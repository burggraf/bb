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
		case 'out':
			// Current implementation uses ground out logic for all outs
			// In V2, this will branch to different handlers based on out type
			return handleGroundOut(currentState, batterId, advancement);

		case 'walk':
		case 'hitByPitch':
			return handleWalkOrHBP(currentState, outcome, batterId, advancement);

		case 'single':
		case 'double':
		case 'triple':
		case 'homeRun':
			return handleHit(currentState, outcome, batterId, advancement);

		case 'strikeout':
			// Will be added as a new outcome type in V2
			return handleStrikeout(currentState, batterId, advancement);

		case 'flyOut':
			// Will be added as a new outcome type in V2
			return handleFlyOut(currentState, batterId, advancement);

		default:
			// Fallback for any unknown outcomes
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
