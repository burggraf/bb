/**
 * Fielder's choice baserunning rules
 *
 * Rules:
 * - Batter reaches 1B safely
 * - Lead runner is retired (the out recorded)
 * - Other runners advance at their own risk (V1: conservative, only forced runners advance)
 * - If no runners on base, treated as a single (batter reaches, no out)
 */

import type { BaserunningState, BaserunningEvent } from '../state.js';
import { advanceRunner, scoreRunner } from '../transitions.js';
import { runnersToBaseConfig } from '../state.js';
import { isBasesEmpty } from '../state.js';

interface FieldersChoiceResult {
	nextState: BaserunningState;
	runsScored: number;
	scorerIds: string[];
	advancement: BaserunningEvent[];
	outRunnerId?: string; // ID of the runner who was put out
}

export function handleFieldersChoice(
	currentState: BaserunningState,
	batterId: string,
	advancement: BaserunningEvent[]
): FieldersChoiceResult {
	const scorerIds: string[] = [];
	let outRunnerId: string | undefined;

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

	// If bases are empty, fielder's choice results in batter reaching with no out
	// (e.g., error on the play, or batter beat the throw)
	if (isBasesEmpty(currentState)) {
		// Batter reaches 1B
		advanceRunner(nextState, advancement, batterId, 'bench', 'first');
		nextState.bases = runnersToBaseConfig(nextState.runners);

		return {
			nextState,
			runsScored: 0,
			scorerIds,
			advancement,
			outRunnerId: undefined,
		};
	}

	// With runners on base: lead runner is retired, others advance if forced
	// Find the lead runner (furthest base)
	let leadRunnerBase: 'first' | 'second' | 'third' | null = null;
	let leadRunnerId: string | undefined;
	if (currentState.runners.third) {
		leadRunnerBase = 'third';
		leadRunnerId = currentState.runners.third;
	} else if (currentState.runners.second) {
		leadRunnerBase = 'second';
		leadRunnerId = currentState.runners.second;
	} else if (currentState.runners.first) {
		leadRunnerBase = 'first';
		leadRunnerId = currentState.runners.first;
	}

	// Process baserunning from 3B to 1B
	// Runner on 3B: Out if lead runner, otherwise holds
	if (currentState.runners.third) {
		if (leadRunnerBase === 'third') {
			// Lead runner is out
			// No advancement event for the out (runner retired at 3B)
			outRunnerId = currentState.runners.third;
			nextState.runners.third = null;
		} else {
			// Not the lead runner, holds (no force)
			nextState.runners.third = currentState.runners.third;
		}
	}

	// Runner on 2B: Out if lead runner and no runner on 3B, advances to 3B if forced
	if (currentState.runners.second) {
		if (leadRunnerBase === 'second') {
			// Lead runner is out at 2B
			outRunnerId = currentState.runners.second;
			nextState.runners.second = null;
		} else if (currentState.runners.first) {
			// Forced to advance by batter taking 1B
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
		} else {
			// Not forced, holds at 2B
			nextState.runners.second = currentState.runners.second;
		}
	}

	// Runner on 1B: Out if lead runner, otherwise forced to 2B by batter
	if (currentState.runners.first) {
		if (leadRunnerBase === 'first') {
			// Lead runner is out at 1B
			outRunnerId = currentState.runners.first;
			nextState.runners.first = null;
		} else {
			// Not the lead runner, forced to advance to 2B by batter
			// Only advance if 2B is now empty (lead runner on 2B was out, or 2B runner advanced)
			if (!nextState.runners.second) {
				advanceRunner(
					nextState,
					advancement,
					currentState.runners.first,
					'first',
					'second'
				);
			} else {
				// 2B still occupied, holds at 1B
				nextState.runners.first = currentState.runners.first;
			}
		}
	}

	// Batter reaches 1B
	advanceRunner(nextState, advancement, batterId, 'bench', 'first');

	// Update bases bitmap
	nextState.bases = runnersToBaseConfig(nextState.runners);

	// Increment outs (lead runner retired)
	nextState.outs = Math.min(outsBefore + 1, 3) as 0 | 1 | 2 | 3;

	return {
		nextState,
		runsScored: scorerIds.length,
		scorerIds,
		advancement,
		outRunnerId,
	};
}
