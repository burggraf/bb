/**
 * Generalized Log5 Matchup Model
 *
 * Based on:
 * - Haechrel, "Matchup Probabilities in Major League Baseball" (SABR)
 * - Classic log5: P(A beats B) = (P(A) - P(A)P(B)) / (P(A) + P(B) - 2P(A)P(B))
 * - Generalized form: P(outcome) ∝ (batter_rate)^α × (pitcher_rate)^β × (league_rate)^γ
 *
 * This is Phase 1: fixed coefficients
 * Phase 2 will add learned coefficients from historical fitting
 * Phase 3 will add full Bayesian hierarchy
 */

import type {
  Matchup,
  Outcome,
  ProbabilityDistribution,
  EventRates,
  ModelConfig,
} from './types.js';
import { EVENT_RATE_KEYS } from './types.js';

/**
 * Validate that rates sum to approximately 1.0
 */
function validateRates(rates: EventRates, label: string): void {
  const sum = Object.values(rates).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1.0) > 0.01) {
    throw new Error(`${label} rates sum to ${sum}, expected ~1.0`);
  }
}

/**
 * Calculate the generalized log5 probability for a single outcome
 *
 * Formula: P = k × (batter^α × pitcher^β × league^γ)
 * where k is a normalization constant
 */
function generalizedLog5(
  batterRate: number,
  pitcherRate: number,
  leagueRate: number,
  config: ModelConfig
): number {
  const { batter: alpha, pitcher: beta, league: gamma } = config.coefficients;

  // Avoid log(0) by clamping rates to a minimum value
  const eps = 1e-6;
  const br = Math.max(batterRate, eps);
  const pr = Math.max(pitcherRate, eps);
  const lr = Math.max(leagueRate, eps);

  // Generalized log5 form
  const raw = Math.pow(br, alpha) * Math.pow(pr, beta) * Math.pow(lr, gamma);

  return raw;
}

/**
 * Get the appropriate rates for a matchup based on handedness
 */
function getRatesForMatchup(matchup: Matchup): {
  batter: EventRates;
  pitcher: EventRates;
  league: EventRates;
} {
  const { batter, pitcher, league } = matchup;

  // Determine which handedness combination to use
  let batterHandedness: 'L' | 'R';
  if (batter.handedness === 'S') {
    // Switch hitters bat opposite to pitcher
    batterHandedness = pitcher.handedness === 'L' ? 'R' : 'L';
  } else {
    batterHandedness = batter.handedness;
  }

  const pitcherHandedness = pitcher.handedness;

  // Get the correct split rates
  const batterRates =
    pitcherHandedness === 'L' ? batter.rates.vsLeft : batter.rates.vsRight;

  const pitcherRates =
    batterHandedness === 'L' ? pitcher.rates.vsLeft : pitcher.rates.vsRight;

  const leagueRates =
    pitcherHandedness === 'L' ? league.rates.vsLeft : league.rates.vsRight;

  return {
    batter: batterRates,
    pitcher: pitcherRates,
    league: leagueRates,
  };
}

/**
 * MatchupModel class for calculating batter-pitcher matchup probabilities
 */
export class MatchupModel {
  private config: ModelConfig;

  constructor(config: Partial<ModelConfig> = {}) {
    // Default to standard log5 coefficients
    this.config = {
      coefficients: config.coefficients || { batter: 1, pitcher: 1, league: -1 },
    };
  }

  /**
   * Calculate the probability distribution for all outcomes in a matchup
   */
  predict(matchup: Matchup): ProbabilityDistribution {
    const { batter, pitcher, league } = getRatesForMatchup(matchup);

    // Validate inputs
    validateRates(batter, 'Batter');
    validateRates(pitcher, 'Pitcher');
    validateRates(league, 'League');

    // Calculate raw probabilities for each outcome
    const rawProbs: Record<keyof EventRates, number> = {} as Record<keyof EventRates, number>;
    let sum = 0;

    for (const outcome of EVENT_RATE_KEYS) {
      const prob = generalizedLog5(
        batter[outcome],
        pitcher[outcome],
        league[outcome],
        this.config
      );
      rawProbs[outcome] = prob;
      sum += prob;
    }

    // Normalize to ensure probabilities sum to 1
    const distribution: ProbabilityDistribution = {} as ProbabilityDistribution;
    for (const outcome of EVENT_RATE_KEYS) {
      distribution[outcome] = rawProbs[outcome] / sum;
    }

    // Final validation
    const finalSum = Object.values(distribution).reduce((a, b) => a + b, 0);
    if (Math.abs(finalSum - 1.0) > 0.001) {
      throw new Error(`Distribution sums to ${finalSum}, expected 1.0`);
    }

    return distribution;
  }

  /**
   * Sample an outcome from a probability distribution
   * Uses inverse transform sampling
   */
  sample(distribution: ProbabilityDistribution): Outcome {
    const r = Math.random();

    let cumulative = 0;
    for (const outcome of EVENT_RATE_KEYS) {
      cumulative += distribution[outcome];
      if (r <= cumulative) {
        return outcome;
      }
    }

    // Fallback (shouldn't happen with proper normalization)
    return 'groundOut';
  }

  /**
   * Simulate a plate appearance and return the outcome
   */
  simulate(matchup: Matchup): Outcome {
    const distribution = this.predict(matchup);
    return this.sample(distribution);
  }

  /**
   * Update model coefficients (for Phase 2: learned coefficients)
   */
  updateCoefficients(coefficients: { batter: number; pitcher: number; league: number }): void {
    this.config.coefficients = coefficients;
  }

  /**
   * Get current model configuration
   */
  getConfig(): ModelConfig {
    return { ...this.config };
  }
}
