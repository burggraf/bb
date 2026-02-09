/**
 * @bb/model - Baseball Matchup Probability Model
 *
 * A TypeScript library for calculating batter-pitcher matchup probabilities
 * using the generalized log5 method.
 *
 * Phase 1: Generalized log5 with fixed coefficients
 * Phase 2: Learned coefficients from historical fitting
 * Phase 3: Full Bayesian hierarchical model
 */

// Core types
export type {
  Outcome,
  EventRates,
  SplitRates,
  BatterStats,
  PitcherStats,
  ExtendedPitcherStats,
  LeagueAverages,
  Matchup,
  ProbabilityDistribution,
  PlayResult,
  ModelConfig,
} from './types.js';

// Main model class
export { MatchupModel } from './MatchupModel.js';

// Utility functions
export {
  calculateRates,
  regressRates,
  createSplitRates,
  normalizeRates,
  roundRates,
} from './utils.js';

// Managerial system
export { generateLineup } from './managerial/lineup.js';
export {
	applyPlatoonAdvantage,
	addNoise,
	isPlatoonDisadvantage,
	getPlatoonRates
} from './managerial/platoon.js';
export {
	shouldPullPitcher,
	selectReliever,
	calculateLeverageIndex,
	reduceStamina,
	calculateLeagueNorms,
	classifyPitchers,
	getEraStrategy,
	isTransitionYear,
	getPureEraStrategy,
	getStrategyFunction,
	blendLineups
} from './managerial/index.js';
export {
	shouldPinchHit,
	isAvailableOnBench,
	getAvailableBench
} from './managerial/substitutions.js';
export type {
	EraLineupOptions,
	LineupSlot,
	PitcherRole,
	BullpenState,
	EnhancedBullpenState,
	GameState,
	PitchingDecision,
	PinchHitDecision,
	LeaguePitchingNorms,
	EraStrategy,
	EraDetection,
	PlayerAvailability,
	LineupBuildResult
} from './managerial/index.js';
