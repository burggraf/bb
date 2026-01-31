/**
 * Core types for the baseball matchup probability model
 */

/**
 * All possible plate appearance outcomes
 */
export type Outcome =
  | 'out'        // Any out (strikeout, fly out, ground out, etc.)
  | 'single'     // Single (1B)
  | 'double'     // Double (2B)
  | 'triple'     // Triple (3B)
  | 'homeRun'    // Home Run (HR)
  | 'walk'       // Walk (BB)
  | 'hitByPitch' // Hit By Pitch (HBP)
  | 'sacrifice'; // Sacrifice bunt/fly (SH, SF) - optional for V1

/**
 * Event rates for a player (batter or pitcher)
 * Each rate represents the proportion of plate appearances ending in that outcome
 */
export interface EventRates {
  out: number;        // Out rate
  single: number;     // Single rate
  double: number;     // Double rate
  triple: number;     // Triple rate
  homeRun: number;    // Home run rate
  walk: number;       // Walk rate
  hitByPitch: number; // HBP rate
}

/**
 * Rates split by opponent handedness
 */
export interface SplitRates {
  vsLeft: EventRates;
  vsRight: EventRates;
}

/**
 * Batter statistics for matchup calculation
 */
export interface BatterStats {
  id: string;
  name: string;
  handedness: 'L' | 'R' | 'S'; // S = switch hitter
  rates: SplitRates; // vs LHP, vs RHP
}

/**
 * Pitcher statistics for matchup calculation
 */
export interface PitcherStats {
  id: string;
  name: string;
  handedness: 'L' | 'R';
  rates: SplitRates; // vs LHB, vs RHB
}

/**
 * League averages for a season
 */
export interface LeagueAverages {
  year: number;
  rates: SplitRates; // vs LHP/LHB, vs RHP/RHB
}

/**
 * A matchup between a specific batter and pitcher
 */
export interface Matchup {
  batter: BatterStats;
  pitcher: PitcherStats;
  league: LeagueAverages;
}

/**
 * Probability distribution over all possible outcomes
 * All probabilities should sum to 1.0
 */
export interface ProbabilityDistribution {
  out: number;
  single: number;
  double: number;
  triple: number;
  homeRun: number;
  walk: number;
  hitByPitch: number;
  // sacrifice: number; // Optional for V1
}

/**
 * Result of a plate appearance
 */
export interface PlayResult {
  outcome: Outcome;
  batterId: string;
  pitcherId: string;
  inning: number;
  timestamp: number;
}

/**
 * Configuration for the matchup model
 */
export interface ModelConfig {
  /**
   * Coefficients for the generalized log5 formula
   * Default is { batter: 1, pitcher: 1, league: -1 } for standard log5
   * Learned coefficients from Bayesian fitting will differ
   */
  coefficients: {
    batter: number;
    pitcher: number;
    league: number;
  };
}
