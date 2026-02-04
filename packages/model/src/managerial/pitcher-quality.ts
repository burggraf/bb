// pitcher-quality.ts
import type { ExtendedPitcherStats } from '../types.js';
import type { LeaguePitchingNorms, PitcherQuality } from './types.js';

// ============================================================================
// CONSTANTS - Pitcher Quality Calculation
// ============================================================================

// Complete game rate threshold for "workhorse" designation
// 15% CG rate indicates a durable starter who consistently goes deep into games
const WORKHORSE_CG_THRESHOLD = 0.15;

// Standard season length for normalizing workload metrics
// Allows fair comparison across seasons of different lengths (e.g., 2020)
const SEASON_GAMES = 162;

// Multiplier for complete game bonus in quality calculation
// CGs are highly valuable, so they count double toward quality score
const CG_MULTIPLIER = 2;

// Normalization divisor for saves rate
// 30 saves is a benchmark closer season (not elite, but solid)
const SAVES_NORMALIZATION = 30;

// Bonus for pitchers with short outings (< 2 IP per game)
// Indicates a closer/high-leverage role where shorter appearances are expected
const CLOSER_SHORT_OUTING_BONUS = 0.2;

// Bonus for pitchers who never start games
// Pure relievers get a small boost for specializing in relief
const PURE_RELIEVER_BONUS = 0.1;

// Weight distribution for starter quality calculation
// Starters are evaluated heavily on ERA/WHIP but workload matters too
const STARTER_WEIGHTS = {
	workload: 0.3,  // Games started rate (durability)
	era: 0.35,      // ERA ratio (prevention)
	whip: 0.25      // WHIP ratio (control)
} as const;

// Weight distribution for reliever quality calculation
// Relievers are valued more for saves and ERA/WHIP than pure volume
const RELIEVER_WEIGHTS = {
	saves: 0.4,     // Saves rate (closer role)
	era: 0.3,       // ERA ratio (prevention)
	whip: 0.2       // WHIP ratio (control)
} as const;

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Calculate era-normalized quality score for a pitcher
 *
 * Quality scores are normalized so 1.0 = league average
 * Scores > 1.0 = above average, < 1.0 = below average
 */
export function calculatePitcherQuality(
	pitcher: ExtendedPitcherStats,
	norms: LeaguePitchingNorms,
	role: 'starter' | 'reliever'
): PitcherQuality {
	const inningsPerGame = pitcher.games > 0 ? pitcher.inningsPitched / pitcher.games : 0;
	const cgRate = pitcher.gamesStarted > 0 ? pitcher.completeGames / pitcher.gamesStarted : 0;
	const isWorkhorse = cgRate >= WORKHORSE_CG_THRESHOLD;

	let qualityScore: number;

	if (role === 'starter') {
		// Starter quality: mix of workload and rate stats
		const gamesStartedRate = pitcher.gamesStarted / SEASON_GAMES;
		const eraRatio = norms.avgERA / pitcher.era; // Lower ERA = higher score
		const whipRatio = norms.avgWHIP / pitcher.whip; // Lower WHIP = higher score
		const cgBonus = cgRate * CG_MULTIPLIER;

		qualityScore =
			(gamesStartedRate * STARTER_WEIGHTS.workload) +
			(eraRatio * STARTER_WEIGHTS.era) +
			(whipRatio * STARTER_WEIGHTS.whip) +
			cgBonus;
	} else {
		// Reliever quality: saves, low ERA/WHIP, short outings
		const savesRate = pitcher.saves / SAVES_NORMALIZATION;
		const eraRatio = norms.avgERA / pitcher.era;
		const whipRatio = norms.avgWHIP / pitcher.whip;
		const shortOutingBonus = inningsPerGame < 2 ? CLOSER_SHORT_OUTING_BONUS : 0;
		const lowStartBonus = pitcher.gamesStarted === 0 ? PURE_RELIEVER_BONUS : 0;

		qualityScore =
			(savesRate * RELIEVER_WEIGHTS.saves) +
			(eraRatio * RELIEVER_WEIGHTS.era) +
			(whipRatio * RELIEVER_WEIGHTS.whip) +
			shortOutingBonus +
			lowStartBonus;
	}

	return {
		id: pitcher.id,
		qualityScore,
		isWorkhorse,
		inningsPerGame,
		role
	};
}
