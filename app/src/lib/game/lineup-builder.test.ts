import { describe, it, expect } from 'vitest';
import { selectStartingPitcher, buildLineup, usesDH, getEraStrategy } from './lineup-builder.js';
import type { PitcherStats, BatterStats } from './types.js';

// Helper to create a minimal roster
function createMinimalRoster(teamId: string = 'TEST'): Record<string, BatterStats> {
	return {
		// C
		'c1': { id: 'c1', name: 'Catcher', bats: 'R', teamId, primaryPosition: 2, positionEligibility: { 2: 5000 }, pa: 400, avg: 0.250, obp: 0.320, slg: 0.380, ops: 0.700, rates: { vsLHP: { single: 0.15, double: 0.04, triple: 0.01, homeRun: 0.02, walk: 0.08, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHP: { single: 0.15, double: 0.04, triple: 0.01, homeRun: 0.02, walk: 0.08, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } },
		// SS
		'ss1': { id: 'ss1', name: 'Shortstop', bats: 'R', teamId, primaryPosition: 6, positionEligibility: { 6: 5000 }, pa: 450, avg: 0.260, obp: 0.330, slg: 0.370, ops: 0.700, rates: { vsLHP: { single: 0.15, double: 0.04, triple: 0.01, homeRun: 0.02, walk: 0.08, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHP: { single: 0.15, double: 0.04, triple: 0.01, homeRun: 0.02, walk: 0.08, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } },
		// 2B
		'2b1': { id: '2b1', name: 'SecondBase', bats: 'R', teamId, primaryPosition: 4, positionEligibility: { 4: 5000 }, pa: 420, avg: 0.255, obp: 0.325, slg: 0.375, ops: 0.700, rates: { vsLHP: { single: 0.15, double: 0.04, triple: 0.01, homeRun: 0.02, walk: 0.08, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHP: { single: 0.15, double: 0.04, triple: 0.01, homeRun: 0.02, walk: 0.08, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } },
		// CF
		'cf1': { id: 'cf1', name: 'CenterField', bats: 'R', teamId, primaryPosition: 8, positionEligibility: { 8: 5000 }, pa: 480, avg: 0.270, obp: 0.340, slg: 0.400, ops: 0.740, rates: { vsLHP: { single: 0.15, double: 0.04, triple: 0.01, homeRun: 0.02, walk: 0.08, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHP: { single: 0.15, double: 0.04, triple: 0.01, homeRun: 0.02, walk: 0.08, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } },
		// 3B
		'3b1': { id: '3b1', name: 'ThirdBase', bats: 'R', teamId, primaryPosition: 5, positionEligibility: { 5: 5000 }, pa: 410, avg: 0.265, obp: 0.335, slg: 0.420, ops: 0.755, rates: { vsLHP: { single: 0.15, double: 0.04, triple: 0.01, homeRun: 0.02, walk: 0.08, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHP: { single: 0.15, double: 0.04, triple: 0.01, homeRun: 0.02, walk: 0.08, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } },
		// 1B
		'1b1': { id: '1b1', name: 'FirstBase', bats: 'R', teamId, primaryPosition: 3, positionEligibility: { 3: 5000 }, pa: 460, avg: 0.275, obp: 0.350, slg: 0.450, ops: 0.800, rates: { vsLHP: { single: 0.15, double: 0.04, triple: 0.01, homeRun: 0.02, walk: 0.08, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHP: { single: 0.15, double: 0.04, triple: 0.01, homeRun: 0.02, walk: 0.08, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } },
		// LF
		'lf1': { id: 'lf1', name: 'LeftField', bats: 'R', teamId, primaryPosition: 7, positionEligibility: { 7: 5000 }, pa: 440, avg: 0.268, obp: 0.338, slg: 0.410, ops: 0.748, rates: { vsLHP: { single: 0.15, double: 0.04, triple: 0.01, homeRun: 0.02, walk: 0.08, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHP: { single: 0.15, double: 0.04, triple: 0.01, homeRun: 0.02, walk: 0.08, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } },
		// RF
		'rf1': { id: 'rf1', name: 'RightField', bats: 'R', teamId, primaryPosition: 9, positionEligibility: { 9: 5000 }, pa: 445, avg: 0.272, obp: 0.342, slg: 0.420, ops: 0.762, rates: { vsLHP: { single: 0.15, double: 0.04, triple: 0.01, homeRun: 0.02, walk: 0.08, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHP: { single: 0.15, double: 0.04, triple: 0.01, homeRun: 0.02, walk: 0.08, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } },
		// Extra DH/backup
		'dh1': { id: 'dh1', name: 'DH', bats: 'R', teamId, primaryPosition: 10, positionEligibility: { 10: 3000, 7: 1000 }, pa: 300, avg: 0.280, obp: 0.360, slg: 0.480, ops: 0.840, rates: { vsLHP: { single: 0.15, double: 0.04, triple: 0.01, homeRun: 0.02, walk: 0.08, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHP: { single: 0.15, double: 0.04, triple: 0.01, homeRun: 0.02, walk: 0.08, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } }
	};
}

// Helper to create a minimal pitching staff
function createMinimalPitchers(teamId: string = 'TEST'): Record<string, PitcherStats> {
	return {
		'sp1': { id: 'sp1', name: 'Starter1', throws: 'R', teamId, games: 30, gamesStarted: 30, completeGames: 5, saves: 0, inningsPitched: 200, whip: 1.2, era: 3.5, avgBfpAsStarter: null, avgBfpAsReliever: null, rates: { vsLHB: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHB: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } },
		'sp2': { id: 'sp2', name: 'Starter2', throws: 'R', teamId, games: 25, gamesStarted: 25, completeGames: 2, saves: 0, inningsPitched: 150, whip: 1.3, era: 4.0, avgBfpAsStarter: null, avgBfpAsReliever: null, rates: { vsLHB: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHB: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } }
	};
}

describe('selectStartingPitcher', () => {
	it('selects best quality starter (gamesStarted + quality stats)', () => {
		const pitchers: PitcherStats[] = [
			// High starts, mediocre stats
			{ id: 'innings-eater', name: 'Innings Eater', throws: 'R', teamId: 'team1', games: 35, gamesStarted: 35, completeGames: 2, saves: 0, inningsPitched: 210, whip: 1.35, era: 4.20, avgBfpAsStarter: null, avgBfpAsReliever: null, rates: { vsLHB: { single: 0.22, double: 0.06, triple: 0.01, homeRun: 0.04, walk: 0.09, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHB: { single: 0.22, double: 0.06, triple: 0.01, homeRun: 0.04, walk: 0.09, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } },
			// Ace: slightly fewer starts but much better stats - wins due to quality
			{ id: 'ace', name: 'Ace', throws: 'R', teamId: 'team1', games: 34, gamesStarted: 34, completeGames: 5, saves: 0, inningsPitched: 240, whip: 0.95, era: 2.50, avgBfpAsStarter: null, avgBfpAsReliever: null, rates: { vsLHB: { single: 0.18, double: 0.05, triple: 0.01, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.25, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHB: { single: 0.18, double: 0.05, triple: 0.01, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.25, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } },
			// Reliever (should not be selected)
			{ id: 'reliever', name: 'Reliever', throws: 'L', teamId: 'team1', games: 60, gamesStarted: 0, completeGames: 0, saves: 10, inningsPitched: 70, whip: 1.10, era: 3.00, avgBfpAsStarter: null, avgBfpAsReliever: null, rates: { vsLHB: { single: 0.2, double: 0.04, triple: 0, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.25, groundOut: 0.18, flyOut: 0.13, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHB: { single: 0.2, double: 0.04, triple: 0, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.25, groundOut: 0.18, flyOut: 0.13, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } }
		];

		const selected = selectStartingPitcher(pitchers);

		// Ace wins with same starts but better quality (ERA, WHIP, CG)
		expect(selected.id).toBe('ace');
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

describe('buildLineup - with usage context', () => {
	it('rests overused batters when usage context is provided', async () => {
		const batters: Record<string, BatterStats> = {
			// Overused starter - should be rested
			'overused101': {
				id: 'overused101',
				name: 'Overused Starter',
				bats: 'L',
				teamId: 'NYA',
				primaryPosition: 9, // RF
				positionEligibility: { 9: 20000 },
				pa: 500,
				avg: 0.300,
				obp: 0.380,
				slg: 0.500,
				ops: 0.880,
				rates: {
					vsLHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.05, walk: 0.1, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 },
					vsRHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.05, walk: 0.1, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }
				}
			},
			// Bench player who can play RF
			'bench101': {
				id: 'bench101',
				name: 'Bench Player',
				bats: 'R',
				teamId: 'NYA',
				primaryPosition: 9, // RF - same position
				positionEligibility: { 9: 5000, 7: 3000 },
				pa: 200,
				avg: 0.260,
				obp: 0.320,
				slg: 0.380,
				ops: 0.700,
				rates: {
					vsLHP: { single: 0.15, double: 0.04, triple: 0.01, homeRun: 0.02, walk: 0.08, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 },
					vsRHP: { single: 0.15, double: 0.04, triple: 0.01, homeRun: 0.02, walk: 0.08, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }
				}
			},
			// Fill out roster
			'combe101': {
				id: 'combe101', name: 'Combs, Earle', bats: 'L', teamId: 'NYA',
				primaryPosition: 8, positionEligibility: { 8: 38130 }, pa: 648,
				avg: 0.356, obp: 0.414, slg: 0.511, ops: 0.925,
				rates: {
					vsLHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.04, walk: 0.1, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 },
					vsRHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.04, walk: 0.1, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }
				}
			},
			'gehrl101': {
				id: 'gehrl101', name: 'Gehrig, Lou', bats: 'L', teamId: 'NYA',
				primaryPosition: 3, positionEligibility: { 3: 39597 }, pa: 584,
				avg: 0.373, obp: 0.474, slg: 0.765, ops: 1.239,
				rates: {
					vsLHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.08, walk: 0.12, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 },
					vsRHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.08, walk: 0.12, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }
				}
			},
			'lazzt101': {
				id: 'lazzt101', name: 'Lazzeri, Tony', bats: 'R', teamId: 'NYA',
				primaryPosition: 4, positionEligibility: { 4: 27462, 5: 2082, 6: 8829 }, pa: 570,
				avg: 0.309, obp: 0.381, slg: 0.482, ops: 0.863,
				rates: {
					vsLHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.04, walk: 0.1, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 },
					vsRHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.04, walk: 0.1, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }
				}
			},
			'koenm101': {
				id: 'koenm101', name: 'Koenig, Mark', bats: 'R', teamId: 'NYA',
				primaryPosition: 6, positionEligibility: { 6: 30408 }, pa: 526,
				avg: 0.285, obp: 0.347, slg: 0.399, ops: 0.746,
				rates: {
					vsLHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.04, walk: 0.1, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 },
					vsRHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.04, walk: 0.1, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }
				}
			},
			'meusb101': {
				id: 'meusb101', name: 'Meusel, Bob', bats: 'R', teamId: 'NYA',
				primaryPosition: 7, positionEligibility: { 7: 19989, 9: 12747 }, pa: 516,
				avg: 0.337, obp: 0.384, slg: 0.510, ops: 0.894,
				rates: {
					vsLHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.04, walk: 0.1, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 },
					vsRHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.04, walk: 0.1, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }
				}
			},
			'dugaj101': {
				id: 'dugaj101', name: 'Dugan, Joe', bats: 'R', teamId: 'NYA',
				primaryPosition: 5, positionEligibility: { 5: 26265 }, pa: 387,
				avg: 0.304, obp: 0.349, slg: 0.432, ops: 0.781,
				rates: {
					vsLHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.04, walk: 0.1, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 },
					vsRHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.04, walk: 0.1, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }
				}
			},
			'collp101': {
				id: 'collp101', name: 'Collins, Pat', bats: 'R', teamId: 'NYA',
				primaryPosition: 2, positionEligibility: { 2: 19311 }, pa: 251,
				avg: 0.276, obp: 0.327, slg: 0.399, ops: 0.726,
				rates: {
					vsLHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.04, walk: 0.1, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 },
					vsRHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.04, walk: 0.1, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }
				}
			}
		};

		const pitchers: Record<string, PitcherStats> = {
			'starter': {
				id: 'starter', name: 'Starting Pitcher', throws: 'R', teamId: 'NYA',
				games: 30, gamesStarted: 30, completeGames: 5, saves: 0, inningsPitched: 200,
				whip: 1.2, era: 3.5, avgBfpAsStarter: null, avgBfpAsReliever: null,
				rates: {
					vsLHB: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 },
					vsRHB: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }
				}
			}
		};

		// Create usage context - overused player at 130% of actual
		const usageContext = {
			playerUsage: new Map([['overused101', 1.30]]),
			restThreshold: 1.25
		};

		const result = await buildLineup(batters, pitchers, 'NYA', 'AL', 1927, usageContext);

		// The bench player should be preferred over the overused player during position assignment
		const benchSlot = result.lineup.players.find(p => p.playerId === 'bench101');
		expect(benchSlot).toBeDefined();

		// The overused player should NOT be in the lineup (was not selected due to high usage)
		const overusedSlot = result.lineup.players.find(p => p.playerId === 'overused101');
		expect(overusedSlot).toBeUndefined();

		// Note: No "Resting" warning is generated because the overused player was
		// never selected in the first place - we prefer underused players during initial assignment
	});
});

describe('buildLineup - position assignment quality', () => {
	it('selects star player over backup when both have same primary position', async () => {
		// Regression test for: Babe Ruth (540 PA) should start over Cedric Durst (129 PA)
		// when both have primary_position = 9 (RF)
		const batters: Record<string, BatterStats> = {
			// Star player - Babe Ruth equivalent
			'ruthb101': {
				id: 'ruthb101',
				name: 'Ruth, Babe',
				bats: 'L',
				teamId: 'NYA',
				primaryPosition: 9, // RF
				positionEligibility: { 7: 14871, 9: 22560 },
				pa: 540,
				avg: 0.356,
				obp: 0.486,
				slg: 0.772,
				ops: 1.258,
				rates: {
					vsLHP: {
						single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.08,
						walk: 0.12, hitByPitch: 0.01, strikeout: 0.1,
						groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02,
						sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0,
						reachedOnError: 0, catcherInterference: 0
					},
					vsRHP: {
						single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.08,
						walk: 0.12, hitByPitch: 0.01, strikeout: 0.1,
						groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02,
						sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0,
						reachedOnError: 0, catcherInterference: 0
					}
				}
			},
			// Backup player - Cedric Durst equivalent
			'dursc101': {
				id: 'dursc101',
				name: 'Durst, Cedric',
				bats: 'L',
				teamId: 'NYA',
				primaryPosition: 9, // RF - same as Ruth!
				positionEligibility: { 7: 2622, 8: 897, 9: 3045 },
				pa: 129,
				avg: 0.260,
				obp: 0.320,
				slg: 0.380,
				ops: 0.700,
				rates: {
					vsLHP: {
						single: 0.15, double: 0.04, triple: 0.01, homeRun: 0.02,
						walk: 0.08, hitByPitch: 0.01, strikeout: 0.15,
						groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03,
						sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0,
						reachedOnError: 0, catcherInterference: 0
					},
					vsRHP: {
						single: 0.15, double: 0.04, triple: 0.01, homeRun: 0.02,
						walk: 0.08, hitByPitch: 0.01, strikeout: 0.15,
						groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03,
						sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0,
						reachedOnError: 0, catcherInterference: 0
					}
				}
			},
			// Fill out the rest of the roster with minimum players
			'combe101': {
				id: 'combe101', name: 'Combs, Earle', bats: 'L', teamId: 'NYA',
				primaryPosition: 8, positionEligibility: { 8: 38130 }, pa: 648,
				avg: 0.356, obp: 0.414, slg: 0.511, ops: 0.925,
				rates: {
					vsLHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.04, walk: 0.1, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 },
					vsRHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.04, walk: 0.1, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }
				}
			},
			'gehrl101': {
				id: 'gehrl101', name: 'Gehrig, Lou', bats: 'L', teamId: 'NYA',
				primaryPosition: 3, positionEligibility: { 3: 39597 }, pa: 584,
				avg: 0.373, obp: 0.474, slg: 0.765, ops: 1.239,
				rates: {
					vsLHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.08, walk: 0.12, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 },
					vsRHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.08, walk: 0.12, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }
				}
			},
			'lazzt101': {
				id: 'lazzt101', name: 'Lazzeri, Tony', bats: 'R', teamId: 'NYA',
				primaryPosition: 4, positionEligibility: { 4: 27462, 5: 2082, 6: 8829 }, pa: 570,
				avg: 0.309, obp: 0.381, slg: 0.482, ops: 0.863,
				rates: {
					vsLHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.04, walk: 0.1, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 },
					vsRHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.04, walk: 0.1, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }
				}
			},
			'koenm101': {
				id: 'koenm101', name: 'Koenig, Mark', bats: 'R', teamId: 'NYA',
				primaryPosition: 6, positionEligibility: { 6: 30408 }, pa: 526,
				avg: 0.285, obp: 0.347, slg: 0.399, ops: 0.746,
				rates: {
					vsLHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.04, walk: 0.1, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 },
					vsRHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.04, walk: 0.1, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }
				}
			},
			'meusb101': {
				id: 'meusb101', name: 'Meusel, Bob', bats: 'R', teamId: 'NYA',
				primaryPosition: 7, positionEligibility: { 7: 19989, 9: 12747 }, pa: 516,
				avg: 0.337, obp: 0.384, slg: 0.510, ops: 0.894,
				rates: {
					vsLHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.04, walk: 0.1, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 },
					vsRHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.04, walk: 0.1, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }
				}
			},
			'dugaj101': {
				id: 'dugaj101', name: 'Dugan, Joe', bats: 'R', teamId: 'NYA',
				primaryPosition: 5, positionEligibility: { 5: 26265 }, pa: 387,
				avg: 0.304, obp: 0.349, slg: 0.432, ops: 0.781,
				rates: {
					vsLHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.04, walk: 0.1, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 },
					vsRHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.04, walk: 0.1, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }
				}
			},
			'collp101': {
				id: 'collp101', name: 'Collins, Pat', bats: 'R', teamId: 'NYA',
				primaryPosition: 2, positionEligibility: { 2: 19311 }, pa: 251,
				avg: 0.276, obp: 0.327, slg: 0.399, ops: 0.726,
				rates: {
					vsLHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.04, walk: 0.1, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 },
					vsRHP: { single: 0.15, double: 0.05, triple: 0.01, homeRun: 0.04, walk: 0.1, hitByPitch: 0.01, strikeout: 0.1, groundOut: 0.15, flyOut: 0.12, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }
				}
			}
		};

		const pitchers: Record<string, PitcherStats> = {
			'starter': {
				id: 'starter', name: 'Starting Pitcher', throws: 'R', teamId: 'NYA',
				games: 30, gamesStarted: 30, completeGames: 5, saves: 0, inningsPitched: 200,
				whip: 1.2, era: 3.5, avgBfpAsStarter: null, avgBfpAsReliever: null,
				rates: {
					vsLHB: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 },
					vsRHB: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }
				}
			}
		};

		const result = await buildLineup(batters, pitchers, 'NYA', 'AL', 1927);

		// Ruth should be in the lineup at RF (position 9)
		const ruthSlot = result.lineup.players.find(p => p.playerId === 'ruthb101');
		expect(ruthSlot).toBeDefined();
		expect(ruthSlot?.position).toBe(9); // RF

		// Durst should NOT be in the starting lineup (he's a backup with same primary position)
		const durstSlot = result.lineup.players.find(p => p.playerId === 'dursc101');
		expect(durstSlot).toBeUndefined();
	});
});

describe('usesDH', () => {
	it('returns true for AL after 1973', () => {
		expect(usesDH('AL', 1973)).toBe(true);
		expect(usesDH('AL', 2020)).toBe(true);
	});
	it('returns false for AL before 1973', () => {
		expect(usesDH('AL', 1972)).toBe(false);
		expect(usesDH('AL', 1950)).toBe(false);
	});
	it('returns true for NL after 2022', () => {
		expect(usesDH('NL', 2022)).toBe(true);
		expect(usesDH('NL', 2024)).toBe(true);
	});
	it('returns false for NL before 2022', () => {
		expect(usesDH('NL', 2021)).toBe(false);
		expect(usesDH('NL', 1950)).toBe(false);
	});
});

describe('buildLineup - era integration', () => {
	it('uses traditional strategy for 1950', () => {
		const batters = createMinimalRoster();
		const pitchers = createMinimalPitchers();

		const result = buildLineup(batters, pitchers, 'TEST', 'NL', 1950);

		// Verify era detection
		expect(result.era).toBeDefined();
		expect(result.era?.primary).toBe('traditional');
		expect(result.era?.secondary).toBeNull();
		expect(result.era?.blendFactor).toBe(1);

		// Verify lineup is built
		expect(result.lineup.players).toHaveLength(9);
		expect(result.lineup.players[result.lineup.players.length - 1]!.position).toBe(1); // Pitcher bats 9th
	});

	it('uses modern strategy for 2020', () => {
		const batters = createMinimalRoster();
		const pitchers = createMinimalPitchers();

		const result = buildLineup(batters, pitchers, 'TEST', 'AL', 2020);

		// Verify era detection
		expect(result.era).toBeDefined();
		expect(result.era?.primary).toBe('modern');
		expect(result.era?.secondary).toBeNull();
		expect(result.era?.blendFactor).toBe(1);

		// Verify lineup is built
		expect(result.lineup.players).toHaveLength(9);
		// DH is used in AL 2020
		expect(result.lineup.players.some(p => p.position === 10)).toBe(true);
	});

	it('blends strategies for 1985 (transition era)', () => {
		const batters = createMinimalRoster();
		const pitchers = createMinimalPitchers();

		const result = buildLineup(batters, pitchers, 'TEST', 'NL', 1985);

		// Verify era detection - 1985 is in transition
		expect(result.era).toBeDefined();
		expect(result.era?.primary).toBe('composite');
		expect(result.era?.secondary).toBe('traditional');
		expect(result.era?.blendFactor).toBeGreaterThan(0);
		expect(result.era?.blendFactor).toBeLessThan(1);

		// Verify lineup is built
		expect(result.lineup.players).toHaveLength(9);
	});

	it('respects strategy override option', () => {
		const batters = createMinimalRoster();
		const pitchers = createMinimalPitchers();

		// Force modern strategy even though 1950 is traditional era
		const result = buildLineup(batters, pitchers, 'TEST', 'NL', 1950, undefined, {
			strategy: 'modern'
		});

		// Verify strategy override
		expect(result.era?.primary).toBe('modern');
		expect(result.era?.secondary).toBeNull();
		expect(result.era?.blendFactor).toBe(1);
	});

	it('uses DH from option when specified', () => {
		const batters = createMinimalRoster();
		const pitchers = createMinimalPitchers();

		// 1950 NL normally doesn't use DH, but override it
		const result = buildLineup(batters, pitchers, 'TEST', 'NL', 1950, undefined, {
			useDH: true
		});

		// Verify DH is used
		expect(result.lineup.players.some(p => p.position === 10)).toBe(true);
	});

	it('applies randomness when specified', () => {
		const batters = createMinimalRoster();
		const pitchers = createMinimalPitchers();

		// Build with high randomness
		const result1 = buildLineup(batters, pitchers, 'TEST', 'NL', 2020, undefined, {
			randomness: 0.5
		});

		const result2 = buildLineup(batters, pitchers, 'TEST', 'NL', 2020, undefined, {
			randomness: 0.5
		});

		// With randomness, lineups may differ (not guaranteed, but possible)
		// Just verify both are valid
		expect(result1.lineup.players).toHaveLength(9);
		expect(result2.lineup.players).toHaveLength(9);
	});

	it('detects all eras correctly', () => {
		const testCases = [
			{ year: 1950, expected: 'traditional' },
			{ year: 1975, expected: 'traditional' },
			{ year: 1980, expected: 'composite' },
			{ year: 1985, expected: 'composite' },
			{ year: 1990, expected: 'early-analytics' },
			{ year: 1995, expected: 'early-analytics' },
			{ year: 2000, expected: 'modern' },
			{ year: 2005, expected: 'modern' },
			{ year: 2010, expected: 'modern' },
			{ year: 2024, expected: 'modern' }
		];

		const batters = createMinimalRoster();
		const pitchers = createMinimalPitchers();

		for (const testCase of testCases) {
			const result = buildLineup(batters, pitchers, 'TEST', 'NL', testCase.year);
			expect(result.era?.primary).toBe(testCase.expected);
		}
	});
});

describe('buildLineup - cross-era validation', () => {
	const testYears = [1920, 1950, 1980, 1990, 2000, 2010, 2020];

	testYears.forEach(year => {
		it(`generates valid lineup for ${year}`, async () => {
			const batters = createMinimalRoster('team1');
			const pitchers = createMinimalPitchers('team1');

			const result = await buildLineup(batters, pitchers, 'team1', 'AL', year);

			// Should have 9 players
			expect(result.lineup.players).toHaveLength(9);

			// Should have unique players (none should be null)
			const playerIds = result.lineup.players.map(p => p.playerId);
			const nonNullIds = playerIds.filter(id => id !== null);
			expect(nonNullIds).toHaveLength(9);
			const uniqueIds = new Set(nonNullIds);
			expect(uniqueIds.size).toBe(9);

			// Should have valid fielding positions (1-10, where 1=pitcher, 10=DH)
			const positions = result.lineup.players.map(p => p.position);
			positions.forEach(pos => {
				expect(pos).toBeGreaterThanOrEqual(1);
				expect(pos).toBeLessThanOrEqual(10);
			});

			// All 9 positions should be filled
			expect(result.lineup.players.every(p => p.playerId !== null)).toBe(true);
		});
	});
});
