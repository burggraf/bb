/**
 * Tests for Substitution Engine
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	shouldPinchHit,
	isAvailableOnBench,
	getAvailableBench
} from './substitutions.js';
import type { GameState } from './types.js';
import type { BatterStats, PitcherStats } from '../types.js';

describe('Substitution Engine', () => {
	let mockState: GameState;
	let mockBatter: BatterStats;
	let mockBench: BatterStats[];
	let mockPitcher: PitcherStats;

	const createBatter = (
		id: string,
		handedness: 'L' | 'R' | 'S',
		vsLeft: number,
		vsRight: number
	): BatterStats => ({
		id,
		name: `Batter ${id}`,
		handedness,
		teamId: 'team_1',
		rates: {
			vsLeft: createRates(vsLeft),
			vsRight: createRates(vsRight)
		}
	});

	const createRates = (obp: number) => ({
		single: obp * 0.5,
		double: obp * 0.15,
		triple: obp * 0.02,
		homeRun: obp * 0.08,
		walk: obp * 0.25,
		hitByPitch: 0.008,
		strikeout: 0.2,
		groundOut: 0.18,
		flyOut: 0.11,
		lineOut: 0.04,
		popOut: 0.03,
		sacrificeFly: 0.01,
		sacrificeBunt: 0.005,
		fieldersChoice: 0.015,
		reachedOnError: 0.01,
		catcherInterference: 0.001
	});

	beforeEach(() => {
		mockState = {
			inning: 7,
			isTopInning: true,
			outs: 1,
			bases: [null, null, null],
			scoreDiff: 0
		};

		// Current batter is decent vs Right
		mockBatter = createBatter('current', 'R', 0.32, 0.35);

		// Bench has better options vs Left
		mockBench = [
			createBatter('bench_1', 'L', 0.38, 0.30), // Much better vs Left
			createBatter('bench_2', 'L', 0.36, 0.31),
			createBatter('bench_3', 'R', 0.33, 0.34) // Worse than current
		];

		mockPitcher = {
			id: 'pitcher_1',
			name: 'Opposing Pitcher',
			handedness: 'L',
			teamId: 'team_2',
			rates: {
				vsLeft: createRates(0.3),
				vsRight: createRates(0.3)
			}
		};
	});

	describe('shouldPinchHit', () => {
		it('should not PH before 6th inning', () => {
			mockState.inning = 5;
			const decision = shouldPinchHit(mockState, mockBatter, mockBench, mockPitcher, 0);
			expect(decision.shouldPinchHit).toBe(false);
		});

		it('should not PH in low leverage situations', () => {
			mockState.inning = 7;
			mockState.scoreDiff = 8; // Blowout
			const decision = shouldPinchHit(mockState, mockBatter, mockBench, mockPitcher, 0);
			expect(decision.shouldPinchHit).toBe(false);
		});

		it('should PH for high leverage + platoon disadvantage', () => {
			mockState.inning = 9;
			mockState.bases = ['r1', 'r2', 'r3']; // Loaded bases - higher leverage
			mockState.scoreDiff = 0; // Tie game
			mockBatter.handedness = 'L'; // L vs L is disadvantage

			// With randomness = 0, 80% chance
			const decisions = Array.from({ length: 100 }, () =>
				shouldPinchHit(mockState, mockBatter, mockBench, mockPitcher, 0)
			);
			const phCount = decisions.filter((d) => d.shouldPinchHit).length;

			// Should PH most of the time (around 80%)
			expect(phCount).toBeGreaterThan(60);
		});

		it('should not PH when no better option on bench', () => {
			mockState.inning = 8;
			mockState.scoreDiff = 0;

			// All bench options are worse
			const badBench = [
				createBatter('bad_1', 'R', 0.28, 0.30),
				createBatter('bad_2', 'R', 0.29, 0.31)
			];

			const decision = shouldPinchHit(mockState, mockBatter, badBench, mockPitcher, 0);
			expect(decision.shouldPinchHit).toBe(false);
		});

		it('should select best pinch-hitter when multiple available', () => {
			mockState.inning = 9;
			mockState.bases = ['r1', 'r2', 'r3'];
			mockState.scoreDiff = -1; // Batting team down 1
			mockBatter.handedness = 'L'; // L vs L is disadvantage

			const decision = shouldPinchHit(mockState, mockBatter, mockBench, mockPitcher, 1.0); // Always PH

			expect(decision.shouldPinchHit).toBe(true);
			// Should pick bench_1 (best vs Left)
			expect(['bench_1', 'bench_2']).toContain(decision.pinchHitterId);
		});

		it('should return empty bench array when all players used', () => {
			const allBatters = [mockBatter, ...mockBench];
			const currentLineup = [mockBatter.id];
			const usedPlayers = mockBench.map((b) => b.id);

			const available = getAvailableBench(allBatters, currentLineup, usedPlayers);
			expect(available).toHaveLength(0);
		});

		it('should respect used players list', () => {
			const allBatters = [mockBatter, ...mockBench];
			const currentLineup = [mockBatter.id, mockBench[0]!.id];
			const usedPlayers = [mockBench[1]!.id];

			const available = getAvailableBench(allBatters, currentLineup, usedPlayers);
			expect(available).toHaveLength(1);
			expect(available[0]!.id).toBe('bench_3');
		});
	});

	describe('isAvailableOnBench', () => {
		it('should return true for unused player', () => {
			const result = isAvailableOnBench('player_5', ['p1', 'p2', 'p3'], ['p4']);
			expect(result).toBe(true);
		});

		it('should return false for player in current lineup', () => {
			const result = isAvailableOnBench('p2', ['p1', 'p2', 'p3'], []);
			expect(result).toBe(false);
		});

		it('should return false for already used player', () => {
			const result = isAvailableOnBench('p4', ['p1', 'p2', 'p3'], ['p4']);
			expect(result).toBe(false);
		});
	});
});
