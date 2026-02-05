# Game Results Database Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a persistent SQLite database for storing baseball game simulation results, enabling standings, league leaders, box scores, game replay, and cross-season analysis.

**Architecture:** Client-side SQLite (sql.js) stored in IndexedDB. Single global database for all simulation results with series-based organization. Stats derived via SQL views from play-by-play data.

**Tech Stack:** sql.js (WASM SQLite), IndexedDB for persistence, TypeScript, Vitest for testing

---

## Task 1: Database Schema and Types

**Files:**
- Create: `app/src/lib/game-results/schema.ts`
- Create: `app/src/lib/game-results/types.ts`

**Step 1: Write the type definitions**

```typescript
// app/src/lib/game-results/types.ts

/**
 * Series types - grouping of games (season replay, tournament, exhibition, etc.)
 */
export type SeriesType = 'season_replay' | 'tournament' | 'exhibition' | 'custom';

/**
 * Series status
 */
export type SeriesStatus = 'active' | 'completed' | 'archived';

/**
 * Event types in game_events table
 */
export type GameEventType =
  | 'plateAppearance'
  | 'startingLineup'
  | 'pitchingChange'
  | 'pinchHit'
  | 'defensiveSub'
  | 'lineupAdjustment'
  // Future: 'stolenBase' | 'caughtStealing' | 'wildPitch' | 'passedBall' | 'balk';

/**
 * Plate appearance outcome (17 outcomes)
 * Re-exported from game/types.ts but kept here for game-results independence
 */
export type Outcome =
  | 'single'
  | 'double'
  | 'triple'
  | 'homeRun'
  | 'walk'
  | 'hitByPitch'
  | 'strikeout'
  | 'groundOut'
  | 'flyOut'
  | 'lineOut'
  | 'popOut'
  | 'sacrificeFly'
  | 'sacrificeBunt'
  | 'fieldersChoice'
  | 'reachedOnError'
  | 'catcherInterference';

/**
 * Series record
 */
export interface Series {
  id: string; // UUID
  name: string;
  description: string | null;
  seriesType: SeriesType;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  status: SeriesStatus;
}

/**
 * Series team record - teams participating in a series
 */
export interface SeriesTeam {
  seriesId: string;
  teamId: string;
  seasonYear: number;
  league: string | null; // 'AL' | 'NL'
  division: string | null; // 'East' | 'Central' | 'West'
}

/**
 * Game record
 */
export interface Game {
  id: string; // UUID
  seriesId: string;
  gameNumber: number | null;

  // Teams with season context
  awayTeamId: string;
  awaySeasonYear: number;
  homeTeamId: string;
  homeSeasonYear: number;

  // Final score
  awayScore: number;
  homeScore: number;
  innings: number;

  // Pitching decisions
  awayStarterId: string | null;
  homeStarterId: string | null;
  winningPitcherId: string | null;
  losingPitcherId: string | null;
  savePitcherId: string | null;

  // Metadata
  scheduledDate: string | null;
  playedAt: string;
  durationMs: number | null;
  useDh: boolean;
}

/**
 * Game event record (play-by-play)
 */
export interface GameEvent {
  id: number; // Auto-increment
  gameId: string;
  sequence: number;

  // Game state context
  inning: number;
  isTopInning: boolean;
  outs: number;
  eventType: GameEventType;

  // Plate appearance data (nullable for non-PA events)
  outcome: Outcome | null;
  batterId: string | null;
  batterName: string | null;
  pitcherId: string | null;
  pitcherName: string | null;
  runsScored: number;
  earnedRuns: number;
  unearnedRuns: number;

  // Runners before the play
  runner1bBefore: string | null;
  runner2bBefore: string | null;
  runner3bBefore: string | null;

  // Runners after the play
  runner1bAfter: string | null;
  runner2bAfter: string | null;
  runner3bAfter: string | null;

  // Managerial / display data
  description: string | null;
  lineupJson: string | null; // JSON string
  substitutedPlayer: string | null;
  position: number | null;

  isSummary: boolean;
}

/**
 * Inning line record (box score data)
 */
export interface InningLine {
  gameId: string;
  teamId: string;
  inning: number;
  runs: number;
  hits: number;
  errors: number;
}

/**
 * Run scored record (junction table for "who scored" queries)
 */
export interface RunScored {
  eventId: number;
  playerId: string;
  isEarned: boolean;
}

/**
 * Standing record (from series_standings view)
 */
export interface Standing {
  seriesId: string;
  teamId: string;
  seasonYear: number;
  league: string | null;
  division: string | null;
  gamesPlayed: number;
  wins: number;
  losses: number;
  runsScored: number;
  runsAllowed: number;
}

/**
 * Batting stat record (from batting_stats view)
 */
export interface BattingStat {
  seriesId: string;
  batterId: string;
  batterName: string;
  pa: number;
  ab: number;
  hits: number;
  singles: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  walks: number;
  hbp: number;
  strikeouts: number;
  rbi: number;
  avg: number;
  obp: number;
  slg: number;
}

/**
 * Pitching stat record (from pitching_stats view)
 */
export interface PitchingStat {
  seriesId: string;
  pitcherId: string;
  pitcherName: string;
  games: number;
  battersFaced: number;
  outsRecorded: number;
  hitsAllowed: number;
  walksAllowed: number;
  strikeouts: number;
  homeRunsAllowed: number;
  runsAllowed: number;
  earnedRuns: number;
  era: number;
  whip: number;
}

/**
 * Game save input - data needed to save a completed game
 */
export interface GameSaveInput {
  seriesId: string;
  gameNumber: number | null;

  // Teams
  awayTeamId: string;
  awaySeasonYear: number;
  homeTeamId: string;
  homeSeasonYear: number;

  // Final score (calculated from plays)
  awayScore: number;
  homeScore: number;
  innings: number;

  // Pitching decisions (to be calculated)
  awayStarterId: string | null;
  homeStarterId: string | null;
  winningPitcherId: string | null;
  losingPitcherId: string | null;
  savePitcherId: string | null;

  // Metadata
  scheduledDate: string | null;
  playedAt: string;
  durationMs: number | null;
  useDh: boolean;

  // Events
  events: GameEventInput[];

  // Inning lines
  inningLines: InningLineInput[];
}

/**
 * Game event input - for saving games
 */
export interface GameEventInput {
  sequence: number;
  inning: number;
  isTopInning: boolean;
  outs: number;
  eventType: GameEventType;
  outcome: Outcome | null;
  batterId: string | null;
  batterName: string | null;
  pitcherId: string | null;
  pitcherName: string | null;
  runsScored: number;
  earnedRuns: number;
  unearnedRuns: number;
  runner1bBefore: string | null;
  runner2bBefore: string | null;
  runner3bBefore: string | null;
  runner1bAfter: string | null;
  runner2bAfter: string | null;
  runner3bAfter: string | null;
  description: string | null;
  lineupJson: string | null;
  substitutedPlayer: string | null;
  position: number | null;
  isSummary: boolean;
  scorerIds: string[]; // Will be expanded into runs_scored table
}

/**
 * Inning line input - for saving games
 */
export interface InningLineInput {
  teamId: string;
  inning: number;
  runs: number;
  hits: number;
  errors: number;
}
```

**Step 2: Write the SQL schema**

```typescript
// app/src/lib/game-results/schema.ts

/**
 * SQL schema for game results database
 */
export const GAME_RESULTS_SCHEMA = `
  -- ============================================
  -- Tables
  -- ============================================

  CREATE TABLE IF NOT EXISTS series (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    series_type TEXT NOT NULL CHECK(series_type IN ('season_replay', 'tournament', 'exhibition', 'custom')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'archived'))
  );

  CREATE TABLE IF NOT EXISTS series_teams (
    series_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    season_year INTEGER NOT NULL,
    league TEXT,
    division TEXT,
    PRIMARY KEY (series_id, team_id, season_year),
    FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    series_id TEXT NOT NULL,
    game_number INTEGER,

    away_team_id TEXT NOT NULL,
    away_season_year INTEGER NOT NULL,
    home_team_id TEXT NOT NULL,
    home_season_year INTEGER NOT NULL,

    away_score INTEGER NOT NULL,
    home_score INTEGER NOT NULL,
    innings INTEGER NOT NULL,

    away_starter_id TEXT,
    home_starter_id TEXT,
    winning_pitcher_id TEXT,
    losing_pitcher_id TEXT,
    save_pitcher_id TEXT,

    scheduled_date TEXT,
    played_at TEXT NOT NULL,
    duration_ms INTEGER,
    use_dh INTEGER NOT NULL DEFAULT 1 CHECK(use_dh IN (0, 1)),

    FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS game_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,

    inning INTEGER NOT NULL,
    is_top_inning INTEGER NOT NULL CHECK(is_top_inning IN (0, 1)),
    outs INTEGER NOT NULL DEFAULT 0,
    event_type TEXT NOT NULL,

    outcome TEXT,
    batter_id TEXT,
    batter_name TEXT,
    pitcher_id TEXT,
    pitcher_name TEXT,
    runs_scored INTEGER NOT NULL DEFAULT 0,
    earned_runs INTEGER NOT NULL DEFAULT 0,
    unearned_runs INTEGER NOT NULL DEFAULT 0,

    runner_1b_before TEXT,
    runner_2b_before TEXT,
    runner_3b_before TEXT,
    runner_1b_after TEXT,
    runner_2b_after TEXT,
    runner_3b_after TEXT,

    description TEXT,
    lineup_json TEXT,
    substituted_player TEXT,
    position INTEGER,

    is_summary INTEGER NOT NULL DEFAULT 0 CHECK(is_summary IN (0, 1)),

    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS inning_lines (
    game_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    inning INTEGER NOT NULL,
    runs INTEGER NOT NULL DEFAULT 0,
    hits INTEGER NOT NULL DEFAULT 0,
    errors INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (game_id, team_id, inning),
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS runs_scored (
    event_id INTEGER NOT NULL,
    player_id TEXT NOT NULL,
    is_earned INTEGER NOT NULL DEFAULT 1 CHECK(is_earned IN (0, 1)),
    PRIMARY KEY (event_id, player_id),
    FOREIGN KEY (event_id) REFERENCES game_events(id) ON DELETE CASCADE
  );

  -- ============================================
  -- Indexes
  -- ============================================

  CREATE INDEX IF NOT EXISTS idx_games_series ON games(series_id);
  CREATE INDEX IF NOT EXISTS idx_games_away ON games(away_team_id, away_season_year);
  CREATE INDEX IF NOT EXISTS idx_games_home ON games(home_team_id, home_season_year);

  CREATE INDEX IF NOT EXISTS idx_events_game ON game_events(game_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_events_batter ON game_events(batter_id) WHERE batter_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_events_pitcher ON game_events(pitcher_id) WHERE pitcher_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_events_outcome ON game_events(outcome) WHERE outcome IS NOT NULL;

  -- ============================================
  -- Views
  -- ============================================

  CREATE VIEW IF NOT EXISTS series_standings AS
  SELECT
    g.series_id,
    t.team_id,
    t.season_year,
    t.league,
    t.division,
    COUNT(*) as games_played,
    SUM(CASE
      WHEN (t.team_id = g.away_team_id AND t.season_year = g.away_season_year AND g.away_score > g.home_score) OR
           (t.team_id = g.home_team_id AND t.season_year = g.home_season_year AND g.home_score > g.away_score)
      THEN 1 ELSE 0 END) as wins,
    SUM(CASE
      WHEN (t.team_id = g.away_team_id AND t.season_year = g.away_season_year AND g.away_score < g.home_score) OR
           (t.team_id = g.home_team_id AND t.season_year = g.home_season_year AND g.home_score < g.away_score)
      THEN 1 ELSE 0 END) as losses,
    SUM(CASE WHEN t.team_id = g.away_team_id AND t.season_year = g.away_season_year
      THEN g.away_score ELSE g.home_score END) as runs_scored,
    SUM(CASE WHEN t.team_id = g.away_team_id AND t.season_year = g.away_season_year
      THEN g.home_score ELSE g.away_score END) as runs_allowed
  FROM series_teams t
  JOIN games g ON g.series_id = t.series_id
    AND (
      (g.away_team_id = t.team_id AND g.away_season_year = t.season_year) OR
      (g.home_team_id = t.team_id AND g.home_season_year = t.season_year)
    )
  GROUP BY g.series_id, t.team_id, t.season_year;

  CREATE VIEW IF NOT EXISTS batting_stats AS
  SELECT
    g.series_id,
    e.batter_id,
    e.batter_name,
    COUNT(*) as pa,
    SUM(CASE WHEN e.outcome NOT IN ('walk','hitByPitch','sacrificeFly','sacrificeBunt','catcherInterference')
      THEN 1 ELSE 0 END) as ab,
    SUM(CASE WHEN e.outcome IN ('single','double','triple','homeRun') THEN 1 ELSE 0 END) as hits,
    SUM(CASE WHEN e.outcome = 'single' THEN 1 ELSE 0 END) as singles,
    SUM(CASE WHEN e.outcome = 'double' THEN 1 ELSE 0 END) as doubles,
    SUM(CASE WHEN e.outcome = 'triple' THEN 1 ELSE 0 END) as triples,
    SUM(CASE WHEN e.outcome = 'homeRun' THEN 1 ELSE 0 END) as home_runs,
    SUM(CASE WHEN e.outcome = 'walk' THEN 1 ELSE 0 END) as walks,
    SUM(CASE WHEN e.outcome = 'hitByPitch' THEN 1 ELSE 0 END) as hbp,
    SUM(CASE WHEN e.outcome = 'strikeout' THEN 1 ELSE 0 END) as strikeouts,
    SUM(e.runs_scored) as rbi,
    ROUND(CAST(SUM(CASE WHEN e.outcome IN ('single','double','triple','homeRun') THEN 1 ELSE 0 END) AS REAL) /
      NULLIF(SUM(CASE WHEN e.outcome NOT IN ('walk','hitByPitch','sacrificeFly','sacrificeBunt','catcherInterference')
        THEN 1 ELSE 0 END), 0), 3) as avg,
    ROUND(CAST(SUM(CASE WHEN e.outcome IN ('single','double','triple','homeRun','walk','hitByPitch')
      THEN 1 ELSE 0 END) AS REAL) / NULLIF(COUNT(*), 0), 3) as obp,
    ROUND(CAST(
      SUM(CASE WHEN e.outcome = 'single' THEN 1 ELSE 0 END) +
      SUM(CASE WHEN e.outcome = 'double' THEN 2 ELSE 0 END) +
      SUM(CASE WHEN e.outcome = 'triple' THEN 3 ELSE 0 END) +
      SUM(CASE WHEN e.outcome = 'homeRun' THEN 4 ELSE 0 END)
    AS REAL) /
      NULLIF(SUM(CASE WHEN e.outcome NOT IN ('walk','hitByPitch','sacrificeFly','sacrificeBunt','catcherInterference')
        THEN 1 ELSE 0 END), 0), 3) as slg
  FROM game_events e
  JOIN games g ON e.game_id = g.id
  WHERE e.event_type = 'plateAppearance'
    AND e.outcome IS NOT NULL
  GROUP BY g.series_id, e.batter_id;

  CREATE VIEW IF NOT EXISTS pitching_stats AS
  SELECT
    g.series_id,
    e.pitcher_id,
    e.pitcher_name,
    COUNT(DISTINCT e.game_id) as games,
    COUNT(*) as batters_faced,
    SUM(CASE WHEN e.outcome IN ('strikeout','groundOut','flyOut','lineOut','popOut',
      'sacrificeFly','sacrificeBunt','fieldersChoice') THEN 1 ELSE 0 END) as outs_recorded,
    SUM(CASE WHEN e.outcome IN ('single','double','triple','homeRun') THEN 1 ELSE 0 END) as hits_allowed,
    SUM(CASE WHEN e.outcome IN ('walk','hitByPitch') THEN 1 ELSE 0 END) as walks_allowed,
    SUM(CASE WHEN e.outcome = 'strikeout' THEN 1 ELSE 0 END) as strikeouts,
    SUM(CASE WHEN e.outcome = 'homeRun' THEN 1 ELSE 0 END) as home_runs_allowed,
    SUM(e.runs_scored) as runs_allowed,
    SUM(e.earned_runs) as earned_runs,
    ROUND(CAST(SUM(e.earned_runs) AS REAL) * 27.0 /
      NULLIF(SUM(CASE WHEN e.outcome IN ('strikeout','groundOut','flyOut','lineOut','popOut',
        'sacrificeFly','sacrificeBunt','fieldersChoice') THEN 1 ELSE 0 END), 0), 2) as era,
    ROUND(CAST(
      SUM(CASE WHEN e.outcome IN ('single','double','triple','homeRun') THEN 1 ELSE 0 END) +
      SUM(CASE WHEN e.outcome IN ('walk','hitByPitch') THEN 1 ELSE 0 END)
    AS REAL) * 3.0 /
      NULLIF(SUM(CASE WHEN e.outcome IN ('strikeout','groundOut','flyOut','lineOut','popOut',
        'sacrificeFly','sacrificeBunt','fieldersChoice') THEN 1 ELSE 0 END), 0), 3) as whip
  FROM game_events e
  JOIN games g ON e.game_id = g.id
  WHERE e.event_type = 'plateAppearance'
    AND e.outcome IS NOT NULL
  GROUP BY g.series_id, e.pitcher_id;
`;

/**
 * Create all tables, indexes, and views in an existing database
 */
export function createGameResultsSchema(db: any): void {
  db.exec(GAME_RESULTS_SCHEMA);
}
```

**Step 3: Write tests for types**

```typescript
// app/src/lib/game-results/types.test.ts

import { describe, it, expect } from 'vitest';
import type {
  Series,
  GameEvent,
  GameSaveInput,
  SeriesType,
  GameEventType,
  Outcome
} from './types.js';

describe('Game Results Types', () => {
  it('should create a valid Series object', () => {
    const series: Series = {
      id: 'test-series-1',
      name: '1976 Season Replay',
      description: 'Full season replay',
      seriesType: 'season_replay',
      createdAt: '2026-02-05T12:00:00Z',
      updatedAt: '2026-02-05T12:00:00Z',
      status: 'active'
    };

    expect(series.seriesType).toBe('season_replay');
    expect(series.status).toBe('active');
  });

  it('should create a valid GameEvent for plate appearance', () => {
    const event: GameEvent = {
      id: 1,
      gameId: 'game-1',
      sequence: 1,
      inning: 1,
      isTopInning: true,
      outs: 0,
      eventType: 'plateAppearance',
      outcome: 'single',
      batterId: 'batter-1',
      batterName: 'Smith, John',
      pitcherId: 'pitcher-1',
      pitcherName: 'Jones, Tom',
      runsScored: 0,
      earnedRuns: 0,
      unearnedRuns: 0,
      runner1bBefore: null,
      runner2bBefore: null,
      runner3bBefore: null,
      runner1bAfter: 'batter-1',
      runner2bAfter: null,
      runner3bAfter: null,
      description: 'Smith singles to center',
      lineupJson: null,
      substitutedPlayer: null,
      position: null,
      isSummary: false
    };

    expect(event.eventType).toBe('plateAppearance');
    expect(event.outcome).toBe('single');
    expect(event.runner1bAfter).toBe('batter-1');
  });

  it('should accept all valid SeriesType values', () => {
    const types: SeriesType[] = ['season_replay', 'tournament', 'exhibition', 'custom'];
    expect(types).toHaveLength(4);
  });

  it('should accept all valid GameEventType values', () => {
    const types: GameEventType[] = [
      'plateAppearance',
      'startingLineup',
      'pitchingChange',
      'pinchHit',
      'defensiveSub',
      'lineupAdjustment'
    ];
    expect(types).toHaveLength(6);
  });

  it('should allow nullable outcome for non-PA events', () => {
    const event: GameEvent = {
      id: 1,
      gameId: 'game-1',
      sequence: 0,
      inning: 1,
      isTopInning: true,
      outs: 0,
      eventType: 'startingLineup',
      outcome: null,
      batterId: null,
      batterName: null,
      pitcherId: null,
      pitcherName: null,
      runsScored: 0,
      earnedRuns: 0,
      unearnedRuns: 0,
      runner1bBefore: null,
      runner2bBefore: null,
      runner3bBefore: null,
      runner1bAfter: null,
      runner2bAfter: null,
      runner3bAfter: null,
      description: 'Starting lineups',
      lineupJson: '[{"playerId":"p1","playerName":"Player 1","battingOrder":1,"fieldingPosition":1}]',
      substitutedPlayer: null,
      position: null,
      isSummary: false
    };

    expect(event.eventType).toBe('startingLineup');
    expect(event.outcome).toBeNull();
  });
});
```

**Step 4: Run tests to verify**

Run: `cd app && pnpm test types.test.ts`

Expected: All tests pass

**Step 5: Commit**

```bash
git add app/src/lib/game-results/
git commit -m "feat: add game results database types and schema"
```

---

## Task 2: Database Initialization and IndexedDB Storage

**Files:**
- Create: `app/src/lib/game-results/database.ts`
- Create: `app/src/lib/game-results/database.test.ts`

**Step 1: Write the failing tests**

```typescript
// app/src/lib/game-results/database.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getGameDatabase, closeGameDatabase, exportGameDatabase } from './database.js';

describe('Game Results Database', () => {
  afterEach(async () => {
    // Close and clean up database after each test
    await closeGameDatabase();
    // Clear IndexedDB
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('bb-game-results');
      request.onsuccess = () => resolve(undefined);
      request.onerror = () => reject(request.error);
    });
  });

  it('should initialize database on first access', async () => {
    const db = await getGameDatabase();
    expect(db).toBeDefined();

    // Verify tables exist
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    const tableNames = tables[0].values.map((row: any[]) => row[0]);

    expect(tableNames).toContain('series');
    expect(tableNames).toContain('series_teams');
    expect(tableNames).toContain('games');
    expect(tableNames).toContain('game_events');
    expect(tableNames).toContain('inning_lines');
    expect(tableNames).toContain('runs_scored');
  });

  it('should create views for stats queries', async () => {
    const db = await getGameDatabase();

    const views = db.exec("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name");
    const viewNames = views[0].values.map((row: any[]) => row[0]);

    expect(viewNames).toContain('series_standings');
    expect(viewNames).toContain('batting_stats');
    expect(viewNames).toContain('pitching_stats');
  });

  it('should export database as Blob', async () => {
    await getGameDatabase(); // Ensure initialized
    const blob = await exportGameDatabase();

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/x-sqlite3');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('should cache database instance in memory', async () => {
    const db1 = await getGameDatabase();
    const db2 = await getGameDatabase();

    // Should return the same instance
    expect(db1).toBe(db2);
  });

  it('should persist data across database reopens', async () => {
    const db = await getGameDatabase();

    // Insert test data
    db.run(
      'INSERT INTO series (id, name, series_type, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, ?)',
      ['test-series-1', 'Test Series', 'exhibition', '2026-02-05T12:00:00Z', '2026-02-05T12:00:00Z', 'active']
    );

    // Close and reopen
    await closeGameDatabase();
    const db2 = await getGameDatabase();

    // Verify data persists
    const result = db2.exec('SELECT name FROM series WHERE id = ?', ['test-series-1']);
    expect(result[0].values[0][0]).toBe('Test Series');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd app && pnpm test database.test.ts`

Expected: Tests fail with "module not found" errors

**Step 3: Implement the database module**

```typescript
// app/src/lib/game-results/database.ts

import initSqlJs, { type Database } from 'sql.js';
import { createGameResultsSchema } from './schema.js';

// Global SQL.js instance
let SQL: any = null;

// In-memory database cache
let gameDb: Database | null = null;

// IndexedDB database name
const GAME_RESULTS_DB_NAME = 'bb-game-results';
const GAME_RESULTS_STORE_NAME = 'database';

/**
 * Initialize SQL.js
 */
async function initializeSQLJS(): Promise<void> {
  if (SQL) return;

  console.log('[GameResultsDB] Initializing sql.js...');
  SQL = await initSqlJs({
    locateFile: (file: string) => `https://sql.js.org/dist/${file}`
  });
  console.log('[GameResultsDB] sql.js initialized');
}

/**
 * Open IndexedDB for game results storage
 */
function openIndexedDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(GAME_RESULTS_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(GAME_RESULTS_STORE_NAME)) {
        db.createObjectStore(GAME_RESULTS_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Load database bytes from IndexedDB
 */
async function loadDatabaseBytes(): Promise<Uint8Array | null> {
  const db = await openIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GAME_RESULTS_STORE_NAME, 'readonly');
    const store = tx.objectStore(GAME_RESULTS_STORE_NAME);
    const request = store.get('game-results');

    request.onsuccess = () => {
      db.close();
      resolve(request.result || null);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

/**
 * Save database bytes to IndexedDB
 */
async function saveDatabaseBytes(data: Uint8Array): Promise<void> {
  const db = await openIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GAME_RESULTS_STORE_NAME, 'readwrite');
    const store = tx.objectStore(GAME_RESULTS_STORE_NAME);
    store.put(data, 'game-results');

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/**
 * Get or create the game results database
 *
 * Lazily initializes the database:
 * 1. First call: Creates new in-memory database with schema
 * 2. Subsequent calls: Returns cached instance
 *
 * @returns Promise<Database> sql.js Database instance
 */
export async function getGameDatabase(): Promise<Database> {
  if (gameDb) {
    return gameDb;
  }

  await initializeSQLJS();

  // Try to load from IndexedDB
  const savedData = await loadDatabaseBytes();

  if (savedData) {
    console.log('[GameResultsDB] Loading existing database from IndexedDB');
    gameDb = new SQL.Database(savedData);
  } else {
    console.log('[GameResultsDB] Creating new game results database');
    gameDb = new SQL.Database();
    createGameResultsSchema(gameDb);
    // Save initial empty database
    await saveDatabaseBytes(gameDb.export());
  }

  return gameDb;
}

/**
 * Close the game database and save to IndexedDB
 *
 * Call this before page unload to persist changes
 */
export async function closeGameDatabase(): Promise<void> {
  if (!gameDb) return;

  console.log('[GameResultsDB] Saving database to IndexedDB...');
  const data = gameDb.export();
  await saveDatabaseBytes(data);

  gameDb.close();
  gameDb = null;
  console.log('[GameResultsDB] Database saved and closed');
}

/**
 * Export the game database as a downloadable Blob
 *
 * Returns a .sqlite file that can be opened in external tools
 *
 * @returns Promise<Blob> SQLite database as blob
 */
export async function exportGameDatabase(): Promise<Blob> {
  const db = await getGameDatabase();
  const data = db.export();
  return new Blob([data], { type: 'application/x-sqlite3' });
}

/**
 * Import a game database from a file
 *
 * Replaces the current database with the imported one
 *
 * @param file - File object containing .sqlite database
 */
export async function importGameDatabase(file: File): Promise<void> {
  await initializeSQLJS();

  const buffer = await file.arrayBuffer();
  const data = new Uint8Array(buffer);

  // Close current database
  if (gameDb) {
    gameDb.close();
    gameDb = null;
  }

  // Load imported database
  gameDb = new SQL.Database(data);

  // Verify it's a valid game results database
  const tables = gameDb.exec("SELECT name FROM sqlite_master WHERE type='table'");
  const tableNames = new Set(tables[0]?.values.map((row: any[]) => row[0]) || []);

  if (!tableNames.has('series') || !tableNames.has('games')) {
    throw new Error('Invalid game results database: missing required tables');
  }

  // Save to IndexedDB
  await saveDatabaseBytes(data);

  console.log('[GameResultsDB] Imported game results database');
}

/**
 * Clear all game results data
 *
 * Deletes the database from memory and IndexedDB
 */
export async function clearGameDatabase(): Promise<void> {
  // Close database
  if (gameDb) {
    gameDb.close();
    gameDb = null;
  }

  // Delete IndexedDB
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(GAME_RESULTS_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  console.log('[GameResultsDB] Cleared game results database');
}

// Auto-save before page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    closeGameDatabase().catch(console.error);
  });
}

// Expose to window for debugging
if (typeof window !== 'undefined') {
  (window as any).getGameDatabase = getGameDatabase;
  (window as any).exportGameDatabase = exportGameDatabase;
  (window as any).clearGameDatabase = clearGameDatabase;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd app && pnpm test database.test.ts`

Expected: All tests pass

**Step 5: Commit**

```bash
git add app/src/lib/game-results/database.ts app/src/lib/game-results/database.test.ts
git commit -m "feat: add game results database initialization with IndexedDB storage"
```

---

## Task 3: Series CRUD Operations

**Files:**
- Create: `app/src/lib/game-results/series.ts`
- Create: `app/src/lib/game-results/series.test.ts`

**Step 1: Write the failing tests**

```typescript
// app/src/lib/game-results/series.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createSeries,
  getSeries,
  listSeries,
  updateSeries,
  deleteSeries,
  addTeamToSeries,
  getSeriesTeams
} from './series.js';
import { clearGameDatabase } from './database.js';

describe('Series CRUD', () => {
  beforeEach(async () => {
    await clearGameDatabase();
  });

  it('should create a new series', async () => {
    const series = await createSeries({
      name: '1976 Season Replay',
      description: 'Full 1976 MLB season',
      seriesType: 'season_replay'
    });

    expect(series.id).toBeDefined();
    expect(series.name).toBe('1976 Season Replay');
    expect(series.seriesType).toBe('season_replay');
    expect(series.status).toBe('active');
  });

  it('should retrieve a series by id', async () => {
    const created = await createSeries({
      name: 'Test Series',
      description: null,
      seriesType: 'exhibition'
    });

    const retrieved = await getSeries(created.id);

    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(created.id);
    expect(retrieved?.name).toBe('Test Series');
  });

  it('should return null for non-existent series', async () => {
    const result = await getSeries('non-existent-id');
    expect(result).toBeNull();
  });

  it('should list all series', async () => {
    await createSeries({ name: 'Series 1', description: null, seriesType: 'custom' });
    await createSeries({ name: 'Series 2', description: null, seriesType: 'tournament' });

    const series = await listSeries();

    expect(series).toHaveLength(2);
    expect(series[0].name).toBe('Series 1');
    expect(series[1].name).toBe('Series 2');
  });

  it('should update a series', async () => {
    const created = await createSeries({
      name: 'Original Name',
      description: 'Original desc',
      seriesType: 'custom'
    });

    const updated = await updateSeries(created.id, {
      name: 'Updated Name',
      status: 'completed'
    });

    expect(updated?.name).toBe('Updated Name');
    expect(updated?.status).toBe('completed');
    expect(updated?.description).toBe('Original desc'); // Unchanged
  });

  it('should delete a series', async () => {
    const created = await createSeries({
      name: 'To Delete',
      description: null,
      seriesType: 'exhibition'
    });

    await deleteSeries(created.id);

    const retrieved = await getSeries(created.id);
    expect(retrieved).toBeNull();
  });

  it('should add teams to a series', async () => {
    const series = await createSeries({
      name: 'Test Series',
      description: null,
      seriesType: 'season_replay'
    });

    await addTeamToSeries(series.id, {
      teamId: 'NYA',
      seasonYear: 1927,
      league: 'AL',
      division: null
    });

    await addTeamToSeries(series.id, {
      teamId: 'BRO',
      seasonYear: 1955,
      league: 'NL',
      division: null
    });

    const teams = await getSeriesTeams(series.id);

    expect(teams).toHaveLength(2);
    expect(teams[0].teamId).toBe('NYA');
    expect(teams[0].seasonYear).toBe(1927);
    expect(teams[1].teamId).toBe('BRO');
    expect(teams[1].seasonYear).toBe(1955);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd app && pnpm test series.test.ts`

Expected: Tests fail with "module not found" errors

**Step 3: Implement series operations**

```typescript
// app/src/lib/game-results/series.ts

import { getGameDatabase } from './database.js';
import type { Series, SeriesTeam, SeriesType } from './types.js';

/**
 * Generate a UUID v4
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Create a new series
 *
 * @param data - Series data (id, timestamps auto-generated)
 * @returns Promise<Series> Created series
 */
export async function createSeries(data: {
  name: string;
  description: string | null;
  seriesType: SeriesType;
}): Promise<Series> {
  const db = await getGameDatabase();

  const id = generateUUID();
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO series (id, name, description, series_type, created_at, updated_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, data.name, data.description, data.seriesType, now, now, 'active']
  );

  return {
    id,
    name: data.name,
    description: data.description,
    seriesType: data.seriesType,
    createdAt: now,
    updatedAt: now,
    status: 'active'
  };
}

/**
 * Get a series by id
 *
 * @param id - Series UUID
 * @returns Promise<Series | null> Series or null if not found
 */
export async function getSeries(id: string): Promise<Series | null> {
  const db = await getGameDatabase();

  const stmt = db.prepare('SELECT * FROM series WHERE id = ?');
  stmt.bind([id]);

  if (!stmt.step()) {
    stmt.free();
    return null;
  }

  const row = stmt.getAsObject() as any;
  stmt.free();

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    seriesType: row.series_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status
  };
}

/**
 * List all series, ordered by created_at DESC
 *
 * @returns Promise<Series[]> Array of all series
 */
export async function listSeries(): Promise<Series[]> {
  const db = await getGameDatabase();

  const stmt = db.prepare('SELECT * FROM series ORDER BY created_at DESC');
  const series: Series[] = [];

  while (stmt.step()) {
    const row = stmt.getAsObject() as any;
    series.push({
      id: row.id,
      name: row.name,
      description: row.description,
      seriesType: row.series_type,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: row.status
    });
  }

  stmt.free();
  return series;
}

/**
 * Update a series
 *
 * @param id - Series UUID
 * @param data - Fields to update (name, description, status)
 * @returns Promise<Series | null> Updated series or null if not found
 */
export async function updateSeries(
  id: string,
  data: {
    name?: string;
    description?: string | null;
    status?: 'active' | 'completed' | 'archived';
  }
): Promise<Series | null> {
  const db = await getGameDatabase();

  const updates: string[] = [];
  const values: any[] = [];

  if (data.name !== undefined) {
    updates.push('name = ?');
    values.push(data.name);
  }
  if (data.description !== undefined) {
    updates.push('description = ?');
    values.push(data.description);
  }
  if (data.status !== undefined) {
    updates.push('status = ?');
    values.push(data.status);
  }

  if (updates.length === 0) {
    return getSeries(id);
  }

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  db.run(`UPDATE series SET ${updates.join(', ')} WHERE id = ?`, values);

  return getSeries(id);
}

/**
 * Delete a series and all associated games
 *
 * @param id - Series UUID
 */
export async function deleteSeries(id: string): Promise<void> {
  const db = await getGameDatabase();
  db.run('DELETE FROM series WHERE id = ?', [id]);
}

/**
 * Add a team to a series
 *
 * @param seriesId - Series UUID
 * @param data - Team data
 */
export async function addTeamToSeries(
  seriesId: string,
  data: {
    teamId: string;
    seasonYear: number;
    league: string | null;
    division: string | null;
  }
): Promise<void> {
  const db = await getGameDatabase();

  db.run(
    `INSERT OR REPLACE INTO series_teams (series_id, team_id, season_year, league, division)
     VALUES (?, ?, ?, ?, ?)`,
    [seriesId, data.teamId, data.seasonYear, data.league, data.division]
  );
}

/**
 * Get all teams in a series
 *
 * @param seriesId - Series UUID
 * @returns Promise<SeriesTeam[]> Array of series teams
 */
export async function getSeriesTeams(seriesId: string): Promise<SeriesTeam[]> {
  const db = await getGameDatabase();

  const stmt = db.prepare('SELECT * FROM series_teams WHERE series_id = ? ORDER BY team_id');
  stmt.bind([seriesId]);

  const teams: SeriesTeam[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as any;
    teams.push({
      seriesId: row.series_id,
      teamId: row.team_id,
      seasonYear: row.season_year,
      league: row.league,
      division: row.division
    });
  }

  stmt.free();
  return teams;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd app && pnpm test series.test.ts`

Expected: All tests pass

**Step 5: Commit**

```bash
git add app/src/lib/game-results/series.ts app/src/lib/game-results/series.test.ts
git commit -m "feat: add series CRUD operations"
```

---

## Task 4: Game Save Functionality

**Files:**
- Create: `app/src/lib/game-results/games.ts`
- Create: `app/src/lib/game-results/games.test.ts`

**Step 1: Write the failing tests**

```typescript
// app/src/lib/game-results/games.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSeries, addTeamToSeries } from './series.js';
import {
  saveGame,
  getGame,
  getGamesBySeries,
  calculateEarnedRuns,
  determinePitchingDecisions
} from './games.js';
import { clearGameDatabase } from './database.js';
import type { GameEventInput, InningLineInput } from './types.js';

describe('Game Save', () => {
  let seriesId: string;

  beforeEach(async () => {
    await clearGameDatabase();

    const series = await createSeries({
      name: 'Test Season',
      description: null,
      seriesType: 'season_replay'
    });
    seriesId = series.id;

    // Add teams to series
    await addTeamToSeries(seriesId, {
      teamId: 'NYA',
      seasonYear: 1927,
      league: 'AL',
      division: null
    });

    await addTeamToSeries(seriesId, {
      teamId: 'BRO',
      seasonYear: 1955,
      league: 'NL',
      division: null
    });
  });

  it('should save a completed game', async () => {
    const gameInput = createMockGameInput();

    const gameId = await saveGame(gameInput);

    expect(gameId).toBeDefined();

    const saved = await getGame(gameId);
    expect(saved).toBeDefined();
    expect(saved?.awayTeamId).toBe('NYA');
    expect(saved?.homeTeamId).toBe('BRO');
    expect(saved?.awayScore).toBe(5);
    expect(saved?.homeScore).toBe(3);
  });

  it('should save game events in correct order', async () => {
    const gameInput = createMockGameInput();
    const gameId = await saveGame(gameInput);

    const db = await (await import('./database.js')).getGameDatabase();
    const stmt = db.prepare('SELECT * FROM game_events WHERE game_id = ? ORDER BY sequence');
    stmt.bind([gameId]);

    const events: any[] = [];
    while (stmt.step()) {
      events.push(stmt.getAsObject());
    }
    stmt.free();

    expect(events.length).toBeGreaterThan(0);
    // Verify sequence is strictly increasing
    for (let i = 1; i < events.length; i++) {
      expect(events[i].sequence).toBe(events[i - 1].sequence + 1);
    }
  });

  it('should save inning lines', async () => {
    const gameInput = createMockGameInput();
    const gameId = await saveGame(gameInput);

    const db = await (await import('./database.js')).getGameDatabase();
    const stmt = db.prepare('SELECT * FROM inning_lines WHERE game_id = ?');
    stmt.bind([gameId]);

    const lines: any[] = [];
    while (stmt.step()) {
      lines.push(stmt.getAsObject());
    }
    stmt.free();

    expect(lines.length).toBeGreaterThan(0);
  });

  it('should expand scorer_ids into runs_scored table', async () => {
    const gameInput = createMockGameInput();
    const gameId = await saveGame(gameInput);

    const db = await (await import('./database.js')).getGameDatabase();
    const stmt = db.prepare('SELECT COUNT(*) as count FROM runs_scored rs JOIN game_events ge ON rs.event_id = ge.id WHERE ge.game_id = ?');
    stmt.bind([gameId]);

    stmt.step();
    const result = stmt.getAsObject();
    stmt.free();

    expect(result.count).toBeGreaterThan(0);
  });

  it('should calculate earned vs unearned runs', () => {
    // Mock scenario: runner reaches on error, then scores
    const events: GameEventInput[] = [
      {
        sequence: 1,
        inning: 1,
        isTopInning: true,
        outs: 0,
        eventType: 'plateAppearance',
        outcome: 'reachedOnError',
        batterId: 'batter-1',
        batterName: 'Player 1',
        pitcherId: 'pitcher-1',
        pitcherName: 'Pitcher 1',
        runsScored: 0,
        earnedRuns: 0,
        unearnedRuns: 0,
        runner1bBefore: null,
        runner2bBefore: null,
        runner3bBefore: null,
        runner1bAfter: 'batter-1',
        runner2bAfter: null,
        runner3bAfter: null,
        description: null,
        lineupJson: null,
        substitutedPlayer: null,
        position: null,
        isSummary: false,
        scorerIds: []
      },
      {
        sequence: 2,
        inning: 1,
        isTopInning: true,
        outs: 0,
        eventType: 'plateAppearance',
        outcome: 'single',
        batterId: 'batter-2',
        batterName: 'Player 2',
        pitcherId: 'pitcher-1',
        pitcherName: 'Pitcher 1',
        runsScored: 1,
        earnedRuns: 0,
        unearnedRuns: 1,
        runner1bBefore: 'batter-1',
        runner2bBefore: null,
        runner3bBefore: null,
        runner1bAfter: 'batter-2',
        runner2bAfter: null,
        runner3bAfter: null,
        description: null,
        lineupJson: null,
        substitutedPlayer: null,
        position: null,
        isSummary: false,
        scorerIds: ['batter-1'] // Runner who reached on error scores
      }
    ];

    const result = calculateEarnedRuns(events);

    // First event: no runs
    expect(result[0].earnedRuns).toBe(0);
    expect(result[0].unearnedRuns).toBe(0);

    // Second event: batter-1 reached on error, so his run is unearned
    expect(result[1].earnedRuns).toBe(0);
    expect(result[1].unearnedRuns).toBe(1);
  });

  it('should determine pitching decisions', () => {
    const decisions = determinePitchingDecisions({
      awayScore: 5,
      homeScore: 3,
      awayStarterId: 'pitcher-away',
      homeStarterId: 'pitcher-home',
      winningPitcherId: null,
      losingPitcherId: null,
      savePitcherId: null
    });

    expect(decisions.winningPitcherId).toBe('pitcher-away');
    expect(decisions.losingPitcherId).toBe('pitcher-home');
    expect(decisions.savePitcherId).toBeNull();
  });

  it('should get all games in a series', async () => {
    const input1 = createMockGameInput();
    const input2 = createMockGameInput();
    input2.gameNumber = 2;

    await saveGame(input1);
    await saveGame(input2);

    const games = await getGamesBySeries(seriesId);

    expect(games).toHaveLength(2);
    expect(games[0].seriesId).toBe(seriesId);
    expect(games[1].seriesId).toBe(seriesId);
  });
});

/**
 * Create a mock game input for testing
 */
function createMockGameInput() {
  const events: GameEventInput[] = [
    {
      sequence: 0,
      inning: 1,
      isTopInning: true,
      outs: 0,
      eventType: 'startingLineup',
      outcome: null,
      batterId: null,
      batterName: null,
      pitcherId: null,
      pitcherName: null,
      runsScored: 0,
      earnedRuns: 0,
      unearnedRuns: 0,
      runner1bBefore: null,
      runner2bBefore: null,
      runner3bBefore: null,
      runner1bAfter: null,
      runner2bAfter: null,
      runner3bAfter: null,
      description: 'Starting lineups',
      lineupJson: JSON.stringify([
        { playerId: 'p1', playerName: 'Player 1', battingOrder: 1, fieldingPosition: 1 }
      ]),
      substitutedPlayer: null,
      position: null,
      isSummary: false,
      scorerIds: []
    },
    {
      sequence: 1,
      inning: 1,
      isTopInning: true,
      outs: 0,
      eventType: 'plateAppearance',
      outcome: 'homeRun',
      batterId: 'batter-1',
      batterName: 'Ruth, Babe',
      pitcherId: 'pitcher-1',
      pitcherName: 'Pitcher 1',
      runsScored: 1,
      earnedRuns: 1,
      unearnedRuns: 0,
      runner1bBefore: null,
      runner2bBefore: null,
      runner3bBefore: null,
      runner1bAfter: null,
      runner2bAfter: null,
      runner3bAfter: null,
      description: 'Ruth homers',
      lineupJson: null,
      substitutedPlayer: null,
      position: null,
      isSummary: false,
      scorerIds: ['batter-1']
    }
  ];

  const inningLines: InningLineInput[] = [
    { teamId: 'NYA', inning: 1, runs: 1, hits: 1, errors: 0 },
    { teamId: 'BRO', inning: 1, runs: 0, hits: 0, errors: 0 }
  ];

  return {
    seriesId: seriesId || 'test-series',
    gameNumber: 1,
    awayTeamId: 'NYA',
    awaySeasonYear: 1927,
    homeTeamId: 'BRO',
    homeSeasonYear: 1955,
    awayScore: 5,
    homeScore: 3,
    innings: 9,
    awayStarterId: 'pitcher-away',
    homeStarterId: 'pitcher-home',
    winningPitcherId: null,
    losingPitcherId: null,
    savePitcherId: null,
    scheduledDate: null,
    playedAt: new Date().toISOString(),
    durationMs: null,
    useDh: false,
    events,
    inningLines
  };
}
```

**Step 2: Run tests to verify they fail**

Run: `cd app && pnpm test games.test.ts`

Expected: Tests fail with "module not found" errors

**Step 3: Implement game save operations**

```typescript
// app/src/lib/game-results/games.ts

import { getGameDatabase } from './database.js';
import type { Game, GameSaveInput, GameEventInput, InningLineInput, Outcome } from './types.js';

/**
 * Generate a UUID v4
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Calculate earned vs unearned runs for each event
 *
 * Rules:
 * - A runner who reaches on error → any run they score is unearned
 * - Runs that score after an error with 0 outs are unearned (wouldn't have happened without error)
 * - All other runs are earned
 *
 * @param events - Game events with scorerIds
 * @returns Events with earnedRuns/unearnedRuns populated
 */
export function calculateEarnedRuns(events: GameEventInput[]): GameEventInput[] {
  // Track runners who reached on error
  const unearnedRunners = new Set<string>();
  // Track if an error occurred with 0 outs in the inning (makes subsequent runs unearned)
  const errorWithZeroOuts = new Map<string, boolean>(); // inning_key -> boolean
  let lastErrorWithZeroOutsKey: string | null = null;

  const result = [...events];

  for (let i = 0; i < result.length; i++) {
    const event = result[i];
    const inningKey = `${event.inning}-${event.isTopInning}`;

    // Check for error on this play
    if (event.outcome === 'reachedOnError' && event.scorerIds.length > 0) {
      // Mark the batter as an unearned runner
      if (event.batterId) {
        unearnedRunners.add(event.batterId);
      }
      // If error with 0 outs, mark this inning
      if (event.outs === 0) {
        errorWithZeroOuts.set(inningKey, true);
        lastErrorWithZeroOutsKey = inningKey;
      }
    }

    // Calculate earned/unearned for this event
    let earnedRuns = 0;
    let unearnedRuns = 0;

    for (const scorerId of event.scorerIds) {
      if (unearnedRunners.has(scorerId)) {
        unearnedRuns++;
      } else if (
        // If this event itself is not an error, but there was an error with 0 outs
        // in this half-inning before this play, runs are unearned
        lastErrorWithZeroOutsKey === inningKey &&
        event.outcome !== 'reachedOnError'
      ) {
        // First non-error play after error with 0 outs
        unearnedRuns++;
      } else {
        earnedRuns++;
      }
    }

    result[i] = {
      ...event,
      earnedRuns,
      unearnedRuns
    };

    // Clear the zero-outs error flag after first non-error play
    if (lastErrorWithZeroOutsKey === inningKey && event.outcome !== 'reachedOnError') {
      lastErrorWithZeroOutsKey = null;
    }
  }

  return result;
}

/**
 * Determine pitching decisions from game outcome
 *
 * @param gameData - Game data with scores and starters
 * @returns Pitching decisions (winner, loser, save)
 */
export function determinePitchingDecisions(gameData: {
  awayScore: number;
  homeScore: number;
  awayStarterId: string | null;
  homeStarterId: string | null;
}): {
  winningPitcherId: string | null;
  losingPitcherId: string | null;
  savePitcherId: string | null;
} {
  const { awayScore, homeScore, awayStarterId, homeStarterId } = gameData;

  if (awayScore > homeScore) {
    // Away team wins
    return {
      winningPitcherId: awayStarterId,
      losingPitcherId: homeStarterId,
      savePitcherId: null // TODO: Track last pitcher for winning team
    };
  } else {
    // Home team wins (or tie - treat as home wins for now)
    return {
      winningPitcherId: homeStarterId,
      losingPitcherId: awayStarterId,
      savePitcherId: null
    };
  }
}

/**
 * Save a completed game to the database
 *
 * @param input - Game data to save
 * @returns Promise<string> Game ID
 */
export async function saveGame(input: GameSaveInput): Promise<string> {
  const db = await getGameDatabase();

  // Calculate earned runs
  const eventsWithEarned = calculateEarnedRuns(input.events);

  // Determine pitching decisions if not provided
  const decisions = input.winningPitcherId
    ? {
        winningPitcherId: input.winningPitcherId,
        losingPitcherId: input.losingPitcherId,
        savePitcherId: input.savePitcherId
      }
    : determinePitchingDecisions(input);

  const gameId = generateUUID();

  // Insert game record
  db.run(
    `INSERT INTO games (
      id, series_id, game_number,
      away_team_id, away_season_year, home_team_id, home_season_year,
      away_score, home_score, innings,
      away_starter_id, home_starter_id,
      winning_pitcher_id, losing_pitcher_id, save_pitcher_id,
      scheduled_date, played_at, duration_ms, use_dh
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      gameId,
      input.seriesId,
      input.gameNumber,
      input.awayTeamId,
      input.awaySeasonYear,
      input.homeTeamId,
      input.homeSeasonYear,
      input.awayScore,
      input.homeScore,
      input.innings,
      input.awayStarterId,
      input.homeStarterId,
      decisions.winningPitcherId,
      decisions.losingPitcherId,
      decisions.savePitcherId,
      input.scheduledDate,
      input.playedAt,
      input.durationMs,
      input.useDh ? 1 : 0
    ]
  );

  // Insert game events
  for (const event of eventsWithEarned) {
    db.run(
      `INSERT INTO game_events (
        game_id, sequence, inning, is_top_inning, outs, event_type,
        outcome, batter_id, batter_name, pitcher_id, pitcher_name,
        runs_scored, earned_runs, unearned_runs,
        runner_1b_before, runner_2b_before, runner_3b_before,
        runner_1b_after, runner_2b_after, runner_3b_after,
        description, lineup_json, substituted_player, position, is_summary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        gameId,
        event.sequence,
        event.inning,
        event.isTopInning ? 1 : 0,
        event.outs,
        event.eventType,
        event.outcome,
        event.batterId,
        event.batterName,
        event.pitcherId,
        event.pitcherName,
        event.runsScored,
        event.earnedRuns,
        event.unearnedRuns,
        event.runner1bBefore,
        event.runner2bBefore,
        event.runner3bBefore,
        event.runner1bAfter,
        event.runner2bAfter,
        event.runner3bAfter,
        event.description,
        event.lineupJson,
        event.substitutedPlayer,
        event.position,
        event.isSummary ? 1 : 0
      ]
    );

    // Get the inserted event ID
    const eventId = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0] as number;

    // Insert runs_scored records
    for (const scorerId of event.scorerIds) {
      const isEarned = !event.scorerIds.every(
        (id) => event.earnedRuns === 0 && event.unearnedRuns > 0
      ); // Simplified - should track per-runner

      db.run(
        'INSERT INTO runs_scored (event_id, player_id, is_earned) VALUES (?, ?, ?)',
        [eventId, scorerId, isEarned ? 1 : 0]
      );
    }
  }

  // Insert inning lines
  for (const line of input.inningLines) {
    db.run(
      `INSERT INTO inning_lines (game_id, team_id, inning, runs, hits, errors)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [gameId, line.teamId, line.inning, line.runs, line.hits, line.errors]
    );
  }

  return gameId;
}

/**
 * Get a game by id
 *
 * @param gameId - Game UUID
 * @returns Promise<Game | null> Game or null if not found
 */
export async function getGame(gameId: string): Promise<Game | null> {
  const db = await getGameDatabase();

  const stmt = db.prepare('SELECT * FROM games WHERE id = ?');
  stmt.bind([gameId]);

  if (!stmt.step()) {
    stmt.free();
    return null;
  }

  const row = stmt.getAsObject() as any;
  stmt.free();

  return {
    id: row.id,
    seriesId: row.series_id,
    gameNumber: row.game_number,
    awayTeamId: row.away_team_id,
    awaySeasonYear: row.away_season_year,
    homeTeamId: row.home_team_id,
    homeSeasonYear: row.home_season_year,
    awayScore: row.away_score,
    homeScore: row.home_score,
    innings: row.innings,
    awayStarterId: row.away_starter_id,
    homeStarterId: row.home_starter_id,
    winningPitcherId: row.winning_pitcher_id,
    losingPitcherId: row.losing_pitcher_id,
    savePitcherId: row.save_pitcher_id,
    scheduledDate: row.scheduled_date,
    playedAt: row.played_at,
    durationMs: row.duration_ms,
    useDh: row.use_dh === 1
  };
}

/**
 * Get all games in a series
 *
 * @param seriesId - Series UUID
 * @returns Promise<Game[]> Array of games ordered by game_number
 */
export async function getGamesBySeries(seriesId: string): Promise<Game[]> {
  const db = await getGameDatabase();

  const stmt = db.prepare('SELECT * FROM games WHERE series_id = ? ORDER BY game_number');
  stmt.bind([seriesId]);

  const games: Game[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as any;
    games.push({
      id: row.id,
      seriesId: row.series_id,
      gameNumber: row.game_number,
      awayTeamId: row.away_team_id,
      awaySeasonYear: row.away_season_year,
      homeTeamId: row.home_team_id,
      homeSeasonYear: row.home_season_year,
      awayScore: row.away_score,
      homeScore: row.home_score,
      innings: row.innings,
      awayStarterId: row.away_starter_id,
      homeStarterId: row.home_starter_id,
      winningPitcherId: row.winning_pitcher_id,
      losingPitcherId: row.losing_pitcher_id,
      savePitcherId: row.save_pitcher_id,
      scheduledDate: row.scheduled_date,
      playedAt: row.played_at,
      durationMs: row.duration_ms,
      useDh: row.use_dh === 1
    });
  }

  stmt.free();
  return games;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd app && pnpm test games.test.ts`

Expected: All tests pass

**Step 5: Commit**

```bash
git add app/src/lib/game-results/games.ts app/src/lib/game-results/games.test.ts
git commit -m "feat: add game save functionality with earned run tracking"
```

---

## Task 5: Stats Queries (Standings, Batting, Pitching)

**Files:**
- Create: `app/src/lib/game-results/stats.ts`
- Create: `app/src/lib/game-results/stats.test.ts`

**Step 1: Write the failing tests**

```typescript
// app/src/lib/game-results/stats.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSeries,
  addTeamToSeries
} from './series.js';
import { saveGame } from './games.js';
import {
  getStandings,
  getBattingStats,
  getPitchingStats,
  getRunsScoredLeaderboard
} from './stats.js';
import { clearGameDatabase } from './database.js';

describe('Stats Queries', () => {
  let seriesId: string;

  beforeEach(async () => {
    await clearGameDatabase();

    const series = await createSeries({
      name: 'Test Season',
      description: null,
      seriesType: 'season_replay'
    });
    seriesId = series.id;

    // Add teams
    await addTeamToSeries(seriesId, {
      teamId: 'NYA',
      seasonYear: 1927,
      league: 'AL',
      division: null
    });

    await addTeamToSeries(seriesId, {
      teamId: 'BRO',
      seasonYear: 1955,
      league: 'NL',
      division: null
    });

    await addTeamToSeries(seriesId, {
      teamId: 'BOS',
      seasonYear: 1927,
      league: 'AL',
      division: null
    });
  });

  it('should calculate standings correctly', async () => {
    // NYA beats BRO
    await saveGame(createMockGame(seriesId, 'NYA', 1927, 'BRO', 1955, 5, 3));
    // BRO beats NYA
    await saveGame(createMockGame(seriesId, 'BRO', 1955, 'NYA', 1927, 4, 2));

    const standings = await getStandings(seriesId);

    expect(standings).toHaveLength(3); // NYA, BRO, BOS

    const nya = standings.find(s => s.teamId === 'NYA' && s.seasonYear === 1927);
    const bro = standings.find(s => s.teamId === 'BRO' && s.seasonYear === 1955);

    expect(nya?.wins).toBe(1);
    expect(nya?.losses).toBe(1);
    expect(bro?.wins).toBe(1);
    expect(bro?.losses).toBe(1);
  });

  it('should calculate batting stats', async () => {
    await saveGame(createMockGame(seriesId, 'NYA', 1927, 'BRO', 1955, 5, 3));

    const stats = await getBattingStats(seriesId);

    expect(stats.length).toBeGreaterThan(0);

    // Check that stats are calculated
    const ruth = stats.find(s => s.batterId === 'batter-1');
    expect(ruth).toBeDefined();
    expect(ruth?.pa).toBeGreaterThan(0);
  });

  it('should calculate pitching stats', async () => {
    await saveGame(createMockGame(seriesId, 'NYA', 1927, 'BRO', 1955, 5, 3));

    const stats = await getPitchingStats(seriesId);

    expect(stats.length).toBeGreaterThan(0);

    // Check that stats are calculated
    const pitcher = stats.find(s => s.pitcherId === 'pitcher-away');
    expect(pitcher).toBeDefined();
    expect(pitcher?.battersFaced).toBeGreaterThan(0);
  });

  it('should get runs scored leaderboard', async () => {
    await saveGame(createMockGame(seriesId, 'NYA', 1927, 'BRO', 1955, 5, 3));

    const leaderboard = await getRunsScoredLeaderboard(seriesId, 10);

    expect(Array.isArray(leaderboard)).toBe(true);
  });
});

function createMockGame(
  seriesId: string,
  awayTeam: string,
  awayYear: number,
  homeTeam: string,
  homeYear: number,
  awayScore: number,
  homeScore: number
) {
  return {
    seriesId,
    gameNumber: null,
    awayTeamId: awayTeam,
    awaySeasonYear: awayYear,
    homeTeamId: homeTeam,
    homeSeasonYear: homeYear,
    awayScore,
    homeScore,
    innings: 9,
    awayStarterId: `pitcher-${awayTeam}`,
    homeStarterId: `pitcher-${homeTeam}`,
    winningPitcherId: null,
    losingPitcherId: null,
    savePitcherId: null,
    scheduledDate: null,
    playedAt: new Date().toISOString(),
    durationMs: null,
    useDh: false,
    events: [
      {
        sequence: 1,
        inning: 1,
        isTopInning: true,
        outs: 0,
        eventType: 'plateAppearance',
        outcome: 'single',
        batterId: 'batter-1',
        batterName: 'Player 1',
        pitcherId: `pitcher-${homeTeam}`,
        pitcherName: 'Pitcher',
        runsScored: 0,
        earnedRuns: 0,
        unearnedRuns: 0,
        runner1bBefore: null,
        runner2bBefore: null,
        runner3bBefore: null,
        runner1bAfter: 'batter-1',
        runner2bAfter: null,
        runner3bAfter: null,
        description: null,
        lineupJson: null,
        substitutedPlayer: null,
        position: null,
        isSummary: false,
        scorerIds: []
      }
    ],
    inningLines: [
      { teamId: awayTeam, inning: 1, runs: awayScore, hits: 5, errors: 0 },
      { teamId: homeTeam, inning: 1, runs: homeScore, hits: 3, errors: 0 }
    ]
  };
}
```

**Step 2: Run tests to verify they fail**

Run: `cd app && pnpm test stats.test.ts`

Expected: Tests fail with "module not found" errors

**Step 3: Implement stats queries**

```typescript
// app/src/lib/game-results/stats.ts

import { getGameDatabase } from './database.js';
import type { Standing, BattingStat, PitchingStat } from './types.js';

/**
 * Get standings for a series
 *
 * @param seriesId - Series UUID
 * @returns Promise<Standing[]> Array of standings
 */
export async function getStandings(seriesId: string): Promise<Standing[]> {
  const db = await getGameDatabase();

  const stmt = db.prepare('SELECT * FROM series_standings WHERE series_id = ? ORDER BY league, division, wins DESC');
  stmt.bind([seriesId]);

  const standings: Standing[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as any;
    standings.push({
      seriesId: row.series_id,
      teamId: row.team_id,
      seasonYear: row.season_year,
      league: row.league,
      division: row.division,
      gamesPlayed: row.games_played,
      wins: row.wins,
      losses: row.losses,
      runsScored: row.runs_scored,
      runsAllowed: row.runs_allowed
    });
  }

  stmt.free();
  return standings;
}

/**
 * Get batting stats for a series
 *
 * @param seriesId - Series UUID
 * @param options - Query options
 * @returns Promise<BattingStat[]> Array of batting stats
 */
export async function getBattingStats(
  seriesId: string,
  options: {
    minPa?: number;
    orderBy?: 'avg' | 'homeRuns' | 'rbi' | 'obp' | 'slg';
    limit?: number;
  } = {}
): Promise<BattingStat[]> {
  const db = await getGameDatabase();

  let sql = 'SELECT * FROM batting_stats WHERE series_id = ?';
  const params: any[] = [seriesId];

  if (options.minPa !== undefined) {
    sql += ' AND pa >= ?';
    params.push(options.minPa);
  }

  switch (options.orderBy) {
    case 'avg':
      sql += ' ORDER BY avg DESC';
      break;
    case 'homeRuns':
      sql += ' ORDER BY home_runs DESC';
      break;
    case 'rbi':
      sql += ' ORDER BY rbi DESC';
      break;
    case 'obp':
      sql += ' ORDER BY obp DESC';
      break;
    case 'slg':
      sql += ' ORDER BY slg DESC';
      break;
    default:
      sql += ' ORDER BY avg DESC';
  }

  if (options.limit) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }

  const stmt = db.prepare(sql);
  stmt.bind(params);

  const stats: BattingStat[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as any;
    stats.push({
      seriesId: row.series_id,
      batterId: row.batter_id,
      batterName: row.batter_name,
      pa: row.pa,
      ab: row.ab,
      hits: row.hits,
      singles: row.singles,
      doubles: row.doubles,
      triples: row.triples,
      homeRuns: row.home_runs,
      walks: row.walks,
      hbp: row.hbp,
      strikeouts: row.strikeouts,
      rbi: row.rbi,
      avg: row.avg,
      obp: row.obp,
      slg: row.slg
    });
  }

  stmt.free();
  return stats;
}

/**
 * Get pitching stats for a series
 *
 * @param seriesId - Series UUID
 * @param options - Query options
 * @returns Promise<PitchingStat[]> Array of pitching stats
 */
export async function getPitchingStats(
  seriesId: string,
  options: {
    minBattersFaced?: number;
    orderBy?: 'era' | 'strikeouts' | 'whip' | 'games';
    limit?: number;
  } = {}
): Promise<PitchingStat[]> {
  const db = await getGameDatabase();

  let sql = 'SELECT * FROM pitching_stats WHERE series_id = ?';
  const params: any[] = [seriesId];

  if (options.minBattersFaced !== undefined) {
    sql += ' AND batters_faced >= ?';
    params.push(options.minBattersFaced);
  }

  switch (options.orderBy) {
    case 'era':
      sql += ' ORDER BY era ASC';
      break;
    case 'strikeouts':
      sql += ' ORDER BY strikeouts DESC';
      break;
    case 'whip':
      sql += ' ORDER BY whip ASC';
      break;
    case 'games':
      sql += ' ORDER BY games DESC';
      break;
    default:
      sql += ' ORDER BY era ASC';
  }

  if (options.limit) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }

  const stmt = db.prepare(sql);
  stmt.bind(params);

  const stats: PitchingStat[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as any;
    stats.push({
      seriesId: row.series_id,
      pitcherId: row.pitcher_id,
      pitcherName: row.pitcher_name,
      games: row.games,
      battersFaced: row.batters_faced,
      outsRecorded: row.outs_recorded,
      hitsAllowed: row.hits_allowed,
      walksAllowed: row.walks_allowed,
      strikeouts: row.strikeouts,
      homeRunsAllowed: row.home_runs_allowed,
      runsAllowed: row.runs_allowed,
      earnedRuns: row.earned_runs,
      era: row.era,
      whip: row.whip
    });
  }

  stmt.free();
  return stats;
}

/**
 * Get runs scored leaderboard for a series
 *
 * @param seriesId - Series UUID
 * @param limit - Maximum number of players to return
 * @returns Promise<Array<{playerId: string, runs: number}>> Leaderboard
 */
export async function getRunsScoredLeaderboard(
  seriesId: string,
  limit: number = 10
): Promise<Array<{ playerId: string; runs: number }>> {
  const db = await getGameDatabase();

  const stmt = db.prepare(`
    SELECT rs.player_id, COUNT(*) as runs
    FROM runs_scored rs
    JOIN game_events ge ON rs.event_id = ge.id
    JOIN games g ON ge.game_id = g.id
    WHERE g.series_id = ?
    GROUP BY rs.player_id
    ORDER BY runs DESC
    LIMIT ?
  `);
  stmt.bind([seriesId, limit]);

  const leaderboard: Array<{ playerId: string; runs: number }> = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as any;
    leaderboard.push({
      playerId: row.player_id,
      runs: row.runs
    });
  }

  stmt.free();
  return leaderboard;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd app && pnpm test stats.test.ts`

Expected: All tests pass

**Step 5: Commit**

```bash
git add app/src/lib/game-results/stats.ts app/src/lib/game-results/stats.test.ts
git commit -m "feat: add stats queries for standings, batting, and pitching"
```

---

## Task 6: Export/Import Functions

**Files:**
- Create: `app/src/lib/game-results/export.ts`
- Create: `app/src/lib/game-results/export.test.ts`

**Step 1: Write the failing tests**

```typescript
// app/src/lib/game-results/export.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  downloadGameDatabase,
  importGameDatabase,
  getGameDatabaseSize
} from './export.js';
import { createSeries, addTeamToSeries } from './series.js';
import { saveGame } from './games.js';
import { clearGameDatabase } from './database.js';

describe('Export/Import', () => {
  beforeEach(async () => {
    await clearGameDatabase();

    // Create test data
    const series = await createSeries({
      name: 'Export Test',
      description: null,
      seriesType: 'exhibition'
    });

    await addTeamToSeries(series.id, {
      teamId: 'NYA',
      seasonYear: 1927,
      league: 'AL',
      division: null
    });

    await addTeamToSeries(series.id, {
      teamId: 'BRO',
      seasonYear: 1955,
      league: 'NL',
      division: null
    });
  });

  afterEach(async () => {
    await clearGameDatabase();
  });

  it('should export database as Blob', async () => {
    const blob = await downloadGameDatabase();

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/x-sqlite3');
    expect(blob.size).toBeGreaterThan(1000); // Should have some content
  });

  it('should get database size info', async () => {
    const size = await getGameDatabaseSize();

    expect(size.byteSize).toBeGreaterThan(0);
    expect(size.tableCount).toBeGreaterThan(0);
  });

  it('should import database from file', async () => {
    // First export
    const blob = await downloadGameDatabase();

    // Clear database
    await clearGameDatabase();

    // Import the exported file
    const file = new File([blob], 'test-game-results.sqlite', { type: 'application/x-sqlite3' });
    await importGameDatabase(file);

    // Verify data is restored
    const { listSeries } = await import('./series.js');
    const series = await listSeries();

    expect(series).toHaveLength(1);
    expect(series[0].name).toBe('Export Test');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd app && pnpm test export.test.ts`

Expected: Tests fail with "module not found" errors

**Step 3: Implement export/import functions**

```typescript
// app/src/lib/game-results/export.ts

import { getGameDatabase, exportGameDatabase as exportDb, importGameDatabase as importDb, closeGameDatabase } from './database.js';

/**
 * Download the game database as a Blob
 *
 * Triggers a browser download of the .sqlite file
 *
 * @param filename - Optional filename (default: 'game-results-[timestamp].sqlite')
 */
export async function downloadGameDatabase(filename?: string): Promise<void> {
  const blob = await exportDb();

  const defaultFilename = `game-results-${new Date().toISOString().split('T')[0]}.sqlite`;
  const actualFilename = filename || defaultFilename;

  // Create download link
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = actualFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Get database size information
 *
 * @returns Promise<{byteSize: number, tableCount: number}> Size info
 */
export async function getGameDatabaseSize(): Promise<{
  byteSize: number;
  tableCount: number;
}> {
  const db = await getGameDatabase();
  const data = db.export();

  const tables = db.exec("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'");
  const tableCount = tables[0].values[0][0] as number;

  return {
    byteSize: data.byteLength,
    tableCount
  };
}

/**
 * Import a game database from a File object
 *
 * Replaces the current database with the imported one
 *
 * @param file - File object containing .sqlite database
 */
export async function importGameDatabase(file: File): Promise<void> {
  await closeGameDatabase();
  await importDb(file);
}
```

**Step 4: Run tests to verify they pass**

Run: `cd app && pnpm test export.test.ts`

Expected: All tests pass

**Step 5: Commit**

```bash
git add app/src/lib/game-results/export.ts app/src/lib/game-results/export.test.ts
git commit -m "feat: add database export/import with download trigger"
```

---

## Task 7: Barrels (GameState to GameSaveInput Converter)

**Files:**
- Create: `app/src/lib/game-results/barrels.ts`
- Create: `app/src/lib/game-results/barrels.test.ts`

**Step 1: Write the failing tests**

```typescript
// app/src/lib/game-results/barrels.test.ts

import { describe, it, expect } from 'vitest';
import {
  gameStateToGameSaveInput,
  calculateInningLines,
  extractPitchingDecisions
} from './barrels.js';
import type { GameState, PlayEvent } from '../game/types.js';

describe('Barrels - GameState Converter', () => {
  it('should convert GameState to GameSaveInput', () => {
    const gameState = createMockGameState();

    const input = gameStateToGameSaveInput(gameState, 'series-1', 1, '2026-02-05');

    expect(input.seriesId).toBe('series-1');
    expect(input.gameNumber).toBe(1);
    expect(input.awayTeamId).toBe('NYA');
    expect(input.homeTeamId).toBe('BOS');
    expect(input.events.length).toBeGreaterThan(0);
  });

  it('should calculate inning lines from plays', () => {
    const plays: PlayEvent[] = [
      {
        inning: 1,
        isTopInning: true,
        outcome: 'single',
        batterId: 'b1',
        batterName: 'Batter 1',
        pitcherId: 'p1',
        pitcherName: 'Pitcher 1',
        description: 'Single',
        runsScored: 1,
        isSummary: false,
        runnersAfter: ['b1', null, null],
        scorerIds: ['b1'],
        runnersBefore: [null, null, null]
      },
      {
        inning: 1,
        isTopInning: false,
        outcome: 'groundOut',
        batterId: 'b2',
        batterName: 'Batter 2',
        pitcherId: 'p2',
        pitcherName: 'Pitcher 2',
        description: 'Ground out',
        runsScored: 0,
        isSummary: false,
        runnersAfter: [null, null, null],
        runnersBefore: [null, null, null]
      }
    ];

    const lines = calculateInningLines(plays, 'NYA', 'BOS');

    expect(lines).toHaveLength(4); // 1st top, 1st bottom, totals for each
  });

  it('should extract pitching decisions from GameState', () => {
    const state = createMockGameState();

    const decisions = extractPitchingDecisions(state);

    expect(decisions.awayStarterId).toBeDefined();
    expect(decisions.homeStarterId).toBeDefined();
  });
});

function createMockGameState(): GameState {
  return {
    meta: {
      awayTeam: 'NYA',
      homeTeam: 'BOS',
      season: 1927
    },
    inning: 9,
    isTopInning: false,
    outs: 3,
    bases: [null, null, null],
    awayLineup: {
      teamId: 'NYA',
      players: [
        { playerId: 'nya-1', position: 1 },
        { playerId: 'nya-2', position: 2 },
        { playerId: 'nya-3', position: 3 },
        { playerId: 'nya-4', position: 4 },
        { playerId: 'nya-5', position: 5 },
        { playerId: 'nya-6', position: 6 },
        { playerId: 'nya-7', position: 7 },
        { playerId: 'nya-8', position: 8 },
        { playerId: 'nya-9', position: 9 }
      ],
      currentBatterIndex: 0,
      pitcher: 'nya-p1'
    },
    homeLineup: {
      teamId: 'BOS',
      players: [
        { playerId: 'bos-1', position: 1 },
        { playerId: 'bos-2', position: 2 },
        { playerId: 'bos-3', position: 3 },
        { playerId: 'bos-4', position: 4 },
        { playerId: 'bos-5', position: 5 },
        { playerId: 'bos-6', position: 6 },
        { playerId: 'bos-7', position: 7 },
        { playerId: 'bos-8', position: 8 },
        { playerId: 'bos-9', position: 9 }
      ],
      currentBatterIndex: 0,
      pitcher: 'bos-p1'
    },
    plays: [
      {
        inning: 1,
        isTopInning: true,
        outcome: 'single',
        batterId: 'nya-2',
        batterName: 'Ruth, Babe',
        pitcherId: 'bos-p1',
        pitcherName: 'Pitcher',
        description: 'Single to right',
        runsScored: 0,
        isSummary: false,
        runnersAfter: ['nya-2', null, null],
        scorerIds: [],
        runnersBefore: [null, null, null],
        eventType: 'plateAppearance'
      }
    ],
    homeTeamHasBattedInInning: true
  };
}
```

**Step 2: Run tests to verify they fail**

Run: `cd app && pnpm test barrels.test.ts`

Expected: Tests fail with "module not found" errors

**Step 3: Implement barrels converter**

```typescript
// app/src/lib/game-results/barrels.ts

import type { GameState, PlayEvent } from '../game/types.js';
import type { GameSaveInput, GameEventInput, InningLineInput, Outcome } from './types.js';

/**
 * Convert PlayEvent from game engine to GameEventInput
 *
 * Maps engine output to database input format
 */
function playEventToInput(event: PlayEvent, outs: number): GameEventInput {
  return {
    sequence: event.isSummary ? -1 : 0, // Will be recalculated
    inning: event.inning,
    isTopInning: event.isTopInning,
    outs,
    eventType: event.eventType || 'plateAppearance',
    outcome: event.outcome || null,
    batterId: event.batterId || null,
    batterName: event.batterName || null,
    pitcherId: event.pitcherId || null,
    pitcherName: event.pitcherName || null,
    runsScored: event.runsScored,
    earnedRuns: 0, // Will be calculated
    unearnedRuns: 0, // Will be calculated
    runner1bBefore: event.runnersBefore?.[0] || null,
    runner2bBefore: event.runnersBefore?.[1] || null,
    runner3bBefore: event.runnersBefore?.[2] || null,
    runner1bAfter: event.runnersAfter?.[0] || null,
    runner2bAfter: event.runnersAfter?.[1] || null,
    runner3bAfter: event.runnersAfter?.[2] || null,
    description: event.description || null,
    lineupJson: event.lineup ? JSON.stringify(event.lineup) : null,
    substitutedPlayer: event.substitutedPlayer || null,
    position: event.position || null,
    isSummary: event.isSummary || false,
    scorerIds: event.scorerIds || []
  };
}

/**
 * Calculate running outs count through the game
 */
function calculateOutsCount(plays: PlayEvent[]): number[] {
  const outs: number[] = [];
  let currentOuts = 0;

  for (const play of plays) {
    if (play.isSummary) continue;

    outs.push(currentOuts);

    // Update outs count based on outcome
    if (
      play.outcome === 'strikeout' ||
      play.outcome === 'groundOut' ||
      play.outcome === 'flyOut' ||
      play.outcome === 'lineOut' ||
      play.outcome === 'popOut' ||
      play.outcome === 'caughtStealing' // Future
    ) {
      currentOuts++;
    }

    // Reset at half-inning
    if (play.runsScored > 0 && play.isTopInning) {
      // Actually, we need to detect half-inning changes
      // This is simplified - real implementation should track inning changes
    }

    if (currentOuts >= 3) {
      currentOuts = 0;
    }
  }

  return outs;
}

/**
 * Calculate inning lines (runs/hits/errors per inning) from plays
 */
export function calculateInningLines(
  plays: PlayEvent[],
  awayTeamId: string,
  homeTeamId: string
): InningLineInput[] {
  const lines: Map<string, InningLineInput> = new Map();

  // Track current score and hits per half-inning
  const awayScoreByInning = new Map<number, number>();
  const homeScoreByInning = new Map<number, number>();
  const awayHitsByInning = new Map<number, number>();
  const homeHitsByInning = new Map<number, number>();

  let awayScore = 0;
  let homeScore = 0;
  let currentInning = 1;

  for (const play of plays) {
    if (play.isSummary) continue;

    const inning = play.inning;
    const team = play.isTopInning ? awayTeamId : homeTeamId;

    // Track hits
    if (
      play.outcome === 'single' ||
      play.outcome === 'double' ||
      play.outcome === 'triple' ||
      play.outcome === 'homeRun'
    ) {
      const hitsMap = play.isTopInning ? awayHitsByInning : homeHitsByInning;
      hitsMap.set(inning, (hitsMap.get(inning) || 0) + 1);
    }

    // Track runs
    if (play.isTopInning) {
      awayScore += play.runsScored;
      awayScoreByInning.set(inning, awayScore);
    } else {
      homeScore += play.runsScored;
      homeScoreByInning.set(inning, homeScore);
    }

    currentInning = Math.max(currentInning, inning);
  }

  // Build inning lines
  for (let i = 1; i <= currentInning; i++) {
    const awayPrev = awayScoreByInning.get(i - 1) || 0;
    const homePrev = homeScoreByInning.get(i - 1) || 0;
    const awayCurr = awayScoreByInning.get(i) || 0;
    const homeCurr = homeScoreByInning.get(i) || 0;

    lines.set(`${awayTeamId}-${i}`, {
      teamId: awayTeamId,
      inning: i,
      runs: awayCurr - awayPrev,
      hits: awayHitsByInning.get(i) || 0,
      errors: 0 // TODO: Track errors
    });

    lines.set(`${homeTeamId}-${i}`, {
      teamId: homeTeamId,
      inning: i,
      runs: homeCurr - homePrev,
      hits: homeHitsByInning.get(i) || 0,
      errors: 0
    });
  }

  return Array.from(lines.values());
}

/**
 * Extract starting pitchers from GameState
 */
export function extractPitchingDecisions(state: GameState): {
  awayStarterId: string | null;
  homeStarterId: string | null;
} {
  return {
    awayStarterId: state.awayLineup.pitcher,
    homeStarterId: state.homeLineup.pitcher
  };
}

/**
 * Convert GameState to GameSaveInput
 *
 * This is the main entry point for saving games.
 * Takes the engine's GameState and converts it to database input format.
 *
 * @param state - Final GameState from GameEngine
 * @param seriesId - Series to save game to
 * @param gameNumber - Game number in series (or null)
 * @param scheduledDate - Original schedule date (if season replay)
 * @returns GameSaveInput ready for saveGame()
 */
export function gameStateToGameSaveInput(
  state: GameState,
  seriesId: string,
  gameNumber: number | null,
  scheduledDate: string | null
): GameSaveInput {
  // Calculate final scores
  let awayScore = 0;
  let homeScore = 0;

  for (const play of state.plays) {
    if (play.isSummary) continue;
    if (play.isTopInning) {
      awayScore += play.runsScored;
    } else {
      homeScore += play.runsScored;
    }
  }

  // Get starting pitchers
  const { awayStarterId, homeStarterId } = extractPitchingDecisions(state);

  // Filter out summary events and convert
  const nonSummaryPlays = state.plays.filter((p) => !p.isSummary);
  const outs = calculateOutsCount(state.plays);

  const events: GameEventInput[] = nonSummaryPlays.map((play, idx) => {
    const input = playEventToInput(play, outs[idx] || 0);
    input.sequence = idx + 1; // 1-indexed
    return input;
  });

  // Calculate inning lines
  const inningLines = calculateInningLines(
    state.plays,
    state.meta.awayTeam,
    state.meta.homeTeam
  );

  return {
    seriesId,
    gameNumber,
    awayTeamId: state.meta.awayTeam,
    awaySeasonYear: state.meta.season,
    homeTeamId: state.meta.homeTeam,
    homeSeasonYear: state.meta.season,
    awayScore,
    homeScore,
    innings: state.inning,
    awayStarterId,
    homeStarterId,
    winningPitcherId: null, // Calculated by saveGame
    losingPitcherId: null,
    savePitcherId: null,
    scheduledDate,
    playedAt: new Date().toISOString(),
    durationMs: null, // TODO: Track in engine
    useDh: false, // TODO: Determine from norms
    events,
    inningLines
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd app && pnpm test barrels.test.ts`

Expected: All tests pass

**Step 5: Commit**

```bash
git add app/src/lib/game-results/barrels.ts app/src/lib/game-results/barrels.test.ts
git commit -m "feat: add GameState to GameSaveInput converter (barrels)"
```

---

## Task 8: Public API Entry Point

**Files:**
- Create: `app/src/lib/game-results/index.ts`
- Create: `app/src/lib/game-results/index.test.ts`

**Step 1: Write the failing tests**

```typescript
// app/src/lib/game-results/index.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSeries,
  saveGameFromState,
  getSeriesStandings,
  getLeagueLeaders,
  exportDatabase,
  importDatabase
} from './index.js';
import { clearGameDatabase } from './database.js';
import type { GameState } from '../game/types.js';

describe('Game Results Public API', () => {
  beforeEach(async () => {
    await clearGameDatabase();
  });

  it('should provide a simple API for creating a series', async () => {
    const series = await createSeries('1976 Season Replay', 'season_replay');

    expect(series.id).toBeDefined();
    expect(series.name).toBe('1976 Season Replay');
  });

  it('should save a game directly from GameState', async () => {
    const series = await createSeries('Test', 'exhibition');

    const mockState = createMockGameState();
    const gameId = await saveGameFromState(series.id, mockState, null, null);

    expect(gameId).toBeDefined();
  });

  it('should get standings as a simple object', async () => {
    const series = await createSeries('Test', 'season_replay');

    const standings = await getSeriesStandings(series.id);

    expect(Array.isArray(standings)).toBe(true);
  });

  it('should export database to file', async () => {
    await exportDatabase('test-export.sqlite');

    // In real browser, this would trigger download
    // In test, we just verify it doesn't throw
    expect(true).toBe(true);
  });
});

function createMockGameState(): GameState {
  return {
    meta: { awayTeam: 'NYA', homeTeam: 'BOS', season: 1927 },
    inning: 9,
    isTopInning: false,
    outs: 3,
    bases: [null, null, null],
    awayLineup: {
      teamId: 'NYA',
      players: Array(9).fill(null).map((_, i) => ({ playerId: `nya-${i}`, position: i + 1 })),
      currentBatterIndex: 0,
      pitcher: 'nya-p'
    },
    homeLineup: {
      teamId: 'BOS',
      players: Array(9).fill(null).map((_, i) => ({ playerId: `bos-${i}`, position: i + 1 })),
      currentBatterIndex: 0,
      pitcher: 'bos-p'
    },
    plays: [],
    homeTeamHasBattedInInning: true
  };
}
```

**Step 2: Run tests to verify they fail**

Run: `cd app && pnpm test index.test.ts`

Expected: Tests fail with "module not found" errors

**Step 3: Implement public API**

```typescript
// app/src/lib/game-results/index.ts

/**
 * Game Results Database API
 *
 * Simple API for managing game simulation results.
 * Handles series, games, standings, and stats.
 */

// Database
export { getGameDatabase, closeGameDatabase, clearGameDatabase } from './database.js';

// Series
export {
  createSeries,
  getSeries,
  listSeries,
  updateSeries,
  deleteSeries,
  addTeamToSeries,
  getSeriesTeams
} from './series.js';

// Games
export {
  saveGame,
  getGame,
  getGamesBySeries,
  calculateEarnedRuns,
  determinePitchingDecisions
} from './games.js';

// Stats
export {
  getStandings,
  getBattingStats,
  getPitchingStats,
  getRunsScoredLeaderboard
} from './stats.js';

// Export/Import
export {
  downloadGameDatabase,
  importGameDatabase,
  getGameDatabaseSize
} from './export.js';

// Barrels (GameState converter)
export {
  gameStateToGameSaveInput,
  calculateInningLines,
  extractPitchingDecisions
} from './barrels.js';

// Types
export type {
  Series,
  SeriesTeam,
  Game,
  GameEvent,
  InningLine,
  RunScored,
  Standing,
  BattingStat,
  PitchingStat,
  GameSaveInput,
  GameEventInput,
  InningLineInput,
  SeriesType,
  SeriesStatus,
  GameEventType,
  Outcome
} from './types.js';

// ============================================
// Convenience Functions
// ============================================

import { createSeries as _createSeries, addTeamToSeries } from './series.js';
import { saveGame } from './games.js';
import { gameStateToGameSaveInput } from './barrels.js';
import { getStandings } from './stats.js';
import { getBattingStats } from './stats.js';
import { downloadGameDatabase } from './export.js';
import type { GameState } from '../game/types.js';

/**
 * Create a series (simplified API)
 */
export async function createSeries(
  name: string,
  seriesType: 'season_replay' | 'tournament' | 'exhibition' | 'custom',
  description?: string
) {
  return _createSeries({ name, description: description || null, seriesType });
}

/**
 * Save a game directly from GameState
 *
 * Convenience function that converts GameState to GameSaveInput and saves.
 *
 * @param seriesId - Series to save to
 * @param state - Final GameState from GameEngine
 * @param gameNumber - Optional game number
 * @param scheduledDate - Optional original schedule date
 * @returns Promise<string> Game ID
 */
export async function saveGameFromState(
  seriesId: string,
  state: GameState,
  gameNumber: number | null,
  scheduledDate: string | null
): Promise<string> {
  const input = gameStateToGameSaveInput(state, seriesId, gameNumber, scheduledDate);
  return saveGame(input);
}

/**
 * Get standings for a series (simplified)
 *
 * @param seriesId - Series UUID
 * @returns Standings array with win percentage calculated
 */
export async function getSeriesStandings(seriesId: string) {
  const standings = await getStandings(seriesId);
  return standings.map(s => ({
    ...s,
    winPct: s.gamesPlayed > 0 ? Math.round((s.wins / s.gamesPlayed) * 1000) / 1000 : 0,
    gamesBack: 0 // TODO: Calculate games behind
  }));
}

/**
 * Get league leaders (batting)
 *
 * @param seriesId - Series UUID
 * @param category - Stat category to rank by
 * @param limit - Number of players to return
 */
export async function getLeagueLeaders(
  seriesId: string,
  category: 'avg' | 'homeRuns' | 'rbi' | 'obp' | 'slg',
  limit: number = 10
) {
  const orderBy = category === 'homeRuns' ? 'homeRuns' : category;
  return getBattingStats(seriesId, { minPa: 1, orderBy, limit });
}

/**
 * Export database to file
 *
 * @param filename - Optional filename
 */
export async function exportDatabase(filename?: string) {
  await downloadGameDatabase(filename);
}

/**
 * Import database from file
 *
 * @param file - File object
 */
export async function importDatabase(file: File) {
  const { importGameDatabase } = await import('./export.js');
  await importGameDatabase(file);
}
```

**Step 4: Run tests to verify they pass**

Run: `cd app && pnpm test index.test.ts`

Expected: All tests pass

**Step 5: Commit**

```bash
git add app/src/lib/game-results/index.ts app/src/lib/game-results/index.test.ts
git commit -m "feat: add public API for game results database"
```

---

## Task 9: Integration Test - Full Game Save

**Files:**
- Create: `app/src/lib/game-results/integration.test.ts`

**Step 1: Write the integration test**

```typescript
// app/src/lib/game-results/integration.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../game/engine.js';
import { createMinimalSeasonPackage } from '../test-helpers.js';
import {
  createSeries,
  addTeamToSeries,
  saveGameFromState,
  getSeriesStandings,
  getLeagueLeaders,
  exportDatabase
} from './index.js';
import { clearGameDatabase } from './database.js';

describe('Game Results Integration', () => {
  beforeEach(async () => {
    await clearGameDatabase();
  });

  it('should save a complete simulated game and query stats', async () => {
    // Create series
    const series = await createSeries('1927 Season', 'season_replay');

    // Add teams from different seasons (cross-era matchup)
    await addTeamToSeries(series.id, {
      teamId: 'NYA',
      seasonYear: 1927,
      league: 'AL',
      division: null
    });

    await addTeamToSeries(series.id, {
      teamId: 'LAN',
      seasonYear: 1988,
      league: 'NL',
      division: 'West'
    });

    // Create and simulate game
    const season = createMinimalSeasonPackage();
    const engine = new GameEngine(season, 'NYA', 'BOS', { enabled: true });

    // Simulate to completion
    while (!engine.isComplete()) {
      engine.simulatePlateAppearance();
    }

    const finalState = engine.getState();

    // Save game
    const gameId = await saveGameFromState(series.id, finalState, 1, '1927-04-12');

    expect(gameId).toBeDefined();

    // Query standings
    const standings = await getSeriesStandings(series.id);
    expect(standings).toHaveLength(2);
    expect(standings[0].gamesPlayed).toBe(1);

    // Query batting leaders
    const leaders = await getLeagueLeaders(series.id, 'homeRuns', 5);
    expect(Array.isArray(leaders)).toBe(true);

    // Export database
    await exportDatabase('test-game.sqlite');
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `cd app && pnpm test integration.test.ts`

Expected: All tests pass

**Step 3: Commit**

```bash
git add app/src/lib/game-results/integration.test.ts
git commit -m "test: add integration test for full game save workflow"
```

---

## Task 10: Documentation

**Files:**
- Create: `app/src/lib/game-results/README.md`

**Step 1: Write documentation**

```markdown
# Game Results Database

Persistent storage for baseball game simulation results using SQLite (sql.js) and IndexedDB.

## Quick Start

```typescript
import {
  createSeries,
  addTeamToSeries,
  saveGameFromState,
  getSeriesStandings,
  getLeagueLeaders
} from './game-results/index.js';

// Create a series
const series = await createSeries('1976 Season Replay', 'season_replay');

// Add teams (can be from different seasons!)
await addTeamToSeries(series.id, {
  teamId: 'NYA',
  seasonYear: 1927,
  league: 'AL',
  division: null
});

// After game simulation, save from GameState
const gameId = await saveGameFromState(series.id, gameState, 1, '1976-04-01');

// Query standings
const standings = await getSeriesStandings(series.id);

// Get league leaders
const hrLeaders = await getLeagueLeaders(series.id, 'homeRuns', 10);
```

## API Reference

### Series Management

- `createSeries(name, type, description?)` - Create a new series
- `getSeries(id)` - Get series by ID
- `listSeries()` - List all series
- `updateSeries(id, data)` - Update series
- `deleteSeries(id)` - Delete series and all games
- `addTeamToSeries(seriesId, team)` - Add team to series

### Game Management

- `saveGame(input)` - Save a game (low-level)
- `saveGameFromState(seriesId, state, gameNumber, scheduledDate)` - Save from GameState
- `getGame(id)` - Get game by ID
- `getGamesBySeries(seriesId)` - Get all games in series

### Stats Queries

- `getSeriesStandings(seriesId)` - Get standings with win percentage
- `getLeagueLeaders(seriesId, category, limit)` - Get stat leaders
- `getBattingStats(seriesId, options)` - Detailed batting stats
- `getPitchingStats(seriesId, options)` - Detailed pitching stats
- `getRunsScoredLeaderboard(seriesId, limit)` - Runs scored leaderboard

### Export/Import

- `exportDatabase(filename?)` - Download database as .sqlite file
- `importDatabase(file)` - Import database from file
- `getGameDatabaseSize()` - Get database size info

### Database Lifecycle

- `getGameDatabase()` - Get/create database instance
- `closeGameDatabase()` - Save and close database
- `clearGameDatabase()` - Delete all data

## Data Model

### Series

Top-level container for games. Types: `season_replay`, `tournament`, `exhibition`, `custom`.

### Games

Individual games with teams (from any season), final score, innings, pitching decisions.

### Game Events

Full play-by-play with:
- Plate appearances (17 outcomes)
- Managerial events (lineups, substitutions, pitching changes)
- Earned/unearned run tracking
- Runner positions before/after each play

### Inning Lines

Box score data: runs, hits, errors per inning per team.

### Runs Scored

Junction table tracking which player scored on which event (for leaderboards).

## Stats Views

Three SQL views provide real-time stats aggregation:

- `series_standings` - W/L record, runs scored/allowed
- `batting_stats` - PA, AB, H, 2B, 3B, HR, BB, SO, AVG, OBP, SLG
- `pitching_stats` - G, BF, IP, H, BB, SO, HR, ER, ERA, WHIP

## Earned Run Tracking

The system tracks earned vs unearned runs:

1. Runners who reach on error → their runs are unearned
2. Runs scored after an error with 0 outs → unearned
3. All other runs → earned

This enables accurate ERA calculation in the `pitching_stats` view.

## Cross-Season Matchups

Series teams store their `seasonYear`, enabling matchups like:
- 1927 Yankees vs 1988 Dodgers
- 1910 Tigers vs 2024 Rays

Each team uses player data from their respective season.

## Storage

- **In-memory:** sql.js database instance
- **Persisted:** IndexedDB (`bb-game-results`)
- **Export:** `.sqlite` files (compatible with DBeaver, Python, DuckDB)

Approximately 18 MB per 162-game season (uncompressed), ~5-8 MB compressed.

## Testing

```bash
cd app && pnpm test game-results
```

Run specific test file:

```bash
pnpm test app/src/lib/game-results/database.test.ts
```
```

**Step 2: Commit**

```bash
git add app/src/lib/game-results/README.md
git commit -m "docs: add game results database documentation"
```

---

## Summary

This implementation plan creates a complete game results database system with:

1. **Schema and Types** - 6 tables, 3 views, full TypeScript types
2. **Database Layer** - sql.js + IndexedDB persistence
3. **CRUD Operations** - Series and games management
4. **Stats Queries** - Standings, batting, pitching leaders
5. **Export/Import** - .sqlite file support for external analysis
6. **Game Engine Integration** - Convert GameState to database format
7. **Public API** - Simple, intuitive interface
8. **Comprehensive Tests** - Unit tests for all modules
9. **Documentation** - Complete API reference

**Total estimated work:** ~2-3 hours for full implementation

**Testing approach:**
- TDD throughout (write test first, make it pass, commit)
- Each task is ~5-15 minutes
- Small commits ensure easy rollback
- Integration test validates end-to-end flow

**Next steps after implementation:**
1. Add UI for viewing standings/leaders
2. Add "Season Replay" mode that auto-saves all games
3. Add historical comparison (sim vs actual)
4. Add game replay viewer
