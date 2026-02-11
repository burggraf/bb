/**
 * Walk / Hit By Pitch baserunning rules
 *
 * Rules:
 * - Force advancement only (all runners advance 1 base)
 * - Batter takes 1B
 * - Bases loaded: Runner from 3B scores
 */

import type { Outcome } from '../../types.js';
import type { BaserunningState, BaserunningEvent } from '../state.js';
import { scoreRunner } from '../transitions.js';
import { runnersToBaseConfig } from '../state.js';

interface WalkResult {
	nextState: BaserunningState;
	runsScored: number;
	scorerIds: string[];
	advancement: BaserunningEvent[];
}

export function handleWalkOrHBP(
	currentState: BaserunningState,
	outcome: 'walk' | 'intentionalWalk' | 'hitByPitch',
	batterId: string,
	advancement: BaserunningEvent[]
): WalkResult {
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

	// Check if bases are loaded
	const basesLoaded =
		currentState.runners.first !== null &&
		currentState.runners.second !== null &&
		currentState.runners.third !== null;

	// Process runners from 3B to 1B (home to first) for force advancement
	// Runner on 3B: scores if bases loaded (forced by batter taking 1B)
	if (currentState.runners.third) {
		if (basesLoaded) {
			// Score the runner
			scoreRunner(nextState, advancement, scorerIds, currentState.runners.third, 'third');
		} else {
			// Runner stays at 3B (not forced)
			nextState.runners.third = currentState.runners.third;
		}
	}

	// Runner on 2B: advances to 3B if forced (runner on 1B)
	if (currentState.runners.second) {
		if (currentState.runners.first || basesLoaded) {
			// Forced to advance to 3B
			nextState.runners.third = currentState.runners.second;
			// Record advancement
			advancement.push({
				runnerId: currentState.runners.second,
				from: 'second',
				to: 'third',
			});
		} else {
			// Not forced, holds at 2B
			nextState.runners.second = currentState.runners.second;
		}
	}

	// Runner on 1B: advances to 2B if forced (batter takes 1B)
	if (currentState.runners.first) {
		// Always forced when there's a walk/HBP (batter takes 1B)
		nextState.runners.second = currentState.runners.first;
		// Record advancement
		advancement.push({
			runnerId: currentState.runners.first,
			from: 'first',
			to: 'second',
		});
	}

	// Batter takes 1B
	nextState.runners.first = batterId;
	// Record batter reaching first
	advancement.push({
		runnerId: batterId,
		from: 'bench',
		to: 'first',
	});

	// Update bases bitmap
	nextState.bases = runnersToBaseConfig(nextState.runners);

	return {
		nextState,
		runsScored: scorerIds.length,
		scorerIds,
		advancement,
	};
}
