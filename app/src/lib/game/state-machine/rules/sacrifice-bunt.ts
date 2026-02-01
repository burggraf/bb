/**
 * Sacrifice bunt baserunning rules
 *
 * Rules:
 * - Batter is out
 * - All runners advance one base
 * - Runner on 3B scores
 * - With 2 outs: no advancement, no scoring (inning ends)
 */

import type { BaserunningState, BaserunningEvent } from '../state.js';
import { advanceRunner, scoreRunner } from '../transitions.js';
import { runnersToBaseConfig } from '../state.js';

interface SacrificeBuntResult {
	nextState: BaserunningState;
	runsScored: number;
	scorerIds: string[];
	advancement: BaserunningEvent[];
}

export function handleSacrificeBunt(
	currentState: BaserunningState,
	batterId: string,
	advancement: BaserunningEvent[]
): SacrificeBuntResult {
	const scorerIds: string[] = [];

	// Clone state for mutation
	const nextState: BaserunningState = {
		outs: currentState.outs,
		bases: currentState.bases,
		runners: {
			first: currentState.runners.first,
			second: currentState.runners.second,
			third: currentState.runners.third,
		},
	};

	const outsBefore = currentState.outs;

	// With 2 outs, this is the 3rd out - inning ends
	if (outsBefore >= 2) {
		nextState.runners = { first: null, second: null, third: null };
		nextState.bases = 0;
		nextState.outs = 0;

		return {
			nextState,
			runsScored: 0,
			scorerIds,
			advancement,
		};
	}

	// With 0-1 outs: All runners advance one base
	// Process from 3B to 1B (home to first)

	// Runner on 3B: scores
	if (currentState.runners.third) {
		scoreRunner(nextState, advancement, scorerIds, currentState.runners.third, 'third');
	}

	// Runner on 2B: advances to 3B
	if (currentState.runners.second) {
		// Only advance if 3B is now empty
		if (!nextState.runners.third) {
			advanceRunner(
				nextState,
				advancement,
				currentState.runners.second,
				'second',
				'third'
			);
		} else {
			nextState.runners.second = currentState.runners.second;
		}
	}

	// Runner on 1B: advances to 2B
	if (currentState.runners.first) {
		// Only advance if 2B is now empty
		if (!nextState.runners.second) {
			advanceRunner(
				nextState,
				advancement,
				currentState.runners.first,
				'first',
				'second'
			);
		} else {
			nextState.runners.first = currentState.runners.first;
		}
	}

	// Update bases bitmap
	nextState.bases = runnersToBaseConfig(nextState.runners);

	// Increment outs (batter is out)
	nextState.outs = outsBefore + 1 as 0 | 1 | 2;

	return {
		nextState,
		runsScored: scorerIds.length,
		scorerIds,
		advancement,
	};
}
