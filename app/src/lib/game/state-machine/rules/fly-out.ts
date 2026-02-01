/**
 * Fly out baserunning rules
 *
 * Rules:
 * - Batter is out
 * - No runner advancement (V1: conservative - runners don't tag up)
 * - With 2 outs: inning ends, no scoring
 *
 * Note: V1 uses conservative rules. V2 may add tag-up advancement.
 */

import type { BaserunningState, BaserunningEvent } from '../state.js';
import { runnersToBaseConfig } from '../state.js';

interface FlyOutResult {
	nextState: BaserunningState;
	runsScored: number;
	scorerIds: string[];
	advancement: BaserunningEvent[];
}

export function handleFlyOut(
	currentState: BaserunningState,
	batterId: string,
	advancement: BaserunningEvent[]
): FlyOutResult {
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

	// With 0-2 outs: All runners hold (no advancement on fly out in V1)
	// Note: When outs would become 3 (inning ending), let engine handle inning change
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
