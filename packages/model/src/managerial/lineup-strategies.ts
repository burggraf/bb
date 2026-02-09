/**
 * Era-specific lineup construction strategies
 *
 * Implements different batting order philosophies based on baseball era:
 * - Traditional (pre-1980s): Archetype-based lineup construction
 * - Composite (1986-1995): Hybrid approach with power in middle
 * - Early Analytics (1996-2010): OPS-based ordering
 * - Modern (2011+): Optimized lineups (currently same as early analytics)
 */

import type { BatterStats } from '../types.js';
import type { EraStrategy, LineupSlot } from './types.js';

interface ScoredBatter {
	batter: BatterStats;
	score: number;
}

/**
 * Calculate batter score from rates (70% vs RHP, 30% vs LHP)
 *
 * This approximates OPS (On-base Plus Slugging) by combining:
 * - OBP: times reached base (1B, 2B, 3B, HR, BB, HBP)
 * - SLG: total bases (1B + 2*2B + 3*3B + 4*HR)
 *
 * The 70/30 split approximates typical platoon balance in a lineup.
 */
function calculateBatterScore(batter: BatterStats): number {
	const vsRight = batter.rates.vsRight;
	const vsLeft = batter.rates.vsLeft;

	// OBP component (times reached base)
	const obp =
		(vsRight.single +
			vsRight.double +
			vsRight.triple +
			vsRight.homeRun +
			vsRight.walk +
			vsRight.hitByPitch) *
			0.7 +
		(vsLeft.single +
			vsLeft.double +
			vsLeft.triple +
			vsLeft.homeRun +
			vsLeft.walk +
			vsLeft.hitByPitch) *
			0.3;

	// SLG component (total bases)
	const slg =
		(vsRight.single +
			vsRight.double * 2 +
			vsRight.triple * 3 +
			vsRight.homeRun * 4) *
			0.7 +
		(vsLeft.single +
			vsLeft.double * 2 +
			vsLeft.triple * 3 +
			vsLeft.homeRun * 4) *
			0.3;

	return obp + slg; // OPS
}

/**
 * Traditional strategy (pre-1980s)
 *
 * Simplified implementation: assigns batters in OPS order.
 * Full implementation will use slot archetypes (leadoff type, #3 hitter, etc.)
 *
 * Traditional era characteristics:
 * - Emphasis on specific batting order roles
 * - Fast high-OBP players leadoff
 * - Best hitter in #3 slot
 * - Power in cleanup (#4)
 */
export function traditionalStrategy(batters: BatterStats[]): LineupSlot[] {
	const minBatters = 8; // Support both 8 (no DH) and 9 (DH) batters
	if (batters.length < minBatters) {
		throw new Error(`Need at least ${minBatters} batters, got ${batters.length}`);
	}

	const scored = batters.map((b) => ({ batter: b, score: calculateBatterScore(b) }));
	scored.sort((a, b) => b.score - a.score);
	const battingOrderSize = Math.min(scored.length, 9);
	const topBatters = scored.slice(0, battingOrderSize);

	return topBatters.map((item, i) => ({
		playerId: item.batter.id,
		battingOrder: i + 1,
		fieldingPosition: 1 // Placeholder - will be assigned based on defensive needs
	}));
}

/**
 * Composite strategy (1986-1995)
 *
 * Hybrid approach combining traditional and analytics:
 * - Slots 3, 4, 5: Top 3 by OPS (heart of the order)
 * - Slots 1, 2: Next 2 highest OBP (table setters)
 * - Slots 6-9: Remaining by OPS
 *
 * This era saw the emergence of sabermetrics while maintaining
 * traditional lineup structures.
 */
export function compositeStrategy(batters: BatterStats[]): LineupSlot[] {
	const minBatters = 8; // Support both 8 (no DH) and 9 (DH) batters
	if (batters.length < minBatters) {
		throw new Error(`Need at least ${minBatters} batters, got ${batters.length}`);
	}

	const scored = batters.map((b) => ({ batter: b, score: calculateBatterScore(b) }));
	scored.sort((a, b) => b.score - a.score);
	const battingOrderSize = Math.min(scored.length, 9);
	const topBatters = scored.slice(0, battingOrderSize);

	// Create array to hold slots
	const slots: (LineupSlot | null)[] = new Array(battingOrderSize).fill(null);

	// Place top 3 in heart of order (slots 3, 4, 5) - adjust if we only have 8 batters
	if (battingOrderSize >= 5) {
		slots[2] = {
			playerId: topBatters[0].batter.id,
			battingOrder: 3,
			fieldingPosition: 1
		};
		slots[3] = {
			playerId: topBatters[1].batter.id,
			battingOrder: 4,
			fieldingPosition: 1
		};
		slots[4] = {
			playerId: topBatters[2].batter.id,
			battingOrder: 5,
			fieldingPosition: 1
		};

		// Remaining batters for other slots
		const remaining = topBatters.slice(3);

		// Slots 1 and 2: Next two best (table setters)
		if (remaining[0]) {
			slots[0] = {
				playerId: remaining[0].batter.id,
				battingOrder: 1,
				fieldingPosition: 1
			};
		}
		if (remaining[1]) {
			slots[1] = {
				playerId: remaining[1].batter.id,
				battingOrder: 2,
				fieldingPosition: 1
			};
		}

		// Slots 6-9: Rest of the lineup
		if (remaining[2]) {
			slots[5] = {
				playerId: remaining[2].batter.id,
				battingOrder: 6,
				fieldingPosition: 1
			};
		}
		if (remaining[3]) {
			slots[6] = {
				playerId: remaining[3].batter.id,
				battingOrder: 7,
				fieldingPosition: 1
			};
		}
		if (remaining[4]) {
			slots[7] = {
				playerId: remaining[4].batter.id,
				battingOrder: 8,
				fieldingPosition: 1
			};
		}
		if (remaining[5]) {
			slots[8] = {
				playerId: remaining[5].batter.id,
				battingOrder: 9,
				fieldingPosition: 1
			};
		}
	} else {
		// Fallback for fewer than 5 batters - just order by score
		for (let i = 0; i < topBatters.length; i++) {
			slots[i] = {
				playerId: topBatters[i]!.batter.id,
				battingOrder: i + 1,
				fieldingPosition: 1
			};
		}
	}

	// Filter out null slots and return
	return slots.filter((slot): slot is LineupSlot => slot !== null);
}

/**
 * Early-analytics/Modern strategy (1996-present)
 *
 * Returns batters in descending OPS order.
 * This is a simplified implementation - full optimization will consider:
 * - Run expectancy matrices
 * - Plate appearance distributions by lineup slot
 * - Clustered offense (best hitters together)
 *
 * Early Analytics era (1996-2010):
 * - Moneyball revolution
 * - OBP emphasis
 * - Power hitting still valued
 *
 * Modern era (2011+):
 * - Full sabermetric optimization
 * - Launch angle revolution
 * - Bullpen specialization shifts offense strategy
 */
export function earlyAnalyticsStrategy(batters: BatterStats[]): LineupSlot[] {
	const minBatters = 8; // Support both 8 (no DH) and 9 (DH) batters
	if (batters.length < minBatters) {
		throw new Error(`Need at least ${minBatters} batters, got ${batters.length}`);
	}

	const scored = batters.map((b) => ({ batter: b, score: calculateBatterScore(b) }));
	scored.sort((a, b) => b.score - a.score);
	const battingOrderSize = Math.min(scored.length, 9);
	const topBatters = scored.slice(0, battingOrderSize);

	return topBatters.map((item, i) => ({
		playerId: item.batter.id,
		battingOrder: i + 1,
		fieldingPosition: 1 // Placeholder - will be assigned based on defensive needs
	}));
}

/**
 * Strategy function type definition
 */
export type StrategyFunction = (batters: BatterStats[]) => LineupSlot[];

/**
 * Get strategy function by era
 *
 * Returns the appropriate lineup construction function for the given era strategy.
 * Both 'early-analytics' and 'modern' currently use the same implementation.
 */
export function getStrategyFunction(strategy: EraStrategy): StrategyFunction {
	switch (strategy) {
		case 'traditional':
			return traditionalStrategy;
		case 'composite':
			return compositeStrategy;
		case 'early-analytics':
		case 'modern':
			return earlyAnalyticsStrategy;
	}
}

/**
 * Blend two lineups based on blend factor
 * @param primary - Primary lineup (higher weight)
 * @param secondary - Secondary lineup (lower weight, or null)
 * @param blendFactor - 0-1, weight for primary (1 = only primary, 0 = only secondary)
 */
export function blendLineups(
	primary: LineupSlot[],
	secondary: LineupSlot[] | null,
	blendFactor: number
): LineupSlot[] {
	if (!secondary || blendFactor >= 1) return primary;
	if (blendFactor <= 0) return secondary;

	// For each slot, randomly choose primary or secondary based on blendFactor
	// This creates variety while respecting era proportions
	return primary.map((primarySlot, i) => {
		if (Math.random() < blendFactor) {
			return primarySlot;
		}
		return secondary[i] || primarySlot;
	});
}
