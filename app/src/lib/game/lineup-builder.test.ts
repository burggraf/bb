import { describe, it, expect } from 'vitest';
import { selectStartingPitcher } from './lineup-builder.js';
import type { PitcherStats } from './types.js';

describe('selectStartingPitcher', () => {
	it('selects best quality starter (gamesStarted + quality stats)', () => {
		const pitchers: PitcherStats[] = [
			// High starts, mediocre stats
			{ id: 'innings-eater', name: 'Innings Eater', throws: 'R', teamId: 'team1', games: 35, gamesStarted: 35, completeGames: 2, saves: 0, inningsPitched: 210, whip: 1.35, era: 4.20, avgBfpAsStarter: null, avgBfpAsReliever: null, rates: { vsLHB: { single: 0.22, double: 0.06, triple: 0.01, homeRun: 0.04, walk: 0.09, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHB: { single: 0.22, double: 0.06, triple: 0.01, homeRun: 0.04, walk: 0.09, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } },
			// Ace: high starts, great stats
			{ id: 'ace', name: 'Ace', throws: 'R', teamId: 'team1', games: 32, gamesStarted: 32, completeGames: 3, saves: 0, inningsPitched: 220, whip: 0.95, era: 2.50, avgBfpAsStarter: null, avgBfpAsReliever: null, rates: { vsLHB: { single: 0.18, double: 0.05, triple: 0.01, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.25, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHB: { single: 0.18, double: 0.05, triple: 0.01, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.25, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } },
			// Reliever (should not be selected)
			{ id: 'reliever', name: 'Reliever', throws: 'L', teamId: 'team1', games: 60, gamesStarted: 0, completeGames: 0, saves: 10, inningsPitched: 70, whip: 1.10, era: 3.00, avgBfpAsStarter: null, avgBfpAsReliever: null, rates: { vsLHB: { single: 0.2, double: 0.04, triple: 0, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.25, groundOut: 0.18, flyOut: 0.13, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHB: { single: 0.2, double: 0.04, triple: 0, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.25, groundOut: 0.18, flyOut: 0.13, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } }
		];

		const selected = selectStartingPitcher(pitchers);

		expect(selected.id).toBe('ace'); // Best quality, not just most starts
	});

	it('prioritizes gamesStarted when quality is similar', () => {
		const pitchers: PitcherStats[] = [
			{ id: 'starter2', name: '#2 Starter', throws: 'R', teamId: 'team1', games: 30, gamesStarted: 28, completeGames: 1, saves: 0, inningsPitched: 170, whip: 1.21, era: 3.51, avgBfpAsStarter: null, avgBfpAsReliever: null, rates: { vsLHB: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHB: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } },
			{ id: 'starter1', name: '#1 Starter', throws: 'R', teamId: 'team1', games: 33, gamesStarted: 33, completeGames: 2, saves: 0, inningsPitched: 200, whip: 1.20, era: 3.50, avgBfpAsStarter: null, avgBfpAsReliever: null, rates: { vsLHB: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHB: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } }
		];

		const selected = selectStartingPitcher(pitchers);

		expect(selected.id).toBe('starter1'); // More gamesStarted
	});
});
