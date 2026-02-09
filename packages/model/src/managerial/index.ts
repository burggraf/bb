/**
 * Managerial System - Strategic decision-making for baseball games
 *
 * This module provides algorithmic decision-making for:
 * - Lineup generation
 * - Pitcher management (bullpen usage)
 * - Pinch-hitter selection
 * - Platoon advantage
 * - League norms calculation
 * - Roster management and rotation building
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
	RelieverSelectionOptions,
	EraStrategy,
	EraDetection,
	PlayerAvailability,
	LineupBuildResult,
	EraLineupOptions,
	LineupSlot
} from './types.js';

// Lineup (legacy - will be deprecated)
export { generateLineup, type LineupOptions } from './lineup.js';

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

// League Norms
export { calculateLeagueNorms } from './norms-calculator.js';

// Pitcher Quality
export { calculatePitcherQuality } from './pitcher-quality.js';

// Pitcher Classifier
export { classifyPitchers } from './pitcher-classifier.js';

// Roster Manager
export {
	RosterManager,
	type RotationSlot,
	type RestDecision,
	type UsageContext,
	type UsageRecord,
	type TeamInfo
} from './roster-manager.js';
