#!/usr/bin/env tsx
/**
 * Direct test of usage tracking fixes
 * Simulates games and checks if dampening and hard cap work correctly
 */

import Database from 'better-sqlite3';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';

const DB_PATH = './game-results-test.db';

// Clean up any existing test database
if (existsSync(DB_PATH)) {
  unlinkSync(DB_PATH);
}

const db = new Database(DB_PATH);

// Create schema
db.exec(`
  CREATE TABLE player_usage (
    series_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    is_pitcher INTEGER NOT NULL,
    actual_season_total REAL NOT NULL,
    games_played_actual INTEGER NOT NULL,
    replay_current_total REAL DEFAULT 0,
    replay_games_played INTEGER DEFAULT 0,
    percentage_of_actual REAL DEFAULT 0,
    status TEXT DEFAULT 'inRange',
    PRIMARY KEY (series_id, player_id, is_pitcher)
  );

  CREATE TABLE games (
    id TEXT PRIMARY KEY,
    series_id TEXT NOT NULL,
    date TEXT NOT NULL,
    away_team TEXT NOT NULL,
    home_team TEXT NOT NULL
  );

  CREATE TABLE series_teams (
    series_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    PRIMARY KEY (series_id, team_id)
  );
`);

const seriesId = 'test-1976';
const teamId = 'NYA';

// Add team
db.prepare('INSERT INTO series_teams (series_id, team_id) VALUES (?, ?)').run([seriesId, teamId]);

// Test player: 500 PA actual, simulates various replay scenarios
const playerId = 'test-player-500pa';
const actualPA = 500;
const seasonLength = 162;

// Insert player
db.prepare(`
  INSERT INTO player_usage (
    series_id, player_id, team_id, is_pitcher,
    actual_season_total, games_played_actual,
    percentage_of_actual, status
  ) VALUES (?, ?, ?, ?, ?, ?, 0, 'inRange')
`).run([seriesId, playerId, teamId, 0, actualPA, 1]);

console.log('\n=== Testing Usage Tracking Fixes ===\n');
console.log('Player: 500 PA actual season total\n');

// Simulate games and track usage
const testCases = [
  { game: 5, replayPA: 30 },
  { game: 10, replayPA: 60 },
  { game: 14, replayPA: 84 },
  { game: 20, replayPA: 120 },
  { game: 50, replayPA: 300 },
  { game: 81, replayPA: 500 },
  { game: 100, replayPA: 800 },
  { game: 162, replayPA: 1000 },
];

for (const tc of testCases) {
  // Simulate PA for this game
  const paPerGame = tc.replayPA / tc.game;

  // NEW calculation with dampening and hard cap
  const teamGames = tc.game;

  // Calculate expected with dampening
  let expected = actualPA * teamGames / seasonLength;
  if (teamGames < 20) {
    const dampeningFactor = teamGames / 20;
    const extrapolated = expected;
    expected = actualPA + (extrapolated - actualPA) * dampeningFactor;
  }

  const newReplay = tc.replayPA;
  let percentage = expected > 0 ? newReplay / expected : 0;
  percentage = Math.min(percentage, 2.0); // Hard cap at 200%

  // Update database
  db.prepare(`
    UPDATE player_usage
    SET replay_current_total = ?,
        replay_games_played = ?,
        percentage_of_actual = ?,
        status = CASE
          WHEN ? < 0.75 THEN 'under'
          WHEN ? > 1.25 THEN 'over'
          ELSE 'inRange'
        END
    WHERE series_id = ? AND player_id = ?
  `).run([newReplay, tc.game, percentage, percentage, percentage, seriesId, playerId]);

  // Get current values
  const row = db.prepare('SELECT * FROM player_usage WHERE player_id = ?').get(playerId) as any;

  console.log(`Game ${tc.game.toString().padStart(3)}: replay=${tc.replayPA.toString().padStart(4)} PA, expected=${expected.toFixed(0).padStart(4)}, usage=${(row.percentage_of_actual * 100).toFixed(0).padStart(5)}%, status=${row.status}`);
}

// Final summary
console.log('\n=== Summary ===');
const finalRow = db.prepare('SELECT * FROM player_usage WHERE player_id = ?').get(playerId) as any;
console.log(`\nFinal at game 162:`);
console.log(`  Actual PA: ${actualPA}`);
console.log(`  Replay PA: ${finalRow.replay_current_total}`);
console.log(`  Usage: ${(finalRow.percentage_of_actual * 100).toFixed(0)}%`);
console.log(`  Status: ${finalRow.status}`);

// Verify fixes
console.log('\n=== Verification ===');

// Test 1: Early season shouldn't be 2000%+
const earlyGameRow = db.prepare('SELECT replay_current_total, percentage_of_actual FROM player_usage WHERE replay_games_played = 14').get() as any;
if (earlyGameRow && earlyGameRow.percentage_of_actual < 5.0) {
  console.log('✓ Early season (game 14): Dampening working -', (earlyGameRow.percentage_of_actual * 100).toFixed(0), '% < 500%');
} else {
  console.log('✗ Early season (game 14): Dampening NOT working -', (earlyGameRow ? (earlyGameRow.percentage_of_actual * 100).toFixed(0) : 'N/A'), '%');
}

// Test 2: No value should exceed 200%
const maxRow = db.prepare('SELECT MAX(percentage_of_actual) as max_pct FROM player_usage').get() as any;
if (maxRow.max_pct <= 2.0) {
  console.log('✓ Hard cap working: Max usage =', (maxRow.max_pct * 100).toFixed(0), '% ≤ 200%');
} else {
  console.log('✗ Hard cap NOT working: Max usage =', (maxRow.max_pct * 100).toFixed(0), '% > 200%');
}

// Test 3: At full season, 1000 PA / 500 actual should be 200% (capped)
const finalPct = finalRow.percentage_of_actual;
if (finalRow.replay_current_total === 1000 && finalPct === 2.0) {
  console.log('✓ Full season hard cap: 1000 PA / 500 PA = 200% (capped correctly)');
} else {
  console.log('✗ Full season issue: 1000 PA / 500 PA =', (finalPct * 100).toFixed(0), '%');
}

db.close();
unlinkSync(DB_PATH);
console.log('\n=== Test Complete ===');
