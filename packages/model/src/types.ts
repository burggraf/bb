/**
 * Core types for the baseball matchup probability model
 */

/**
 * The 17 detailed plate appearance outcomes.
 * Grouped by category for readability.
 */
export type Outcome =
  // Hits
  | 'single'
  | 'double'
  | 'triple'
  | 'homeRun'
  // Walks
  | 'walk'
  | 'hitByPitch'
  // Strikeout
  | 'strikeout'
  // Ball-in-play outs
  | 'groundOut'
  | 'flyOut'
  | 'lineOut'
  | 'popOut'
  // Sacrifices
  | 'sacrificeFly'
  | 'sacrificeBunt'
  // Other
  | 'fieldersChoice'
  | 'reachedOnError'
  | 'catcherInterference';

/**
 * Probability rates for each of the 17 plate appearance outcomes.
 * Rates should sum to 1.0 within a split (vsLeft or vsRight).
 */
export interface EventRates {
  // Hits
  single: number;
  double: number;
  triple: number;
  homeRun: number;
  // Walks
  walk: number;
  hitByPitch: number;
  // Strikeout
  strikeout: number;
  // Ball-in-play outs
  groundOut: number;
  flyOut: number;
  lineOut: number;
  popOut: number;
  // Sacrifices
  sacrificeFly: number;
  sacrificeBunt: number;
  // Other
  fieldersChoice: number;
  reachedOnError: number;
  catcherInterference: number;
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
 * Extended pitcher statistics including traditional stats
 * Used for managerial decisions and era normalization
 */
export interface ExtendedPitcherStats extends PitcherStats {
  throws: 'L' | 'R';
  teamId: string;
  games: number;
  gamesStarted: number;
  completeGames: number;
  saves: number;
  inningsPitched: number;
  whip: number;
  era: number;
  avgBfpAsStarter: number | null;
  avgBfpAsReliever: number | null;
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
  // Hits
  single: number;
  double: number;
  triple: number;
  homeRun: number;
  // Walks
  walk: number;
  hitByPitch: number;
  // Strikeout
  strikeout: number;
  // Ball-in-play outs
  groundOut: number;
  flyOut: number;
  lineOut: number;
  popOut: number;
  // Sacrifices
  sacrificeFly: number;
  sacrificeBunt: number;
  // Other
  fieldersChoice: number;
  reachedOnError: number;
  catcherInterference: number;
}

/**
 * All outcome keys in consistent order for iteration.
 * Order prioritizes common ball-in-play outs first, then other outcomes
 * grouped by type and approximate frequency for intuitive display.
 */
export const EVENT_RATE_KEYS: (keyof EventRates)[] = [
  'groundOut',      // 12.1%
  'single',         // 16.3%
  'strikeout',      // 14.4%
  'flyOut',         // 7.8%
  'walk',           // 7.9%
  'popOut',         // 3.4%
  'lineOut',        // 3.3%
  'double',         // 4.1%
  'homeRun',        // 2.1%
  'reachedOnError', // 1.3%
  'sacrificeBunt',  // 1.1%
  'triple',         // 0.7%
  'hitByPitch',     // 0.7%
  'sacrificeFly',   // 0.7%
  'fieldersChoice', // 0.5%
  'catcherInterference', // 0.01%
];

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
