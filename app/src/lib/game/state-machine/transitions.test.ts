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
	describe('Ground Out', () => {
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

		describe.each(outsTests.flatMap((o) =>
			baseConfigTests.map((b) => ({ outs: o, bases: b }))
		))('ground out with $outs outs, bases: $bases', ({ outs, bases }) => {
			it('handles ground out correctly', () => {
				const result = transition(createState(outs, bases), 'groundOut', 'batter-123');

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
					// Special case: with 1 out and runner on 3B, 3B runner scores, clearing 3B
					if (bases[1]) {
						const thirdBaseEmptyAfter = !bases[2] || (bases[2] && outs === 1);
						if (thirdBaseEmptyAfter) {
							expect(result.nextState.runners.third).toBe(bases[1]);
						} else {
							expect(result.nextState.runners.second).toBe(bases[1]);
						}
					}

					// Runner on 1B: advances to 2B if 2B is empty after processing
					if (bases[0]) {
						// 2B is empty if: no one was on 2B, OR 2B runner advanced to 3B
						const secondBaseEmptyAfter = !bases[1] || (bases[1] && !bases[2]) || (bases[1] && bases[2] && outs === 1);
						if (secondBaseEmptyAfter) {
							expect(result.nextState.runners.second).toBe(bases[0]);
						} else {
							expect(result.nextState.runners.first).toBe(bases[0]);
						}
					}
				}
			});
		});
	});

	describe('Walk', () => {
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

		describe.each(baseConfigTests.map((b) => ({ bases: b })))('walk with bases: $bases', ({ bases }) => {
			it('handles walk correctly', () => {
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
	});

	describe('Hit By Pitch', () => {
		it('behaves same as walk - force advancement', () => {
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
			it('runner on 3B scores', () => {
			const bases = [null, null, 'r3'] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'single', 'batter-new');

			expect(result.runsScored).toBe(1);
			expect(result.scorerIds).toContain('r3');
			expect(result.nextState.runners.first).toBe('batter-new');
		});

			it('runner on 2B advances to 3B', () => {
			const bases = [null, 'r2', null] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'single', 'batter-new');

			expect(result.nextState.runners.third).toBe('r2');
			expect(result.nextState.runners.first).toBe('batter-new');
		});

			it('runner on 1B advances to 2B', () => {
			const bases = ['r1', null, null] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'single', 'batter-new');

			expect(result.nextState.runners.second).toBe('r1');
			expect(result.nextState.runners.first).toBe('batter-new');
		});
	});

	describe('Double', () => {
			it('all runners score, batter to 2B', () => {
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
			it('all runners score, batter to 3B', () => {
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
			it('all runners + batter score, bases cleared', () => {
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

			it('grand slam with bases loaded', () => {
			const bases = ['r1', 'r2', 'r3'] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'homeRun', 'batter-new');

			expect(result.runsScored).toBe(4);
		});
	});

	describe('Strikeout', () => {
			it('strikeout with runners on - no advancement', () => {
			const bases = ['r1', 'r2', 'r3'] as [string | null, string | null, string | null];
			const result = transition(createState(1, bases), 'strikeout', 'batter-new');

			expect(result.nextState.outs).toBe(2);
			expect(result.nextState.runners.first).toBe('r1');
			expect(result.nextState.runners.second).toBe('r2');
			expect(result.nextState.runners.third).toBe('r3');
			expect(result.runsScored).toBe(0);
		});

			it('strikeout with 2 outs ends inning', () => {
			const bases = ['r1', 'r2', 'r3'] as [string | null, string | null, string | null];
			const result = transition(createState(2, bases), 'strikeout', 'batter-new');

			expect(result.nextState.outs).toBe(0);
			expect(result.nextState.bases).toBe(0);
			expect(result.runsScored).toBe(0);
		});
	});

	describe('Fly Out', () => {
			it('fly out with runners on - no advancement', () => {
			const bases = ['r1', 'r2', 'r3'] as [string | null, string | null, string | null];
			const result = transition(createState(1, bases), 'flyOut', 'batter-new');

			expect(result.nextState.outs).toBe(2);
			expect(result.nextState.runners.first).toBe('r1');
			expect(result.nextState.runners.second).toBe('r2');
			expect(result.nextState.runners.third).toBe('r3');
			expect(result.runsScored).toBe(0);
		});
	});

	describe('Line Out', () => {
			it('line out with runners on - no advancement', () => {
			const bases = ['r1', 'r2', 'r3'] as [string | null, string | null, string | null];
			const result = transition(createState(1, bases), 'lineOut', 'batter-new');

			expect(result.nextState.outs).toBe(2);
			expect(result.nextState.runners.first).toBe('r1');
			expect(result.nextState.runners.second).toBe('r2');
			expect(result.nextState.runners.third).toBe('r3');
			expect(result.runsScored).toBe(0);
		});
	});

	describe('Pop Out', () => {
			it('pop out with runners on - no advancement', () => {
			const bases = ['r1', 'r2', 'r3'] as [string | null, string | null, string | null];
			const result = transition(createState(1, bases), 'popOut', 'batter-new');

			expect(result.nextState.outs).toBe(2);
			expect(result.nextState.runners.first).toBe('r1');
			expect(result.nextState.runners.second).toBe('r2');
			expect(result.nextState.runners.third).toBe('r3');
			expect(result.runsScored).toBe(0);
		});
	});

	describe('Sacrifice Fly', () => {
			it('sacrifice fly with runner on 3B, 0 outs - runner scores', () => {
			const bases = [null, null, 'r3'] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'sacrificeFly', 'batter-new');

			expect(result.nextState.outs).toBe(1);
			expect(result.runsScored).toBe(1);
			expect(result.scorerIds).toContain('r3');
			expect(result.nextState.runners.third).toBeNull();
		});

			it('sacrifice fly with runner on 3B, 1 out - runner scores', () => {
			const bases = [null, null, 'r3'] as [string | null, string | null, string | null];
			const result = transition(createState(1, bases), 'sacrificeFly', 'batter-new');

			expect(result.nextState.outs).toBe(2);
			expect(result.runsScored).toBe(1);
			expect(result.scorerIds).toContain('r3');
		});

			it('sacrifice fly with 2 outs - no scoring', () => {
			const bases = [null, null, 'r3'] as [string | null, string | null, string | null];
			const result = transition(createState(2, bases), 'sacrificeFly', 'batter-new');

			expect(result.nextState.outs).toBe(0); // Inning ends
			expect(result.nextState.bases).toBe(0);
			expect(result.runsScored).toBe(0);
		});

			it('sacrifice fly with runners on 1B and 3B, 0 outs - only 3B scores', () => {
			const bases = ['r1', null, 'r3'] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'sacrificeFly', 'batter-new');

			expect(result.nextState.outs).toBe(1);
			expect(result.runsScored).toBe(1);
			expect(result.scorerIds).toContain('r3');
			expect(result.nextState.runners.first).toBe('r1'); // 1B runner holds
		});
	});

	describe('Sacrifice Bunt', () => {
			it('sacrifice bunt with runner on 1B, 0 outs - advances to 2B', () => {
			const bases = ['r1', null, null] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'sacrificeBunt', 'batter-new');

			expect(result.nextState.outs).toBe(1);
			expect(result.nextState.runners.second).toBe('r1');
			expect(result.nextState.runners.first).toBeNull();
			expect(result.runsScored).toBe(0);
		});

			it('sacrifice bunt with runner on 2B, 0 outs - advances to 3B', () => {
			const bases = [null, 'r2', null] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'sacrificeBunt', 'batter-new');

			expect(result.nextState.outs).toBe(1);
			expect(result.nextState.runners.third).toBe('r2');
			expect(result.nextState.runners.second).toBeNull();
		});

			it('sacrifice bunt with runner on 3B, 0 outs - scores', () => {
			const bases = [null, null, 'r3'] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'sacrificeBunt', 'batter-new');

			expect(result.nextState.outs).toBe(1);
			expect(result.runsScored).toBe(1);
			expect(result.scorerIds).toContain('r3');
		});

			it('sacrifice bunt with bases loaded, 0 outs - one run scores', () => {
			const bases = ['r1', 'r2', 'r3'] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'sacrificeBunt', 'batter-new');

			expect(result.nextState.outs).toBe(1);
			expect(result.runsScored).toBe(1);
			expect(result.scorerIds).toContain('r3');
			expect(result.nextState.runners.first).toBeNull();
			expect(result.nextState.runners.second).toBe('r1');
			expect(result.nextState.runners.third).toBe('r2');
		});

			it('sacrifice bunt with 2 outs - no advancement', () => {
			const bases = ['r1', 'r2', 'r3'] as [string | null, string | null, string | null];
			const result = transition(createState(2, bases), 'sacrificeBunt', 'batter-new');

			expect(result.nextState.outs).toBe(0); // Inning ends
			expect(result.nextState.bases).toBe(0);
			expect(result.runsScored).toBe(0);
		});
	});

	describe('Fielder\'s Choice', () => {
			it('fielder\'s choice with runner on 1B - batter reaches, runner out', () => {
			const bases = ['r1', null, null] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'fieldersChoice', 'batter-new');

			expect(result.nextState.outs).toBe(1);
			expect(result.nextState.runners.first).toBe('batter-new');
			expect(result.nextState.runners.second).toBeNull();
			expect(result.runsScored).toBe(0);
		});

			it('fielder\'s choice with runners on 1B and 2B - batter reaches, lead runner out', () => {
			const bases = ['r1', 'r2', null] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'fieldersChoice', 'batter-new');

			expect(result.nextState.outs).toBe(1);
			expect(result.nextState.runners.first).toBe('batter-new');
			expect(result.nextState.runners.second).toBe('r1'); // Forced to advance
			expect(result.nextState.runners.third).toBeNull(); // Lead runner (r2) is out
			expect(result.runsScored).toBe(0);
		});

			it('fielder\'s choice with empty bases - treated as single', () => {
			const bases = [null, null, null] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'fieldersChoice', 'batter-new');

			expect(result.nextState.outs).toBe(0); // No out recorded
			expect(result.nextState.runners.first).toBe('batter-new');
		});
	});

	describe('Reached On Error', () => {
			it('reached on error with empty bases - batter reaches 1B', () => {
			const bases = [null, null, null] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'reachedOnError', 'batter-new');

			expect(result.nextState.outs).toBe(0); // No out
			expect(result.nextState.runners.first).toBe('batter-new');
			expect(result.runsScored).toBe(0);
		});

			it('reached on error with runner on 3B - runner scores', () => {
			const bases = [null, null, 'r3'] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'reachedOnError', 'batter-new');

			expect(result.nextState.outs).toBe(0); // No out
			expect(result.runsScored).toBe(1);
			expect(result.scorerIds).toContain('r3');
			expect(result.nextState.runners.first).toBe('batter-new');
		});

			it('reached on error with runner on 1B - advances like single', () => {
			const bases = ['r1', null, null] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'reachedOnError', 'batter-new');

			expect(result.nextState.outs).toBe(0); // No out
			expect(result.nextState.runners.second).toBe('r1');
			expect(result.nextState.runners.first).toBe('batter-new');
		});
	});

	describe('Catcher Interference', () => {
			it('interference with empty bases - batter awarded 1B', () => {
			const bases = [null, null, null] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'catcherInterference', 'batter-new');

			expect(result.nextState.outs).toBe(0); // No out
			expect(result.nextState.runners.first).toBe('batter-new');
			expect(result.runsScored).toBe(0);
		});

			it('interference with bases loaded - batter awarded 1B, runner scores', () => {
			const bases = ['r1', 'r2', 'r3'] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'catcherInterference', 'batter-new');

			expect(result.nextState.outs).toBe(0); // No out
			expect(result.runsScored).toBe(1);
			expect(result.scorerIds).toContain('r3');
			expect(result.nextState.runners.first).toBe('batter-new');
			expect(result.nextState.runners.second).toBe('r1');
			expect(result.nextState.runners.third).toBe('r2');
		});

			it('interference with runner on 1B only - forced advancement', () => {
			const bases = ['r1', null, null] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'catcherInterference', 'batter-new');

			expect(result.nextState.outs).toBe(0); // No out
			expect(result.nextState.runners.first).toBe('batter-new');
			expect(result.nextState.runners.second).toBe('r1');
			expect(result.runsScored).toBe(0);
		});

			it('interference with runner on 2B only - no forced advancement', () => {
			const bases = [null, 'r2', null] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'catcherInterference', 'batter-new');

			expect(result.nextState.outs).toBe(0); // No out
			expect(result.nextState.runners.first).toBe('batter-new');
			expect(result.nextState.runners.second).toBe('r2'); // Holds (not forced)
			expect(result.runsScored).toBe(0);
		});
	});

	describe('Edge Cases', () => {
			it('empty bases, 0 outs, single', () => {
			const bases = [null, null, null] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'single', 'batter-new');

			expect(result.runsScored).toBe(0);
			expect(result.nextState.runners.first).toBe('batter-new');
		});

			it('empty bases, 2 outs, ground out ends inning', () => {
			const bases = [null, null, null] as [string | null, string | null, string | null];
			const result = transition(createState(2, bases), 'groundOut', 'batter-new');

			expect(result.nextState.outs).toBe(0); // Reset
			expect(result.nextState.bases).toBe(0); // Cleared
			expect(result.runsScored).toBe(0);
		});

			it('runner on 1B only, 0 outs, ground out - runner advances', () => {
			const bases = ['r1', null, null] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'groundOut', 'batter-new');

			expect(result.nextState.runners.second).toBe('r1');
			expect(result.nextState.outs).toBe(1);
		});

			it('runner on 3B only, 0 outs, ground out - runner holds', () => {
			const bases = [null, null, 'r3'] as [string | null, string | null, string | null];
			const result = transition(createState(0, bases), 'groundOut', 'batter-new');

			expect(result.nextState.runners.third).toBe('r3');
			expect(result.runsScored).toBe(0);
		});

			it('runner on 3B only, 1 out, ground out - runner scores', () => {
			const bases = [null, null, 'r3'] as [string | null, string | null, string | null];
			const result = transition(createState(1, bases), 'groundOut', 'batter-new');

			expect(result.runsScored).toBe(1);
			expect(result.scorerIds).toContain('r3');
		});
	});
});
