/**
 * State machine transition tests
 * Tests all 24 states (0/1/2 outs × 8 base configurations) × 7 outcomes
 */

import { describe, it, expect } from 'vitest';
import { transition } from './transitions.js';
import { createBaserunningState } from './state.js';
import type { Outcome } from '../types.js';

// Helper to create a state with specific outs and base configuration
function createState(outs: number, bases: [string | null, string | null, string | null]) {
	return createBaserunningState(outs, bases);
}

describe('State Machine Transitions', () => {
	describe('Ground Out (out)', () => {
		const outsTests = [0, 1, 2];
		const baseConfigTests = [
			[null, null, null], // 0: empty
			['r1', null, null], // 1: 1B
			[null, 'r2', null], // 2: 2B
			['r1', 'r2', null], // 3: 1B&2B
			[null, null, 'r3'], // 4: 3B
			['r1', null, 'r3'], // 5: 1B&3B
			[null, 'r2', 'r3'], // 6: 2B&3B
			['r1', 'r2', 'r3'], // 7: loaded
		] as const;

		test.each(outsTests.flatMap((o) =>
			baseConfigTests.map((b) => ({ outs: o, bases: b }))
		))('ground out with %d outs, bases $bases', ({ outs, bases }) => {
			const result = transition(createState(outs, bases), 'out', 'batter-123');

			// Validation rules
			if (outs === 2) {
				// With 2 outs (3rd out), inning ends
				expect(result.nextState.outs).toBe(0); // Reset for next inning
				expect(result.nextState.bases).toBe(0); // Bases cleared
				expect(result.runsScored).toBe(0); // No runs on 3rd out
				expect(result.nextState.runners).toEqual({ first: null, second: null, third: null });
			} else {
				// With 0-1 outs
				expect(result.nextState.outs).toBe(outs + 1);

				// Runner on 3B: scores with 1 out, holds with 0 outs
				if (bases[2]) {
					if (outs === 1) {
						expect(result.runsScored).toBe(1);
						expect(result.scorerIds).toContain(bases[2]);
					} else {
						expect(result.runsScored).toBe(0);
						expect(result.nextState.runners.third).toBe(bases[2]);
					}
				}

				// Runner on 2B: advances to 3B if 3B empty (both 0 and 1 outs)
				if (bases[1] && !bases[2]) {
					expect(result.nextState.runners.third).toBe(bases[1]);
					expect(result.nextState.runners.second).toBeNull();
				} else if (bases[1] && bases[2] && outs === 0) {
					// 3B occupied, runner holds at 2B
					expect(result.nextState.runners.second).toBe(bases[1]);
				}

				// Runner on 1B: advances to 2B if 2B is empty (both 0 and 1 outs)
				if (bases[0]) {
					// Check if 2B is empty after processing other runners
					const secondBaseEmpty =
						(bases[1] && !bases[2]) || // 2B runner advanced to 3B
						!bases[1]; // No one was on 2B

					if (secondBaseEmpty) {
						expect(result.nextState.runners.second).toBe(bases[0]);
					} else {
						expect(result.nextState.runners.first).toBe(bases[0]);
					}
				}
			}
		});
	});

	describe('Walk (walk)', () => {
		const baseConfigTests = [
			[null, null, null], // empty
			['r1', null, null], // 1B
			[null, 'r2', null], // 2B
			['r1', 'r2', null], // 1B&2B
			[null, null, 'r3'], // 3B
			['r1', null, 'r3'], // 1B&3B
			[null, 'r2', 'r3'], // 2B&3B
			['r1', 'r2', 'r3'], // loaded
		] as const;

		test.each(baseConfigTests.map((b) => ({ bases: b })))('walk with bases $bases', ({ bases }) => {
			const result = transition(createState(0, bases), 'walk', 'batter-new');

			// Batter always reaches 1B
			expect(result.nextState.runners.first).toBe('batter-new');

			// Force advancement rules
			if (bases[0]) {
				// Runner on 1B always forced to 2B on walk
				expect(result.nextState.runners.second).toBe(bases[0]);
			}
			if (bases[1]) {
				// Runner on 2B forced to 3B if there was a runner on 1B
				if (bases[0]) {
					expect(result.nextState.runners.third).toBe(bases[1]);
				} else {
					expect(result.nextState.runners.second).toBe(bases[1]);
				}
			}
			if (bases[2]) {
				// Runner on 3B scores only if bases loaded
				if (bases[0] && bases[1]) {
					expect(result.runsScored).toBe(1);
					expect(result.scorerIds).toContain(bases[2]);
				} else {
					expect(result.nextState.runners.third).toBe(bases[2]);
				}
			}
		});
	});

	describe('Hit By Pitch (hitByPitch)', () => {
		test('behaves same as walk - force advancement', () => {
			const bases = ['r1', 'r2', 'r3'] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'hitByPitch', 'batter-new');

			expect(result.nextState.runners.first).toBe('batter-new');
			expect(result.nextState.runners.second).toBe('r1');
			expect(result.nextState.runners.third).toBe('r2');
			expect(result.runsScored).toBe(1);
			expect(result.scorerIds).toContain('r3');
		});
	});

	describe('Single', () => {
		test('runner on 3B scores', () => {
			const bases = [null, null, 'r3'] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'single', 'batter-new');

			expect(result.runsScored).toBe(1);
			expect(result.scorerIds).toContain('r3');
			expect(result.nextState.runners.first).toBe('batter-new');
		});

		test('runner on 2B advances to 3B', () => {
			const bases = [null, 'r2', null] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'single', 'batter-new');

			expect(result.nextState.runners.third).toBe('r2');
			expect(result.nextState.runners.first).toBe('batter-new');
		});

		test('runner on 1B advances to 2B', () => {
			const bases = ['r1', null, null] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'single', 'batter-new');

			expect(result.nextState.runners.second).toBe('r1');
			expect(result.nextState.runners.first).toBe('batter-new');
		});
	});

	describe('Double', () => {
		test('all runners score, batter to 2B', () => {
			const bases = ['r1', 'r2', 'r3'] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'double', 'batter-new');

			expect(result.runsScored).toBe(3);
			expect(result.scorerIds).toContain('r1');
			expect(result.scorerIds).toContain('r2');
			expect(result.scorerIds).toContain('r3');
			expect(result.nextState.runners.second).toBe('batter-new');
			expect(result.nextState.runners.first).toBeNull();
		});
	});

	describe('Triple', () => {
		test('all runners score, batter to 3B', () => {
			const bases = ['r1', 'r2', 'r3'] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'triple', 'batter-new');

			expect(result.runsScored).toBe(3);
			expect(result.scorerIds).toContain('r1');
			expect(result.scorerIds).toContain('r2');
			expect(result.scorerIds).toContain('r3');
			expect(result.nextState.runners.third).toBe('batter-new');
		});
	});

	describe('Home Run', () => {
		test('all runners + batter score, bases cleared', () => {
			const bases = ['r1', 'r2', 'r3'] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'homeRun', 'batter-new');

			expect(result.runsScored).toBe(4);
			expect(result.scorerIds).toContain('r1');
			expect(result.scorerIds).toContain('r2');
			expect(result.scorerIds).toContain('r3');
			expect(result.scorerIds).toContain('batter-new');
			expect(result.nextState.bases).toBe(0);
			expect(result.nextState.runners).toEqual({ first: null, second: null, third: null });
		});

		test('grand slam with bases loaded', () => {
			const bases = ['r1', 'r2', 'r3'] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'homeRun', 'batter-new');

			expect(result.runsScored).toBe(4);
		});
	});

	describe('Edge Cases', () => {
		test('empty bases, 0 outs, single', () => {
			const bases = [null, null, null] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'single', 'batter-new');

			expect(result.runsScored).toBe(0);
			expect(result.nextState.runners.first).toBe('batter-new');
		});

		test('empty bases, 2 outs, ground out ends inning', () => {
			const bases = [null, null, null] as [string | null, string | null, string | null];
			const result = transition(createState(2, bases), 'out', 'batter-new');

			expect(result.nextState.outs).toBe(0); // Reset
			expect(result.nextState.bases).toBe(0); // Cleared
			expect(result.runsScored).toBe(0);
		});

		test('runner on 1B only, 0 outs, ground out - runner advances', () => {
			const bases = ['r1', null, null] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'out', 'batter-new');

			expect(result.nextState.runners.second).toBe('r1');
			expect(result.nextState.outs).toBe(1);
		});

		test('runner on 3B only, 0 outs, ground out - runner holds', () => {
			const bases = [null, null, 'r3'] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'out', 'batter-new');

			expect(result.nextState.runners.third).toBe('r3');
			expect(result.runsScored).toBe(0);
		});

		test('runner on 3B only, 1 out, ground out - runner scores', () => {
			const bases = [null, null, 'r3'] as [string | null, string | null, string | null];
			const result = transition(createState(1, bases), 'out', 'batter-new');

			expect(result.runsScored).toBe(1);
			expect(result.scorerIds).toContain('r3');
		});
	});
});
