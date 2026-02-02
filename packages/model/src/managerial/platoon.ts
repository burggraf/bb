/**
 * Platoon Advantage - Apply handedness matchups with randomness
 */

import type { BatterStats, PitcherStats, EventRates } from '../types.js';

/**
 * Apply platoon advantage with randomness
 * Returns the adjusted matchup probability rates
 */
export function applyPlatoonAdvantage(
	batter: BatterStats,
	pitcher: PitcherStats,
	baseRates: EventRates,
	randomness = 0.1
): EventRates {
	const pitcherHandedness = pitcher.handedness;
	const batterHandedness = batter.handedness;

	// Get correct platoon rates
	let rates: EventRates;

	// Switch hitters: always use favorable split
	if (batterHandedness === 'S') {
		// Switch hitters get advantage vs both
		// Use vsRight vs LHP (favorable), vsLeft vs RHP (favorable)
		rates = pitcherHandedness === 'L' ? batter.rates.vsRight : batter.rates.vsLeft;
	}
	// Normal platoon
	else if (pitcherHandedness === 'L') {
		rates = batter.rates.vsLeft;
	} else {
		rates = batter.rates.vsRight;
	}

	// Add slight randomness for realism
	if (randomness > 0) {
		rates = addNoise(rates, randomness);
	}

	return rates;
}

/**
 * Add small random noise to rates while keeping them valid probabilities
 *
 * Note: After adding noise, rates may not sum exactly to 1.0.
 * The MatchupModel handles normalization if needed.
 */
export function addNoise(rates: EventRates, noise: number): EventRates {
	const noisy = { ...rates };

	for (const key of Object.keys(noisy) as (keyof EventRates)[]) {
		const randomAdjustment = (Math.random() - 0.5) * 2 * noise; // -noise to +noise
		noisy[key] = Math.max(0, Math.min(1, noisy[key] + randomAdjustment));
	}

	return noisy;
}

/**
 * Check if batter has platoon disadvantage
 * Returns true if batter is same-handed as pitcher
 */
export function isPlatoonDisadvantage(
	batterHandedness: 'L' | 'R' | 'S',
	pitcherHandedness: 'L' | 'R'
): boolean {
	// Switch hitters never have disadvantage
	if (batterHandedness === 'S') return false;

	// Same-handed is disadvantage (L vs L, R vs R)
	return batterHandedness === pitcherHandedness;
}

/**
 * Get the batter's rates that match the pitcher's handedness
 * Handles switch hitters optimally
 */
export function getPlatoonRates(
	batter: BatterStats,
	pitcher: PitcherStats
): EventRates {
	const pitcherHandedness = pitcher.handedness;
	const batterHandedness = batter.handedness;

	// Switch hitters: use favorable split
	if (batterHandedness === 'S') {
		return pitcherHandedness === 'L' ? batter.rates.vsRight : batter.rates.vsLeft;
	}

	// Normal batters: use matching split
	return pitcherHandedness === 'L' ? batter.rates.vsLeft : batter.rates.vsRight;
}
