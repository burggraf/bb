/**
 * Baseball game state machine - state transition functions
 * Pure functions for testability
 */

import type { Outcome } from '../types.js';
import type {
	BaserunningState,
	BaserunningEvent,
} from './state.js';
import { runnersToBaseConfig } from './state.js';
import { handleGroundOut } from './rules/ground-out.js';
import { handleWalkOrHBP } from './rules/walk.js';
import { handleHit } from './rules/hit.js';
import { handleStrikeout } from './rules/strikeout.js';
import { handleFlyOut } from './rules/fly-out.js';
import { handleSacrificeFly } from './rules/sacrifice-fly.js';
import { handleSacrificeBunt } from './rules/sacrifice-bunt.js';
import { handleFieldersChoice } from './rules/fielders-choice.js';
import { handleReachedOnError } from './rules/reached-on-error.js';
import { handleCatcherInterference } from './rules/interference.js';
import { handlePopOut } from './rules/pop-out.js';
import { handleLineOut } from './rules/line-out.js';

/**
 * Result of a state transition
 */
export interface TransitionResult {
	nextState: BaserunningState;
	runsScored: number;
	scorerIds: string[];
	advancement: BaserunningEvent[];
	outRunnerId?: string; // ID of the runner who was put out (for fielder's choice, etc.)
}

/**
 * Core state transition function
 * Returns the next state based on baseball rules
 *
 * @param currentState - Current baserunning state
 * @param outcome - The outcome of the plate appearance
 * @param batterId - ID of the batter
 * @returns TransitionResult with next state, runs scored, and advancement events
 */
export function transition(
	currentState: BaserunningState,
	outcome: Outcome,
	batterId: string
): TransitionResult {
	let result: TransitionResult;

	const advancement: BaserunningEvent[] = [];

	switch (outcome) {
		// Hits
		case 'single':
		case 'double':
		case 'triple':
		case 'homeRun':
			result = handleHit(currentState, outcome, batterId, advancement);
			break;

		// Walks and HBP
		case 'walk':
		case 'intentionalWalk':
		case 'hitByPitch':
			result = handleWalkOrHBP(currentState, outcome, batterId, advancement);
			break;

		// Strikeout
		case 'strikeout':
			result = handleStrikeout(currentState, batterId, advancement);
			break;

		// Ball-in-play outs
		case 'groundOut':
			result = handleGroundOut(currentState, batterId, advancement);
			break;
		case 'flyOut':
			result = handleFlyOut(currentState, batterId, advancement);
			break;
		case 'lineOut':
			result = handleLineOut(currentState, batterId, advancement);
			break;
		case 'popOut':
			result = handlePopOut(currentState, batterId, advancement);
			break;

		// Sacrifices
		case 'sacrificeFly':
			result = handleSacrificeFly(currentState, batterId, advancement);
			break;
		case 'sacrificeBunt':
			result = handleSacrificeBunt(currentState, batterId, advancement);
			break;

		// Other reach-base outcomes
		case 'fieldersChoice': {
			const fcResult = handleFieldersChoice(currentState, batterId, advancement);
			result = {
				...fcResult,
				outRunnerId: fcResult.outRunnerId,
			};
			break;
		}
		case 'reachedOnError':
			result = handleReachedOnError(currentState, batterId, advancement);
			break;
		case 'catcherInterference':
			result = handleCatcherInterference(currentState, batterId, advancement);
			break;

		default:
			// Fallback for any unknown outcomes
			const _exhaustive: never = outcome;
			result = {
				nextState: currentState,
				runsScored: 0,
				scorerIds: [],
				advancement,
			};
	}

	// Handle inning end: 3 outs resets to 0 and clears bases
	if (result.nextState.outs === 3) {
		// IN BASEBALL, runs can score on the 3rd out IF it's not a force out
		// or the batter-runner being put out before reaching first base.
		// For Phase 1, we use a simplified rule: runs score if it's NOT a force/fly out.
		// However, current rules handle this within their respective functions.
		// We only wipe runs if the rule explicitly says so, or if it's 3 outs.
		
		// Determine if this is a "no-run" 3rd out (force out, strikeout, fly out)
		const isNoRunOut = ['strikeout', 'flyOut', 'popOut', 'lineOut', 'groundOut', 'sacrificeFly', 'sacrificeBunt'].includes(outcome);
		
		if (isNoRunOut) {
			result.runsScored = 0;
			result.scorerIds = [];
		}

		result.nextState = {
			outs: 0,
			bases: 0,
			runners: { first: null, second: null, third: null },
		};
	}

	return result;
}

/**
 * Helper function to record a baserunning advancement event
 */
export function recordAdvancement(
	advancement: BaserunningEvent[],
	runnerId: string,
	from: BaserunningEvent['from'],
	to: BaserunningEvent['to']
): void {
	advancement.push({ runnerId, from, to });
}

/**
 * Helper function to advance a runner and track the event
 */
export function advanceRunner(
	state: BaserunningState,
	advancement: BaserunningEvent[],
	runnerId: string,
	fromBase: 'first' | 'second' | 'third' | 'bench',
	toBase: 'first' | 'second' | 'third' | 'home' | 'dugout'
): void {
	// Remove from current base
	if (fromBase === 'first') state.runners.first = null;
	else if (fromBase === 'second') state.runners.second = null;
	else if (fromBase === 'third') state.runners.third = null;

	// Add to new base
	if (toBase === 'first') state.runners.first = runnerId;
	else if (toBase === 'second') state.runners.second = runnerId;
	else if (toBase === 'third') state.runners.third = runnerId;

	// Update bases bitmap
	state.bases = runnersToBaseConfig(state.runners);

	// Record the advancement
	recordAdvancement(
		advancement,
		runnerId,
		fromBase === 'bench' ? 'bench' : fromBase,
		toBase
	);
}

/**
 * Helper function to score a runner
 */
export function scoreRunner(
	state: BaserunningState,
	advancement: BaserunningEvent[],
	scorerIds: string[],
	runnerId: string,
	fromBase: 'first' | 'second' | 'third'
): void {
	advanceRunner(state, advancement, runnerId, fromBase, 'home');
	scorerIds.push(runnerId);
}
