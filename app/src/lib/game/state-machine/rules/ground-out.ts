/**
 * Ground out baserunning rules
 *
 * Rules:
 * - 2 outs before: No advancement, no scoring (inning ends)
 * - 0 outs before:
 *   - Runner on 3B: Holds (too risky to get thrown out at home with 0 outs)
 *   - Runner on 2B: Advances to 3B if 3B empty
 *   - Runner on 1B: Advances to 2B if bases ahead are empty
 * - 1 out before:
 *   - Runner on 3B: Tags and scores
 *   - Runner on 2B: Advances to 3B if 3B empty
 *   - Runner on 1B: Advances to 2B if bases ahead are empty
 */

import type { BaserunningState, BaserunningEvent } from '../state.js';
import { advanceRunner, scoreRunner } from '../transitions.js';
import { runnersToBaseConfig } from '../state.js';

interface GroundOutResult {
	nextState: BaserunningState;
	runsScored: number;
	scorerIds: string[];
	advancement: BaserunningEvent[];
}

export function handleGroundOut(
	currentState: BaserunningState,
	batterId: string,
	advancement: BaserunningEvent[]
): GroundOutResult {
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

	// With 0-1 outs: handle baserunning
	// Process runners from 3B to 1B (home to first) to handle force scenarios

	// Runner on 3B: holds with 0 outs (too risky), scores with 1 out (run matters)
	if (currentState.runners.third) {
		if (outsBefore === 1) {
			// Score the runner (worth the risk with 1 out)
			scoreRunner(nextState, advancement, scorerIds, currentState.runners.third, 'third');
		} else {
			// With 0 outs, runner stays at 3B (conservative - don't make easy 3rd out)
			// No advancement needed, runner stays
		}
	}

	// Runner on 2B: advances if 3B empty (both 0 and 1 outs)
	if (currentState.runners.second) {
		const thirdBaseOccupied = nextState.runners.third !== null;
		if (!thirdBaseOccupied) {
			// Advance to 3B
			advanceRunner(
				nextState,
				advancement,
				currentState.runners.second,
				'second',
				'third'
			);
		} else {
			// Hold at 2B (3B occupied)
			// No advancement needed, runner stays
		}
	}

	// Runner on 1B: advances if 2B is empty (both 0 and 1 outs)
	// Only checks the base directly ahead, not all bases
	if (currentState.runners.first) {
		const secondBaseOccupied = nextState.runners.second !== null;

		if (!secondBaseOccupied) {
			// Advance to 2B (2B is empty)
			advanceRunner(
				nextState,
				advancement,
				currentState.runners.first,
				'first',
				'second'
			);
		} else {
			// Hold at 1B (2B occupied)
			// No advancement needed, runner stays
		}
	}

	// Update bases bitmap
	nextState.bases = runnersToBaseConfig(nextState.runners);

	// Increment outs (will be handled by engine)
	nextState.outs = outsBefore + 1 as 0 | 1 | 2;

	return {
		nextState,
		runsScored: scorerIds.length,
		scorerIds,
		advancement,
	};
}
