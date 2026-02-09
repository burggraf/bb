// lineup-strategies.test.ts
import { describe, it, expect } from 'vitest';
import type { BatterStats } from '../types.js';
import {
	traditionalStrategy,
	compositeStrategy,
	earlyAnalyticsStrategy,
	getStrategyFunction
} from './lineup-strategies.js';
import type { EraStrategy } from './types.js';

// Helper to create mock batter with custom rates
function createMockBatter(
	id: string,
	obp: number,
	slg: number
): BatterStats {
	// Create rates that produce the desired OBP and SLG
	// OBP = (1B + 2B + 3B + HR + BB + HBP) / PA
	// SLG = (1B + 2*2B + 3*3B + 4*HR) / AB
	// For simplicity, we'll create normalized rates that sum to 1
	const outRate = 1 - obp;
	const hrRate = slg * 0.1; // Rough approximation
	const tripleRate = slg * 0.02;
	const doubleRate = slg * 0.08;
	const singleRate = obp - hrRate - tripleRate - doubleRate - (obp * 0.15); // Reserve space for walks
	const walkRate = obp * 0.12;
	const hbpRate = obp * 0.03;

	const baseRates = {
		single: Math.max(0, singleRate),
		double: Math.max(0, doubleRate),
		triple: Math.max(0, tripleRate),
		homeRun: Math.max(0, hrRate),
		walk: Math.max(0, walkRate),
		hitByPitch: Math.max(0, hbpRate),
		strikeout: outRate * 0.2,
		groundOut: outRate * 0.4,
		flyOut: outRate * 0.25,
		lineOut: outRate * 0.08,
		popOut: outRate * 0.05,
		sacrificeFly: 0.005,
		sacrificeBunt: 0.005,
		fieldersChoice: 0.01,
		reachedOnError: 0.01,
		catcherInterference: 0.001
	};

	return {
		id,
		name: `Player ${id}`,
		handedness: 'R',
		rates: {
			vsLeft: { ...baseRates },
			vsRight: { ...baseRates }
		}
	};
}

describe('traditionalStrategy', () => {
	it('returns 9 lineup slots', () => {
		const batters = Array.from({ length: 9 }, (_, i) =>
			createMockBatter(`p${i}`, 0.3 + i * 0.01, 0.4 + i * 0.01)
		);

		const result = traditionalStrategy(batters);

		expect(result).toHaveLength(9);
	});

	it('throws with fewer than 9 batters', () => {
		const batters = Array.from({ length: 8 }, (_, i) =>
			createMockBatter(`p${i}`, 0.3, 0.4)
		);

		expect(() => traditionalStrategy(batters)).toThrow(
			'Need at least 9 batters, got 8'
		);
	});

	it('assigns batting orders 1-9', () => {
		const batters = Array.from({ length: 9 }, (_, i) =>
			createMockBatter(`p${i}`, 0.3 + i * 0.01, 0.4 + i * 0.01)
		);

		const result = traditionalStrategy(batters);

		const battingOrders = result.map((slot) => slot.battingOrder).sort((a, b) => a - b);
		expect(battingOrders).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
	});

	it('places highest OPS batters first (simplified traditional)', () => {
		// Create batters with descending OPS (p0 has highest)
		const batters = Array.from({ length: 9 }, (_, i) =>
			createMockBatter(`p${i}`, 0.4 - i * 0.02, 0.6 - i * 0.03)
		);

		const result = traditionalStrategy(batters);

		// In simplified traditional, best batter is first
		expect(result[0].playerId).toBe('p0');
	});

	it('uses placeholder fielding position 1', () => {
		const batters = Array.from({ length: 9 }, (_, i) =>
			createMockBatter(`p${i}`, 0.3, 0.4)
		);

		const result = traditionalStrategy(batters);

		result.forEach((slot) => {
			expect(slot.fieldingPosition).toBe(1);
		});
	});
});

describe('compositeStrategy', () => {
	it('returns 9 lineup slots', () => {
		const batters = Array.from({ length: 9 }, (_, i) =>
			createMockBatter(`p${i}`, 0.3 + i * 0.01, 0.4 + i * 0.01)
		);

		const result = compositeStrategy(batters);

		expect(result).toHaveLength(9);
	});

	it('throws with fewer than 9 batters', () => {
		const batters = Array.from({ length: 8 }, (_, i) =>
			createMockBatter(`p${i}`, 0.3, 0.4)
		);

		expect(() => compositeStrategy(batters)).toThrow(
			'Need at least 9 batters, got 8'
		);
	});

	it('places top 3 OPS in slots 3, 4, 5', () => {
		// Create batters with descending OPS (p0 highest, p8 lowest)
		const batters = Array.from({ length: 9 }, (_, i) =>
			createMockBatter(`p${i}`, 0.4 - i * 0.02, 0.6 - i * 0.03)
		);

		const result = compositeStrategy(batters);

		// Find slots 3, 4, 5 (indices 2, 3, 4)
		const slot3 = result.find((s) => s.battingOrder === 3);
		const slot4 = result.find((s) => s.battingOrder === 4);
		const slot5 = result.find((s) => s.battingOrder === 5);

		// Top 3 batters (p0, p1, p2) should be in slots 3, 4, 5
		const topPlayerIds = [slot3?.playerId, slot4?.playerId, slot5?.playerId].sort();
		expect(topPlayerIds).toEqual(['p0', 'p1', 'p2']);
	});

	it('assigns remaining batters to slots 1, 2, 6-9 in OPS order', () => {
		const batters = Array.from({ length: 9 }, (_, i) =>
			createMockBatter(`p${i}`, 0.4 - i * 0.02, 0.6 - i * 0.03)
		);

		const result = compositeStrategy(batters);

		// Slots 1 and 2 should have the next best batters (p3, p4)
		const slot1 = result.find((s) => s.battingOrder === 1);
		const slot2 = result.find((s) => s.battingOrder === 2);
		const slots12 = [slot1?.playerId, slot2?.playerId].sort();

		expect(slots12).toEqual(['p3', 'p4']);
	});

	it('uses placeholder fielding position 1', () => {
		const batters = Array.from({ length: 9 }, (_, i) =>
			createMockBatter(`p${i}`, 0.3, 0.4)
		);

		const result = compositeStrategy(batters);

		result.forEach((slot) => {
			expect(slot.fieldingPosition).toBe(1);
		});
	});
});

describe('earlyAnalyticsStrategy', () => {
	it('returns 9 lineup slots', () => {
		const batters = Array.from({ length: 9 }, (_, i) =>
			createMockBatter(`p${i}`, 0.3 + i * 0.01, 0.4 + i * 0.01)
		);

		const result = earlyAnalyticsStrategy(batters);

		expect(result).toHaveLength(9);
	});

	it('throws with fewer than 9 batters', () => {
		const batters = Array.from({ length: 8 }, (_, i) =>
			createMockBatter(`p${i}`, 0.3, 0.4)
		);

		expect(() => earlyAnalyticsStrategy(batters)).toThrow(
			'Need at least 9 batters, got 8'
		);
	});

	it('assigns batting orders 1-9', () => {
		const batters = Array.from({ length: 9 }, (_, i) =>
			createMockBatter(`p${i}`, 0.3 + i * 0.01, 0.4 + i * 0.01)
		);

		const result = earlyAnalyticsStrategy(batters);

		const battingOrders = result.map((slot) => slot.battingOrder).sort((a, b) => a - b);
		expect(battingOrders).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
	});

	it('places highest OPS batters first (simplified analytics)', () => {
		// Create batters with descending OPS (p0 has highest)
		const batters = Array.from({ length: 9 }, (_, i) =>
			createMockBatter(`p${i}`, 0.4 - i * 0.02, 0.6 - i * 0.03)
		);

		const result = earlyAnalyticsStrategy(batters);

		// In simplified early analytics, best batter is first
		expect(result[0].playerId).toBe('p0');
	});

	it('uses placeholder fielding position 1', () => {
		const batters = Array.from({ length: 9 }, (_, i) =>
			createMockBatter(`p${i}`, 0.3, 0.4)
		);

		const result = earlyAnalyticsStrategy(batters);

		result.forEach((slot) => {
			expect(slot.fieldingPosition).toBe(1);
		});
	});
});

describe('getStrategyFunction', () => {
	it('returns traditionalStrategy for "traditional" era', () => {
		const fn = getStrategyFunction('traditional');

		const batters = Array.from({ length: 9 }, (_, i) =>
			createMockBatter(`p${i}`, 0.3 + i * 0.01, 0.4 + i * 0.01)
		);

		const result = fn(batters);
		expect(result).toHaveLength(9);
	});

	it('returns compositeStrategy for "composite" era', () => {
		const fn = getStrategyFunction('composite');

		const batters = Array.from({ length: 9 }, (_, i) =>
			createMockBatter(`p${i}`, 0.3 + i * 0.01, 0.4 + i * 0.01)
		);

		const result = fn(batters);
		expect(result).toHaveLength(9);
	});

	it('returns earlyAnalyticsStrategy for "early-analytics" era', () => {
		const fn = getStrategyFunction('early-analytics');

		const batters = Array.from({ length: 9 }, (_, i) =>
			createMockBatter(`p${i}`, 0.3 + i * 0.01, 0.4 + i * 0.01)
		);

		const result = fn(batters);
		expect(result).toHaveLength(9);
	});

	it('returns earlyAnalyticsStrategy for "modern" era (same as early-analytics)', () => {
		const fn = getStrategyFunction('modern');

		const batters = Array.from({ length: 9 }, (_, i) =>
			createMockBatter(`p${i}`, 0.3 + i * 0.01, 0.4 + i * 0.01)
		);

		const result = fn(batters);
		expect(result).toHaveLength(9);
	});

	it('handles all era strategy types', () => {
		const strategies: EraStrategy[] = [
			'traditional',
			'composite',
			'early-analytics',
			'modern'
		];

		strategies.forEach((strategy) => {
			const fn = getStrategyFunction(strategy);
			expect(typeof fn).toBe('function');
		});
	});
});

describe('Strategy behavior differences', () => {
	it('composite and traditional produce different orders', () => {
		// Create batters with clear OPS hierarchy
		const batters = Array.from({ length: 9 }, (_, i) =>
			createMockBatter(`p${i}`, 0.4 - i * 0.02, 0.6 - i * 0.03)
		);

		const traditionalResult = traditionalStrategy(batters);
		const compositeResult = compositeStrategy(batters);

		// Convert to batting order arrays
		const traditionalOrder = traditionalResult.map((s) => s.playerId);
		const compositeOrder = compositeResult.map((s) => s.playerId);

		// They should produce different results
		expect(traditionalOrder).not.toEqual(compositeOrder);
	});

	it('earlyAnalytics and traditional produce same order (both simplified to OPS)', () => {
		const batters = Array.from({ length: 9 }, (_, i) =>
			createMockBatter(`p${i}`, 0.4 - i * 0.02, 0.6 - i * 0.03)
		);

		const traditionalResult = traditionalStrategy(batters);
		const earlyAnalyticsResult = earlyAnalyticsStrategy(batters);

		const traditionalOrder = traditionalResult.map((s) => s.playerId);
		const earlyAnalyticsOrder = earlyAnalyticsResult.map((s) => s.playerId);

		// Currently both are simplified to OPS order, so they should match
		expect(traditionalOrder).toEqual(earlyAnalyticsOrder);
	});
});
