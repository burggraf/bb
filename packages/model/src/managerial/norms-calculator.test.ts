// norms-calculator.test.ts
import { describe, it, expect } from 'vitest';
import { calculateLeagueNorms } from './norms-calculator.js';
import type { ExtendedPitcherStats } from '../types.js';

describe('calculateLeagueNorms', () => {
	it('calculates league averages from pitcher stats', () => {
		const pitchers: ExtendedPitcherStats[] = [
			{
				id: 'p1', name: 'Pitcher 1', handedness: 'R', throws: 'R', teamId: 'team1',
				games: 30, gamesStarted: 30, completeGames: 5, saves: 0,
				inningsPitched: 200, whip: 1.200, era: 3.50,
				avgBfpAsStarter: 29, avgBfpAsReliever: null,
				rates: { vsLeft: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.2, flyOut: 0.15, lineOut: 0.05, popOut: 0.05, sacrificeFly: 0.01, sacrificeBunt: 0.01, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRight: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.2, flyOut: 0.15, lineOut: 0.05, popOut: 0.05, sacrificeFly: 0.01, sacrificeBunt: 0.01, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } }
			},
			{
				id: 'p2', name: 'Pitcher 2', handedness: 'L', throws: 'L', teamId: 'team1',
				games: 60, gamesStarted: 0, completeGames: 0, saves: 20,
				inningsPitched: 80, whip: 1.000, era: 2.00,
				avgBfpAsStarter: null, avgBfpAsReliever: 4,
				rates: { vsLeft: { single: 0.15, double: 0.04, triple: 0.01, homeRun: 0.02, walk: 0.06, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.2, flyOut: 0.15, lineOut: 0.05, popOut: 0.05, sacrificeFly: 0.01, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRight: { single: 0.15, double: 0.04, triple: 0.01, homeRun: 0.02, walk: 0.06, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.2, flyOut: 0.15, lineOut: 0.05, popOut: 0.05, sacrificeFly: 0.01, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } }
			}
		];

		const norms = calculateLeagueNorms(pitchers, 1976, 2);

		expect(norms.avgERA).toBeCloseTo(3.0714, 4); // Weighted: (3.5*200 + 2.0*80)/280 = 860/280
		expect(norms.avgWHIP).toBeCloseTo(1.142857, 4); // Weighted: (1.2*200 + 1.0*80)/280 = 320/280
		expect(norms.avgSavesPerTeam).toBeCloseTo(10); // 20 saves / 2 teams
		expect(norms.avgCGRate).toBeCloseTo(0.167); // 5/30 for p1
		expect(norms.year).toBe(1976);
	});

	it('handles empty pitcher list gracefully', () => {
		const norms = calculateLeagueNorms([], 2020, 1);
		expect(norms.avgERA).toBe(4.00); // Default fallback
		expect(norms.avgWHIP).toBe(1.35); // Default fallback
	});
});
