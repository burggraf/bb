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

		// Pull thresholds are now absolute BFP values (not fractions of typicalBfp)
		const hardLimit = pullThresholds.hardLimit;
		const considerThreshold = pullThresholds.consider;
		const likelyThreshold = pullThresholds.likely;

		// Workhorses get extended hard limit
		const workhorseBonus = pitcher.isWorkhorse ? 1.2 : 1.0;
		if (pitcher.battersFace >= hardLimit * workhorseBonus) {
			return { shouldChange: true, reason: `Exceeded limit (${pitcher.battersFace} BFP)` };
		}

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

				// Late game with lead: workhorses get extra leeway to finish
				if (inning >= 8 && scoreDiff > 0 && roughness < 0.3) {
					pullChance -= 0.25;
					if (pitcher.isWorkhorse) {
						pullChance -= 0.15; // Extra bonus for workhorses
					}
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

		// Use inning-specific reliever BFP from season data
		// These values represent the 75th percentile of actual historical relief appearances
		let typicalBfp: number;
		if (options?.seasonRelieverBFP) {
			// Use season-specific values from export script (already percentile-based)
			typicalBfp = inning <= 3
				? options.seasonRelieverBFP.early
				: inning <= 6
					? options.seasonRelieverBFP.middle
					: options.seasonRelieverBFP.late;
		} else {
			// Fall back to defaults if no season data
			if (year < 1940) {
				typicalBfp = inning <= 3 ? 36 : inning <= 6 ? 20 : 10;
			} else if (year < 1973) {
				typicalBfp = inning <= 3 ? 28 : inning <= 6 ? 14 : 8;
			} else if (year < 1995) {
				typicalBfp = inning <= 3 ? 24 : inning <= 6 ? 10 : 6;
			} else {
				// Modern era - short specialists
				typicalBfp = inning <= 3 ? 18 : inning <= 6 ? 8 : 5;
			}
		}

		// Clamp to individual reliever's average to avoid exceeding their typical performance
		// But allow some variance for game situations
		typicalBfp = Math.min(typicalBfp, relieverAvg * 1.5);

		// Variance based on BFP - higher variance for shorter outings (modern specialists)
		const variance = typicalBfp > 15 ? 0.20 : 0.35;

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
	// Game situation thresholds based on standard MLB bullpen usage patterns
	const BLOWOUT_RUN_THRESHOLD = 5;  // 5+ runs = low leverage, use any rested reliever
	const SAVE_RUN_MIN = 1;           // Minimum lead for closer to enter
	const SAVE_RUN_MAX = 3;           // Maximum lead for closer to enter
	const CLOSE_GAME_RUN_THRESHOLD = 2; // 2 runs or less = high leverage
	const LATE_INNING_MIN = 7;        // Setup men typically enter in 7th/8th
	const LATE_INNING_MAX = 8;
	const SAVE_INNING_MIN = 9;        // Closer typically enters in 9th+
	const EARLY_INNING_MAX = 6;       // Long relievers for innings 1-6

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

	// === BLOWOUT (5+ run difference) ===
	// Use any rested reliever, save closer/setup
	if (Math.abs(pitchingScoreDiff) >= BLOWOUT_RUN_THRESHOLD) {
		// Use regular relievers first
		const available = bullpen.relievers.find(r => r.pitcherId !== excludePitcherId);
		if (available) return available;
		// Then long relief if available
		if (isEnhanced && enhancedBullpen.longRelief && enhancedBullpen.longRelief.length > 0) {
			const available = enhancedBullpen.longRelief.find(r => r.pitcherId !== excludePitcherId);
			if (available) return available;
		}
		// Desperate times
		return enhancedBullpen.setup?.[0] ?? enhancedBullpen.closer;
	}

	// === SAVE SITUATION: 9th inning+, leading by 1-3 runs ===
	if (inning >= SAVE_INNING_MIN && pitchingScoreDiff >= SAVE_RUN_MIN && pitchingScoreDiff <= SAVE_RUN_MAX) {
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

	// === LATE & CLOSE (7th-8th, close game) ===
	// Check score differential for close game condition
	if (inning >= LATE_INNING_MIN && inning <= LATE_INNING_MAX && Math.abs(pitchingScoreDiff) <= CLOSE_GAME_RUN_THRESHOLD) {
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
	if (inning <= EARLY_INNING_MAX) {
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

	// === DEFAULT: EXTRA INNINGS OR OTHER CASES ===
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
