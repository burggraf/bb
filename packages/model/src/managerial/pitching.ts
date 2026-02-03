/**
 * Pitching Management - Bullpen usage and pitching changes
 */

import type { GameState, PitcherRole, BullpenState, PitchingDecision } from './types.js';

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
	/** Season-specific average BFP for starters (from season norms) */
	seasonStarterBFP?: number;
	/** Current inning for determining appropriate reliever cap */
	currentInning: number;
}

/**
 * Decide whether to pull the current pitcher
 *
 * Uses pitcher-specific average BFP based on their current role.
 * - Starters: pulled around their typical starter workload
 * - Relievers: use their average but with caps to handle skewed data
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

	// Get pitcher's average BFP for their current role
	const avgBfp = pitcher.role === 'starter'
		? pitcher.avgBfpAsStarter
		: pitcher.avgBfpAsReliever;

	let typicalBfp: number;
	let variance: number;

	if (pitcher.role === 'starter') {
		// === STARTER LOGIC: Complete game considerations ===
		typicalBfp = avgBfp ?? options?.seasonStarterBFP ?? 27;

		// Determine era from typical BFP (higher = earlier era)
		const isEarlyEra = typicalBfp > 29;
		const isMiddleEra = typicalBfp >= 27 && typicalBfp <= 29;
		const isModernEra = typicalBfp < 27;

		// Hard limit: 1.5x average is absolute max
		if (pitcher.battersFace >= typicalBfp * 1.5) {
			return { shouldChange: true, reason: `Exceeded limit (${pitcher.battersFace} BFP)` };
		}

		// Modern era: Pull earlier (at 65% of average) to simulate modern hook
		// Early/Middle era: Pull at average (allow complete games)
		const pullThreshold = (isEarlyEra || isMiddleEra) ? typicalBfp : typicalBfp * 0.55;

		if (pitcher.battersFace >= pullThreshold) {
			let pullChance = 0.5; // Base 50% chance at average

			// === COMPLETE GAME LOGIC: Only for early/middle eras ===
			// Modern baseball: Pull at average regardless of performance
			if (isEarlyEra || isMiddleEra) {
				// 1. How is the pitcher performing today?
				const baserunnersAllowed = pitcher.hitsAllowed + pitcher.walksAllowed;
				const roughness = pitcher.battersFace > 0 ? baserunnersAllowed / pitcher.battersFace : 0;

				if (roughness < 0.2) {
					pullChance -= 0.25; // Pitching great
				} else if (roughness > 0.4) {
					pullChance += 0.15; // Getting hit around
				}

				// 2. Game situation
				if (scoreDiff >= 4) {
					pullChance -= 0.15; // Comfortable lead
				} else if (scoreDiff <= -2 || (scoreDiff >= 0 && scoreDiff <= 2)) {
					pullChance += 0.15; // Losing or close game
				}

				// 3. Inning context - deep in game with lead?
				if (inning >= 8 && scoreDiff > 0 && roughness < 0.3) {
					pullChance -= 0.25;
				}

				// 4. Era-specific adjustments
				if (isEarlyEra) {
					// Early era: Managers let starters finish
					if (roughness < 0.3) {
						pullChance -= 0.2;
					}
					if (pitcher.battersFace < typicalBfp * 1.2 && roughness < 0.4) {
						pullChance = Math.min(pullChance, 0.3);
					}
				} else if (roughness < 0.25) {
					pullChance -= 0.1;
				}
			} else {
				// Modern era: Pull at average regardless of how they're pitching
				// Maybe slightly more lenient if absolutely dominating
				const baserunnersAllowed = pitcher.hitsAllowed + pitcher.walksAllowed;
				const roughness = pitcher.battersFace > 0 ? baserunnersAllowed / pitcher.battersFace : 0;
				if (roughness < 0.1) {
					// Perfect game / no-hitter type performance
					pullChance -= 0.1;
				}
			}

			pullChance += randomness;
			pullChance = Math.max(0.1, Math.min(pullChance, 1.0));

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

		// Before reaching average, only pull for serious issues
		if (pitcher.battersFace >= typicalBfp * 0.8) {
			const baserunnersAllowed = pitcher.hitsAllowed + pitcher.walksAllowed;
			const roughness = pitcher.battersFace > 0 ? baserunnersAllowed / pitcher.battersFace : 0;

			if (roughness > 0.5) {
				if (Math.random() < 0.4 + randomness) {
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
		// Relievers use their personal average, capped at inning-group appropriate maximum
		const relieverAvg = avgBfp ?? 12;

		// Determine the appropriate cap based on current inning
		let seasonCap: number;
		if (options?.seasonRelieverBFP) {
			if (inning <= 3) {
				seasonCap = options.seasonRelieverBFP.early;
			} else if (inning <= 6) {
				seasonCap = options.seasonRelieverBFP.middle;
			} else {
				seasonCap = options.seasonRelieverBFP.late;
			}
		} else {
			// Fallback defaults if no season data
			seasonCap = inning <= 3 ? 15 : inning <= 6 ? 10 : 6;
		}

		// Cap at the inning-group average to handle swingmen with inflated reliever averages
		// E.g., a swingman with avgBfpAsReliever=18 entering in 8th gets capped at late-game avg (~4-6)
		typicalBfp = Math.min(relieverAvg, seasonCap);
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
export function selectReliever(gameState: GameState, bullpen: BullpenState, excludePitcherId?: string): PitcherRole | undefined {
	const { inning, outs, scoreDiff } = gameState;

	// Determine if this is the home or away pitching
	const isHomePitching = !gameState.isTopInning;

	// Adjust score diff to be from pitching team's perspective
	const pitchingScoreDiff = isHomePitching ? scoreDiff : -scoreDiff;

	// Save situation: 9th inning+, leading by 1-3 runs
	if (inning >= 9 && pitchingScoreDiff > 0 && pitchingScoreDiff <= 3) {
		const available = bullpen.closer && bullpen.closer.pitcherId !== excludePitcherId
			? bullpen.closer
			: bullpen.relievers.find(r => r.pitcherId !== excludePitcherId);
		return available;
	}

	// High leverage, late innings - use best reliever
	if (inning >= 7) {
		const available = bullpen.relievers.find(r => r.pitcherId !== excludePitcherId);
		return available;
	}

	// Earlier: use middle reliever (not necessarily the best)
	// Select from relievers excluding closer if available, and also excluding the specified pitcher
	let availableRelievers = bullpen.relievers.filter((r) => r.pitcherId !== excludePitcherId);
	if (bullpen.closer && bullpen.closer.pitcherId !== excludePitcherId) {
		availableRelievers = availableRelievers.filter((r) => r.pitcherId !== bullpen.closer!.pitcherId);
	}

	if (availableRelievers.length > 0) {
		return availableRelievers[Math.floor(Math.random() * availableRelievers.length)];
	}

	// No relievers available
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
