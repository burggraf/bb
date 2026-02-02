/**
 * Tests for Platoon Advantage
 */

import { describe, it, expect } from 'vitest';
import {
	applyPlatoonAdvantage,
	addNoise,
	isPlatoonDisadvantage,
	getPlatoonRates
} from './platoon.js';
import type { BatterStats, PitcherStats, EventRates } from '../types.js';

describe('Platoon Advantage', () => {
	const mockRates: EventRates = {
		single: 0.15,
		double: 0.05,
		triple: 0.01,
		homeRun: 0.03,
		walk: 0.08,
		hitByPitch: 0.008,
		strikeout: 0.2,
		groundOut: 0.2,
		flyOut: 0.12,
		lineOut: 0.05,
		popOut: 0.03,
		sacrificeFly: 0.01,
		sacrificeBunt: 0.005,
		fieldersChoice: 0.02,
		reachedOnError: 0.01,
		catcherInterference: 0.001
	};

	const createBatter = (handedness: 'L' | 'R' | 'S', vsLeft: EventRates, vsRight: EventRates): BatterStats => ({
		id: 'test_batter',
		name: 'Test Batter',
		handedness,
		teamId: 'team_1',
		rates: { vsLeft, vsRight }
	});

	const createPitcher = (handedness: 'L' | 'R'): PitcherStats => ({
		id: 'test_pitcher',
		name: 'Test Pitcher',
		handedness,
		teamId: 'team_1',
		rates: { vsLeft: mockRates, vsRight: mockRates }
	});

	describe('applyPlatoonAdvantage', () => {
		it('should use vsLeft for lefty batter vs lefty pitcher', () => {
			const vsLeft = { ...mockRates, single: 0.18 };
			const vsRight = { ...mockRates, single: 0.12 };
			const batter = createBatter('L', vsLeft, vsRight);
			const pitcher = createPitcher('L');

			const result = applyPlatoonAdvantage(batter, pitcher, mockRates, 0);

			expect(result.single).toBeCloseTo(0.18);
		});

		it('should use vsRight for lefty batter vs righty pitcher', () => {
			const vsLeft = { ...mockRates, single: 0.18 };
			const vsRight = { ...mockRates, single: 0.12 };
			const batter = createBatter('L', vsLeft, vsRight);
			const pitcher = createPitcher('R');

			const result = applyPlatoonAdvantage(batter, pitcher, mockRates, 0);

			expect(result.single).toBeCloseTo(0.12);
		});

		it('should use favorable split for switch hitter vs lefty', () => {
			const vsLeft = { ...mockRates, single: 0.12 }; // Worse vs Left
			const vsRight = { ...mockRates, single: 0.18 }; // Better vs Right
			const batter = createBatter('S', vsLeft, vsRight);
			const pitcher = createPitcher('L');

			const result = applyPlatoonAdvantage(batter, pitcher, mockRates, 0);

			// Switch hitter gets vsRight (favorable) vs Left
			expect(result.single).toBeCloseTo(0.18);
		});

		it('should use favorable split for switch hitter vs righty', () => {
			const vsLeft = { ...mockRates, single: 0.18 }; // Better vs Left
			const vsRight = { ...mockRates, single: 0.12 }; // Worse vs Right
			const batter = createBatter('S', vsLeft, vsRight);
			const pitcher = createPitcher('R');

			const result = applyPlatoonAdvantage(batter, pitcher, mockRates, 0);

			// Switch hitter gets vsLeft (favorable) vs Right
			expect(result.single).toBeCloseTo(0.18);
		});
	});

	describe('addNoise', () => {
		it('should not modify rates when noise is 0', () => {
			const result = addNoise(mockRates, 0);
			expect(result).toEqual(mockRates);
		});

		it('should add small random variations with noise > 0', () => {
			// Set seed for reproducibility (not directly available in vitest)
			// Just verify that rates change
			const result = addNoise(mockRates, 0.1);

			// At least some rates should be different
			let differences = 0;
			for (const key of Object.keys(mockRates) as (keyof EventRates)[]) {
				if (Math.abs(result[key] - mockRates[key]) > 0.0001) {
					differences++;
				}
			}

			// With noise, some rates should change (though not guaranteed)
			// This test may occasionally fail if randomness happens to produce same values
			expect(differences).toBeGreaterThan(0);
		});

		it('should keep rates between 0 and 1', () => {
			// Even with high noise, rates should stay valid
			const result = addNoise(mockRates, 1.0);

			for (const key of Object.keys(result) as (keyof EventRates)[]) {
				expect(result[key]).toBeGreaterThanOrEqual(0);
				expect(result[key]).toBeLessThanOrEqual(1);
			}
		});
	});

	describe('isPlatoonDisadvantage', () => {
		it('should return false for switch hitters', () => {
			expect(isPlatoonDisadvantage('S', 'L')).toBe(false);
			expect(isPlatoonDisadvantage('S', 'R')).toBe(false);
		});

		it('should return true for same-handed matchups', () => {
			expect(isPlatoonDisadvantage('L', 'L')).toBe(true);
			expect(isPlatoonDisadvantage('R', 'R')).toBe(true);
		});

		it('should return false for opposite-handed matchups', () => {
			expect(isPlatoonDisadvantage('L', 'R')).toBe(false);
			expect(isPlatoonDisadvantage('R', 'L')).toBe(false);
		});
	});

	describe('getPlatoonRates', () => {
		it('should return correct rates for lefty batter', () => {
			const vsLeft = { ...mockRates, single: 0.18 };
			const vsRight = { ...mockRates, single: 0.12 };
			const batter = createBatter('L', vsLeft, vsRight);
			const leftyPitcher = createPitcher('L');
			const rightyPitcher = createPitcher('R');

			expect(getPlatoonRates(batter, leftyPitcher).single).toBeCloseTo(0.18);
			expect(getPlatoonRates(batter, rightyPitcher).single).toBeCloseTo(0.12);
		});

		it('should return favorable rates for switch hitter', () => {
			const vsLeft = { ...mockRates, single: 0.12 };
			const vsRight = { ...mockRates, single: 0.18 };
			const batter = createBatter('S', vsLeft, vsRight);
			const leftyPitcher = createPitcher('L');
			const rightyPitcher = createPitcher('R');

			// Switch hitters get favorable split
			expect(getPlatoonRates(batter, leftyPitcher).single).toBeCloseTo(0.18); // vsRight
			expect(getPlatoonRates(batter, rightyPitcher).single).toBeCloseTo(0.12); // vsLeft
		});
	});
});
