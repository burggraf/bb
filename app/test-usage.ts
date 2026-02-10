#!/usr/bin/env tsx
/**
 * Quick test script to verify usage tracking fixes
 * Runs 50 games of a season replay and reports usage statistics
 */

import { GameEngine } from './src/lib/game/engine.js';
import { loadSeason, getSeasonSchedule, getBattersForTeam, getPitchersForTeam } from './src/lib/game/sqlite-season-loader.js';
import { UsageTracker } from './src/lib/game-results/usage-tracker.js';
import type { BatterStats, PitcherStats } from './src/lib/game/types.js';

const YEAR = 1976;
const NUM_GAMES = 50;

interface UsageReport {
  playerId: string;
  playerName: string;
  actualPA: number;
  replayPA: number;
  usagePercent: number;
  status: string;
}

async function main() {
  console.log(`\n=== Usage Tracking Test - ${YEAR} Season (${NUM_GAMES} games) ===\n`);

  // Load season data
  console.log('Loading season data...');
  const season = await loadSeason(YEAR);
  const schedule = await getSeasonSchedule(YEAR);

  console.log(`Loaded ${Object.keys(season.batters).length} batters, ${Object.keys(season.pitchers).length} pitchers`);
  console.log(`Schedule has ${schedule.length} games\n`);

  // Initialize usage tracker
  const seriesId = `test-${YEAR}-${Date.now()}`;
  const usageTracker = new UsageTracker(seriesId, YEAR);

  // Seed usage targets
  await usageTracker.seedUsageTargets(season.batters, season.pitchers);
  console.log('Usage targets seeded\n');

  // Run games
  console.log(`Running ${NUM_GAMES} games...\`);
  let gamesCompleted = 0;
  let errors = 0;

  for (let i = 0; i < Math.min(NUM_GAMES, schedule.length); i++) {
    const game = schedule[i];

    try {
      // Create game engine
      const engine = new GameEngine({
        awayTeam: game.awayTeam,
        homeTeam: game.homeTeam,
        season: season,
        awayLineup: null, // Let engine build lineups
        homeLineup: null,
      });

      // Get usage context for lineup building
      const usage = await usageTracker.getAllTeamsUsageForContext();
      const awayUsage = usage.get(game.awayTeam) || new Map();
      const homeUsage = usage.get(game.homeTeam) || new Map();

      // Build lineups with usage context
      engine.buildLineups({
        awayUsageContext: { playerUsage: awayUsage },
        homeUsageContext: { playerUsage: homeUsage },
      });

      // Simulate the game
      let plays = 0;
      const maxPlays = 200; // Safety limit

      while (!engine.isComplete() && plays < maxPlays) {
        engine.simulatePlateAppearance();
        plays++;
      }

      if (plays >= maxPlays) {
        console.error(`Game ${i + 1} hit play limit!`);
        errors++;
      }

      gamesCompleted++;

      // Track usage stats
      const state = engine.getState();
      const batterPA: Map<string, number> = new Map();
      const pitcherIP: Map<string, number> = new Map();

      // Count PA for each batter
      for (const play of state.plays) {
        if (play.eventType === 'plateAppearance' && play.batterId) {
          batterPA.set(play.batterId, (batterPA.get(play.batterId) || 0) + 1);
        }
      }

      // Simple IP tracking (outs / 3)
      for (const play of state.plays) {
        // TODO: Proper IP tracking would require more complex logic
      }

      await usageTracker.updateGameUsage({ batterPa: batterPA, pitcherIp: pitcherIP });

      if ((i + 1) % 10 === 0) {
        console.log(`  Completed ${i + 1}/${NUM_GAMES} games...`);
      }
    } catch (e: any) {
      console.error(`Error in game ${i + 1}: ${e.message}`);
      errors++;
    }
  }

  console.log(`\nCompleted ${gamesCompleted} games with ${errors} errors\n`);

  // Generate usage report
  console.log('=== Usage Report ===\n');

  // Get all team usage
  const allTeams = new Set(
    Object.values(season.batters).map(b => b.teamId)
  );

  const reports: UsageReport[] = [];

  for (const teamId of allTeams) {
    const teamUsage = await usageTracker.getTeamUsage(teamId);

    for (const record of teamUsage) {
      if (!record.isPitcher) {
        const player = season.batters[record.playerId];
        reports.push({
          playerId: record.playerId,
          playerName: player?.name || record.playerId,
          actualPA: record.actualSeasonTotal,
          replayPA: record.replayCurrentTotal,
          usagePercent: record.percentageOfActual * 100,
          status: record.status,
        });
      }
    }
  }

  // Sort by usage percentage descending
  reports.sort((a, b) => b.usagePercent - a.usagePercent);

  // Find problematic players
  const over150 = reports.filter(r => r.usagePercent > 150);
  const over125 = reports.filter(r => r.usagePercent > 125);
  const under75 = reports.filter(r => r.usagePercent < 75);
  const zeroUsage = reports.filter(r => r.replayPA === 0);

  // Print top 20 most used
  console.log('Top 20 Most Used Players:');
  console.log('Name                    \tActual\tReplay\tUsage\tStatus');
  console.log('-'.repeat(70));
  for (let i = 0; i < Math.min(20, reports.length); i++) {
    const r = reports[i];
    console.log(`${r.playerName.padEnd(24)}\t${r.actualPA}\t${r.replayPA}\t${r.usagePercent.toFixed(0)}%\t${r.status}`);
  }

  console.log('\n=== Summary ===');
  console.log(`Total players tracked: ${reports.length}`);
  console.log(`Over 150% usage: ${over150.length}`);
  console.log(`Over 125% usage: ${over125.length}`);
  console.log(`Under 75% usage: ${under75.length}`);
  console.log(`Zero usage: ${zeroUsage.length}`);

  if (over150.length > 0) {
    console.log('\nPlayers over 150% usage:');
    for (const r of over150) {
      console.log(`  ${r.playerName}: ${r.usagePercent.toFixed(0)}% (${r.replayPA}/${r.actualPA} PA)`);
    }
  }

  // Check for extreme values (should be fixed)
  const extreme = reports.filter(r => r.usagePercent > 500);
  if (extreme.length > 0) {
    console.log('\n⚠️  EXTREME USAGE DETECTED (should be fixed):');
    for (const r of extreme) {
      console.log(`  ${r.playerName}: ${r.usagePercent.toFixed(0)}% (${r.replayPA}/${r.actualPA} PA)`);
    }
  } else {
    console.log('\n✓ No extreme usage (>500%) detected - dampening fix working!');
  }

  // Expected max usage check
  const expectedGames = NUM_GAMES / 2; // Each team plays half the games
  const expectedMaxPA = Math.max(...reports.map(r => r.actualPA)) * expectedGames / 162;
  console.log(`\nExpected max PA at game ${NUM_GAMES}: ~${expectedMaxPA.toFixed(0)}`);
  console.log(`Actual max PA: ${Math.max(...reports.map(r => r.replayPA))}`);

  console.log(`\n=== Test Complete ===`);
}

main().catch(console.error);
