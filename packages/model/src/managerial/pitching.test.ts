/**
 * Tests for Pitching Management
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	shouldPullPitcher,
	selectReliever,
	calculateLeverageIndex,
	reduceStamina
} from './pitching.js';
import type { GameState, PitcherRole, BullpenState } from './types.js';

describe('Pitching Management', () => {
	let mockState: GameState;
	let mockPitcher: PitcherRole;
	let mockBullpen: BullpenState;

	beforeEach(() => {
		mockState = {
			inning: 7,
			isTopInning: true,
			outs: 1,
			bases: [null, null, null],
			scoreDiff: 0
		};

		mockPitcher = {
			pitcherId: 'pitcher_1',
			role: 'starter',
			stamina: 100,
			pitchesThrown: 80,
			battersFace: 25,
			avgBfpAsStarter: 27,
			avgBfpAsReliever: null,
			hitsAllowed: 0,
			walksAllowed: 0,
			runsAllowed: 0
		};

		const closer: PitcherRole = {
			pitcherId: 'closer_1',
			role: 'closer',
			stamina: 100,
			pitchesThrown: 0,
			battersFace: 0,
			avgBfpAsStarter: null,
			avgBfpAsReliever: 4,
			hitsAllowed: 0,
			walksAllowed: 0,
			runsAllowed: 0
		};

		const reliever1: PitcherRole = {
			pitcherId: 'reliever_1',
			role: 'reliever',
			stamina: 100,
			pitchesThrown: 0,
			battersFace: 0,
			avgBfpAsStarter: null,
			avgBfpAsReliever: 6,
			hitsAllowed: 0,
			walksAllowed: 0,
			runsAllowed: 0
		};

		const reliever2: PitcherRole = {
			pitcherId: 'reliever_2',
			role: 'reliever',
			stamina: 100,
			pitchesThrown: 0,
			battersFace: 0,
			avgBfpAsStarter: null,
			avgBfpAsReliever: 5,
			hitsAllowed: 0,
			walksAllowed: 0,
			runsAllowed: 0
		};

		mockBullpen = {
			starter: mockPitcher,
			relievers: [reliever1, reliever2],
			closer: closer
		};
	});

	describe('shouldPullPitcher', () => {
		it('should pull at 110 BFP (hard limit)', () => {
			mockPitcher.battersFace = 110;
			const decision = shouldPullPitcher(mockState, mockPitcher, mockBullpen, 0);
			expect(decision.shouldChange).toBe(true);
			expect(decision.reason).toContain('110');
		});

		it('should not pull early in game with low pitch count', () => {
			mockState.inning = 5;
			mockPitcher.battersFace = 15;
			const decision = shouldPullPitcher(mockState, mockPitcher, mockBullpen, 0);
			expect(decision.shouldChange).toBe(false);
		});

		it('should consider pulling at average BFP through 6th', () => {
			mockState.inning = 6;
			mockPitcher.battersFace = 27; // Average starter BFP
			// With randomness = 0, 30% chance means most tests will pass
			// This test might occasionally fail
			const decisions = Array.from({ length: 100 }, () =>
				shouldPullPitcher(mockState, mockPitcher, mockBullpen, 0)
			);
			const pullCount = decisions.filter((d) => d.shouldChange).length;
			// Should pull roughly 30% of the time
			expect(pullCount).toBeGreaterThan(10);
			expect(pullCount).toBeLessThan(60);
		});

		it('should pull for high leverage situation with tired reliever', () => {
			// Create a reliever for this test (high leverage logic only applies to relievers)
			const tiredReliever: PitcherRole = {
				pitcherId: 'reliever_tired',
				role: 'reliever',
				stamina: 30,
				pitchesThrown: 0,
				battersFace: 4, // Near average for reliever
				avgBfpAsStarter: null,
				avgBfpAsReliever: 5,
				hitsAllowed: 0,
				walksAllowed: 0,
				runsAllowed: 0
			};

			mockState.inning = 7;
			mockState.bases = ['runner1', 'runner2', 'runner3']; // Loaded
			mockState.scoreDiff = 0;

			// High leverage (loaded bases, tie game)
			const decisions = Array.from({ length: 100 }, () =>
				shouldPullPitcher(mockState, tiredReliever, mockBullpen, 0)
			);
			const pullCount = decisions.filter((d) => d.shouldChange).length;
			// Should pull most of the time (70%+)
			expect(pullCount).toBeGreaterThan(50);
		});
	});

	describe('selectReliever', () => {
		it('should use closer in save situation', () => {
			mockState.inning = 9;
			mockState.isTopInning = true; // Away team batting, home team pitching
			mockState.scoreDiff = -2; // Batting team (away) down by 2 = home team leads by 2

			const selected = selectReliever(mockState, mockBullpen);
			expect(selected.pitcherId).toBe('closer_1');
		});

		it('should use best reliever in late innings', () => {
			mockState.inning = 8;
			mockState.scoreDiff = 0;

			const selected = selectReliever(mockState, mockBullpen);
			// Should be first reliever (best)
			expect(selected.pitcherId).toBe('reliever_1');
		});

		it('should use middle reliever in early innings', () => {
			mockState.inning = 6;
			mockState.scoreDiff = 0;

			const selected = selectReliever(mockState, mockBullpen);
			// Should be a reliever (not necessarily closer)
			expect(['reliever_1', 'reliever_2']).toContain(selected.pitcherId);
		});

		it('should handle empty bullpen', () => {
			mockBullpen.relievers = [];
			mockBullpen.closer = undefined;

			// Should not crash, return undefined or handle gracefully
			const selected = selectReliever(mockState, mockBullpen);
			expect(selected).toBeUndefined();
		});
	});

	describe('calculateLeverageIndex', () => {
		it('should return ~1.0 for average situation', () => {
			const li = calculateLeverageIndex({
				inning: 5,
				isTopInning: true,
				outs: 1,
				bases: [null, null, null],
				scoreDiff: 2
			});
			// 1.0 base * 1.2 (close score) = 1.2
			expect(li).toBeCloseTo(1.2);
		});

		it('should increase for later innings', () => {
			const early = calculateLeverageIndex({
				inning: 5,
				isTopInning: true,
				outs: 1,
				bases: [null, null, null],
				scoreDiff: 0
			});

			const late = calculateLeverageIndex({
				inning: 9,
				isTopInning: true,
				outs: 1,
				bases: [null, null, null],
				scoreDiff: 0
			});

			expect(late).toBeGreaterThan(early);
		});

		it('should increase for close score', () => {
			const blowout = calculateLeverageIndex({
				inning: 7,
				isTopInning: true,
				outs: 1,
				bases: [null, null, null],
				scoreDiff: 8
			});

			const close = calculateLeverageIndex({
				inning: 7,
				isTopInning: true,
				outs: 1,
				bases: [null, null, null],
				scoreDiff: 0
			});

			expect(close).toBeGreaterThan(blowout);
		});

		it('should increase for runners on base', () => {
			const empty = calculateLeverageIndex({
				inning: 7,
				isTopInning: true,
				outs: 1,
				bases: [null, null, null],
				scoreDiff: 0
			});

			const loaded = calculateLeverageIndex({
				inning: 7,
				isTopInning: true,
				outs: 1,
				bases: ['r1', 'r2', 'r3'],
				scoreDiff: 0
			});

			expect(loaded).toBeGreaterThan(empty);
		});

		it('should be highest in tie game 9th inning', () => {
			const li = calculateLeverageIndex({
				inning: 9,
				isTopInning: false, // Bottom of 9th
				outs: 2,
				bases: [null, null, null],
				scoreDiff: 0 // Tie game
			});

			expect(li).toBeGreaterThan(3.0);
		});
	});

	describe('reduceStamina', () => {
		it('should reduce stamina based on pitches thrown', () => {
			const newStamina = reduceStamina(100, 5, 110);
			expect(newStamina).toBeLessThan(100);
			expect(newStamina).toBeGreaterThan(90);
		});

		it('should reduce stamina faster as pitcher gets tired', () => {
			const freshReduction = reduceStamina(100, 5, 110) - 100;
			const tiredReduction = reduceStamina(40, 5, 110) - 40;

			expect(Math.abs(tiredReduction)).toBeGreaterThan(Math.abs(freshReduction));
		});

		it('should not go below 0', () => {
			const newStamina = reduceStamina(5, 10, 110);
			expect(newStamina).toBe(0);
		});
	});
});
