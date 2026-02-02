/**
 * Substitution Engine - Pinch-hitter decisions
 */

import type { GameState } from './types.js';
import type { BatterStats, PitcherStats } from '../types.js';
import { calculateLeverageIndex } from './pitching.js';
import { isPlatoonDisadvantage } from './platoon.js';

/**
 * Decision about whether to pinch-hit
 */
export interface PinchHitDecision {
	shouldPinchHit: boolean;
	pinchHitterId?: string;
	reason?: string;
}

/**
 * Decide whether to pinch-hit for the current batter
 */
export function shouldPinchHit(
	gameState: GameState,
	currentBatter: BatterStats,
	bench: BatterStats[],
	opposingPitcher: PitcherStats,
	randomness = 0.15
): PinchHitDecision {
	const { inning, outs, bases, scoreDiff } = gameState;

	// Early game: rarely PH
	if (inning < 6) {
		return { shouldPinchHit: false };
	}

	// Calculate leverage
	const leverage = calculateLeverageIndex(gameState);

	// Low leverage: don't PH
	if (leverage < 1.0) {
		return { shouldPinchHit: false };
	}

	// Check for platoon disadvantage
	const pitcherHandedness = opposingPitcher.handedness;
	const batterHandedness = currentBatter.handedness;

	const hasDisadvantage = isPlatoonDisadvantage(batterHandedness, pitcherHandedness);

	if (!hasDisadvantage && leverage < 2.0) {
		// No platoon issue, moderate leverage - stick with current
		return { shouldPinchHit: false };
	}

	// Find better option on bench
	const betterOption = findBestPinchHitter(bench, opposingPitcher, currentBatter);

	if (!betterOption) {
		return { shouldPinchHit: false };
	}

	// Decision matrix with randomness
	let phChance = 0;

	// High leverage + platoon disadvantage
	if (leverage >= 2.0 && hasDisadvantage) {
		phChance = 0.8;
	}
	// High leverage only
	else if (leverage >= 2.0) {
		phChance = 0.5;
	}
	// Platoon disadvantage + medium leverage
	else if (hasDisadvantage && leverage >= 1.3) {
		phChance = 0.6;
	}
	// Late game close
	else if (inning >= 8 && Math.abs(scoreDiff) <= 2) {
		phChance = 0.4;
	}

	// Add randomness and apply
	phChance += randomness;
	phChance = Math.min(phChance, 1.0);

	if (Math.random() < phChance) {
		return {
			shouldPinchHit: true,
			pinchHitterId: betterOption.id,
			reason: `Pinch hit for ${currentBatter.name} (${betterOption.name})`
		};
	}

	return { shouldPinchHit: false };
}

/**
 * Find best pinch-hitter from bench
 */
function findBestPinchHitter(
	bench: BatterStats[],
	opposingPitcher: PitcherStats,
	currentBatter: BatterStats
): BatterStats | null {
	if (bench.length === 0) return null;

	const pitcherHandedness = opposingPitcher.handedness;

	// Get relevant rates function
	const getOBP = (b: BatterStats) => {
		const rates = pitcherHandedness === 'L' ? b.rates.vsLeft : b.rates.vsRight;
		return rates.walk + rates.single + rates.double + rates.triple + rates.homeRun;
	};

	const currentOBP = getOBP(currentBatter);

	// Find bench players with better matchup
	const candidates = bench
		.map((b) => ({
			batter: b,
			obp: getOBP(b),
			improvement: 0
		}))
		.map((c) => ({
			batter: c.batter,
			improvement: c.obp - currentOBP
		}))
		.filter((c) => c.improvement > 0) // Must be better
		.sort((a, b) => b.improvement - a.improvement);

	if (candidates.length === 0) return null;

	// Add randomness: sometimes take 2nd or 3rd best
	const randomFactor = Math.random();
	if (randomFactor < 0.7 || candidates.length === 1) {
		return candidates[0].batter;
	} else if (randomFactor < 0.9 && candidates.length >= 2) {
		return candidates[1].batter;
	} else if (candidates.length >= 3) {
		return candidates[2].batter;
	}

	return candidates[candidates.length - 1].batter;
}

/**
 * Check if a player is available on the bench (not in current lineup)
 */
export function isAvailableOnBench(
	playerId: string,
	currentLineup: string[],
	usedPlayers: string[]
): boolean {
	return !currentLineup.includes(playerId) && !usedPlayers.includes(playerId);
}

/**
 * Get available bench players from a full roster
 */
export function getAvailableBench(
	allBatters: BatterStats[],
	currentLineup: string[],
	usedPlayers: string[]
): BatterStats[] {
	return allBatters.filter((b) => isAvailableOnBench(b.id, currentLineup, usedPlayers));
}
