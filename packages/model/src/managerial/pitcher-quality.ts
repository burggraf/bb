// pitcher-quality.ts
import type { ExtendedPitcherStats } from '../types.js';
import type { LeaguePitchingNorms, PitcherQuality } from './types.js';

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
	const isWorkhorse = cgRate >= 0.15; // 15%+ CG rate = workhorse

	let qualityScore: number;

	if (role === 'starter') {
		// Starter quality: mix of workload and rate stats
		const gamesStartedRate = pitcher.gamesStarted / 162; // Normalized to season
		const eraRatio = norms.avgERA / pitcher.era; // Lower ERA = higher score
		const whipRatio = norms.avgWHIP / pitcher.whip; // Lower WHIP = higher score
		const cgBonus = cgRate * 2; // Complete games add value

		qualityScore = (gamesStartedRate * 0.3) + (eraRatio * 0.35) + (whipRatio * 0.25) + cgBonus;
	} else {
		// Reliever quality: saves, low ERA/WHIP, short outings
		const savesRate = pitcher.saves / 30; // Normalized
		const eraRatio = norms.avgERA / pitcher.era;
		const whipRatio = norms.avgWHIP / pitcher.whip;
		const shortOutingBonus = inningsPerGame < 2 ? 0.2 : 0; // Closers pitch fewer innings
		const lowStartBonus = pitcher.gamesStarted === 0 ? 0.1 : 0;

		qualityScore = (savesRate * 0.4) + (eraRatio * 0.3) + (whipRatio * 0.2) + shortOutingBonus + lowStartBonus;
	}

	return {
		id: pitcher.id,
		qualityScore,
		isWorkhorse,
		inningsPerGame,
		role
	};
}
