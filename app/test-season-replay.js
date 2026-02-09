// Quick test script to run a season replay and check usage data
// Run with: pnpm exec tsx test-season-replay.js

import { SeasonReplayEngine } from './src/lib/season-replay/index.js';
import { listSeries } from './src/lib/game-results/series.js';
import { UsageTracker } from './src/lib/game-results/usage-tracker.js';
import { getGameDatabase } from './src/lib/game-results/database.js';

async function runSeasonReplay() {
  console.log('Starting season replay test...');

  // Initialize database (getGameDatabase handles initialization)
  const db = await getGameDatabase();

  // Check for existing 1976 season replay
  const allSeries = await listSeries();
  const series1976 = allSeries.find(s => s.name.includes('1976'));

  let seriesId = null;
  if (series1976) {
    seriesId = series1976.id;
    console.log('Found existing series:', seriesId, series1976.name);
  }

  if (!seriesId) {
    throw new Error('No 1976 series found. Please create one from the UI first.');
  }

  // Create engine with animated mode OFF
  const engine = new SeasonReplayEngine(seriesId, 1976, {
    animated: false,
    simSpeed: 0
  });

  await engine.initialize();

  // Set up progress tracking
  engine.on('progress', (data) => {
    console.log(`Progress: ${data.currentGameIndex}/${data.totalGames} (${data.percent}%)`);
  });

  engine.on('statusChange', (data) => {
    console.log('Status:', data.status);
  });

  // Start the replay
  await engine.start();

  // Play all games
  console.log('Playing all games...');
  while (engine.getStatus() === 'playing') {
    await engine.playNextGame();
  }

  console.log('Season replay complete!');

  // Check usage data
  const usageTracker = new UsageTracker(seriesId, 1976);
  const violations = await usageTracker.checkThresholds();

  console.log('\n=== USAGE VIOLATIONS ===');
  console.log(`Total violations: ${violations.length}`);
  console.log(`Under used: ${violations.filter(v => v.status === 'under').length}`);
  console.log(`Over used: ${violations.filter(v => v.status === 'over').length}`);

  // Get sample usage records
  const sampleStmt = db.prepare(`
    SELECT * FROM player_usage
    WHERE series_id = ?
    AND is_pitcher = 0
    ORDER BY percentage_of_actual DESC
    LIMIT 10
  `);
  sampleStmt.bind([seriesId]);

  console.log('\n=== SAMPLE BATTER USAGE ===');
  console.log('PlayerID\tReplayPA\tExpectedPA\tActualPA\tStoredPct\tStatus');

  while (sampleStmt.step()) {
    const row = sampleStmt.getAsObject();
    const replayPA = row.replay_current_total;
    const actualPA = row.actual_season_total;
    const storedPct = (row.percentage_of_actual * 100).toFixed(1);
    const status = row.status;

    // Calculate expected based on team games vs season length (162)
    // Get team games from the games table
    const teamGamesStmt = db.prepare(`
      SELECT COUNT(*) as games_played
      FROM games g
      WHERE g.series_id = ?
        AND (g.away_team_id = ? OR g.home_team_id = ?)
    `);
    teamGamesStmt.bind([seriesId, row.team_id, row.team_id]);
    const teamGames = teamGamesStmt.step() ? teamGamesStmt.getAsObject().games_played : 0;
    teamGamesStmt.free();

    const seasonLength = 162;
    const expectedPA = Math.round(actualPA * (teamGames / seasonLength));
    const correctPct = expectedPA > 0 ? ((replayPA / expectedPA) * 100).toFixed(1) : '0.0';

    console.log(`${row.player_id}\t${replayPA}\t${expectedPA}\t${actualPA}\t${storedPct}%\t${status}\t(calc: ${correctPct}%)`);
  }
  sampleStmt.free();

  console.log('\n=== STATS SUMMARY ===');
  const statsStmt = db.prepare(`
    SELECT
      COUNT(*) as total_players,
      SUM(CASE WHEN status = 'under' THEN 1 ELSE 0 END) as under_count,
      SUM(CASE WHEN status = 'over' THEN 1 ELSE 0 END) as over_count,
      SUM(CASE WHEN status = 'inRange' THEN 1 ELSE 0 END) as in_range_count
    FROM player_usage
    WHERE series_id = ?
  `);
  statsStmt.bind([seriesId]);
  if (statsStmt.step()) {
    const stats = statsStmt.getAsObject();
    console.log(`Total players: ${stats.total_players}`);
    console.log(`Under used (<75%): ${stats.under_count}`);
    console.log(`Over used (>125%): ${stats.over_count}`);
    console.log(`In range (75-125%): ${stats.in_range_count}`);
  }
  statsStmt.free();

  await db.close();
  console.log('\nDone!');
}

runSeasonReplay().catch(console.error);
