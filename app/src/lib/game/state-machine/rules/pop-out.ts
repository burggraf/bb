/**
 * Pop out baserunning rules
 *
 * Rules:
 * - Batter is out
 * - No runner advancement (pop up is usually caught infield, runners hold)
 * - With 2 outs: inning ends, no scoring
 */

import type { BaserunningState, BaserunningEvent } from '../state.js';
import { runnersToBaseConfig } from '../state.js';

interface PopOutResult {
	nextState: BaserunningState;
	runsScored: number;
	scorerIds: string[];
	advancement: BaserunningEvent[];
}

export function handlePopOut(
	currentState: BaserunningState,
	batterId: string,
	advancement: BaserunningEvent[]
): PopOutResult {
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

	// With 0-1 outs: All runners hold (no advancement on pop out)
	if (currentState.runners.third) {
		nextState.runners.third = currentState.runners.third;
	}
	if (currentState.runners.second) {
		nextState.runners.second = currentState.runners.second;
	}
	if (currentState.runners.first) {
		nextState.runners.first = currentState.runners.first;
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
