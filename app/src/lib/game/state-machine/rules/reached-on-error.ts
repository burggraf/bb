/**
 * Reached on error baserunning rules
 *
 * Rules:
 * - Batter reaches 1B safely (no out recorded)
 * - Runner advancement is like a single, but no out is recorded
 * - Runner on 3B scores
 * - Runner on 2B advances to 3B
 * - Runner on 1B advances to 2B
 *
 * Note: This is treated like a single for baserunning purposes,
 * but no out is recorded (the batter is safe due to error).
 */

import type { BaserunningState, BaserunningEvent } from '../state.js';
import { advanceRunner, scoreRunner } from '../transitions.js';
import { runnersToBaseConfig } from '../state.js';

interface ReachedOnErrorResult {
	nextState: BaserunningState;
	runsScored: number;
	scorerIds: string[];
	advancement: BaserunningEvent[];
}

export function handleReachedOnError(
	currentState: BaserunningState,
	batterId: string,
	advancement: BaserunningEvent[]
): ReachedOnErrorResult {
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

	// Runner advancement follows single rules
	// Process runners from 3B to 1B

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
			// 3B still occupied, holds at 2B
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
			// 2B occupied, holds at 1B
			nextState.runners.first = currentState.runners.first;
		}
	}

	// Batter reaches 1B (no out recorded)
	if (!nextState.runners.first) {
		advanceRunner(nextState, advancement, batterId, 'bench', 'first');
	}

	// Update bases bitmap
	nextState.bases = runnersToBaseConfig(nextState.runners);

	// No outs recorded (error)

	return {
		nextState,
		runsScored: scorerIds.length,
		scorerIds,
		advancement,
	};
}
