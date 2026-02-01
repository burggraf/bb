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
    // Return league average rates if no data (approximate 2024 MLB averages)
    return {
      // Hits
      single: 0.163,
      double: 0.041,
      triple: 0.007,
      homeRun: 0.021,
      // Walks
      walk: 0.079,
      hitByPitch: 0.007,
      // Strikeout
      strikeout: 0.144,
      // Ball-in-play outs
      groundOut: 0.121,
      flyOut: 0.078,
      lineOut: 0.033,
      popOut: 0.034,
      // Sacrifices
      sacrificeFly: 0.007,
      sacrificeBunt: 0.011,
      // Other
      fieldersChoice: 0.005,
      reachedOnError: 0.013,
      catcherInterference: 0.0001,
    };
  }

  return {
    // Hits
    single: (counts.single || 0) / total,
    double: (counts.double || 0) / total,
    triple: (counts.triple || 0) / total,
    homeRun: (counts.homeRun || 0) / total,
    // Walks
    walk: (counts.walk || 0) / total,
    hitByPitch: (counts.hitByPitch || 0) / total,
    // Strikeout
    strikeout: (counts.strikeout || 0) / total,
    // Ball-in-play outs
    groundOut: (counts.groundOut || 0) / total,
    flyOut: (counts.flyOut || 0) / total,
    lineOut: (counts.lineOut || 0) / total,
    popOut: (counts.popOut || 0) / total,
    // Sacrifices
    sacrificeFly: (counts.sacrificeFly || 0) / total,
    sacrificeBunt: (counts.sacrificeBunt || 0) / total,
    // Other
    fieldersChoice: (counts.fieldersChoice || 0) / total,
    reachedOnError: (counts.reachedOnError || 0) / total,
    catcherInterference: (counts.catcherInterference || 0) / total,
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
