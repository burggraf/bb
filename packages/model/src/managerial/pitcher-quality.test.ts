// pitcher-quality.test.ts
import { describe, it, expect } from 'vitest';
import { calculatePitcherQuality } from './pitcher-quality.js';
import type { ExtendedPitcherStats } from '../types.js';
import type { LeaguePitchingNorms } from './types.js';

describe('calculatePitcherQuality', () => {
	const norms: LeaguePitchingNorms = {
		avgERA: 3.50,
		avgWHIP: 1.20,
		avgSavesPerTeam: 15,
		avgCGRate: 0.10,
		year: 2020
	};

	it('calculates quality score for a quality starter', () => {
		const starter: ExtendedPitcherStats = {
			id: 'ace', name: 'Ace', handedness: 'R', throws: 'R', teamId: 'team1',
			games: 33, gamesStarted: 33, completeGames: 3, saves: 0,
			inningsPitched: 220, whip: 0.95, era: 2.50,
			avgBfpAsStarter: 28, avgBfpAsReliever: null,
			rates: { vsLeft: { single: 0.18, double: 0.05, triple: 0.01, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.25, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRight: { single: 0.18, double: 0.05, triple: 0.01, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.25, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } }
		};

		const quality = calculatePitcherQuality(starter, norms, 'starter');

		expect(quality.id).toBe('ace');
		expect(quality.role).toBe('starter');
		expect(quality.qualityScore).toBeGreaterThan(1.0); // Above average
		expect(quality.inningsPerGame).toBeCloseTo(220 / 33, 1);
	});

	it('identifies workhorse starters (high CG rate)', () => {
		const workhorse: ExtendedPitcherStats = {
			id: 'workhorse', name: 'Workhorse', handedness: 'R', throws: 'R', teamId: 'team1',
			games: 35, gamesStarted: 35, completeGames: 10, saves: 0,
			inningsPitched: 280, whip: 1.10, era: 3.00,
			avgBfpAsStarter: 30, avgBfpAsReliever: null,
			rates: { vsLeft: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.2, flyOut: 0.15, lineOut: 0.05, popOut: 0.05, sacrificeFly: 0.01, sacrificeBunt: 0.01, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRight: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.2, flyOut: 0.15, lineOut: 0.05, popOut: 0.05, sacrificeFly: 0.01, sacrificeBunt: 0.01, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } }
		};

		const quality = calculatePitcherQuality(workhorse, norms, 'starter');

		expect(quality.isWorkhorse).toBe(true); // 10/35 > 15%
	});

	it('calculates quality for a closer', () => {
		const closer: ExtendedPitcherStats = {
			id: 'closer', name: 'Closer', handedness: 'R', throws: 'R', teamId: 'team1',
			games: 60, gamesStarted: 0, completeGames: 0, saves: 35,
			inningsPitched: 65, whip: 0.90, era: 1.80,
			avgBfpAsStarter: null, avgBfpAsReliever: 4,
			rates: { vsLeft: { single: 0.15, double: 0.04, triple: 0, homeRun: 0.02, walk: 0.06, hitByPitch: 0.01, strikeout: 0.3, groundOut: 0.18, flyOut: 0.12, lineOut: 0.02, popOut: 0, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRight: { single: 0.15, double: 0.04, triple: 0, homeRun: 0.02, walk: 0.06, hitByPitch: 0.01, strikeout: 0.3, groundOut: 0.18, flyOut: 0.12, lineOut: 0.02, popOut: 0, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } }
		};

		const quality = calculatePitcherQuality(closer, norms, 'reliever');

		expect(quality.qualityScore).toBeGreaterThan(1.0); // Elite closer
		expect(quality.inningsPerGame).toBeCloseTo(65 / 60, 1); // Low IP/G
	});
});
