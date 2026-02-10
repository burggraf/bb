#!/usr/bin/env tsx
/**
 * Full season replay using the actual GameEngine
 * This runs the real game simulation in Node.js using SQLite instead of IndexedDB
 *
 * Usage: npx tsx run-season-replay.ts <year>
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import Database from 'better-sqlite3';
import type { Database as SQLiteDatabase } from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const YEAR = parseInt(process.argv[2]) || 1976;
const SEASON_FILE = join(__dirname, `static/seasons/${YEAR}.sqlite`);
const TMP_DIR = join(__dirname, '../tmp');
const RESULTS_DB = join(TMP_DIR, `replay-${YEAR}-${Date.now()}.sqlite`);

// Ensure tmp directory exists
if (!existsSync(TMP_DIR)) {
  mkdirSync(TMP_DIR, { recursive: true });
}

console.log(`= Full Season Replay with GameEngine for ${YEAR} =`);
console.log(`Season file: ${SEASON_FILE}`);
console.log(`Results DB: ${RESULTS_DB}`);

// Type definitions
interface ScheduledGame {
  id: string;
  date: string;
  awayTeam: string;
  homeTeam: string;
}

interface SeasonPackage {
  meta: { year: number; version: string };
  teams: Record<string, { league: string; city: string; nickname: string }>;
  batters: Record<string, any>;
  pitchers: Record<string, any>;
  league: {
    vsLHP: any;
    vsRHP: any;
    pitcherBatter: { vsLHP: any; vsRHP: any };
  };
  norms: {
    substitutions: { pinchHitsPerGame: number };
    pitching?: any;
  };
}

// Global database reference for the mock
let globalResultsDb: SQLiteDatabase | null = null;

/**
 * Create a mock for the game-results database module
 * This replaces IndexedDB with SQLite
 */
function createMockGameDatabase(dbPath: string) {
  const db = new Database(dbPath);

  // Initialize schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS series (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      series_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      status TEXT NOT NULL,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS series_teams (
      series_id TEXT NOT NULL,
      team_id TEXT NOT NULL,
      season_year INTEGER NOT NULL,
      league TEXT,
      division TEXT,
      PRIMARY KEY (series_id, team_id)
    );

    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      series_id TEXT NOT NULL,
      game_number INTEGER NOT NULL,
      date TEXT NOT NULL,
      away_team TEXT NOT NULL,
      home_team TEXT NOT NULL,
      away_score INTEGER,
      home_score INTEGER,
      metadata TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS game_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      inning INTEGER NOT NULL,
      is_top_inning INTEGER NOT NULL,
      outcome TEXT,
      batter_id TEXT,
      batter_name TEXT,
      pitcher_id TEXT,
      pitcher_name TEXT,
      description TEXT,
      runs_scored INTEGER DEFAULT 0,
      event_type TEXT,
      substituted_player TEXT,
      is_summary INTEGER DEFAULT 0,
      lineup TEXT
    );

    CREATE TABLE IF NOT EXISTS player_usage (
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

    CREATE INDEX IF NOT EXISTS idx_games_series ON games(series_id);
    CREATE INDEX IF NOT EXISTS idx_events_game ON game_events(game_id);
    CREATE INDEX IF NOT EXISTS idx_player_usage_series ON player_usage(series_id);
    CREATE INDEX IF NOT EXISTS idx_player_usage_team ON player_usage(team_id);
  `);

  return db;
}

/**
 * Load season data from SQLite database in the format expected by GameEngine
 */
async function loadSeasonData(year: number): Promise<SeasonPackage> {
  console.log(`\n[1/4] Loading ${year} season data...`);

  const seasonDb = new Database(SEASON_FILE, { readonly: true });

  const season: any = {
    meta: { year, version: '1.0' },
    teams: {},
    batters: {},
    pitchers: {},
    league: {
      vsLHP: null as any,
      vsRHP: null as any,
      pitcherBatter: { vsLHP: null as any, vsRHP: null as any }
    },
    norms: { substitutions: { pinchHitsPerGame: 2.5 } }
  };

  // Load teams
  const teamRows = seasonDb.prepare('SELECT id, league, city, nickname FROM teams').all() as any[];
  for (const row of teamRows) {
    season.teams[row.id] = {
      league: row.league,
      city: row.city || row.id,
      nickname: row.nickname || row.id
    };
  }
  console.log(`  Loaded ${Object.keys(season.teams).length} teams`);

  // Load batters
  const batterStmt = seasonDb.prepare(`
    SELECT id, name, bats, team_id as teamId,
           primary_position as primaryPosition,
           position_eligibility as positionEligibility,
           pa, avg, obp, slg, ops
    FROM batters WHERE pa >= 20
  `);

  const batterRows = batterStmt.all() as any[];

  // Load batter rates separately (all 17 outcomes)
  const batterRatesStmt = seasonDb.prepare(`
    SELECT batter_id, split, walk, single, double, triple, home_run, hit_by_pitch,
           strikeout, ground_out, fly_out, line_out, pop_out,
           sacrifice_fly, sacrifice_bunt, fielders_choice, reached_on_error, catcher_interference
    FROM batter_rates
  `);
  const batterRates = batterRatesStmt.all() as any[];
  const ratesByBatter = new Map<string, any>();
  for (const rate of batterRates) {
    if (!ratesByBatter.has(rate.batter_id)) {
      ratesByBatter.set(rate.batter_id, {});
    }
    const splitKey = rate.split === 'vsLHP' ? 'vsLHP' : 'vsRHP';
    ratesByBatter.get(rate.batter_id)[splitKey] = {
      walk: rate.walk,
      single: rate.single,
      double: rate.double,
      triple: rate.triple,
      homeRun: rate.home_run,
      hitByPitch: rate.hit_by_pitch,
      strikeout: rate.strikeout,
      groundOut: rate.ground_out,
      flyOut: rate.fly_out,
      lineOut: rate.line_out,
      popOut: rate.pop_out,
      sacrificeFly: rate.sacrifice_fly,
      sacrificeBunt: rate.sacrifice_bunt,
      fieldersChoice: rate.fielders_choice,
      reachedOnError: rate.reached_on_error,
      catcherInterference: rate.catcher_interference
    };
  }

  const defaultRates = {
    walk: 0, single: 0, double: 0, triple: 0, homeRun: 0, hitByPitch: 0,
    strikeout: 0, groundOut: 0, flyOut: 0, lineOut: 0, popOut: 0,
    sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0
  };

  for (const row of batterRows) {
    const rates = ratesByBatter.get(row.id) || { vsLHP: {}, vsRHP: {} };
    season.batters[row.id] = {
      id: row.id,
      name: row.name,
      bats: row.bats,
      teamId: row.teamId,
      primaryPosition: row.primaryPosition,
      positionEligibility: row.positionEligibility ? JSON.parse(row.positionEligibility) : {},
      pa: row.pa,
      avg: row.avg,
      obp: row.obp,
      slg: row.slg,
      ops: row.ops,
      rates: {
        vsLHP: rates.vsLHP || { ...defaultRates },
        vsRHP: rates.vsRHP || { ...defaultRates }
      }
    };
  }
  console.log(`  Loaded ${Object.keys(season.batters).length} batters`);

  // Load pitchers
  const pitcherStmt = seasonDb.prepare(`
    SELECT id, name, throws, team_id as teamId,
           games, games_started as gamesStarted, saves,
           complete_games as completeGames, innings_pitched as inningsPitched,
           era, whip, avg_bfp_as_starter as avgBfpAsStarter,
           avg_bfp_as_reliever as avgBfpAsReliever
    FROM pitchers WHERE innings_pitched >= 5
  `);

  const pitcherRows = pitcherStmt.all() as any[];

  // Load pitcher rates separately (all 17 outcomes)
  const pitcherRatesStmt = seasonDb.prepare(`
    SELECT pitcher_id, split, walk, single, double, triple, home_run, hit_by_pitch,
           strikeout, ground_out, fly_out, line_out, pop_out,
           sacrifice_fly, sacrifice_bunt, fielders_choice, reached_on_error, catcher_interference
    FROM pitcher_rates
  `);
  const pitcherRates = pitcherRatesStmt.all() as any[];
  const ratesByPitcher = new Map<string, any>();
  for (const rate of pitcherRates) {
    if (!ratesByPitcher.has(rate.pitcher_id)) {
      ratesByPitcher.set(rate.pitcher_id, {});
    }
    const splitKey = rate.split === 'vsLHB' ? 'vsLHB' : 'vsRHB';
    ratesByPitcher.get(rate.pitcher_id)[splitKey] = {
      walk: rate.walk,
      single: rate.single,
      double: rate.double,
      triple: rate.triple,
      homeRun: rate.home_run,
      hitByPitch: rate.hit_by_pitch,
      strikeout: rate.strikeout,
      groundOut: rate.ground_out,
      flyOut: rate.fly_out,
      lineOut: rate.line_out,
      popOut: rate.pop_out,
      sacrificeFly: rate.sacrifice_fly,
      sacrificeBunt: rate.sacrifice_bunt,
      fieldersChoice: rate.fielders_choice,
      reachedOnError: rate.reached_on_error,
      catcherInterference: rate.catcher_interference
    };
  }

  for (const row of pitcherRows) {
    const rates = ratesByPitcher.get(row.id) || { vsLHB: {}, vsRHB: {} };
    season.pitchers[row.id] = {
      id: row.id,
      name: row.name,
      throws: row.throws,
      teamId: row.teamId,
      primaryPosition: 1,
      positionEligibility: { 1: 1 },
      games: row.games,
      gamesStarted: row.gamesStarted,
      saves: row.saves,
      completeGames: row.completeGames,
      inningsPitched: row.inningsPitched,
      era: row.era,
      whip: row.whip,
      avgBfpAsStarter: row.avgBfpAsStarter,
      avgBfpAsReliever: row.avgBfpAsReliever,
      rates: {
        vsLHB: rates.vsLHB || { ...defaultRates },
        vsRHB: rates.vsRHB || { ...defaultRates }
      }
    };
  }
  console.log(`  Loaded ${Object.keys(season.pitchers).length} pitchers`);

  // Calculate league norms
  calculateLeagueNorms(season);

  // Calculate pitching norms
  const allPitchers = Object.values(season.pitchers);
  const starters = allPitchers.filter((p: any) => p.gamesStarted > 0);
  const relievers = allPitchers.filter((p: any) => p.games > p.gamesStarted);

  const avgStarterBFP = starters.length > 0
    ? starters.reduce((sum, p) => sum + (p.avgBfpAsStarter || 25), 0) / starters.length
    : 25;

  const avgRelieverBFP = relievers.length > 0
    ? relievers.reduce((sum, p) => sum + (p.avgBfpAsReliever || 4), 0) / relievers.length
    : 4;

  season.norms.pitching = {
    starterBFP: avgStarterBFP,
    relieverBFP: { early: avgRelieverBFP, middle: avgRelieverBFP, late: avgRelieverBFP },
    relieverBFPOverall: avgRelieverBFP,
    pullThresholds: { consider: 16, likely: 18, hardLimit: 21 }
  };

  seasonDb.close();
  return season;
}

function calculateLeagueNorms(season: any) {
  // Calculate average rates across all batters for league norms
  const allBatters = Object.values(season.batters);

  // Default 17-outcome rates structure
  const createEmptyRates = () => ({
    walk: 0, single: 0, double: 0, triple: 0, homeRun: 0, hitByPitch: 0,
    strikeout: 0, groundOut: 0, flyOut: 0, lineOut: 0, popOut: 0,
    sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0
  });

  // Calculate league average rates (average of all batters vs LHP/RHP)
  if (allBatters.length > 0) {
    const leagueRates = {
      vsLHP: createEmptyRates(),
      vsRHP: createEmptyRates()
    };

    for (const batter of allBatters) {
      if (batter?.rates?.vsLHP) {
        for (const key of Object.keys(leagueRates.vsLHP) as Array<keyof typeof leagueRates.vsLHP>) {
          leagueRates.vsLHP[key] += batter.rates.vsLHP[key] || 0;
          leagueRates.vsRHP[key] += batter.rates.vsRHP[key] || 0;
        }
      }
    }

    const count = allBatters.length;
    for (const key of Object.keys(leagueRates.vsLHP) as Array<keyof typeof leagueRates.vsLHP>) {
      leagueRates.vsLHP[key] /= count;
      leagueRates.vsRHP[key] /= count;
    }

    season.league.vsLHP = leagueRates.vsLHP;
    season.league.vsRHP = leagueRates.vsRHP;
    // Also set pitcherBatter for createAugmentedBattersRecord
    season.league.pitcherBatter = {
      vsLHP: leagueRates.vsLHP,
      vsRHP: leagueRates.vsRHP
    };
  }
}

/**
 * Load schedule from season database
 */
async function loadSchedule(year: number): Promise<ScheduledGame[]> {
  console.log(`\n[2/4] Loading ${year} schedule...`);

  const seasonDb = new Database(SEASON_FILE, { readonly: true });
  const stmt = seasonDb.prepare(`
    SELECT id, date, away_team as awayTeam, home_team as homeTeam
    FROM games ORDER BY date, id
  `);

  const games = stmt.all() as ScheduledGame[];
  seasonDb.close();

  console.log(`  Loaded ${games.length} games`);
  return games;
}

/**
 * Seed usage targets in the results database
 */
function seedUsageTargets(
  db: SQLiteDatabase,
  seriesId: string,
  season: SeasonPackage
): void {
  console.log(`\n[3/4] Seeding usage targets...`);

  const MIN_BATTER_THRESHOLD = 20;
  const MIN_PITCHER_THRESHOLD = 5;

  const insertBatter = db.prepare(`
    INSERT INTO player_usage (
      series_id, player_id, team_id, is_pitcher,
      actual_season_total, games_played_actual,
      percentage_of_actual, status
    ) VALUES (?, ?, ?, 0, ?, ?, 0, 'inRange')
  `);

  let batterCount = 0;
  for (const [id, batter] of Object.entries(season.batters)) {
    if (batter.pa >= MIN_BATTER_THRESHOLD) {
      insertBatter.run(seriesId, id, batter.teamId, batter.pa, 1);
      batterCount++;
    }
  }

  const insertPitcher = db.prepare(`
    INSERT INTO player_usage (
      series_id, player_id, team_id, is_pitcher,
      actual_season_total, games_played_actual,
      percentage_of_actual, status
    ) VALUES (?, ?, ?, 1, ?, ?, 0, 'inRange')
  `);

  let pitcherCount = 0;
  for (const [id, pitcher] of Object.entries(season.pitchers)) {
    if (pitcher.inningsPitched >= MIN_PITCHER_THRESHOLD) {
      insertPitcher.run(seriesId, id, pitcher.teamId, pitcher.inningsPitched * 3, pitcher.games || 1);
      pitcherCount++;
    }
  }

  console.log(`  Seeded ${batterCount} batters, ${pitcherCount} pitchers`);
}

/**
 * Run the full season replay using the actual GameEngine
 */
async function runFullReplay(): Promise<void> {
  const startTime = Date.now();

  // Load all season data
  const season = await loadSeasonData(YEAR);
  const schedule = await loadSchedule(YEAR);

  // Initialize results database
  if (existsSync(RESULTS_DB)) {
    unlinkSync(RESULTS_DB);
  }
  globalResultsDb = createMockGameDatabase(RESULTS_DB);
  const seriesId = `cli-replay-${YEAR}-${Date.now()}`;

  // Create series record
  const insertSeries = globalResultsDb.prepare(`
    INSERT INTO series (id, name, series_type, created_at, updated_at, status, metadata)
    VALUES (?, ?, ?, datetime('now'), datetime('now'), 'active', ?)
  `);
  insertSeries.run(
    seriesId,
    `${YEAR} CLI Replay`,
    'season_replay',
    JSON.stringify({ seasonReplay: { seasonYear: YEAR, totalGames: schedule.length } })
  );

  // Seed usage targets
  seedUsageTargets(globalResultsDb, seriesId, season);

  console.log(`\n[4/4] Running ${schedule.length} games with GameEngine...`);

  // Import GameEngine dynamically
  const { GameEngine } = await import('./src/lib/game/engine.js');

  // Track cumulative usage
  const playerUsage = new Map<string, number>();
  // Initialize all players with 100% usage (on pace)
  for (const player of Object.values(season.batters)) {
    playerUsage.set(player.id, 1.0);
  }
  for (const player of Object.values(season.pitchers)) {
    playerUsage.set(player.id, 1.0);
  }

  // Track games played per team
  const teamGamesPlayed = new Map<string, number>();
  for (const teamId of Object.keys(season.teams)) {
    teamGamesPlayed.set(teamId, 0);
  }

  let completedGames = 0;
  let errorGames = 0;

  for (let i = 0; i < schedule.length; i++) {
    const game = schedule[i];

    if (i % 50 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = i / elapsed;
      const eta = (schedule.length - i) / rate;
      console.log(`  Progress: ${i}/${schedule.length} (${((i/schedule.length)*100).toFixed(1)}%) - ${completedGames} completed, ${errorGames} errors - ETA: ${(eta/60).toFixed(1)}min`);
    }

    try {
      // Get current usage for both teams
      const awayUsage = new Map<string, number>();
      const homeUsage = new Map<string, number>();

      // Filter usage to relevant teams
      for (const [playerId, usage] of playerUsage) {
        const player = season.batters[playerId] || season.pitchers[playerId];
        if (player) {
          if (player.teamId === game.awayTeam) {
            awayUsage.set(playerId, usage);
          } else if (player.teamId === game.homeTeam) {
            homeUsage.set(playerId, usage);
          }
        }
      }

      // Create GameEngine with usage context
      const managerial = {
        enabled: true,
        randomness: 0.1,
        pitcherUsage: playerUsage,
        restThreshold: 1.25
      };

      const engine = (GameEngine as any).create(
        season,
        game.awayTeam,
        game.homeTeam,
        managerial,
        { playerUsage: awayUsage },
        { playerUsage: homeUsage }
      );

      // Simulate the game
      let paCount = 0;
      const maxPAs = 500;

      while (!engine.isComplete() && paCount < maxPAs) {
        engine.simulatePlateAppearance();
        paCount++;
      }

      if (paCount >= maxPAs) {
        console.warn(`    Game ${i + 1} (${game.awayTeam} vs ${game.homeTeam}) exceeded ${maxPAs} PAs`);
      }

      const finalState = engine.getState();

      // Calculate scores by summing runsScored on individual plays
      // Note: state.plays is in reverse order (newest first)
      const awayScore = finalState.plays
        .filter((p: any) => p.isTopInning && !p.isSummary && p.eventType === 'plateAppearance')
        .reduce((sum: number, p: any) => sum + (p.runsScored || 0), 0);
      const homeScore = finalState.plays
        .filter((p: any) => !p.isTopInning && !p.isSummary && p.eventType === 'plateAppearance')
        .reduce((sum: number, p: any) => sum + (p.runsScored || 0), 0);

      // Save game to database
      const gameId = `${seriesId}-game-${i + 1}`;
      const insertGame = globalResultsDb.prepare(`
        INSERT INTO games (id, series_id, game_number, date, away_team, home_team, away_score, home_score)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertGame.run(gameId, seriesId, i + 1, game.date, game.awayTeam, game.homeTeam, awayScore, homeScore);

      // Update team games played BEFORE calculating usage
      teamGamesPlayed.set(game.awayTeam, (teamGamesPlayed.get(game.awayTeam) || 0) + 1);
      teamGamesPlayed.set(game.homeTeam, (teamGamesPlayed.get(game.homeTeam) || 0) + 1);

      // Extract and update batter PA
      const batterPa = new Map<string, number>();
      for (const play of finalState.plays) {
        // Count any play with a batterId that isn't a summary as a PA
        if (play.batterId && !play.isSummary) {
          batterPa.set(play.batterId, (batterPa.get(play.batterId) || 0) + 1);
        }
      }

      // Update usage tracking for ALL players on both teams
      const seasonLength = YEAR < 1962 ? 154 : 162;
      const participatingTeams = [game.awayTeam, game.homeTeam];

      const getCurrentStmt = globalResultsDb.prepare(
        'SELECT replay_current_total, replay_games_played FROM player_usage WHERE series_id = ? AND player_id = ?'
      );
      const updateUsageStmt = globalResultsDb.prepare(`
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
      `);

      for (const teamId of participatingTeams) {
        // Find all batters on this team
        const teamBatters = Object.values(season.batters).filter((b: any) => b.teamId === teamId);

        for (const batter of teamBatters) {
          const playerId = batter.id;
          const paInThisGame = batterPa.get(playerId) || 0;

          const currentRow = getCurrentStmt.get(seriesId, playerId) as any;
          if (!currentRow) continue;

          const newTotalPA = (currentRow.replay_current_total || 0) + paInThisGame;
          const newGamesPlayed = (currentRow.replay_games_played || 0) + (paInThisGame > 0 ? 1 : 0);

          const teamGames = teamGamesPlayed.get(teamId) || 1;
          const prorationFactor = Math.min(1, teamGames / seasonLength);
          const rawExpectedPA = batter.pa * prorationFactor;
          const minExpectedPA = Math.min(batter.pa, Math.max(10, batter.pa * 0.1));
          const expectedPA = Math.max(rawExpectedPA, minExpectedPA);
          const usagePercentage = expectedPA > 0 ? newTotalPA / expectedPA : 0;

          playerUsage.set(playerId, usagePercentage);
          updateUsageStmt.run(newTotalPA, newGamesPlayed, usagePercentage, usagePercentage, usagePercentage, seriesId, playerId);
        }
      }

      completedGames++;

    } catch (error) {
      errorGames++;
      if (errorGames <= 10) {
        console.warn(`    Error in game ${i + 1} (${game.awayTeam} vs ${game.homeTeam}):`, error);
        if (error instanceof Error && error.stack) {
          console.warn(`    Stack:`, error.stack.split('\n').slice(0, 3).join('\n'));
        }
      }
    }
  }

  console.log(`\n  Completed ${completedGames} games (${errorGames} errors)`);

  // Output results
  console.log(`\n=== Results ===`);
  console.log(`Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log(`Games/sec: ${(completedGames / ((Date.now() - startTime) / 1000)).toFixed(2)}`);

  // Query results - Batters
  const reportQuery = globalResultsDb.prepare(`
    SELECT player_id, team_id, actual_season_total, replay_current_total,
           (replay_current_total / actual_season_total) as final_percentage,
           status
    FROM player_usage
    WHERE is_pitcher = 0
    ORDER BY final_percentage DESC
    LIMIT 15
  `);

  const rows = reportQuery.all() as any[];

  console.log(`\nTop 15 most overused batters (Final Replay vs Actual Season):`);
  console.log(`Player ID\t\tTeam\tActual\tReplay\t%\tStatus`);
  console.log(`-`.repeat(70));

  for (const row of rows) {
    console.log(
      `${row.player_id.padEnd(16)}\t${row.team_id}\t${Math.round(row.actual_season_total)}\t${Math.round(row.replay_current_total)}\t${(row.final_percentage * 100).toFixed(0)}%\t${row.status}`
    );
  }

  // Query results - Pitchers
  const pitcherReportQuery = globalResultsDb.prepare(`
    SELECT player_id, team_id, actual_season_total, replay_current_total,
           (replay_current_total / actual_season_total) as final_percentage,
           status
    FROM player_usage
    WHERE is_pitcher = 1
    ORDER BY final_percentage DESC
    LIMIT 15
  `);

  const pitcherRows = pitcherReportQuery.all() as any[];

  console.log(`\nTop 15 most overused pitchers (Final Replay vs Actual Season):`);
  console.log(`Player ID\t\tTeam\tActual\tReplay\t%\tStatus`);
  console.log(`-`.repeat(70));

  for (const row of pitcherRows) {
    console.log(
      `${row.player_id.padEnd(16)}\t${row.team_id}\t${Math.round(row.actual_season_total)}\t${Math.round(row.replay_current_total)}\t${(row.final_percentage * 100).toFixed(0)}%\t${row.status}`
    );
  }

  // Summary
  const summaryQuery = globalResultsDb.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN (replay_current_total / actual_season_total) > 1.25 THEN 1 ELSE 0 END) as over,
      SUM(CASE WHEN (replay_current_total / actual_season_total) < 0.75 THEN 1 ELSE 0 END) as under,
      SUM(CASE WHEN (replay_current_total / actual_season_total) BETWEEN 0.75 AND 1.25 THEN 1 ELSE 0 END) as inrange
    FROM player_usage
    WHERE is_pitcher = 0
  `);
  const summary = summaryQuery.get() as any;

  console.log(`\nSummary:`);
  console.log(`  Total batters: ${summary.total}`);
  console.log(`  Over 125%: ${summary.over}`);
  console.log(`  Under 75%: ${summary.under}`);
  console.log(`  In range (75-125%): ${summary.inrange}`);
  
  // Standings
  reportStandings(globalResultsDb);
  
  globalResultsDb.close();
  console.log(`\nResults saved to: ${RESULTS_DB}`);
}

/**
 * Report final team standings
 */
function reportStandings(db: SQLiteDatabase): void {
  const standingsQuery = db.prepare(`
    WITH team_results AS (
      SELECT away_team as team,
             (CASE WHEN away_score > home_score THEN 1 ELSE 0 END) as win,
             (CASE WHEN away_score < home_score THEN 1 ELSE 0 END) as loss
      FROM games
      UNION ALL
      SELECT home_team as team,
             (CASE WHEN home_score > away_score THEN 1 ELSE 0 END) as win,
             (CASE WHEN home_score < away_score THEN 1 ELSE 0 END) as loss
      FROM games
    )
    SELECT team, SUM(win) as W, SUM(loss) as L,
           CAST(SUM(win) AS REAL) / (SUM(win) + SUM(loss)) as win_pct
    FROM team_results
    GROUP BY team
    ORDER BY win_pct DESC, W DESC
  `);

  const rows = standingsQuery.all() as any[];

  console.log(`\nFinal Standings:`);
  console.log(`Team\tW\tL\tPct`);
  console.log(`-`.repeat(30));

  for (const row of rows) {
    console.log(`${row.team}\t${row.W}\t${row.L}\t${row.win_pct.toFixed(3)}`);
  }
}

// Run the replay
runFullReplay().catch(err => {
  console.error('Fatal error:', err);
  if (globalResultsDb) {
    globalResultsDb.close();
  }
  process.exit(1);
});
