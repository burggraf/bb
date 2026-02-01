/**
 * Hit baserunning rules (single, double, triple, home run)
 *
 * Rules:
 * - Single: Runner on 3B scores, runner on 2B to 3B, runner on 1B to 2B, batter to 1B
 * - Double: Runners on 1B and 2B score, batter to 2B
 * - Triple: All runners score, batter to 3B
 * - Home Run: All runners + batter score, bases cleared
 */

import type { BaserunningState, BaserunningEvent } from '../state.js';
import { advanceRunner, scoreRunner } from '../transitions.js';
import { runnersToBaseConfig } from '../state.js';

interface HitResult {
	nextState: BaserunningState;
	runsScored: number;
	scorerIds: string[];
	advancement: BaserunningEvent[];
}

export function handleHit(
	currentState: BaserunningState,
	outcome: 'single' | 'double' | 'triple' | 'homeRun',
	batterId: string,
	advancement: BaserunningEvent[]
): HitResult {
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

	switch (outcome) {
		case 'single':
			// Runner on 3B: scores
			if (currentState.runners.third) {
				scoreRunner(nextState, advancement, scorerIds, currentState.runners.third, 'third');
			}
			// Runner on 2B: advances to 3B
			if (currentState.runners.second) {
				// Only advance if 3B is now empty (runner from 3B scored)
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
			// Batter to 1B
			if (!nextState.runners.first) {
				advanceRunner(nextState, advancement, batterId, 'bench', 'first');
			}
			break;

		case 'double':
			// Runner on 1B: scores
			if (currentState.runners.first) {
				scoreRunner(nextState, advancement, scorerIds, currentState.runners.first, 'first');
			}
			// Runner on 2B: scores
			if (currentState.runners.second) {
				scoreRunner(nextState, advancement, scorerIds, currentState.runners.second, 'second');
			}
			// Runner on 3B: scores
			if (currentState.runners.third) {
				scoreRunner(nextState, advancement, scorerIds, currentState.runners.third, 'third');
			}
			// Batter to 2B
			advanceRunner(nextState, advancement, batterId, 'bench', 'second');
			break;

		case 'triple':
			// All runners score
			if (currentState.runners.first) {
				scoreRunner(nextState, advancement, scorerIds, currentState.runners.first, 'first');
			}
			if (currentState.runners.second) {
				scoreRunner(nextState, advancement, scorerIds, currentState.runners.second, 'second');
			}
			if (currentState.runners.third) {
				scoreRunner(nextState, advancement, scorerIds, currentState.runners.third, 'third');
			}
			// Batter to 3B
			advanceRunner(nextState, advancement, batterId, 'bench', 'third');
			break;

		case 'homeRun':
			// All runners score
			if (currentState.runners.first) {
				scoreRunner(nextState, advancement, scorerIds, currentState.runners.first, 'first');
			}
			if (currentState.runners.second) {
				scoreRunner(nextState, advancement, scorerIds, currentState.runners.second, 'second');
			}
			if (currentState.runners.third) {
				scoreRunner(nextState, advancement, scorerIds, currentState.runners.third, 'third');
			}
			// Batter scores
			scorerIds.push(batterId);
			advancement.push({
				runnerId: batterId,
				from: 'bench',
				to: 'home',
			});
			// Bases cleared
			nextState.runners = { first: null, second: null, third: null };
			break;
	}

	// Update bases bitmap
	nextState.bases = runnersToBaseConfig(nextState.runners);

	return {
		nextState,
		runsScored: scorerIds.length,
		scorerIds,
		advancement,
	};
}
