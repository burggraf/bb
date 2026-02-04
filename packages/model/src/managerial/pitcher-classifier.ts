// pitcher-classifier.ts
import type { ExtendedPitcherStats } from '../types.js';
import type { EnhancedBullpenState, LeaguePitchingNorms, PitcherRole } from './types.js';
import { calculatePitcherQuality } from './pitcher-quality.js';

/**
 * Determine if era uses closers based on league save totals
 */
function hasClosers(norms: LeaguePitchingNorms): boolean {
	if (norms.year < 1950) return false; // No saves recorded
	if (norms.year < 1970) return norms.avgSavesPerTeam > 5; // Emerging
	if (norms.year < 1990) return norms.avgSavesPerTeam > 12; // Established
	return true; // Modern era
}

/**
 * Determine pitcher's primary role from stats
 */
function getPitcherRole(pitcher: ExtendedPitcherStats): 'starter' | 'reliever' {
	const startRate = pitcher.gamesStarted / pitcher.games;
	if (startRate >= 0.5) return 'starter';
	if (startRate <= 0.2) return 'reliever';
	// Swingman: decide by total starts
	return pitcher.gamesStarted >= 15 ? 'starter' : 'reliever';
}

/**
 * Create PitcherRole from ExtendedPitcherStats
 */
function createPitcherRole(pitcher: ExtendedPitcherStats, role: 'starter' | 'reliever'): PitcherRole {
	return {
		pitcherId: pitcher.id,
		role: role === 'starter' ? 'starter' : 'reliever',
		stamina: 100,
		pitchesThrown: 0,
		battersFace: 0,
		avgBfpAsStarter: pitcher.avgBfpAsStarter,
		avgBfpAsReliever: pitcher.avgBfpAsReliever,
		hitsAllowed: 0,
		walksAllowed: 0,
		runsAllowed: 0
	};
}

/**
 * Classify all pitchers for a team into roles
 *
 * Returns EnhancedBullpenState with:
 * - starter: Best quality starting pitcher
 * - closer: Best reliever (if era uses closers)
 * - setup: Next-best relievers (1-2)
 * - longRelief: Long-relief capable pitchers
 * - relievers: All remaining pitchers
 */
export function classifyPitchers(
	pitchers: ExtendedPitcherStats[],
	norms: LeaguePitchingNorms
): EnhancedBullpenState {
	// Calculate quality for all pitchers
	const qualities = pitchers.map(p => ({
		pitcher: p,
		quality: calculatePitcherQuality(p, norms, getPitcherRole(p))
	}));

	// Separate starters and relievers
	const starters = qualities.filter(q => q.quality.role === 'starter').sort((a, b) => b.quality.qualityScore - a.quality.qualityScore);
	const relievers = qualities.filter(q => q.quality.role === 'reliever').sort((a, b) => b.quality.qualityScore - a.quality.qualityScore);

	if (starters.length === 0) {
		throw new Error('No starting pitchers available');
	}

	// Best starter is the ace
	const starter = createPitcherRole(starters[0]!.pitcher, 'starter');

	// Determine if this era uses closers
	const eraHasClosers = hasClosers(norms);

	// Build bullpen
	let closer: PitcherRole | undefined;
	let setup: PitcherRole[] = [];
	let longRelief: PitcherRole[] = [];
	const remaining: PitcherRole[] = [];

	if (eraHasClosers && relievers.length > 0) {
		// Best reliever is closer (highest saves or quality)
		const closerIdx = relievers.findIndex(r => r.pitcher.saves > 0) ?? 0;
		if (relievers[closerIdx]!.pitcher.saves >= 5 || relievers[0]!.quality.qualityScore > 1.2) {
			closer = createPitcherRole(relievers[closerIdx]!.pitcher, 'reliever');
			relievers.splice(closerIdx, 1);
		}

		// Classify remaining relievers: setup men (shorter outings) vs long relief (longer outings)
		// Modern era: < 1.5 IP/G = setup, >= 1.5 IP/G = long relief
		for (const r of relievers) {
			if (r.quality.inningsPerGame > 1.5) {
				longRelief.push(createPitcherRole(r.pitcher, 'reliever'));
			} else {
				// Shorter outings = setup man
				setup.push(createPitcherRole(r.pitcher, 'reliever'));
			}
		}

		// Keep only top 2 setup men
		if (setup.length > 2) {
			remaining.push(...setup.splice(2));
		}
	} else {
		// No closers - all relievers go to longRelief or remaining
		for (const r of relievers) {
			if (r.quality.inningsPerGame > 1.5) {
				longRelief.push(createPitcherRole(r.pitcher, 'reliever'));
			} else {
				remaining.push(createPitcherRole(r.pitcher, 'reliever'));
			}
		}
	}

	return {
		starter,
		relievers: remaining,
		closer,
		setup: setup.length > 0 ? setup : undefined,
		longRelief: longRelief.length > 0 ? longRelief : undefined
	};
}
