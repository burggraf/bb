/**
 * Fly out baserunning rules
 *
 * Rules:
 * - 2 outs before: No advancement, no scoring (inning ends)
 * - 0-1 outs before:
 *   - Runner on 3B: Tags and scores
 *   - Runner on 2B: May tag and advance to 3B (60% chance)
 *   - Runner on 1B: Usually holds (may advance on deep fly, 20% chance)
 *
 * Note: V1 uses deterministic rules (no randomness). V2 may add randomness.
 */

import type { BaserunningState, BaserunningEvent } from '../state.js';
import { advanceRunner, scoreRunner } from '../transitions.js';
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

	// With 2 outs, this is the 3rd out - inning ends, no advancement, no scoring
	if (outsBefore >= 2) {
		// Clear all runners, no one scores
		nextState.runners = { first: null, second: null, third: null };
		nextState.bases = 0;
		nextState.outs = 0; // Will be reset for next inning

		// Batter is out (no advancement event needed for batter)
		return {
			nextState,
			runsScored: 0,
			scorerIds: [],
			advancement,
		};
	}

	// With 0-1 outs: handle baserunning with tag-up rules
	// Process runners from 3B to 1B (home to first) to handle force scenarios

	// Runner on 3B: tags and scores (both 0 and 1 outs)
	if (currentState.runners.third) {
		// Score the runner (tags up on fly out)
		scoreRunner(nextState, advancement, scorerIds, currentState.runners.third, 'third');
	}

	// Runner on 2B: may tag and advance to 3B (V1: deterministic - always advances if 3B empty)
	if (currentState.runners.second) {
		const thirdBaseOccupied = nextState.runners.third !== null;
		if (!thirdBaseOccupied) {
			// Advance to 3B (tags up)
			advanceRunner(
				nextState,
				advancement,
				currentState.runners.second,
				'second',
				'third'
			);
		} else {
			// Hold at 2B (3B occupied)
			nextState.runners.second = currentState.runners.second;
		}
	}

	// Runner on 1B: usually holds (V1: deterministic - always holds)
	// V2 may add 20% chance to advance on deep fly
	if (currentState.runners.first) {
		// Hold at 1B
		nextState.runners.first = currentState.runners.first;
	}

	// Update bases bitmap
	nextState.bases = runnersToBaseConfig(nextState.runners);

	// Increment outs (will be handled by engine)
	nextState.outs = outsBefore + 1;

	return {
		nextState,
		runsScored: scorerIds.length,
		scorerIds,
		advancement,
	};
}
