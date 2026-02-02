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
 * Options for pinch-hit decision
 */
export interface PinchHitOptions {
	randomness?: number;
	/** Lower thresholds to increase PH frequency (for season-based frequency control) */
	relaxedThresholds?: boolean;
}

/**
 * Decide whether to pinch-hit for the current batter
 */
export function shouldPinchHit(
	gameState: GameState,
	currentBatter: BatterStats,
	bench: BatterStats[],
	opposingPitcher: PitcherStats,
	options: number | PinchHitOptions = 0.15
): PinchHitDecision {
	// Handle legacy API where randomness was passed as a number
	const randomness = typeof options === 'number' ? options : (options.randomness ?? 0.15);
	const relaxedThresholds = typeof options === 'object' ? options.relaxedThresholds ?? false : false;
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

	// Relaxed thresholds: only require leverage >= 0.7 (vs 1.0) and no platoon requirement
	const minLeverage = relaxedThresholds ? 0.7 : 1.0;
	const platoonRequiredLeverage = relaxedThresholds ? 0.7 : 2.0;

	if (!hasDisadvantage && leverage < platoonRequiredLeverage) {
		// No platoon issue, moderate leverage - stick with current
		return { shouldPinchHit: false };
	}

	// Find better option on bench (or any option if relaxed)
	const betterOption = findBestPinchHitter(bench, opposingPitcher, currentBatter, relaxedThresholds);

	if (!betterOption) {
		return { shouldPinchHit: false };
	}

	// Decision matrix with randomness
	let phChance = 0;

	// High leverage + platoon disadvantage
	if (leverage >= 2.0 && hasDisadvantage) {
		phChance = relaxedThresholds ? 1.0 : 0.8;
	}
	// High leverage only
	else if (leverage >= 2.0) {
		phChance = relaxedThresholds ? 0.95 : 0.5;
	}
	// Platoon disadvantage + medium leverage
	else if (hasDisadvantage && leverage >= 1.3) {
		phChance = relaxedThresholds ? 0.95 : 0.6;
	}
	// Late game close
	else if (inning >= 8 && Math.abs(scoreDiff) <= 2) {
		phChance = relaxedThresholds ? 0.90 : 0.4;
	}
	// Relaxed: 6th inning+ with leverage >= 0.5
	else if (relaxedThresholds && leverage >= 0.5) {
		phChance = 0.95;
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
	currentBatter: BatterStats,
	relaxedThresholds = false
): BatterStats | null {
	if (bench.length === 0) return null;

	const pitcherHandedness = opposingPitcher.handedness;

	// Get relevant rates function - use OPS (OBP + SLG) for more comprehensive evaluation
	const getOPS = (b: BatterStats) => {
		const rates = pitcherHandedness === 'L' ? b.rates.vsLeft : b.rates.vsRight;
		// OBP = (H + BB + HBP) / PA, but we use rates directly
		const obp = rates.walk + rates.single + rates.double + rates.triple + rates.homeRun;
		// SLG = (1B + 2B*2 + 3B*3 + HR*4) / AB, approximated with rates
		const slg =
			rates.single * 1 +
			rates.double * 2 +
			rates.triple * 3 +
			rates.homeRun * 4;
		return obp + slg; // Simple OPS approximation
	};

	const currentOPS = getOPS(currentBatter);

	// Find bench players with better matchup
	const candidates = bench
		.map((b) => {
			const ops = getOPS(b);
			return {
				batter: b,
				ops,
				improvement: ops - currentOPS
			};
		})
		.filter((c) => {
			if (relaxedThresholds) {
				// Relaxed: require better OPS or at least 90% of current OPS
				return c.improvement > 0 || c.ops >= currentOPS * 0.9;
			}
			return c.improvement > 0; // Strict: must be better
		})
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
