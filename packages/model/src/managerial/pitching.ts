/**
 * Pitching Management - Bullpen usage and pitching changes
 */

import type { GameState, PitcherRole, BullpenState, PitchingDecision } from './types.js';

/**
 * Decide whether to pull the current pitcher
 */
export function shouldPullPitcher(
	gameState: GameState,
	pitcher: PitcherRole,
	bullpen: BullpenState,
	randomness = 0.1
): PitchingDecision {
	const { inning, outs, bases, scoreDiff } = gameState;

	// Hard limits
	if (pitcher.pitchesThrown >= 110) {
		return { shouldChange: true, reason: 'Pitch count limit (110)' };
	}

	if (pitcher.stamina <= 20) {
		return { shouldChange: true, reason: 'Fatigue' };
	}

	// Soft limits with randomness
	let pullThreshold = 100;
	let pullChance = 0;

	// Through 6th: 85 pitches
	if (inning <= 6 && pitcher.pitchesThrown >= 85) {
		pullThreshold = 85;
		pullChance = 0.3;
	}

	// 7th inning: 90 pitches
	if (inning === 7 && pitcher.pitchesThrown >= 90) {
		pullThreshold = 90;
		pullChance = 0.5;
	}

	// 8th inning+: 95 pitches
	if (inning >= 8 && pitcher.pitchesThrown >= 95) {
		pullThreshold = 95;
		pullChance = 0.7;
	}

	// Add randomness
	pullChance += randomness;
	pullChance = Math.min(pullChance, 1.0);

	if (pitcher.pitchesThrown >= pullThreshold && Math.random() < pullChance) {
		const newPitcher = selectReliever(gameState, bullpen);
		return {
			shouldChange: true,
			newPitcher: newPitcher.pitcherId,
			reason: 'Pitch count with situation'
		};
	}

	// Situation-based: high leverage, starter tired
	const leverage = calculateLeverageIndex(gameState);
	if (leverage > 2.5 && pitcher.pitchesThrown >= 75) {
		if (Math.random() < 0.7 + randomness) {
			const newPitcher = selectReliever(gameState, bullpen);
			return {
				shouldChange: true,
				newPitcher: newPitcher.pitcherId,
				reason: 'High leverage situation'
			};
		}
	}

	return { shouldChange: false };
}

/**
 * Select the best reliever for current situation
 */
export function selectReliever(gameState: GameState, bullpen: BullpenState): PitcherRole {
	const { inning, outs, scoreDiff } = gameState;

	// Determine if this is the home or away pitching
	const isHomePitching = !gameState.isTopInning;

	// Adjust score diff to be from pitching team's perspective
	const pitchingScoreDiff = isHomePitching ? scoreDiff : -scoreDiff;

	// Save situation: 9th inning+, leading by 1-3 runs
	if (inning >= 9 && pitchingScoreDiff > 0 && pitchingScoreDiff <= 3) {
		return bullpen.closer ?? bullpen.relievers[0];
	}

	// High leverage, late innings - use best reliever
	if (inning >= 7) {
		return bullpen.relievers[0];
	}

	// Earlier: use middle reliever (not necessarily the best)
	// Select from relievers excluding closer if available
	const availableRelievers = bullpen.closer
		? bullpen.relievers.filter((r) => r.pitcherId !== bullpen.closer!.pitcherId)
		: bullpen.relievers;

	if (availableRelievers.length > 0) {
		return availableRelievers[Math.floor(Math.random() * availableRelievers.length)];
	}

	return bullpen.relievers[Math.floor(Math.random() * bullpen.relievers.length)];
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
