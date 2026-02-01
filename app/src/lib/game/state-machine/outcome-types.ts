/**
 * Outcome type classification helpers
 *
 * Provides utilities for classifying outcomes into categories
 * for state machine logic.
 */

import type { Outcome } from '../types.js';

export const HIT_OUTCOMES: Outcome[] = ['single', 'double', 'triple', 'homeRun'];
export const REACH_BASE_OUTCOMES: Outcome[] = ['walk', 'hitByPitch', 'fieldersChoice', 'reachedOnError', 'catcherInterference'];
export const OUT_OUTCOMES: Outcome[] = ['strikeout', 'groundOut', 'flyOut', 'lineOut', 'popOut', 'sacrificeFly', 'sacrificeBunt'];
export const BALL_IN_PLAY_OUTS: Outcome[] = ['groundOut', 'flyOut', 'lineOut', 'popOut'];
export const SACRIFICE_OUTCOMES: Outcome[] = ['sacrificeFly', 'sacrificeBunt'];

export function isHit(outcome: Outcome): boolean {
	return HIT_OUTCOMES.includes(outcome);
}

export function isOut(outcome: Outcome): boolean {
	return OUT_OUTCOMES.includes(outcome);
}

export function isBallInPlayOut(outcome: Outcome): boolean {
	return BALL_IN_PLAY_OUTS.includes(outcome);
}

export function batterReachesBase(outcome: Outcome): boolean {
	return isHit(outcome) || REACH_BASE_OUTCOMES.includes(outcome);
}

export function isSacrifice(outcome: Outcome): boolean {
	return SACRIFICE_OUTCOMES.includes(outcome);
}
