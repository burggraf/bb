/**
 * Lineup Engine - Generate optimal batting lineups with randomness
 */

import type { BatterStats } from '../types.js';
import type { LineupSlot } from './types.js';

export interface LineupOptions {
	/** Method for calculating batter value */
	method?: 'obp' | 'sabermetric' | 'traditional';
	/** Randomness factor 0-1, default 0.1 (10% randomness) */
	randomness?: number;
}

interface ScoredBatter {
	batter: BatterStats;
	score: number;
}

/**
 * Generate an optimal lineup with randomness
 */
export function generateLineup(
	batters: BatterStats[],
	options: LineupOptions = {}
): LineupSlot[] {
	const { method = 'obp', randomness = 0.1 } = options;

	if (batters.length < 9) {
		throw new Error(`Need at least 9 batters, got ${batters.length}`);
	}

	// Calculate a "lineup score" for each batter
	const scored = batters.map((b) => ({
		batter: b,
		score: calculateLineupScore(b, method)
	}));

	// Sort by score (best first)
	scored.sort((a, b) => b.score - a.score);

	// Take top 9
	let lineup = scored.slice(0, 9);

	// Apply randomness - swap adjacent players
	if (randomness > 0) {
		lineup = applyRandomness(lineup, randomness);
	}

	// Arrange in optimal batting order
	const ordered = optimizeBattingOrder(lineup);

	return ordered.map((item, i) => ({
		playerId: item.batter.id,
		battingOrder: i + 1,
		fieldingPosition: assignPosition(item.batter, i)
	}));
}

/**
 * Calculate batter's lineup score based on method
 */
function calculateLineupScore(batter: BatterStats, method: string): number {
	const vsRight = batter.rates.vsRight;
	const vsLeft = batter.rates.vsLeft;

	// Weighted average (70% vs Right since most pitchers are right-handed)
	const obp =
		(vsRight.walk + vsRight.single + vsRight.double + vsRight.triple + vsRight.homeRun) * 0.7 +
		(vsLeft.walk + vsLeft.single + vsLeft.double + vsLeft.triple + vsLeft.homeRun) * 0.3;

	const slg =
		(vsRight.single + vsRight.double * 2 + vsRight.triple * 3 + vsRight.homeRun * 4) * 0.7 +
		(vsLeft.single + vsLeft.double * 2 + vsLeft.triple * 3 + vsLeft.homeRun * 4) * 0.3;

	switch (method) {
		case 'obp':
			return obp;
		case 'sabermetric':
			return obp * 1.8 + slg * 0.9; // Approximate wOBA weights
		case 'traditional':
			return slg; // Power hitters first
		default:
			return obp;
	}
}

/**
 * Apply randomness by swapping adjacent players
 */
function applyRandomness(
	lineup: ScoredBatter[],
	randomness: number
): ScoredBatter[] {
	const result = [...lineup];
	const numSwaps = Math.floor(Math.random() * 3) + 1; // 1-3 swaps

	for (let i = 0; i < numSwaps; i++) {
		// Only swap if randomness roll passes
		if (Math.random() < randomness) {
			const idx = Math.floor(Math.random() * 8); // 0-7, swap with next
			[result[idx], result[idx + 1]] = [result[idx + 1]!, result[idx]!];
		}
	}

	return result;
}

/**
 * Arrange lineup in optimal batting order
 * Using "The Book" recommendations simplified
 */
function optimizeBattingOrder(lineup: ScoredBatter[]): ScoredBatter[] {
	// For V1, return as-is (already sorted by quality)
	// V2 could implement:
	// - Best hitter #2 or #4
	// - High OBP #1 and #2
	// - Best power #3 and #4
	return lineup;
}

/**
 * Assign fielding position (simplified for V1)
 * For now, positions 1-9 map to standard baseball positions
 * V2 would use actual position data from player stats
 */
function assignPosition(batter: BatterStats, battingOrder: number): number {
	// Simplified: just map batting order to position 1-9
	// 1=Pitcher, 2=Catcher, 3=1B, 4=2B, 5=3B, 6=SS, 7=LF, 8=CF, 9=RF
	// For V1, this is a placeholder
	return (battingOrder % 9) + 1;
}
