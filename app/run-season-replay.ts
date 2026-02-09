#!/usr/bin/env tsx
/**
 * Standalone Node.js script to run a full season replay
 * Usage: npx tsx run-season-replay.ts <year>
 *
 * This script runs a complete season replay and outputs usage statistics,
 * making it much faster to debug and test changes without using the browser.
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, unlinkSync, readFileSync, writeFileSync } from 'fs';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const YEAR = parseInt(process.argv[2]) || 1976;
const SEASON_FILE = join(__dirname, `static/seasons/${YEAR}.sqlite`);
const RESULTS_DB = join(__dirname, `../tmp/replay-${YEAR}-${Date.now()}.sqlite`);

console.log(`= Season Replay Script for ${YEAR} =`);
console.log(`Season file: ${SEASON_FILE}`);
console.log(`Results DB: ${RESULTS_DB}`);

// Type definitions for the season database
interface ScheduledGame {
  id: string;
  date: string;
  awayTeam: string;
  homeTeam: string;
}

interface BatterStats {
  id: string;
  name: string;
  bats: 'L' | 'R' | 'S';
  teamId: string;
  primaryPosition: number;
  positionEligibility: Record<number, number>;
  pa: number;
  avg: number;
  obp: number;
  slg: number;
  ops: number;
}

interface PitcherStats {
  id: string;
  name: string;
  throws: 'L' | 'R';
  teamId: string;
  primaryPosition: number;
  positionEligibility: Record<number, number>;
  inningsPitched: number;
  era: number;
  whip: number;
  games: number;
  gamesStarted: number;
  saves: number;
  completeGames: number;
}

// Simple in-memory season data structure
class SeasonData {
  batters: Record<string, BatterStats> = {};
  pitchers: Record<string, PitcherStats> = {};
  teams: Record<string, { league: string }> = {};
}

/**
 * Load season data from SQLite database
 */
async function loadSeasonData(year: number): Promise<SeasonData> {
  console.log(`\n[1/5] Loading ${year} season data...`);

  const seasonDb = new Database(SEASON_FILE, { readonly: true });
  const season = new SeasonData();

  // Load batters
  const batterStmt = seasonDb.prepare(`
    SELECT
      id, name, bats, team_id as teamId,
      primary_position as primaryPosition,
      position_eligibility as positionEligibility,
      pa, avg, obp, slg, ops
    FROM batters
    WHERE pa >= 20
  `);

  const batterRows = batterStmt.all() as any[];
  for (const row of batterRows) {
    season.batters[row.id] = {
      id: row.id,
      name: row.name,
      bats: row.bats,
      teamId: row.teamId,
      primaryPosition: row.primaryPosition,
      positionEligibility: row.position_eligibility ? JSON.parse(row.position_eligibility) : {},
      pa: row.pa,
      avg: row.avg,
      obp: row.obp,
      slg: row.slg,
      ops: row.ops,
    };
  }
  // batterStmt automatically cleaned up
  console.log(`  Loaded ${Object.keys(season.batters).length} batters`);

  // Load pitchers
  const pitcherStmt = seasonDb.prepare(`
    SELECT
      id, name, throws, team_id as teamId,
      games, games_started as gamesStarted,
      saves, complete_games as completeGames,
      innings_pitched as inningsPitched,
      era, whip
    FROM pitchers
    WHERE innings_pitched >= 5
  `);

  const pitcherRows = pitcherStmt.all() as any[];
  for (const row of pitcherRows) {
    season.pitchers[row.id] = {
      id: row.id,
      name: row.name,
      throws: row.throws,
      teamId: row.teamId,
      primaryPosition: 1, // Pitcher
      positionEligibility: { 1: 1 },
      inningsPitched: row.innings_pitched,
      era: row.era,
      whip: row.whip,
      games: row.games,
      gamesStarted: row.games_started,
      saves: row.saves,
      completeGames: row.complete_games,
    };
  }
  // pitcherStmt automatically cleaned up
  console.log(`  Loaded ${Object.keys(season.pitchers).length} pitchers`);

  // Load teams
  const teamStmt = seasonDb.prepare('SELECT id, league FROM teams');
  const teamRows = teamStmt.all() as any[];
  for (const row of teamRows) {
    season.teams[row.id] = { league: row.league };
  }
  // teamStmt automatically cleaned up
  console.log(`  Loaded ${Object.keys(season.teams).length} teams`);

  seasonDb.close();
  return season;
}

/**
 * Load schedule from season database
 */
async function loadSchedule(year: number): Promise<ScheduledGame[]> {
  console.log(`\n[2/5] Loading ${year} schedule...`);

  const seasonDb = new Database(SEASON_FILE, { readonly: true });
  const stmt = seasonDb.prepare(`
    SELECT
      id, date, away_team as awayTeam, home_team as homeTeam
    FROM games
    ORDER BY id
  `);

  const games = stmt.all() as any[];
  // stmt automatically cleaned up
  seasonDb.close();

  console.log(`  Loaded ${games.length} games`);
  return games;
}

/**
 * Initialize the results database with usage tracking tables
 */
function initializeResultsDatabase(dbPath: string): Database {
  console.log(`\n[3/5] Initializing results database...`);

  // Delete existing database if it exists
  if (existsSync(dbPath)) {
    unlinkSync(dbPath);
  }

  const db = new Database(dbPath);

  // Create tables
  db.exec(`
    CREATE TABLE games (
      id TEXT PRIMARY KEY,
      series_id TEXT NOT NULL,
      date TEXT NOT NULL,
      away_team TEXT NOT NULL,
      home_team TEXT NOT NULL,
      away_score INTEGER,
      home_score INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

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

    CREATE TABLE series_metadata (
      series_id TEXT PRIMARY KEY,
      season_year INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX idx_player_usage_team ON player_usage(team_id);
    CREATE INDEX idx_player_usage_series ON player_usage(series_id);
  `);

  console.log(`  Database initialized at ${dbPath}`);
  return db;
}

/**
 * Seed usage targets from season data
 */
function seedUsageTargets(
  db: Database,
  seriesId: string,
  batters: Record<string, BatterStats>,
  pitchers: Record<string, PitcherStats>
): void {
  console.log(`\n[4/5] Seeding usage targets...`);

  const MIN_BATTER_THRESHOLD = 20;
  const MIN_PITCHER_THRESHOLD = 5;

  // Insert batters
  const insertBatter = db.prepare(`
    INSERT INTO player_usage (
      series_id, player_id, team_id, is_pitcher,
      actual_season_total, games_played_actual,
      percentage_of_actual, status
    ) VALUES (?, ?, ?, ?, ?, ?, 0, 'inRange')
  `);

  let batterCount = 0;
  for (const [id, batter] of Object.entries(batters)) {
    if (batter.pa >= MIN_BATTER_THRESHOLD) {
      insertBatter.run([
        seriesId,
        id,
        batter.teamId,
        0, // is_pitcher = false
        batter.pa,
        Math.max(1, 1), // games_played_actual (placeholder)
      ]);
      batterCount++;
    }
  }
  console.log(`  Seeded ${batterCount} batters`);

  // Insert pitchers
  const insertPitcher = db.prepare(`
    INSERT INTO player_usage (
      series_id, player_id, team_id, is_pitcher,
      actual_season_total, games_played_actual,
      percentage_of_actual, status
    ) VALUES (?, ?, ?, ?, ?, ?, 0, 'inRange')
  `);

  let pitcherCount = 0;
  for (const [id, pitcher] of Object.entries(pitchers)) {
    const ip = pitcher.inningsPitched || 0;
    if (ip >= MIN_PITCHER_THRESHOLD) {
      insertPitcher.run([
        seriesId,
        id,
        pitcher.teamId,
        1, // is_pitcher = true
        ip * 3, // Convert IP to outs
        Math.max(1, pitcher.games || 1),
      ]);
      pitcherCount++;
    }
  }
  console.log(`  Seeded ${pitcherCount} pitchers`);

  // insertBatter automatically cleaned up
  // insertPitcher automatically cleaned up
}

/**
 * Simulate a game (simplified - just track PA distribution)
 */
function simulateGame(
  db: Database,
  seriesId: string,
  game: ScheduledGame,
  season: SeasonData
): void {
  const seasonLength = 162; // For 1976

  // Get team games played so far - use MAX of replay_games_played
  // Any player who appeared in a game will have replay_games_played incremented
  const teamGamesStmt = db.prepare(`
    SELECT MAX(replay_games_played) as games_played
    FROM player_usage
    WHERE series_id = ? AND team_id = ?
  `);

  // Get away team games
  const awayRow = teamGamesStmt.get(seriesId, game.awayTeam) as { games_played: number } | undefined;
  let awayGames = awayRow?.games_played || 0;

  // Get home team games
  const homeRow = teamGamesStmt.get(seriesId, game.homeTeam) as { games_played: number } | undefined;
  let homeGames = homeRow?.games_played || 0;

  // Increment games for both teams
  const newAwayGames = awayGames + 1;
  const newHomeGames = homeGames + 1;

  // Simulate PA for each batter on both teams (simplified - assume ~38 PA per team)
  const PA_PER_GAME = 38;

  // Get batters for each team
  const awayBatters = Object.values(season.batters).filter(b => b.teamId === game.awayTeam && b.primaryPosition !== 1);
  const homeBatters = Object.values(season.batters).filter(b => b.teamId === game.homeTeam && b.primaryPosition !== 1);

  // Assign PA to ~9 batters per game (simulating a lineup)
  // Better players (more actual PA) are more likely to be selected
  const assignPA = (batters: BatterStats[]) => {
    // Sort by PA (descending) - better players get priority
    const sorted = [...batters].sort((a, b) => b.pa - a.pa);
    const totalPA = sorted.reduce((sum, b) => sum + b.pa, 0);

    // Select top batters weighted by their actual PA contribution
    // This simulates "better players play more often"
    const LINEUP_SIZE = 9;
    const selectedBatters: Array<{ id: string; weight: number; pa: number }> = [];

    // Weighted random selection - batters with more actual PA have higher chance
    const available = [...sorted];
    for (let i = 0; i < Math.min(LINEUP_SIZE, available.length); i++) {
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
      selectedBatters.push({ id: selected.id, weight: selected.pa, pa: selected.pa });
    }

    // Distribute 38 PA among selected batters (4-5 PA each)
    const paDistribution: Record<string, number> = {};
    let remainingPA = PA_PER_GAME;

    for (const batter of selectedBatters) {
      // Give 4-5 PA per batter, weighted by quality
      const pa = Math.min(remainingPA, Math.floor(Math.random() * 2) + 3); // 3-4 PA
      paDistribution[batter.id] = pa;
      remainingPA -= pa;
    }

    // Distribute remaining PA
    let fillIndex = 0;
    while (remainingPA > 0 && fillIndex < selectedBatters.length) {
      const pa = Math.min(remainingPA, 2);
      paDistribution[selectedBatters[fillIndex].id] += pa;
      remainingPA -= pa;
      fillIndex++;
    }

    return paDistribution;
  };

  const awayPA = assignPA(awayBatters);
  const homePA = assignPA(homeBatters);

  // Update usage for away team
  const updateAway = db.prepare(`
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

  for (const [playerId, pa] of Object.entries(awayPA)) {
    updateAway.run([pa, pa, newAwayGames, seasonLength, pa, newAwayGames, seasonLength, pa, newAwayGames, seasonLength, seriesId, playerId]);
  }
  // updateAway automatically cleaned up

  // Update usage for home team
  const updateHome = db.prepare(`
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

  for (const [playerId, pa] of Object.entries(homePA)) {
    updateHome.run([pa, pa, newHomeGames, seasonLength, pa, newHomeGames, seasonLength, pa, newHomeGames, seasonLength, seriesId, playerId]);
  }
  // updateHome automatically cleaned up
}

/**
 * Run the full season replay
 */
async function runSeasonReplay(year: number): Promise<void> {
  const startTime = Date.now();

  // Load season data
  const season = await loadSeasonData(year);
  const schedule = await loadSchedule(year);

  // Initialize results database
  const db = initializeResultsDatabase(RESULTS_DB);
  const seriesId = `test-${year}-${Date.now()}`;

  // Seed usage targets
  seedUsageTargets(db, seriesId, season.batters, season.pitchers);

  // Run all games
  console.log(`\n[5/5] Running ${schedule.length} games...`);

  for (let i = 0; i < schedule.length; i++) {
    if (i % 100 === 0) {
      console.log(`  Progress: ${i}/${schedule.length} games (${((i / schedule.length) * 100).toFixed(1)}%)`);
    }

    simulateGame(db, seriesId, schedule[i], season);
  }

  console.log(`  Completed ${schedule.length} games`);

  // Output results
  console.log(`\n=== Results ===`);
  console.log(`Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  const reportStmt = db.prepare(`
    SELECT
      pu.player_id,
      pu.team_id,
      pu.actual_season_total,
      pu.replay_current_total,
      pu.percentage_of_actual,
      pu.status
    FROM player_usage pu
    WHERE pu.is_pitcher = 0
    ORDER BY pu.percentage_of_actual DESC
  `);

  const reportRows = reportStmt.all() as any[];

  console.log(`\nTop 20 most overused batters:`);
  console.log(`Player ID\t\tTeam\tActual\tReplay\t%\tStatus`);
  console.log(`-`.repeat(70));

  let count = 0;
  let over125Count = 0;
  let zeroUsageCount = 0;

  for (const row of reportRows.slice(0, 100)) {
    count++;

    if (row.percentage_of_actual > 1.25) over125Count++;
    if (row.replay_current_total === 0) zeroUsageCount++;

    if (count <= 20) {
      console.log(
        `${row.player_id}\t${row.team_id}\t${Math.round(row.actual_season_total)}\t${Math.round(row.replay_current_total)}\t${(row.percentage_of_actual * 100).toFixed(0)}%\t${row.status}`
      );
    }
  }
  // reportStmt automatically cleaned up

  console.log(`\nSummary:`);
  console.log(`  Total batters: ${count}`);
  console.log(`  Over 125%: ${over125Count}`);
  console.log(`  Zero usage: ${zeroUsageCount}`);

  // Check specific problematic players
  const checkPlayer = db.prepare(`
    SELECT * FROM player_usage
    WHERE player_id IN ('lis-j101', 'faheb101', 'tabbj101')
  `);

  const checkRows = checkPlayer.all() as any[];

  console.log(`\nSpecific players check:`);
  console.log(`Player ID\t\tActual\tReplay\t%\tStatus`);
  console.log(`-`.repeat(50));
  for (const row of checkRows) {
    console.log(
      `${row.player_id}\t${Math.round(row.actual_season_total)}\t${Math.round(row.replay_current_total)}\t${(row.percentage_of_actual * 100).toFixed(0)}%\t${row.status}`
    );
  }
  // checkPlayer automatically cleaned up

  db.close();
  console.log(`\nResults saved to: ${RESULTS_DB}`);
}

// Run the script
runSeasonReplay(YEAR).catch(console.error);
