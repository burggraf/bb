/**
 * Strikeout baserunning rules
 *
 * Rules:
 * - No baserunning advancement
 * - Possible wild pitch/passed ball scenarios (V2)
 */

import type { BaserunningState, BaserunningEvent } from '../state.js';
import { runnersToBaseConfig } from '../state.js';

interface StrikeoutResult {
	nextState: BaserunningState;
	runsScored: number;
	scorerIds: string[];
	advancement: BaserunningEvent[];
}

export function handleStrikeout(
	currentState: BaserunningState,
	batterId: string,
	advancement: BaserunningEvent[]
): StrikeoutResult {
	const scorerIds: string[] = [];

	// Clone state for mutation
	const nextState: BaserunningState = {
		outs: currentState.outs + 1,
		bases: currentState.bases,
		runners: {
			first: currentState.runners.first,
			second: currentState.runners.second,
			third: currentState.runners.third,
		},
	};

	// No baserunning advancement on strikeout
	// All runners hold their positions

	// Batter strikes out (no advancement event needed for batter)
	// Batter doesn't reach base

	return {
		nextState,
		runsScored: 0,
		scorerIds: [],
		advancement,
	};
}
