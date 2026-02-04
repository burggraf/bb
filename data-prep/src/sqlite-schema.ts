import Database from 'better-sqlite3';
import type { EventRates } from '@bb/model';

/**
 * Create all tables for season SQLite database
 */
export function createSeasonSchema(db: Database.Database): void {
  db.exec(`
    -- Meta table
    CREATE TABLE IF NOT EXISTS meta (
      year INTEGER PRIMARY KEY,
      generated_at TEXT NOT NULL,
      version TEXT NOT NULL
    );

    -- Norms table (stored as JSON for simplicity)
    CREATE TABLE IF NOT EXISTS norms (
      year INTEGER PRIMARY KEY,
      era TEXT NOT NULL,
      norms_json TEXT NOT NULL
    );

    -- Batters table
    CREATE TABLE IF NOT EXISTS batters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      bats TEXT NOT NULL CHECK(bats IN ('L', 'R', 'S')),
      team_id TEXT NOT NULL,
      primary_position INTEGER NOT NULL,
      position_eligibility TEXT NOT NULL,
      pa INTEGER NOT NULL,
      avg REAL NOT NULL,
      obp REAL NOT NULL,
      slg REAL NOT NULL,
      ops REAL NOT NULL
    );

    -- Batter rates (17 outcomes × 2 splits)
    CREATE TABLE IF NOT EXISTS batter_rates (
      batter_id TEXT NOT NULL,
      split TEXT NOT NULL CHECK(split IN ('vsLHP', 'vsRHP')),
      single REAL NOT NULL,
      double REAL NOT NULL,
      triple REAL NOT NULL,
      home_run REAL NOT NULL,
      walk REAL NOT NULL,
      hit_by_pitch REAL NOT NULL,
      strikeout REAL NOT NULL,
      ground_out REAL NOT NULL,
      fly_out REAL NOT NULL,
      line_out REAL NOT NULL,
      pop_out REAL NOT NULL,
      sacrifice_fly REAL NOT NULL,
      sacrifice_bunt REAL NOT NULL,
      fielders_choice REAL NOT NULL,
      reached_on_error REAL NOT NULL,
      catcher_interference REAL NOT NULL,
      PRIMARY KEY (batter_id, split),
      FOREIGN KEY (batter_id) REFERENCES batters(id) ON DELETE CASCADE
    );

    -- Pitchers table
    CREATE TABLE IF NOT EXISTS pitchers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      throws TEXT NOT NULL CHECK(throws IN ('L', 'R')),
      team_id TEXT NOT NULL,
      avg_bfp_as_starter REAL,
      avg_bfp_as_reliever REAL,
      games INTEGER NOT NULL,
      games_started INTEGER NOT NULL,
      complete_games INTEGER NOT NULL,
      saves INTEGER NOT NULL,
      innings_pitched REAL NOT NULL,
      whip REAL NOT NULL,
      era REAL NOT NULL
    );

    -- Pitcher rates
    CREATE TABLE IF NOT EXISTS pitcher_rates (
      pitcher_id TEXT NOT NULL,
      split TEXT NOT NULL CHECK(split IN ('vsLHB', 'vsRHB')),
      single REAL NOT NULL,
      double REAL NOT NULL,
      triple REAL NOT NULL,
      home_run REAL NOT NULL,
      walk REAL NOT NULL,
      hit_by_pitch REAL NOT NULL,
      strikeout REAL NOT NULL,
      ground_out REAL NOT NULL,
      fly_out REAL NOT NULL,
      line_out REAL NOT NULL,
      pop_out REAL NOT NULL,
      sacrifice_fly REAL NOT NULL,
      sacrifice_bunt REAL NOT NULL,
      fielders_choice REAL NOT NULL,
      reached_on_error REAL NOT NULL,
      catcher_interference REAL NOT NULL,
      PRIMARY KEY (pitcher_id, split),
      FOREIGN KEY (pitcher_id) REFERENCES pitchers(id) ON DELETE CASCADE
    );

    -- League averages
    CREATE TABLE IF NOT EXISTS league_averages (
      split TEXT PRIMARY KEY CHECK(split IN ('vsLHP', 'vsRHP')),
      single REAL NOT NULL,
      double REAL NOT NULL,
      triple REAL NOT NULL,
      home_run REAL NOT NULL,
      walk REAL NOT NULL,
      hit_by_pitch REAL NOT NULL,
      strikeout REAL NOT NULL,
      ground_out REAL NOT NULL,
      fly_out REAL NOT NULL,
      line_out REAL NOT NULL,
      pop_out REAL NOT NULL,
      sacrifice_fly REAL NOT NULL,
      sacrifice_bunt REAL NOT NULL,
      fielders_choice REAL NOT NULL,
      reached_on_error REAL NOT NULL,
      catcher_interference REAL NOT NULL
    );

    -- Pitcher-batter league averages
    CREATE TABLE IF NOT EXISTS pitcher_batter_league (
      split TEXT PRIMARY KEY CHECK(split IN ('vsLHP', 'vsRHP')),
      rates_json TEXT NOT NULL
    );

    -- Teams table
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      league TEXT NOT NULL,
      city TEXT NOT NULL,
      nickname TEXT NOT NULL
    );

    -- Games table
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      away_team TEXT NOT NULL,
      home_team TEXT NOT NULL,
      use_dh INTEGER NOT NULL CHECK(use_dh IN (0, 1)),
      FOREIGN KEY (away_team) REFERENCES teams(id),
      FOREIGN KEY (home_team) REFERENCES teams(id)
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_batters_team ON batters(team_id);
    CREATE INDEX IF NOT EXISTS idx_pitchers_team ON pitchers(team_id);
    CREATE INDEX IF NOT EXISTS idx_games_date ON games(date);
  `);
}

/**
 * Convert EventRates from camelCase (TypeScript) to snake_case (SQL)
 */
export function eventRatesToSQL(rates: EventRates): Record<string, number> {
  return {
    single: rates.single,
    double: rates.double,
    triple: rates.triple,
    home_run: rates.homeRun,
    walk: rates.walk,
    hit_by_pitch: rates.hitByPitch,
    strikeout: rates.strikeout,
    ground_out: rates.groundOut,
    fly_out: rates.flyOut,
    line_out: rates.lineOut,
    pop_out: rates.popOut,
    sacrifice_fly: rates.sacrificeFly,
    sacrifice_bunt: rates.sacrificeBunt,
    fielders_choice: rates.fieldersChoice,
    reached_on_error: rates.reachedOnError,
    catcher_interference: rates.catcherInterference,
  };
}

/**
 * Convert EventRates from snake_case (SQL) to camelCase (TypeScript)
 */
export function sqlToEventRates(row: Record<string, number>): EventRates {
  return {
    single: row.single,
    double: row.double,
    triple: row.triple,
    homeRun: row.home_run,
    walk: row.walk,
    hitByPitch: row.hit_by_pitch,
    strikeout: row.strikeout,
    groundOut: row.ground_out,
    flyOut: row.fly_out,
    lineOut: row.line_out,
    popOut: row.pop_out,
    sacrificeFly: row.sacrifice_fly,
    sacrificeBunt: row.sacrifice_bunt,
    fieldersChoice: row.fielders_choice,
    reachedOnError: row.reached_on_error,
    catcherInterference: row.catcher_interference,
  };
}
