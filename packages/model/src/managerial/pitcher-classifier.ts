// pitcher-classifier.ts
import type { ExtendedPitcherStats } from '../types.js';
import type { EnhancedBullpenState, LeaguePitchingNorms, PitcherRole, PitcherQuality } from './types.js';
import { calculatePitcherQuality } from './pitcher-quality.js';

// Role classification thresholds
const STARTER_START_RATE_THRESHOLD = 0.5;   // 50%+ starts = starter
const RELIEVER_START_RATE_THRESHOLD = 0.2;  // 20%- starts = swingman, decide by total starts
const SWINGMAN_START_THRESHOLD = 15;        // Swingman with 15+ starts treated as starter
const CLOSER_SAVE_THRESHOLD = 5;            // Min saves to qualify as closer
const LONG_RELIEVER_IP_THRESHOLD = 1.3;     // IP/G threshold for long relief classification
const CLOSER_QUALITY_THRESHOLD = 1.2;       // Quality score threshold for closer consideration

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
	if (startRate >= STARTER_START_RATE_THRESHOLD) return 'starter';
	if (startRate <= RELIEVER_START_RATE_THRESHOLD) return 'reliever';
	// Swingman: decide by total starts
	return pitcher.gamesStarted >= SWINGMAN_START_THRESHOLD ? 'starter' : 'reliever';
}

/**
 * Create PitcherRole from ExtendedPitcherStats
 */
function createPitcherRole(pitcher: ExtendedPitcherStats, quality: PitcherQuality): PitcherRole {
	return {
		pitcherId: pitcher.id,
		role: quality.role === 'starter' ? 'starter' : 'reliever',
		stamina: 100,
		pitchesThrown: 0,
		battersFace: 0,
		avgBfpAsStarter: pitcher.avgBfpAsStarter,
		avgBfpAsReliever: pitcher.avgBfpAsReliever,
		hitsAllowed: 0,
		walksAllowed: 0,
		runsAllowed: 0,
		isWorkhorse: quality.isWorkhorse
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
	const starter = createPitcherRole(starters[0]!.pitcher, starters[0]!.quality);

	// Determine if this era uses closers
	const eraHasClosers = hasClosers(norms);

	// Build bullpen
	let closer: PitcherRole | undefined;
	let setup: PitcherRole[] = [];
	let longRelief: PitcherRole[] = [];
	const remaining: PitcherRole[] = [];

	if (eraHasClosers && relievers.length > 0) {
		// Best reliever is closer (highest saves or quality)
		const closerIdx = relievers.findIndex(r => r.pitcher.saves > 0);
		const effectiveCloserIdx = closerIdx >= 0 ? closerIdx : 0;
		if (relievers[effectiveCloserIdx]!.pitcher.saves >= CLOSER_SAVE_THRESHOLD || relievers[0]!.quality.qualityScore > CLOSER_QUALITY_THRESHOLD) {
			closer = createPitcherRole(relievers[effectiveCloserIdx]!.pitcher, relievers[effectiveCloserIdx]!.quality);
			relievers.splice(effectiveCloserIdx, 1);
		}

		// Next 1-2 are setup men (by quality score, after closer removed)
		const setupCount = Math.min(2, relievers.length);
		for (let i = 0; i < setupCount; i++) {
			setup.push(createPitcherRole(relievers[i]!.pitcher, relievers[i]!.quality));
		}
		relievers.splice(0, setupCount);

		// Long relievers have higher innings per game (remaining after setup removed)
		for (const r of relievers) {
			if (r.quality.inningsPerGame > LONG_RELIEVER_IP_THRESHOLD) {
				longRelief.push(createPitcherRole(r.pitcher, r.quality));
			} else {
				remaining.push(createPitcherRole(r.pitcher, r.quality));
			}
		}
	} else {
		// No closers - all relievers go to longRelief or remaining
		for (const r of relievers) {
			if (r.quality.inningsPerGame > LONG_RELIEVER_IP_THRESHOLD) {
				longRelief.push(createPitcherRole(r.pitcher, r.quality));
			} else {
				remaining.push(createPitcherRole(r.pitcher, r.quality));
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
