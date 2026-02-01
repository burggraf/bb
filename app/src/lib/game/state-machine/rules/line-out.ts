/**
 * Line out baserunning rules
 *
 * Rules:
 * - Batter is out
 * - No runner advancement (line drive is caught quickly, runners can't advance)
 * - With 2 outs: inning ends, no scoring
 */

import type { BaserunningState, BaserunningEvent } from '../state.js';
import { runnersToBaseConfig } from '../state.js';

interface LineOutResult {
	nextState: BaserunningState;
	runsScored: number;
	scorerIds: string[];
	advancement: BaserunningEvent[];
}

export function handleLineOut(
	currentState: BaserunningState,
	batterId: string,
	advancement: BaserunningEvent[]
): LineOutResult {
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

	// With 0-2 outs: All runners hold (no advancement on line out)
	// Line drives are caught too quickly for runners to tag up
	// Note: When outs would become 3 (inning ending), let engine handle inning change
	// Line drives are caught too quickly for runners to tag up
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
	nextState.outs = outsBefore + 1 as 0 | 1 | 2 | 3;

	return {
		nextState,
		runsScored: scorerIds.length,
		scorerIds,
		advancement,
	};
}
