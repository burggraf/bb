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
	// Clone the current state to avoid mutation
	const nextState: BaserunningState = {
		outs: currentState.outs,
		bases: currentState.bases,
		runners: {
			first: currentState.runners.first,
			second: currentState.runners.second,
			third: currentState.runners.third,
		},
	};

	const advancement: BaserunningEvent[] = [];

	switch (outcome) {
		// Hits
		case 'single':
		case 'double':
		case 'triple':
		case 'homeRun':
			return handleHit(currentState, outcome, batterId, advancement);

		// Walks and HBP
		case 'walk':
		case 'hitByPitch':
			return handleWalkOrHBP(currentState, outcome, batterId, advancement);

		// Strikeout
		case 'strikeout':
			return handleStrikeout(currentState, batterId, advancement);

		// Ball-in-play outs
		case 'groundOut':
			return handleGroundOut(currentState, batterId, advancement);
		case 'flyOut':
			return handleFlyOut(currentState, batterId, advancement);
		case 'lineOut':
			return handleLineOut(currentState, batterId, advancement);
		case 'popOut':
			return handlePopOut(currentState, batterId, advancement);

		// Sacrifices
		case 'sacrificeFly':
			return handleSacrificeFly(currentState, batterId, advancement);
		case 'sacrificeBunt':
			return handleSacrificeBunt(currentState, batterId, advancement);

		// Other reach-base outcomes
		case 'fieldersChoice':
			return handleFieldersChoice(currentState, batterId, advancement);
		case 'reachedOnError':
			return handleReachedOnError(currentState, batterId, advancement);
		case 'catcherInterference':
			return handleCatcherInterference(currentState, batterId, advancement);

		default:
			// Fallback for any unknown outcomes
			const _exhaustive: never = outcome;
			return {
				nextState,
				runsScored: 0,
				scorerIds: [],
				advancement,
			};
	}
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
