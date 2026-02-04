// pitcher-classifier.test.ts
import { describe, it, expect } from 'vitest';
import { classifyPitchers } from './pitcher-classifier.js';
import type { ExtendedPitcherStats } from '../types.js';
import type { LeaguePitchingNorms } from './types.js';

describe('classifyPitchers', () => {
	const norms2020: LeaguePitchingNorms = {
		avgERA: 4.00,
		avgWHIP: 1.30,
		avgSavesPerTeam: 20,
		avgCGRate: 0.05,
		year: 2020
	};

	it('classifies modern era pitchers with closer', () => {
		const pitchers: ExtendedPitcherStats[] = [
			// Ace starter
			{ id: 'starter1', name: 'Ace', handedness: 'R', throws: 'R', teamId: 'team1', games: 32, gamesStarted: 32, completeGames: 1, saves: 0, inningsPitched: 200, whip: 1.00, era: 2.80, avgBfpAsStarter: 27, avgBfpAsReliever: null, rates: { vsLeft: { single: 0.18, double: 0.05, triple: 0.01, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.25, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRight: { single: 0.18, double: 0.05, triple: 0.01, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.25, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } },
			// #2 starter
			{ id: 'starter2', name: '#2', handedness: 'L', throws: 'L', teamId: 'team1', games: 30, gamesStarted: 28, completeGames: 0, saves: 0, inningsPitched: 160, whip: 1.20, era: 3.50, avgBfpAsStarter: 25, avgBfpAsReliever: null, rates: { vsLeft: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.2, flyOut: 0.15, lineOut: 0.05, popOut: 0.05, sacrificeFly: 0.01, sacrificeBunt: 0.01, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRight: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.2, flyOut: 0.15, lineOut: 0.05, popOut: 0.05, sacrificeFly: 0.01, sacrificeBunt: 0.01, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } },
			// Closer
			{ id: 'closer', name: 'Closer', handedness: 'R', throws: 'R', teamId: 'team1', games: 60, gamesStarted: 0, completeGames: 0, saves: 35, inningsPitched: 60, whip: 0.95, era: 2.00, avgBfpAsStarter: null, avgBfpAsReliever: 4, rates: { vsLeft: { single: 0.15, double: 0.04, triple: 0, homeRun: 0.02, walk: 0.06, hitByPitch: 0.01, strikeout: 0.3, groundOut: 0.18, flyOut: 0.12, lineOut: 0.02, popOut: 0, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRight: { single: 0.15, double: 0.04, triple: 0, homeRun: 0.02, walk: 0.06, hitByPitch: 0.01, strikeout: 0.3, groundOut: 0.18, flyOut: 0.12, lineOut: 0.02, popOut: 0, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } },
			// Setup man
			{ id: 'setup', name: 'Setup', handedness: 'R', throws: 'R', teamId: 'team1', games: 50, gamesStarted: 2, completeGames: 0, saves: 5, inningsPitched: 70, whip: 1.10, era: 2.80, avgBfpAsStarter: null, avgBfpAsReliever: 4.5, rates: { vsLeft: { single: 0.18, double: 0.04, triple: 0.01, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.25, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRight: { single: 0.18, double: 0.04, triple: 0.01, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.25, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } },
			// Long reliever
			{ id: 'long', name: 'Long', handedness: 'L', throws: 'L', teamId: 'team1', games: 40, gamesStarted: 5, completeGames: 0, saves: 1, inningsPitched: 85, whip: 1.25, era: 3.80, avgBfpAsStarter: null, avgBfpAsReliever: 5.5, rates: { vsLeft: { single: 0.22, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.18, groundOut: 0.2, flyOut: 0.14, lineOut: 0.05, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRight: { single: 0.22, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.18, groundOut: 0.2, flyOut: 0.14, lineOut: 0.05, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } }
		];

		const result = classifyPitchers(pitchers, norms2020);

		expect(result.starter.pitcherId).toBe('starter1'); // Best starter
		expect(result.closer?.pitcherId).toBe('closer');
		expect(result.setup?.length).toBeGreaterThan(0);
		expect(result.setup?.[0]?.pitcherId).toBe('setup');
		expect(result.longRelief?.length).toBeGreaterThan(0);
		expect(result.longRelief?.[0]?.pitcherId).toBe('long');
	});

	it('handles historical era with no closers (1970s)', () => {
		const norms1976: LeaguePitchingNorms = {
			avgERA: 3.50,
			avgWHIP: 1.20,
			avgSavesPerTeam: 8, // Low saves era
			avgCGRate: 0.20, // High CG era
			year: 1976
		};

		const pitchers: ExtendedPitcherStats[] = [
			{ id: 'starter1', name: 'Ace', handedness: 'R', throws: 'R', teamId: 'team1', games: 40, gamesStarted: 38, completeGames: 15, saves: 2, inningsPitched: 280, whip: 1.05, era: 2.90, avgBfpAsStarter: 30, avgBfpAsReliever: null, rates: { vsLeft: { single: 0.18, double: 0.05, triple: 0.01, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.22, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0.01, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRight: { single: 0.18, double: 0.05, triple: 0.01, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.22, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0.01, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } },
			{ id: 'reliever1', name: 'Reliever', handedness: 'R', throws: 'R', teamId: 'team1', games: 50, gamesStarted: 3, completeGames: 0, saves: 6, inningsPitched: 90, whip: 1.15, era: 3.20, avgBfpAsStarter: null, avgBfpAsReliever: 4, rates: { vsLeft: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRight: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } }
		];

		const result = classifyPitchers(pitchers, norms1976);

		expect(result.starter.pitcherId).toBe('starter1');
		expect(result.closer).toBeUndefined(); // No dedicated closer in 1976
	});
});
