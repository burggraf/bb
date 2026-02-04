/**
 * Managerial System - Strategic decision-making for baseball games
 *
 * This module provides algorithmic decision-making for:
 * - Lineup generation
 * - Pitcher management (bullpen usage)
 * - Pinch-hitter selection
 * - Platoon advantage
 */

// Types
export type {
	GameState,
	PitcherRole,
	BullpenState,
	PitchingDecision,
	EnhancedBullpenState,
	PitcherQuality,
	LeaguePitchingNorms,
	RelieverSelectionOptions
} from './types.js';

// Lineup
export { generateLineup, type LineupOptions, type LineupSlot } from './lineup.js';

// Platoon
export {
	applyPlatoonAdvantage,
	addNoise,
	isPlatoonDisadvantage,
	getPlatoonRates
} from './platoon.js';

// Pitching
export {
	shouldPullPitcher,
	selectReliever,
	calculateLeverageIndex,
	reduceStamina,
	type PitchCountOptions
} from './pitching.js';

// Substitutions
export {
	shouldPinchHit,
	isAvailableOnBench,
	getAvailableBench,
	type PinchHitDecision
} from './substitutions.js';
