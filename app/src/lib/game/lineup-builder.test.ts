import { describe, it, expect } from 'vitest';
import { selectStartingPitcher, buildLineup } from './lineup-builder.js';
import type { PitcherStats, BatterStats } from './types.js';

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

		// The bench player should replace the overused player
		const benchSlot = result.lineup.players.find(p => p.playerId === 'bench101');
		expect(benchSlot).toBeDefined();

		// The overused player should NOT be in the lineup
		const overusedSlot = result.lineup.players.find(p => p.playerId === 'overused101');
		expect(overusedSlot).toBeUndefined();

		// Should have warning about resting the player
		expect(result.warnings.some(w => w.includes('Resting Overused Starter'))).toBe(true);
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
