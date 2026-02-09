#!/usr/bin/env tsx
/**
 * Quick test of the usage tracking - run 100 games and check Joe Lis
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, unlinkSync } from 'fs';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const YEAR = 1976;
const SEASON_FILE = join(__dirname, `static/seasons/${YEAR}.sqlite`);
const RESULTS_DB = join(__dirname, `../tmp/quick-test-${Date.now()}.sqlite`);

console.log(`= Quick Usage Test for ${YEAR} =`);

// Simple test: simulate PA distribution
interface BatterStats {
  id: string;
  name: string;
  teamId: string;
  pa: number;
}

class SeasonData {
  batters: Record<string, BatterStats> = {};
}

async function loadSeasonData(year: number): Promise<SeasonData> {
  const seasonDb = new Database(SEASON_FILE, { readonly: true });
  const season = new SeasonData();

  const batterStmt = seasonDb.prepare(`
    SELECT id, name, team_id as teamId, pa
    FROM batters
    WHERE pa >= 20
  `);

  const batterRows = batterStmt.all() as any[];
  for (const row of batterRows) {
    season.batters[row.id] = {
      id: row.id,
      name: row.name,
      teamId: row.teamId,
      pa: row.pa
    };
  }

  console.log(`Loaded ${Object.keys(season.batters).length} batters`);
  seasonDb.close();
  return season;
}

function initializeResultsDatabase(dbPath: string): Database {
  if (existsSync(dbPath)) {
    unlinkSync(dbPath);
  }

  const db = new Database(dbPath);
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
  `);
  return db;
}

function seedUsageTargets(
  db: Database,
  seriesId: string,
  batters: Record<string, BatterStats>
): void {
  const insertBatter = db.prepare(`
    INSERT INTO player_usage (
      series_id, player_id, team_id, is_pitcher,
      actual_season_total, games_played_actual,
      percentage_of_actual, status
    ) VALUES (?, ?, ?, ?, ?, ?, 0, 'inRange')
  `);

  for (const [id, batter] of Object.entries(batters)) {
    if (batter.pa >= 20) {
      insertBatter.run([seriesId, id, batter.teamId, 0, batter.pa, 1]);
    }
  }
  console.log(`Seeded ${Object.keys(batters).length} batters`);
}

/**
 * Simulate games using INNINGS-WEIGHTED position selection
 * This is the NEW approach we implemented
 */
function simulateGames(
  db: Database,
  seriesId: string,
  season: SeasonData,
  numGames: number
): void {
  const seasonLength = 162;
  const PA_PER_GAME = 38;

  // For each team
  const teams = [...new Set(Object.values(season.batters).map(b => b.teamId))];

  for (let gameNum = 0; gameNum < numGames; gameNum++) {
    for (const teamId of teams) {
      const teamBatters = Object.values(season.batters).filter(b => b.teamId === teamId);

      // NEW APPROACH: Innings-weighted selection
      // Each player's probability = their PA / total team PA
      const totalTeamPA = teamBatters.reduce((sum, b) => sum + b.pa, 0);

      // Select 9 batters using weighted random
      const selectedBatters: BatterStats[] = [];
      const available = [...teamBatters];

      for (let i = 0; i < Math.min(9, available.length); i++) {
        const weights = available.map(b => b.pa);
        const totalWeight = weights.reduce((sum, w) => sum + w, 0);
        let random = Math.random() * totalWeight;
        let selectedIndex = 0;

        for (let j = 0; j < weights.length; j++) {
          random -= weights[j];
          if (random <= 0) {
            selectedIndex = j;
            break;
          }
        }

        const selected = available.splice(selectedIndex, 1)[0];
        selectedBatters.push(selected);
      }

      // Distribute PA
      const paDistribution: Record<string, number> = {};
      let remainingPA = PA_PER_GAME;

      for (const batter of selectedBatters) {
        const pa = Math.min(remainingPA, Math.floor(Math.random() * 2) + 3);
        paDistribution[batter.id] = pa;
        remainingPA -= pa;
      }

      // Update usage
      const updateStmt = db.prepare(`
        UPDATE player_usage
        SET replay_current_total = replay_current_total + ?,
            replay_games_played = replay_games_played + 1,
            percentage_of_actual = CAST(replay_current_total + ? AS REAL) / NULLIF(actual_season_total * CAST(? AS REAL) / ?, 0),
            status = CASE
              WHEN CAST(replay_current_total + ? AS REAL) / NULLIF(actual_season_total * CAST(? AS REAL) / ?, 0) < 0.75 THEN 'under'
              WHEN CAST(replay_current_total + ? AS REAL) / NULLIF(actual_season_total * CAST(? AS REAL) / ?, 0) > 1.25 THEN 'over'
              ELSE 'inRange'
            END
        WHERE series_id = ? AND player_id = ?
      `);

      for (const [playerId, pa] of Object.entries(paDistribution)) {
        updateStmt.run([pa, pa, gameNum + 1, seasonLength, pa, gameNum + 1, seasonLength, pa, gameNum + 1, seasonLength, seriesId, playerId]);
      }
    }
  }
}

async function runTest(): Promise<void> {
  const startTime = Date.now();
  const season = await loadSeasonData(YEAR);
  const db = initializeResultsDatabase(RESULTS_DB);
  const seriesId = `test-${YEAR}-${Date.now()}`;

  seedUsageTargets(db, seriesId, season.batters);

  console.log(`\nRunning 162 games with INNINGS-WEIGHTED selection...`);
  simulateGames(db, seriesId, season, 162);

  console.log(`Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s\n`);

  // Check Joe Lis
  const lisStmt = db.prepare('SELECT * FROM player_usage WHERE player_id = ?');
  const lis = lisStmt.get('lis-j101');

  console.log('=== Joe Lis (lis-j101) ===');
  if (lis) {
    console.log(`Actual PA: ${Math.round(lis.actual_season_total)}`);
    console.log(`Replay PA: ${Math.round(lis.replay_current_total)}`);
    console.log(`Usage: ${(lis.percentage_of_actual * 100).toFixed(0)}%`);
  } else {
    console.log('Not found');
  }

  // Top overused
  const topStmt = db.prepare('SELECT player_id, actual_season_total, replay_current_total, percentage_of_actual FROM player_usage WHERE is_pitcher = 0 ORDER BY percentage_of_actual DESC LIMIT 10');
  const top = topStmt.all();

  console.log('\n=== Top 10 Most Overused ===');
  for (const row of top) {
    console.log(`${row.player_id}: ${Math.round(row.replay_current_total)} / ${Math.round(row.actual_season_total)} = ${(row.percentage_of_actual * 100).toFixed(0)}%`);
  }

  db.close();
  console.log(`\nResults saved to: ${RESULTS_DB}`);
}

runTest().catch(console.error);
