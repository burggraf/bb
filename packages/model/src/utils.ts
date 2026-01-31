/**
 * Utility functions for the matchup model
 */

import type { EventRates, SplitRates } from './types.js';

/**
 * Calculate event rates from event counts
 */
export function calculateRates(counts: Record<string, number>): EventRates {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  if (total === 0) {
    // Return league average rates if no data
    return {
      out: 0.68,
      single: 0.155,
      double: 0.045,
      triple: 0.005,
      homeRun: 0.03,
      walk: 0.08,
      hitByPitch: 0.005,
    };
  }

  return {
    out: (counts.out || 0) / total,
    single: (counts.single || 0) / total,
    double: (counts.double || 0) / total,
    triple: (counts.triple || 0) / total,
    homeRun: (counts.homeRun || 0) / total,
    walk: (counts.walk || 0) / total,
    hitByPitch: (counts.hitByPitch || 0) / total,
  };
}

/**
 * Apply regression toward league average (partial pooling)
 *
 * This is a simple version of Bayesian shrinkage.
 * For Phase 3, we'll use the full hierarchical model.
 */
export function regressRates(
  playerRates: EventRates,
  leagueRates: EventRates,
  plateAppearances: number,
  regressionThreshold: number = 200
): EventRates {
  // Calculate regression weight
  // More PA = less regression (closer to player's actual rates)
  const weight = Math.min(plateAppearances / regressionThreshold, 1);

  const regressed: EventRates = {} as EventRates;

  for (const outcome of Object.keys(playerRates) as Array<keyof EventRates>) {
    regressed[outcome] =
      playerRates[outcome] * weight + leagueRates[outcome] * (1 - weight);
  }

  return regressed;
}

/**
 * Create split rates from vsLeft and vsRight data
 */
export function createSplitRates(vsLeft: EventRates, vsRight: EventRates): SplitRates {
  return {
    vsLeft,
    vsRight,
  };
}

/**
 * Normalize rates to ensure they sum to 1.0
 */
export function normalizeRates(rates: EventRates): EventRates {
  const sum = Object.values(rates).reduce((a, b) => a + b, 0);

  if (sum === 0) {
    throw new Error('Cannot normalize zero rates');
  }

  const normalized: EventRates = {} as EventRates;
  for (const key of Object.keys(rates) as Array<keyof EventRates>) {
    normalized[key] = rates[key] / sum;
  }

  return normalized;
}

/**
 * Round rates to a specified number of decimal places
 */
export function roundRates(rates: EventRates, decimals: number = 4): EventRates {
  const rounded: EventRates = {} as EventRates;
  const factor = Math.pow(10, decimals);

  for (const key of Object.keys(rates) as Array<keyof EventRates>) {
    rounded[key] = Math.round(rates[key] * factor) / factor;
  }

  return rounded;
}
