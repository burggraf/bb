/**
 * Sacrifice fly baserunning rules
 *
 * Rules:
 * - Batter is out
 * - If <2 outs and runner on 3B, runner tags and scores
 * - Other runners advance at their own risk (V1: conservative - they hold)
 * - With 2 outs: no advancement, no scoring (inning ends)
 */

import type { BaserunningState, BaserunningEvent } from '../state.js';
import { scoreRunner } from '../transitions.js';
import { runnersToBaseConfig } from '../state.js';

interface SacrificeFlyResult {
	nextState: BaserunningState;
	runsScored: number;
	scorerIds: string[];
	advancement: BaserunningEvent[];
}

export function handleSacrificeFly(
	currentState: BaserunningState,
	batterId: string,
	advancement: BaserunningEvent[]
): SacrificeFlyResult {
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
	// Note: We leave outs at 3 (or cap at 2) to signal engine that inning should change
	// The engine is responsible for resetting outs when the inning changes
	if (outsBefore >= 2) {
		nextState.runners = { first: null, second: null, third: null };
		nextState.bases = 0;
		nextState.outs = 3; // Signal 3 outs (engine will handle inning change)

		return {
			nextState,
			runsScored: 0,
			scorerIds,
			advancement,
		};
	}

	// With 0-1 outs: Runner on 3B tags and scores
	if (currentState.runners.third) {
		scoreRunner(nextState, advancement, scorerIds, currentState.runners.third, 'third');
	}

	// Other runners hold (V1: conservative - no advancement on sacrifice fly)
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
