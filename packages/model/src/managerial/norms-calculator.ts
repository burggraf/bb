// norms-calculator.ts
import type { ExtendedPitcherStats } from '../types.js';
import type { LeaguePitchingNorms } from './types.js';

/**
 * Calculate league-average pitching norms from all pitchers in a season
 */
export function calculateLeagueNorms(
	pitchers: ExtendedPitcherStats[],
	year: number,
	numTeams: number
): LeaguePitchingNorms {
	if (pitchers.length === 0) {
		return {
			avgERA: 4.00,
			avgWHIP: 1.35,
			avgSavesPerTeam: 0,
			avgCGRate: 0,
			year
		};
	}

	const totalIP = pitchers.reduce((sum, p) => sum + p.inningsPitched, 0);
	const totalER = pitchers.reduce((sum, p) => sum + (p.era * p.inningsPitched) / 9, 0);
	const totalWH = pitchers.reduce((sum, p) => sum + (p.whip * p.inningsPitched), 0);
	const totalSaves = pitchers.reduce((sum, p) => sum + p.saves, 0);

	// Calculate weighted average ERA and WHIP
	const avgERA = totalIP > 0 ? totalER * 9 / totalIP : 4.00;
	const avgWHIP = totalIP > 0 ? totalWH / totalIP : 1.35;

	// Calculate CG rate only for pitchers with starts
	const starters = pitchers.filter(p => p.gamesStarted > 0);
	const totalCGRate = starters.length > 0
		? starters.reduce((sum, p) => sum + (p.completeGames / p.gamesStarted), 0) / starters.length
		: 0;

	return {
		avgERA,
		avgWHIP,
		avgSavesPerTeam: totalSaves / numTeams,
		avgCGRate: totalCGRate,
		year
	};
}
