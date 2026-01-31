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
