/**
 * Pitching Management - Bullpen usage and pitching changes
 */

import type { GameState, PitcherRole, BullpenState, EnhancedBullpenState, PitchingDecision } from './types.js';

/**
 * Options for customizing pitch count limits by era
 */
export interface PitchCountOptions {
	/** Hard limit after which pitcher must be pulled */
	hardLimit: number;
	/** Typical limit for starting pitchers */
	typicalLimit: number;
	/** Pitch count where fatigue begins to set in */
	fatigueThreshold: number;
}

/**
 * Default modern-era pitch count limits (used if no options provided)
 */
const DEFAULT_PITCH_COUNT_OPTIONS: PitchCountOptions = {
	hardLimit: 110,
	typicalLimit: 100,
	fatigueThreshold: 85,
};

/**
 * Options for pull decisions - use season-specific data from season norms
 */
export interface PullDecisionOptions {
	/** Season-specific average BFP for relievers by inning group */
	seasonRelieverBFP?: {
		/** Early game (innings 1-3) */
		early: number;
		/** Middle game (innings 4-6) */
		middle: number;
		/** Late game (innings 7+) */
		late: number;
	};
	/** Season-specific overall average BFP for relievers (from season norms) */
	seasonRelieverBFPOverall?: number;
	/** Season-specific average BFP for starters (from season norms) */
	seasonStarterBFP?: number;
	/** Current inning for determining appropriate reliever cap */
	currentInning: number;
	/** Season year for era determination */
	year?: number;
	/** Is the pitching team in a DH game? */
	usesDH?: boolean;
	/** Season-specific pull thresholds (overrides year-based calculation) */
	pullThresholds?: {
		consider: number;
		likely: number;
		hardLimit: number;
	};
	/** Season-specific era minimum reliever caps */
	eraMinRelieverCaps?: {
		early: number;
		middle: number;
		late: number;
	};
}

/**
 * Era-specific pitching configuration
 * Based on historical analysis of MLB pitcher usage patterns
 */
interface EraConfig {
	/** Era name */
	name: string;
	/** Expected number of pitchers used per game (for validation) */
	expectedPitchersPerGame: number;
	/** Starter pull thresholds as percentage of average BFP */
	starterPullThresholds: {
		/** When to start considering pull (fraction of avg BFP) */
		consider: number;
		/** When pull is likely (fraction of avg BFP) */
		likely: number;
		/** Hard limit (fraction of avg BFP) */
		hardLimit: number;
	};
	/** Complete game allowance */
	completeGame: {
		/** Maximum CG rate as fraction of starts */
		maxCGRate: number;
		/** Performance bonus for good games */
		performanceBonus: boolean;
	};
}

/**
 * Get era configuration based on year
 * Uses year-based era detection instead of inferring from BFP
 */
function getEraConfig(year: number, usesDH: boolean): EraConfig {
	// Non-DH games typically use more pitchers (pinch-hitting for pitchers)
	const dhAdjustment = usesDH ? 0 : 0.5;

	if (year < 1920) {
		// Deadball Era: High complete game rate (~75%)
		// Starters routinely pitched 30+ batters, pull thresholds reflect this
		return {
			name: 'deadball',
			expectedPitchersPerGame: 3.2,
			starterPullThresholds: { consider: 1.0, likely: 1.2, hardLimit: 1.4 },
			completeGame: { maxCGRate: 0.75, performanceBonus: true }
		};
	} else if (year < 1947) {
		// Integration Era: Still high CG rate (~72%)
		return {
			name: 'integration',
			expectedPitchersPerGame: 3.7,
			starterPullThresholds: { consider: 1.0, likely: 1.15, hardLimit: 1.35 },
			completeGame: { maxCGRate: 0.72, performanceBonus: true }
		};
	} else if (year < 1969) {
		// Golden Age: Declining but still significant CG rate (~61%)
		return {
			name: 'golden-age',
			expectedPitchersPerGame: 4.8,
			starterPullThresholds: { consider: 0.80, likely: 0.95, hardLimit: 1.25 },
			completeGame: { maxCGRate: 0.61, performanceBonus: true }
		};
	} else if (year < 1973) {
		// Early DH Era: Transition period (~61% CG)
		return {
			name: 'early-dh',
			expectedPitchersPerGame: 5.1,
			starterPullThresholds: { consider: 0.75, likely: 0.90, hardLimit: 1.2 },
			completeGame: { maxCGRate: 0.61, performanceBonus: true }
		};
	} else if (year < 1995) {
		// DH Era: Modern bullpen usage begins (~54-58% CG depending on DH)
		return {
			name: 'dh-era',
			expectedPitchersPerGame: 5.2 + dhAdjustment,
			starterPullThresholds: { consider: 0.70, likely: 0.90, hardLimit: 1.2 },
			completeGame: { maxCGRate: usesDH ? 0.58 : 0.54, performanceBonus: true }
		};
	} else if (year < 2009) {
		// Modern Era: Specialization begins (~46-49% CG)
		return {
			name: 'modern',
			expectedPitchersPerGame: 7.1 + dhAdjustment,
			starterPullThresholds: { consider: 0.65, likely: 0.85, hardLimit: 1.15 },
			completeGame: { maxCGRate: usesDH ? 0.49 : 0.46, performanceBonus: false }
		};
	} else {
		// Analytics Era: Heavy specialization (~25-31% CG)
		return {
			name: 'analytics',
			expectedPitchersPerGame: 8.0 + dhAdjustment,
			starterPullThresholds: { consider: 0.55, likely: 0.80, hardLimit: 1.1 },
			completeGame: { maxCGRate: usesDH ? 0.31 : 0.25, performanceBonus: false }
		};
	}
}

/**
 * Decide whether to pull the current pitcher
 *
 * Uses era-specific pull thresholds based on year and DH status.
 * - Starters: pulled based on era-appropriate BFP thresholds
 * - Relievers: use their average but with caps by inning group
 *   - Pure relievers (no starter data): avgBfpAsReliever capped at 6 (modern specialists)
 *   - Swingmen (have starter data): avgBfpAsReliever capped at 12 (can go longer)
 */
export function shouldPullPitcher(
	gameState: GameState,
	pitcher: PitcherRole,
	bullpen: BullpenState,
	randomness = 0.1,
	options?: PullDecisionOptions
): PitchingDecision {
	const { inning, scoreDiff } = gameState;

	// Get era configuration (default to 1976 if year not provided)
	const year = options?.year ?? 1976;
	const usesDH = options?.usesDH ?? false;

	// Use season-specific pull thresholds if provided, otherwise fall back to year-based
	let pullThresholds: { consider: number; likely: number; hardLimit: number };
	let performanceBonus: boolean;

	if (options?.pullThresholds) {
		// Season-specific values from export script
		pullThresholds = options.pullThresholds;
		// Performance bonus based on era (CG rates declined over time)
		performanceBonus = year < 1995;
	} else {
		// Fall back to year-based era config
		const eraConfig = getEraConfig(year, usesDH);
		pullThresholds = eraConfig.starterPullThresholds;
		performanceBonus = eraConfig.completeGame.performanceBonus;
	}

	// Get pitcher's average BFP for their current role
	const avgBfp = pitcher.role === 'starter'
		? pitcher.avgBfpAsStarter
		: pitcher.avgBfpAsReliever;

	let typicalBfp: number;
	let variance: number;

	if (pitcher.role === 'starter') {
		// === STARTER LOGIC: Era-specific complete game considerations ===
		typicalBfp = avgBfp ?? options?.seasonStarterBFP ?? 27;

		// Hard limit: exceeded hard limit threshold
		const hardLimit = typicalBfp * pullThresholds.hardLimit;
		if (pitcher.battersFace >= hardLimit) {
			return { shouldChange: true, reason: `Exceeded limit (${pitcher.battersFace} BFP)` };
		}

		// Consider pull threshold
		const considerThreshold = typicalBfp * pullThresholds.consider;
		const likelyThreshold = typicalBfp * pullThresholds.likely;

		if (pitcher.battersFace >= considerThreshold) {
			// Calculate base pull chance based on BFP progress
			const bfpProgress = (pitcher.battersFace - considerThreshold) / (likelyThreshold - considerThreshold);
			let pullChance = 0.2 + bfpProgress * 0.5; // 20% at consider, 70% at likely

			// Performance-based adjustment (only for eras that allow CG bonuses)
			if (performanceBonus) {
				const baserunnersAllowed = pitcher.hitsAllowed + pitcher.walksAllowed;
				const roughness = pitcher.battersFace > 0 ? baserunnersAllowed / pitcher.battersFace : 0;

				// Reduce pull chance for good performances
				if (roughness < 0.15) {
					pullChance -= 0.3; // Dominating
				} else if (roughness < 0.25) {
					pullChance -= 0.15; // Pitching well
				} else if (roughness > 0.5) {
					pullChance += 0.2; // Getting hit around
				}

				// Game situation adjustments
				if (scoreDiff >= 4) {
					pullChance -= 0.1; // Comfortable lead
				} else if (scoreDiff <= -2) {
					pullChance += 0.15; // Losing
				}

				// Late game with lead: let them finish
				if (inning >= 8 && scoreDiff > 0 && roughness < 0.3) {
					pullChance -= 0.25;
				}
			} else {
				// Modern/analytics era: performance matters less, adherence to limits matters more
				// Only extreme performances get consideration
				const baserunnersAllowed = pitcher.hitsAllowed + pitcher.walksAllowed;
				const roughness = pitcher.battersFace > 0 ? baserunnersAllowed / pitcher.battersFace : 0;
				if (roughness < 0.08) {
					// Perfect game / no-hitter type performance
					pullChance -= 0.15;
				} else if (roughness > 0.6) {
					// Getting shelled
					pullChance += 0.25;
				}
			}

			pullChance += randomness;
			pullChance = Math.max(0.05, Math.min(pullChance, 0.95));

			if (Math.random() < pullChance) {
				const newPitcher = selectReliever(gameState, bullpen, pitcher.pitcherId);
				if (newPitcher) {
					return {
						shouldChange: true,
						newPitcher: newPitcher.pitcherId,
						reason: `BFP count (${pitcher.battersFace}/${typicalBfp.toFixed(0)} avg)`
					};
				}
			}
		}

		// Early pull for terrible performance (any era)
		if (pitcher.battersFace >= typicalBfp * 0.5) {
			const baserunnersAllowed = pitcher.hitsAllowed + pitcher.walksAllowed;
			const roughness = pitcher.battersFace > 0 ? baserunnersAllowed / pitcher.battersFace : 0;

			if (roughness > 0.6) {
				if (Math.random() < 0.5 + randomness) {
					const newPitcher = selectReliever(gameState, bullpen, pitcher.pitcherId);
					if (newPitcher) {
						return {
							shouldChange: true,
							newPitcher: newPitcher.pitcherId,
							reason: 'Pitching ineffectively'
						};
					}
				}
			}
		}

		return { shouldChange: false };
	} else {
		// === RELIEVER LOGIC ===
		const relieverAvg = avgBfp ?? 12;

		// Determine era-specific MINIMUM caps (these are floors, not ceilings)
		// Use season-specific values if available, otherwise fall back to year-based
		let eraMinCap: number;
		if (options?.eraMinRelieverCaps) {
			// Use season-specific caps from export script
			eraMinCap = inning <= 3
				? options.eraMinRelieverCaps.early
				: inning <= 6
					? options.eraMinRelieverCaps.middle
					: options.eraMinRelieverCaps.late;
		} else {
			// Fall back to year-based era determination
			if (year < 1940) {
				// Deadball/Integration: Long relievers routinely pitched 3+ innings
				eraMinCap = inning <= 3 ? 18 : inning <= 6 ? 14 : 10;
			} else if (year < 1973) {
				eraMinCap = inning <= 3 ? 16 : inning <= 6 ? 12 : 8;
			} else if (year < 1995) {
				eraMinCap = inning <= 3 ? 12 : inning <= 6 ? 8 : 5;
			} else {
				// Modern era - strict caps
				eraMinCap = inning <= 3 ? 9 : inning <= 6 ? 6 : 4;
			}
		}

		// Use the overall season average for capping, which better represents typical reliever usage
		// The inning-specific values are too low as they include short specialists
		let seasonCap: number;
		if (options?.seasonRelieverBFPOverall) {
			// Use the overall average as the cap, which includes all reliever types
			// This allows both short and long relievers to perform according to their actual ability
			seasonCap = Math.max(eraMinCap, options.seasonRelieverBFPOverall);
		} else if (options?.seasonRelieverBFP) {
			// Fall back to inning-specific values if overall not available
			const normBFP = inning <= 3
				? options.seasonRelieverBFP.early
				: inning <= 6
					? options.seasonRelieverBFP.middle
					: options.seasonRelieverBFP.late;
			// Use 2.5x to account for overall being higher than inning-specific
			seasonCap = Math.max(eraMinCap, normBFP * 2.5);
		} else {
			seasonCap = eraMinCap * 2.5;
		}

		// Cap at the season cap to handle swingmen with inflated reliever averages
		// But ensure we don't cap below the era minimum
		typicalBfp = Math.max(Math.min(relieverAvg, seasonCap), eraMinCap);
		// Lower variance for early eras (relievers pitched longer), higher for modern (specialists)
		variance = seasonCap > 10 ? 0.15 : 0.30;
	}

	const lowerThreshold = typicalBfp * (1 - variance);
	const upperThreshold = typicalBfp * (1 + variance);

	// Hard limit: exceeded upper threshold
	if (pitcher.battersFace >= upperThreshold) {
		return { shouldChange: true, reason: `Exceeded limit (${pitcher.battersFace} BFP)` };
	}

	// Start considering pull when at lower threshold
	if (pitcher.battersFace >= lowerThreshold) {
		let pullChance = 0.3; // Base 30% chance at lower threshold

		// Increase chance as we approach upper threshold
		const bfpProgress = (pitcher.battersFace - lowerThreshold) / (upperThreshold - lowerThreshold);
		pullChance += bfpProgress * 0.4; // Up to 70% at upper threshold

		// Later innings = more aggressive pulling
		if (inning >= 9) {
			pullChance += 0.15;
		} else if (inning >= 7) {
			pullChance += 0.1;
		}


		// Add randomness
		pullChance += randomness;
		pullChance = Math.min(pullChance, 1.0);

		if (Math.random() < pullChance) {
			const newPitcher = selectReliever(gameState, bullpen, pitcher.pitcherId);
			if (newPitcher) {
				return {
					shouldChange: true,
					newPitcher: newPitcher.pitcherId,
					reason: `BFP count (${pitcher.battersFace}/${typicalBfp.toFixed(0)} avg)`
				};
			}
		}
	}

	// Situation-based: high leverage, consider pull even earlier
	const leverage = calculateLeverageIndex(gameState);
	if (leverage > 2.0 && pitcher.battersFace >= lowerThreshold * 0.8) {
		if (Math.random() < 0.7 + randomness) {
			const newPitcher = selectReliever(gameState, bullpen, pitcher.pitcherId);
			if (newPitcher) {
				return {
					shouldChange: true,
					newPitcher: newPitcher.pitcherId,
					reason: 'High leverage situation'
				};
			}
		}
	}

	return { shouldChange: false };
}

/**
 * Select the best reliever for current situation
 *
 * @param gameState - Current game state
 * @param bullpen - Available bullpen
 * @param excludePitcherId - Optional pitcher ID to exclude from selection (e.g., current pitcher)
 * @returns Selected reliever, or undefined if no relievers available
 */
export function selectReliever(
	gameState: GameState,
	bullpen: BullpenState | EnhancedBullpenState,
	excludePitcherId?: string
): PitcherRole | undefined {
	const { inning, scoreDiff } = gameState;

	// Determine if this is the home or away pitching
	const isHomePitching = !gameState.isTopInning;

	// Adjust score diff to be from pitching team's perspective
	const pitchingScoreDiff = isHomePitching ? scoreDiff : -scoreDiff;

	// Helper to check if pitcher is available
	const isAvailable = (p: PitcherRole): boolean => p.pitcherId !== excludePitcherId;

	// Check if this is an enhanced bullpen with role-specific relievers
	const isEnhanced = 'setup' in bullpen || 'longRelief' in bullpen;
	const enhancedBullpen = bullpen as EnhancedBullpenState;

	// === SAVE SITUATION: 9th inning+, leading by 1-3 runs ===
	if (inning >= 9 && pitchingScoreDiff > 0 && pitchingScoreDiff <= 3) {
		// Use closer if available
		if (enhancedBullpen.closer && isAvailable(enhancedBullpen.closer)) {
			return enhancedBullpen.closer;
		}

		// Fall back to setup men if closer unavailable
		if (isEnhanced && enhancedBullpen.setup) {
			const availableSetup = enhancedBullpen.setup.find(isAvailable);
			if (availableSetup) return availableSetup;
		}

		// Fall back to regular relievers
		const availableReliever = bullpen.relievers.find(isAvailable);
		if (availableReliever) return availableReliever;

		return undefined;
	}

	// === LATE INNINGS (7th-8th): HIGH LEVERAGE ===
	if (inning >= 7 && inning <= 8) {
		// Prefer setup men in enhanced bullpens
		if (isEnhanced && enhancedBullpen.setup && enhancedBullpen.setup.length > 0) {
			const availableSetup = enhancedBullpen.setup.find(isAvailable);
			if (availableSetup) return availableSetup;
		}

		// Fall back to regular relievers
		const availableReliever = bullpen.relievers.find(isAvailable);
		if (availableReliever) return availableReliever;

		// Last resort: use closer (not ideal, but better than no one)
		if (bullpen.closer && isAvailable(bullpen.closer)) {
			return bullpen.closer;
		}

		return undefined;
	}

	// === EARLY/MIDDLE INNINGS (1st-6th) ===
	if (inning <= 6) {
		// Prefer long relievers in early innings
		if (isEnhanced && enhancedBullpen.longRelief && enhancedBullpen.longRelief.length > 0) {
			const availableLong = enhancedBullpen.longRelief.find(isAvailable);
			if (availableLong) return availableLong;
		}

		// Fall back to regular relievers (middle relievers)
		const availableReliever = bullpen.relievers.find(isAvailable);
		if (availableReliever) return availableReliever;

		// In a pinch, use setup men (not ideal, but available)
		if (isEnhanced && enhancedBullpen.setup) {
			const availableSetup = enhancedBullpen.setup.find(isAvailable);
			if (availableSetup) return availableSetup;
		}

		return undefined;
	}

	// === EXTRA INNINGS (10th+): HIGH LEVERAGE ===
	if (inning > 9) {
		// Use best available: closer, setup, or regular reliever
		if (bullpen.closer && isAvailable(bullpen.closer)) {
			return bullpen.closer;
		}

		if (isEnhanced && enhancedBullpen.setup) {
			const availableSetup = enhancedBullpen.setup.find(isAvailable);
			if (availableSetup) return availableSetup;
		}

		const availableReliever = bullpen.relievers.find(isAvailable);
		if (availableReliever) return availableReliever;

		if (isEnhanced && enhancedBullpen.longRelief) {
			const availableLong = enhancedBullpen.longRelief.find(isAvailable);
			if (availableLong) return availableLong;
		}

		return undefined;
	}

	// Fallback: any available reliever
	const anyAvailable = bullpen.relievers.find(isAvailable);
	return anyAvailable;
}

/**
 * Simple leverage index calculation
 *
 * Leverage Index (LI) measures the importance of a game situation.
 * Average LI = 1.0. Higher values = more critical situations.
 *
 * Simplified calculation based on:
 * - Inning (later = higher leverage)
 * - Score difference (close game = higher leverage)
 * - Base state (runners on = higher leverage)
 * - Outs (fewer outs = slightly higher leverage)
 */
export function calculateLeverageIndex(state: GameState): number {
	const { inning, outs, bases, scoreDiff, isTopInning } = state;

	// Base leverage by inning
	let baseLI = 1.0;
	if (inning >= 7) baseLI = 1.2;
	if (inning >= 8) baseLI = 1.5;
	if (inning >= 9) baseLI = 2.0;

	// Extra innings are very high leverage
	if (inning > 9) {
		baseLI = 2.0 + (inning - 9) * 0.2;
	}

	// Score difference (close game = higher leverage)
	const absScoreDiff = Math.abs(scoreDiff);
	if (absScoreDiff <= 1) baseLI *= 1.5;
	else if (absScoreDiff <= 2) baseLI *= 1.2;
	else if (absScoreDiff <= 3) baseLI *= 1.1;
	else if (absScoreDiff >= 5) baseLI *= 0.7; // Blowout - lower leverage

	// Tied game in late innings is very high leverage
	if (scoreDiff === 0 && inning >= 9) {
		baseLI *= 2.0;
	}

	// Base state (runners on base)
	const runnersOnBase = bases.filter((b) => b !== null).length;
	if (runnersOnBase === 1) baseLI *= 1.1;
	if (runnersOnBase === 2) baseLI *= 1.3;
	if (runnersOnBase === 3) baseLI *= 1.8;

	// Outs
	if (outs === 0) baseLI *= 1.1;
	if (outs === 2) baseLI *= 1.2; // 2 outs - last chance

	return baseLI;
}

/**
 * Calculate pitcher stamina reduction
 * Call this after each plate appearance to update stamina
 */
export function reduceStamina(
	currentStamina: number,
	pitchesInPa: number,
	maxPitches: number
): number {
	// Stamina reduces more quickly as pitcher gets tired
	const fatigueFactor = 1 + (maxPitches - currentStamina) / 100;
	const reduction = pitchesInPa * fatigueFactor;
	return Math.max(0, currentStamina - reduction);
}
