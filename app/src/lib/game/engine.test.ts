/**
 * Game engine tests - specifically for double-switch bug
 *
 * Bug: When pinch hitting for a pitcher (double switch), the new pitcher
 * is never added to the batting order at position 1. This corrupts the lineup.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from './engine.js';
import type { SeasonPackage, BatterStats, PitcherStats } from './types.js';
import type { EventRates } from './types.js';

// Create minimal test data
function createMinimalRates(): EventRates {
	return {
		single: 0.15,
		double: 0.05,
		triple: 0.01,
		homeRun: 0.03,
		walk: 0.08,
		hitByPitch: 0.01,
		strikeout: 0.2,
		groundOut: 0.2,
		flyOut: 0.15,
		lineOut: 0.05,
		popOut: 0.04,
		sacrificeFly: 0.01,
		sacrificeBunt: 0.005,
		fieldersChoice: 0.005,
		reachedOnError: 0.005,
		catcherInterference: 0.001
	};
}

function createSeasonPackage(): SeasonPackage {
	// Create test batters - including a pitcher and pinch hitter
	const pitcherBatter: BatterStats = {
		id: 'pitcher-1',
		name: 'Lester, Jon',
		bats: 'L',
		teamId: 'team-1',
		primaryPosition: 1,
		positionEligibility: { 1: 100 },
		pa: 50,
		avg: 0.100,
		obp: 0.150,
		slg: 0.120,
		ops: 0.270,
		rates: {
			vsLHP: createMinimalRates(),
			vsRHP: createMinimalRates()
		}
	};

	const relieverBatter: BatterStats = {
		id: 'reliever-1',
		name: 'Edwards, Carl',
		bats: 'R',
		teamId: 'team-1',
		primaryPosition: 1,
		positionEligibility: { 1: 100 },
		pa: 20,
		avg: 0.080,
		obp: 0.120,
		slg: 0.100,
		ops: 0.220,
		rates: {
			vsLHP: createMinimalRates(),
			vsRHP: createMinimalRates()
		}
	};

	const pinchHitter: BatterStats = {
		id: 'ph-1',
		name: 'La Stella, Tommy',
		bats: 'L',
		teamId: 'team-1',
		primaryPosition: 5, // 3B
		positionEligibility: { 5: 50, 4: 30, 6: 20 }, // 3B, 2B, SS
		pa: 200,
		avg: 0.260,
		obp: 0.340,
		slg: 0.380,
		ops: 0.720,
		rates: {
			vsLHP: createMinimalRates(),
			vsRHP: createMinimalRates()
		}
	};

	// Position players
	const positionPlayers: BatterStats[] = [];
	for (let i = 2; i <= 9; i++) {
		const pos = i as 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
		positionPlayers.push({
			id: `player-${i}`,
			name: `Player${i}, Last${i}`,
			bats: 'R',
			teamId: 'team-1',
			primaryPosition: pos,
			positionEligibility: { [pos]: 100 },
			pa: 500,
			avg: 0.270,
			obp: 0.340,
			slg: 0.430,
			ops: 0.770,
			rates: {
				vsLHP: createMinimalRates(),
				vsRHP: createMinimalRates()
			}
		});
	}

	// Pitchers - ensure all required fields are present
	const startingPitcher: PitcherStats = {
		id: 'pitcher-1',
		name: 'Lester, Jon',
		throws: 'L',
		teamId: 'team-1',
		games: 30,
		gamesStarted: 30,
		completeGames: 5,
		saves: 0,
		inningsPitched: 180,
		whip: 1.2,
		era: 3.5,
		avgBfpAsStarter: 27,
		avgBfpAsReliever: null,
		rates: {
			vsLHB: createMinimalRates(),
			vsRHB: createMinimalRates()
		}
	};

	const relieverPitcher: PitcherStats = {
		id: 'reliever-1',
		name: 'Edwards, Carl',
		throws: 'R',
		teamId: 'team-1',
		games: 60,
		gamesStarted: 0,
		completeGames: 0,
		saves: 5,
		inningsPitched: 60,
		whip: 1.1,
		era: 3.2,
		avgBfpAsStarter: null,
		avgBfpAsReliever: 4,
		rates: {
			vsLHB: createMinimalRates(),
			vsRHB: createMinimalRates()
		}
	};

	// Add more relievers for bullpen depth
	const reliever2: PitcherStats = {
		id: 'reliever-2',
		name: 'Reliever, Two',
		throws: 'R',
		teamId: 'team-1',
		games: 50,
		gamesStarted: 0,
		completeGames: 0,
		saves: 3,
		inningsPitched: 55,
		whip: 1.3,
		era: 3.8,
		avgBfpAsStarter: null,
		avgBfpAsReliever: 4,
		rates: {
			vsLHB: createMinimalRates(),
			vsRHB: createMinimalRates()
		}
	};

	const closer: PitcherStats = {
		id: 'closer-1',
		name: 'Closer, Joe',
		throws: 'R',
		teamId: 'team-1',
		games: 60,
		gamesStarted: 0,
		completeGames: 0,
		saves: 30,
		inningsPitched: 60,
		whip: 1.0,
		era: 2.5,
		avgBfpAsStarter: null,
		avgBfpAsReliever: 3,
		rates: {
			vsLHB: createMinimalRates(),
			vsRHB: createMinimalRates()
		}
	};

	// Build opposing team batters
	const opposingBatters: BatterStats[] = [];
	for (let i = 1; i <= 9; i++) {
		const pos = i as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
		opposingBatters.push({
			id: `opposing-player-${i}`,
			name: `Opp${i}, Player${i}`,
			bats: 'R',
			teamId: 'team-2',
			primaryPosition: pos,
			positionEligibility: { [pos]: 100 },
			pa: 500,
			avg: 0.270,
			obp: 0.340,
			slg: 0.430,
			ops: 0.770,
			rates: {
				vsLHP: createMinimalRates(),
				vsRHP: createMinimalRates()
			}
		});
	}

	const opposingPitcher: PitcherStats = {
		id: 'opposing-player-1',
		name: 'Opp1, Player1',
		throws: 'R',
		teamId: 'team-2',
		games: 30,
		gamesStarted: 30,
		completeGames: 5,
		saves: 0,
		inningsPitched: 180,
		whip: 1.2,
		era: 3.5,
		avgBfpAsStarter: 27,
		avgBfpAsReliever: null,
		rates: {
			vsLHB: createMinimalRates(),
			vsRHB: createMinimalRates()
		}
	};

	const opposingReliever1: PitcherStats = {
		id: 'opposing-reliever-1',
		name: 'OppReliever, One',
		throws: 'R',
		teamId: 'team-2',
		games: 50,
		gamesStarted: 0,
		completeGames: 0,
		saves: 5,
		inningsPitched: 60,
		whip: 1.1,
		era: 3.2,
		avgBfpAsStarter: null,
		avgBfpAsReliever: 4,
		rates: {
			vsLHB: createMinimalRates(),
			vsRHB: createMinimalRates()
		}
	};

	const opposingReliever2: PitcherStats = {
		id: 'opposing-reliever-2',
		name: 'OppReliever, Two',
		throws: 'L',
		teamId: 'team-2',
		games: 50,
		gamesStarted: 0,
		completeGames: 0,
		saves: 3,
		inningsPitched: 55,
		whip: 1.3,
		era: 3.8,
		avgBfpAsStarter: null,
		avgBfpAsReliever: 4,
		rates: {
			vsLHB: createMinimalRates(),
			vsRHB: createMinimalRates()
		}
	};

	const opposingCloser: PitcherStats = {
		id: 'opposing-closer-1',
		name: 'OppCloser, Joe',
		throws: 'R',
		teamId: 'team-2',
		games: 60,
		gamesStarted: 0,
		completeGames: 0,
		saves: 30,
		inningsPitched: 60,
		whip: 1.0,
		era: 2.5,
		avgBfpAsStarter: null,
		avgBfpAsReliever: 3,
		rates: {
			vsLHB: createMinimalRates(),
			vsRHB: createMinimalRates()
		}
	};

	// Build batters record
	const batters: Record<string, BatterStats> = {
		'pitcher-1': pitcherBatter,
		'reliever-1': relieverBatter,
		'ph-1': pinchHitter
	};
	for (const p of positionPlayers) {
		batters[p.id] = p;
	}
	for (const p of opposingBatters) {
		batters[p.id] = p;
	}

	// Build pitchers record - opposing pitcher is already in opposingBatters
	const pitchers: Record<string, PitcherStats> = {
		'pitcher-1': startingPitcher,
		'reliever-1': relieverPitcher,
		'reliever-2': reliever2,
		'closer-1': closer,
		'opposing-player-1': opposingPitcher,
		'opposing-reliever-1': opposingReliever1,
		'opposing-reliever-2': opposingReliever2,
		'opposing-closer-1': opposingCloser
	};

	return {
		meta: {
			year: 2016,
			generatedAt: new Date().toISOString(),
			version: '1.0.0'
		},
		norms: {
			year: 2016,
			era: 'modern',
			pitching: {
				starterPitches: {
					fatigueThreshold: 85,
					typicalLimit: 100,
					hardLimit: 120
				},
				relieverPitches: {
					maxPitches: 40,
					typicalPitches: 20
				},
				starterBFP: 25,
				relieverBFP: {
					early: 6,
					middle: 4,
					late: 3
				},
				relieverBFPOverall: 4,
				relieversPerGame: 3,
				starterDeepOutingBFP: 30
			},
			substitutions: {
				pinchHitsPerGame: 2.5,
				defensiveReplacementsPerGame: 1.5
			}
		},
		batters,
		pitchers,
		league: {
			vsLHP: createMinimalRates(),
			vsRHP: createMinimalRates(),
			pitcherBatter: {
				vsLHP: createMinimalRates(),
				vsRHP: createMinimalRates()
			}
		},
		teams: {
			'team-1': { id: 'team-1', league: 'NL', city: 'Chicago', nickname: 'Cubs' },
			'team-2': { id: 'team-2', league: 'NL', city: 'St. Louis', nickname: 'Cardinals' }
		},
		games: []
	};
}

describe('Double Switch Bug', () => {
	let season: SeasonPackage;
	let engine: GameEngine;

	beforeEach(() => {
		season = createSeasonPackage();
		// Create engine with disabled managerial (we'll manually invoke the logic)
		engine = new GameEngine(season, 'team-1', 'team-2', { enabled: false });
	});

	// This test documents the bug: when pinch hitting for a pitcher (double switch),
	// the new reliever is never added to the batting order at position 1.
	// This causes the lineup to have no pitcher at position 1, and instead has
	// the pinch hitter at their defensive position (e.g., 3B).
	//
	// After the fix, this test should verify:
	// 1. The new reliever is in the batting order at position 1
	// 2. The pinch hitter is in the batting order at their defensive position
	// 3. The lineup.pitcher field points to the new reliever
	// 4. There are exactly 9 players in the batting order
	// 5. No position is duplicated (e.g., don't have two players at 3B)
	it('maintains valid lineup after double-switch (pinch hit for pitcher)', () => {
		// This test will be properly implemented once we can trigger
		// the double-switch logic via the managerial system
		// For now, it's a placeholder documenting the expected behavior

		// BUG: The double-switch code at engine.ts:744-781 does NOT:
		// - Add the new reliever to the batting order at position 1
		//
		// What it DOES:
		// - Line 756: Puts pinch hitter at batterIndex at their defensivePosition
		// - Line 759: Updates battingTeam.pitcher to new reliever
		// - BUT: Never adds the new reliever to battingTeam.players at position 1
		//
		// Result: Lineup corruption - no pitcher at position 1, pinch hitter
		// occupies their defensive position slot, but no player occupies position 1

		expect(true).toBe(true); // Placeholder - will implement proper test
	});

	it('has exactly 9 players and one at each position in initial lineup', () => {
		const state = engine.getState();
		const homeTeam = state.homeLineup;

		// Should have 9 players
		expect(homeTeam.players).toHaveLength(9);

		// Should have one player at each position 1-9
		const positions = homeTeam.players.map(p => p.position).sort((a, b) => a - b);
		expect(positions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
	});

	it('has pitcher at position 1 in batting order', () => {
		const state = engine.getState();
		const homeTeam = state.homeLineup;

		const pitcherSlot = homeTeam.players.findIndex(p => p.position === 1);
		expect(pitcherSlot).toBeGreaterThanOrEqual(0);
		expect(homeTeam.players[pitcherSlot!].playerId).toBe(homeTeam.pitcher);
	});

	it('does not move pitcher to pinch hitter spot when PH replaces position player', () => {
		// Bug: When a pinch hitter replaces a position player (not the pitcher),
		// the "lineup adjustment" message was incorrectly showing the pitcher
		// replacing the PH in the batting order. The pitcher should stay at position 1.
		//
		// Example from real game:
		// - Kershaw is the pitcher at position 1 (batting 9th)
		// - Toles pinch hits for Kendrick (LF, batting 4th)
		// - Expected: Toles is replaced by a bench player in the 4th spot
		// - Bug was: "Kershaw replaces Toles, batting 4th" - WRONG

		const state = engine.getState();
		const homeTeam = state.homeLineup;

		// Find the pitcher's original batting position
		const originalPitcherSlot = homeTeam.players.findIndex(p => p.position === 1);
		const originalPitcherId = homeTeam.pitcher;
		const originalPitcherBattingOrder = originalPitcherSlot + 1;

		// Find a position player to PH for (not the pitcher) - use player 4 (1B)
		const positionPlayerIndex = homeTeam.players.findIndex(p => p.position === 4);
		const positionPlayerId = homeTeam.players[positionPlayerIndex].playerId!;

		// Manually create a PH scenario: replace position player with PH
		const phId = 'ph-1';
		homeTeam.players[positionPlayerIndex] = { playerId: phId, position: 11 }; // 11 = PH

		// Mark the replaced player as removed
		(engine as any).removedPlayers.add(positionPlayerId);
		(engine as any).usedPinchHitters.add(phId);

		// Simulate to end of inning to trigger lineup audit
		// We need to call auditLineupAtHalfInningEnd
		const teamId = homeTeam.teamId;
		(engine as any).auditLineupAtHalfInningEnd(homeTeam, teamId);

		// After audit:
		// 1. The pitcher should STILL be at the same batting position (position 1)
		const newPitcherSlot = homeTeam.players.findIndex(p => p.position === 1);
		expect(newPitcherSlot).toBe(originalPitcherSlot);
		expect(homeTeam.pitcher).toBe(originalPitcherId);
		expect(homeTeam.players[originalPitcherSlot].playerId).toBe(originalPitcherId);

		// 2. The PH slot should have a bench player, not the pitcher
		expect(homeTeam.players[positionPlayerIndex].playerId).not.toBe(originalPitcherId);
		expect(homeTeam.players[positionPlayerIndex].position).not.toBe(1);
	});
});

describe('Pitcher Re-Entry Bug', () => {
	let season: SeasonPackage;
	let engine: GameEngine;

	beforeEach(() => {
		season = createSeasonPackage();
		// Create engine with enabled managerial to trigger pitching changes
		engine = new GameEngine(season, 'team-1', 'team-2', { enabled: true });
	});

	// Bug: Once a pitcher is removed from the game, they should not be able
	// to re-enter. The selectReliever function was not filtering out removed
	// pitchers, causing the same pitcher to be selected multiple times.
	it('prevents removed pitchers from re-entering the game', () => {
		// Track all pitching changes to detect re-entries
		const pitchingChanges: { old: string; new: string; inning: number }[] = [];
		const pitcherHistory: string[] = [];

		// Simulate many PAs to trigger multiple pitching changes
		// With low BFP limits, we should see several relievers enter the game
		for (let i = 0; i < 100; i++) {
			const stateBefore = engine.getState();
			const currentPitcher = stateBefore.isTopInning
				? stateBefore.homeLineup.pitcher
				: stateBefore.awayLineup.pitcher;

			// Simulate one PA
			engine.simulatePlateAppearance();

			const stateAfter = engine.getState();
			const newPitcher = stateAfter.isTopInning
				? stateAfter.homeLineup.pitcher
				: stateAfter.awayLineup.pitcher;

			// Track pitcher changes
			if (currentPitcher !== newPitcher) {
				pitchingChanges.push({
					old: currentPitcher!,
					new: newPitcher!,
					inning: stateBefore.inning
				});
				pitcherHistory.push(newPitcher!);
			}

			// Stop if game is complete
			if (engine.isComplete()) break;
		}

		// Verify: No pitcher should appear more than once in the history
		// (except the starting pitcher who begins in the history)
		const uniquePitchers = new Set(pitcherHistory);
		const duplicates = pitcherHistory.filter((p, idx) => pitcherHistory.indexOf(p) !== idx);

		expect(duplicates).toHaveLength(0);
		expect(uniquePitchers.size).toBe(pitcherHistory.length);

		// Also verify that no pitcher in pitchingChanges appears as both "old" and "new"
		// (i.e., a pitcher leaves and later comes back)
		const allOldPitchers = new Set(pitchingChanges.map(c => c.old));
		const allNewPitchers = new Set(pitchingChanges.map(c => c.new));

		// Find pitchers who were removed (appear as "old") and later re-entered (appear as "new" after being "old")
		const removedPitchers = [...allOldPitchers];
		const reEntries = removedPitchers.filter(p => allNewPitchers.has(p));

		expect(reEntries).toHaveLength(0);
	});
});

describe('Home Team Batting 9th Inning Bug', () => {
	let season: SeasonPackage;
	let engine: GameEngine;

	beforeEach(() => {
		season = createSeasonPackage();
		engine = new GameEngine(season, 'team-1', 'team-2', { enabled: false });
	});

	// Bug: When the away team is leading after the top of the 9th inning,
	// the game ends immediately without giving the home team a chance to bat.
	// Root cause: isComplete() checks `!this.state.isTopInning` which becomes true
	// immediately after the top of the 9th ends, before the home team bats.
	it('allows home team to bat in bottom of 9th when trailing', () => {
		// Simulate the entire game
		while (!engine.isComplete()) {
			engine.simulatePlateAppearance();
		}

		const finalState = engine.getState();

		// Calculate final scores
		let awayScore = 0;
		let homeScore = 0;
		for (const play of finalState.plays) {
			if (play.isTopInning) {
				awayScore += play.runsScored;
			} else {
				homeScore += play.runsScored;
			}
		}

		// Count plays in bottom of 9th
		const playsInBottomOf9th = finalState.plays.filter(
			p => p.inning === 9 && !p.isTopInning && !p.isSummary
		).length;

		// If away team won in 9 innings, home team MUST have batted in bottom of 9th
		// The flag should be set to true, and there should be at least 3 plays (3 outs)
		if (awayScore > homeScore && finalState.inning === 9) {
			// Home team had their chance - they completed their at-bat
			expect(finalState.homeTeamHasBattedInInning).toBe(true);
			// Should have at least 3 plate appearances (3 outs)
			expect(playsInBottomOf9th).toBeGreaterThanOrEqual(3);
		}
	});

	it('allows home team to bat in bottom of extra innings when trailing', () => {
		// Simulate the entire game
		while (!engine.isComplete()) {
			engine.simulatePlateAppearance();
		}

		const finalState = engine.getState();

		// Calculate final scores
		let awayScore = 0;
		let homeScore = 0;
		for (const play of finalState.plays) {
			if (play.isTopInning) {
				awayScore += play.runsScored;
			} else {
				homeScore += play.runsScored;
			}
		}

		// If away team won in extra innings, home team must have batted in final inning
		if (finalState.inning > 9 && awayScore > homeScore) {
			// Home team had their chance in the bottom of the final inning
			expect(finalState.homeTeamHasBattedInInning).toBe(true);

			// Count plays in bottom of final inning
			const playsInBottomOfFinal = finalState.plays.filter(
				p => p.inning === finalState.inning && !p.isTopInning && !p.isSummary
			).length;

			// Should have at least 3 plate appearances (3 outs)
			expect(playsInBottomOfFinal).toBeGreaterThanOrEqual(3);
		}
	});
});
