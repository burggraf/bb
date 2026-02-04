# SQLite Conversion Plan: From JSON to wa-sqlite

## Overview

Convert the baseball simulation app from JSON-based season data to SQLite using:
- **Data Prep**: `better-sqlite3` to create `.sqlite` files
- **Browser**: `wa-sqlite` with OPFS for persistent storage
- **Tests**: `better-sqlite3` opening the same SQLite files for 100% parity

## Benefits

1. **100% Test Parity**: Tests run against the exact same data as production
2. **Lazy Loading**: Only load queried data, not entire season in memory
3. **Query Power**: Use SQL for filtering, aggregations, and joins
4. **Compression**: SQLite compresses better than JSON
5. **Simpler Data Flow**: No JSON parsing, no transformation layers

---

## Phase 1: Data Preparation Pipeline

### File: `data-prep/src/export-season.ts`

**Current Behavior:**
- Runs DuckDB queries
- Parses CSV output
- Builds in-memory SeasonPackage object
- Writes JSON to `app/static/seasons/{year}.json`

**New Behavior:**
- Runs DuckDB queries (unchanged)
- Parses CSV output (unchanged)
- **NEW**: Creates SQLite database with `better-sqlite3`
- **NEW**: Inserts data into normalized tables
- **NEW**: Writes `app/static/seasons/{year}.sqlite`

### Implementation Steps

#### 1.1 Add Dependencies

```bash
cd data-prep
pnpm add better-sqlite3
```

#### 1.2 Create Database Schema

```typescript
// In export-season.ts, add new function:

import Database from 'better-sqlite3';

function createSeasonSchema(db: Database.Database) {
  db.exec(`
    -- Meta table
    CREATE TABLE meta (
      year INTEGER PRIMARY KEY,
      generated_at TEXT NOT NULL,
      version TEXT NOT NULL
    );

    -- Norms table (stored as JSON for simplicity)
    CREATE TABLE norms (
      year INTEGER PRIMARY KEY,
      era TEXT NOT NULL,
      norms_json TEXT NOT NULL
    );

    -- Batters table
    CREATE TABLE batters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      bats TEXT NOT NULL CHECK(bats IN ('L', 'R', 'S')),
      team_id TEXT NOT NULL,
      primary_position INTEGER NOT NULL,
      position_eligibility TEXT NOT NULL, -- JSON: {position: count}
      pa INTEGER NOT NULL,
      avg REAL NOT NULL,
      obp REAL NOT NULL,
      slg REAL NOT NULL,
      ops REAL NOT NULL
    );

    -- Batter rates (17 outcomes × 2 splits = 34 columns per row)
    CREATE TABLE batter_rates (
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
    CREATE TABLE pitchers (
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
    CREATE TABLE pitcher_rates (
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
    CREATE TABLE league_averages (
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
    CREATE TABLE pitcher_batter_league (
      split TEXT PRIMARY KEY CHECK(split IN ('vsLHP', 'vsRHP')),
      rates_json TEXT NOT NULL
    );

    -- Teams table
    CREATE TABLE teams (
      id TEXT PRIMARY KEY,
      league TEXT NOT NULL,
      city TEXT NOT NULL,
      nickname TEXT NOT NULL
    );

    -- Games table
    CREATE TABLE games (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      away_team TEXT NOT NULL,
      home_team TEXT NOT NULL,
      use_dh INTEGER NOT NULL CHECK(use_dh IN (0, 1)),
      FOREIGN KEY (away_team) REFERENCES teams(id),
      FOREIGN KEY (home_team) REFERENCES teams(id)
    );

    -- Indexes for common queries
    CREATE INDEX idx_batters_team ON batters(team_id);
    CREATE INDEX idx_batters_position ON batters(primary_position);
    CREATE INDEX idx_pitchers_team ON pitchers(team_id);
    CREATE INDEX idx_games_date ON games(date);
  `);
}

function eventRatesToSQL(rates: EventRates): Record<string, number> {
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
```

#### 1.3 Replace JSON Export with SQLite Export

```typescript
export async function exportSeasonAsSqlite(
  year: number,
  dbPath: string,
  outputPath: string
): Promise<void> {
  console.log(`📦 Exporting ${year} season to SQLite: ${outputPath}...\n`);

  // Create SQLite database
  const db = new Database(outputPath);
  createSeasonSchema(db);

  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL');

  // Extract data (reuse existing queries)
  const season = await exportSeason(year, dbPath, '/tmp/unused.json');

  // Insert data in transactions
  insertMeta(db, season);
  insertNorms(db, season);
  insertBatters(db, season.batters);
  insertPitchers(db, season.pitchers);
  insertLeagueAverages(db, season.league);
  insertTeams(db, season.teams);
  insertGames(db, season.games);

  db.close();
  console.log(`\n✅ Season exported to ${outputPath}`);
}

function insertBatters(db: Database.Database, batters: Record<string, BatterStats>) {
  const insertBatter = db.prepare(`
    INSERT INTO batters (id, name, bats, team_id, primary_position, position_eligibility, pa, avg, obp, slg, ops)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertRates = db.prepare(`
    INSERT INTO batter_rates (
      batter_id, split, single, double, triple, home_run, walk, hit_by_pitch, strikeout,
      ground_out, fly_out, line_out, pop_out, sacrifice_fly, sacrifice_bunt,
      fielders_choice, reached_on_error, catcher_interference
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((batterList: BatterStats[]) => {
    for (const batter of batterList) {
      insertBatter.run(
        batter.id,
        batter.name,
        batter.bats,
        batter.teamId,
        batter.primaryPosition,
        JSON.stringify(batter.positionEligibility),
        batter.pa,
        batter.avg,
        batter.obp,
        batter.slg,
        batter.ops
      );

      // Insert vsLHP rates
      const vsLHP = eventRatesToSQL(batter.rates.vsLHP);
      insertRates.run(
        batter.id, 'vsLHP',
        vsLHP.single, vsLHP.double, vsLHP.triple, vsLHP.home_run,
        vsLHP.walk, vsLHP.hit_by_pitch, vsLHP.strikeout,
        vsLHP.ground_out, vsLHP.fly_out, vsLHP.line_out, vsLHP.pop_out,
        vsLHP.sacrifice_fly, vsLHP.sacrifice_bunt,
        vsLHP.fielders_choice, vsLHP.reached_on_error, vsLHP.catcher_interference
      );

      // Insert vsRHP rates
      const vsRHP = eventRatesToSQL(batter.rates.vsRHP);
      insertRates.run(
        batter.id, 'vsRHP',
        vsRHP.single, vsRHP.double, vsRHP.triple, vsRHP.home_run,
        vsRHP.walk, vsRHP.hit_by_pitch, vsRHP.strikeout,
        vsRHP.ground_out, vsRHP.fly_out, vsRHP.line_out, vsRHP.pop_out,
        vsRHP.sacrifice_fly, vsRHP.sacrifice_bunt,
        vsRHP.fielders_choice, vsRHP.reached_on_error, vsRHP.catcher_interference
      );
    }
  });

  insertMany(Object.values(batters));
  console.log(`    ✓ ${Object.keys(batters).length} batters`);
}

// Similar functions for insertPitchers, insertLeagueAverages, etc.
// (Follow same pattern: prepare statements, use transactions for bulk insert)
```

#### 1.4 Update CLI

```typescript
// In main() function:
const outputFormat = process.argv[4] || 'sqlite'; // or 'json' for backward compatibility

if (outputFormat === 'sqlite') {
  await exportSeasonAsSqlite(year, dbPath, `../app/static/seasons/${year}.sqlite`);
} else {
  await exportSeason(year, dbPath, `../app/static/seasons/${year}.json`);
}
```

---

## Phase 2: Browser Season Loader with wa-sqlite

### File: `app/src/lib/game/sqlite-season-loader.ts` (NEW)

```typescript
/**
 * Load season data from SQLite files using wa-sqlite
 * Downloads .sqlite files to OPFS and queries them directly
 */

import waSqlite from 'wa-sqlite';
import type { SeasonPackage, BatterStats, PitcherStats } from './types.js';

const SEASON_CACHE = new Map<number, any>(); // wa-sqlite database handles

interface SeasonManifest {
  meta: {
    generatedAt: string;
    totalYears: number;
  };
  seasons: Array<{
    year: number;
    file: string;
    size: number;
  }>;
}

/**
 * Download season SQLite file and save to OPFS
 */
async function downloadSeasonToOPFS(year: number): Promise<void> {
  const response = await fetch(`/seasons/${year}.sqlite`);
  if (!response.ok) {
    throw new Error(`Failed to load season ${year}: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const opfsRoot = await navigator.storage.getDirectory();
  const fileHandle = await opfsRoot.getFileHandle(`${year}.sqlite`, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(arrayBuffer);
  await writable.close();
}

/**
 * Check if season is already downloaded to OPFS
 */
async function isSeasonDownloaded(year: number): Promise<boolean> {
  try {
    const opfsRoot = await navigator.storage.getDirectory();
    await opfsRoot.getFileHandle(`${year}.sqlite`, { create: false });
    return true;
  } catch {
    return false;
  }
}

/**
 * Open season database from OPFS
 */
async function openSeasonDatabase(year: number): Promise<any> {
  // Download if not already present
  if (!(await isSeasonDownloaded(year))) {
    await downloadSeasonToOPFS(year);
  }

  // Open with wa-sqlite
  const db = await waSqlite.openOpfs(`${year}.sqlite`);
  return db;
}

/**
 * Load season meta information
 */
async function loadSeasonMeta(db: any): Promise<{ year: number; generatedAt: string; version: string }> {
  const row = await db.exec('SELECT year, generated_at, version FROM meta LIMIT 1');
  return {
    year: row[0].year,
    generatedAt: row[0].generated_at,
    version: row[0].version,
  };
}

/**
 * Load season norms
 */
async function loadSeasonNorms(db: any): Promise<any> {
  const row = await db.exec('SELECT year, era, norms_json FROM norms LIMIT 1');
  return JSON.parse(row[0].norms_json);
}

/**
 * Load all batters for a team
 */
async function loadBattersByTeam(db: any, teamId: string): Promise<Record<string, BatterStats>> {
  const rows = await db.exec(`
    SELECT
      b.id, b.name, b.bats, b.team_id, b.primary_position, b.position_eligibility,
      b.pa, b.avg, b.obp, b.slg, b.ops,
      r.split, r.single, r.double, r.triple, r.home_run,
      r.walk, r.hit_by_pitch, r.strikeout,
      r.ground_out, r.fly_out, r.line_out, r.pop_out,
      r.sacrifice_fly, r.sacrifice_bunt,
      r.fielders_choice, r.reached_on_error, r.catcher_interference
    FROM batters b
    JOIN batter_rates r ON b.id = r.batter_id
    WHERE b.team_id = ?
    ORDER BY b.id
  `, [teamId]);

  // Group by batter (2 rows per batter: vsLHP, vsRHP)
  const batters: Record<string, BatterStats> = {};

  for (const row of rows) {
    const { id, name, bats, team_id, primary_position, position_eligibility, pa, avg, obp, slg, ops, split, ...rates } = row;

    if (!batters[id]) {
      batters[id] = {
        id,
        name,
        bats,
        teamId: team_id,
        primaryPosition: primary_position,
        positionEligibility: JSON.parse(position_eligibility),
        pa,
        avg,
        obp,
        slg,
        ops,
        rates: {
          vsLHP: {} as EventRates,
          vsRHP: {} as EventRates,
        },
      };
    }

    // Assign rates based on split
    const targetSplit = split === 'vsLHP' ? 'vsLHP' : 'vsRHP';
    batters[id].rates[targetSplit] = {
      single: rates.single,
      double: rates.double,
      triple: rates.triple,
      homeRun: rates.home_run,
      walk: rates.walk,
      hitByPitch: rates.hit_by_pitch,
      strikeout: rates.strikeout,
      groundOut: rates.ground_out,
      flyOut: rates.fly_out,
      lineOut: rates.line_out,
      popOut: rates.pop_out,
      sacrificeFly: rates.sacrifice_fly,
      sacrificeBunt: rates.sacrifice_bunt,
      fieldersChoice: rates.fielders_choice,
      reachedOnError: rates.reached_on_error,
      catcherInterference: rates.catcher_interference,
    };
  }

  return batters;
}

/**
 * Load all pitchers for a team
 */
async function loadPitchersByTeam(db: any, teamId: string): Promise<Record<string, PitcherStats>> {
  const rows = await db.exec(`
    SELECT
      p.id, p.name, p.throws, p.team_id,
      p.avg_bfp_as_starter, p.avg_bfp_as_reliever,
      p.games, p.games_started, p.complete_games, p.saves,
      p.innings_pitched, p.whip, p.era,
      r.split, r.single, r.double, r.triple, r.home_run,
      r.walk, r.hit_by_pitch, r.strikeout,
      r.ground_out, r.fly_out, r.line_out, r.pop_out,
      r.sacrifice_fly, r.sacrifice_bunt,
      r.fielders_choice, r.reached_on_error, r.catcher_interference
    FROM pitchers p
    JOIN pitcher_rates r ON p.id = r.pitcher_id
    WHERE p.team_id = ?
    ORDER BY p.id
  `, [teamId]);

  // Group by pitcher (2 rows per pitcher: vsLHB, vsRHB)
  const pitchers: Record<string, PitcherStats> = {};

  for (const row of rows) {
    const { id, name, throws, team_id, avg_bfp_as_starter, avg_bfp_as_reliever,
            games, games_started, complete_games, saves, innings_pitched, whip, era,
            split, ...rates } = row;

    if (!pitchers[id]) {
      pitchers[id] = {
        id,
        name,
        throws,
        teamId: team_id,
        avgBfpAsStarter: avg_bfp_as_starter,
        avgBfpAsReliever: avg_bfp_as_reliever,
        games,
        gamesStarted: games_started,
        completeGames: complete_games,
        saves,
        inningsPitched: innings_pitched,
        whip,
        era,
        rates: {
          vsLHB: {} as EventRates,
          vsRHB: {} as EventRates,
        },
      };
    }

    // Assign rates based on split
    const targetSplit = split === 'vsLHB' ? 'vsLHB' : 'vsRHB';
    pitchers[id].rates[targetSplit] = {
      single: rates.single,
      double: rates.double,
      triple: rates.triple,
      homeRun: rates.home_run,
      walk: rates.walk,
      hitByPitch: rates.hit_by_pitch,
      strikeout: rates.strikeout,
      groundOut: rates.ground_out,
      flyOut: rates.fly_out,
      lineOut: rates.line_out,
      popOut: rates.pop_out,
      sacrificeFly: rates.sacrifice_fly,
      sacrificeBunt: rates.sacrifice_bunt,
      fieldersChoice: rates.fielders_choice,
      reachedOnError: rates.reached_on_error,
      catcherInterference: rates.catcher_interference,
    };
  }

  return pitchers;
}

/**
 * Load league averages
 */
async function loadLeagueAverages(db: any): Promise<{ vsLHP: EventRates; vsRHP: EventRates }> {
  const rows = await db.exec('SELECT * FROM league_averages');

  const result: any = { vsLHP: {}, vsRHP: {} };

  for (const row of rows) {
    const { split, ...rates } = row;
    const key = split === 'vsLHP' ? 'vsLHP' : 'vsRHP';
    result[key] = {
      single: rates.single,
      double: rates.double,
      triple: rates.triple,
      homeRun: rates.home_run,
      walk: rates.walk,
      hitByPitch: rates.hit_by_pitch,
      strikeout: rates.strikeout,
      groundOut: rates.ground_out,
      flyOut: rates.fly_out,
      lineOut: rates.line_out,
      popOut: rates.pop_out,
      sacrificeFly: rates.sacrifice_fly,
      sacrificeBunt: rates.sacrifice_bunt,
      fieldersChoice: rates.fielders_choice,
      reachedOnError: rates.reached_on_error,
      catcherInterference: rates.catcher_interference,
    };
  }

  return result;
}

/**
 * Load teams
 */
async function loadTeams(db: any): Promise<Record<string, { id: string; league: string; city: string; nickname: string }>> {
  const rows = await db.exec('SELECT * FROM teams');

  const teams: Record<string, any> = {};
  for (const row of rows) {
    teams[row.id] = {
      id: row.id,
      league: row.league,
      city: row.city,
      nickname: row.nickname,
    };
  }

  return teams;
}

/**
 * Load games
 */
async function loadGames(db: any): Promise<Array<{ id: string; date: string; awayTeam: string; homeTeam: string; useDH: boolean }>> {
  const rows = await db.exec('SELECT * FROM games');

  return rows.map((row: any) => ({
    id: row.id,
    date: row.date,
    awayTeam: row.away_team,
    homeTeam: row.home_team,
    useDH: row.use_dh === 1,
  }));
}

/**
 * Main function to load a season
 */
export async function loadSeason(year: number): Promise<SeasonPackage> {
  // Check cache first
  if (SEASON_CACHE.has(year)) {
    return SEASON_CACHE.get(year);
  }

  // Open database
  const db = await openSeasonDatabase(year);

  // Load all data
  const meta = await loadSeasonMeta(db);
  const norms = await loadSeasonNorms(db);
  const teams = await loadTeams(db);
  const games = await loadGames(db);
  const league = await loadLeagueAverages(db);

  // Build season package
  const season: SeasonPackage = {
    meta,
    norms,
    batters: {}, // Loaded on-demand by team
    pitchers: {}, // Loaded on-demand by team
    league,
    teams,
    games,
  };

  // Store database handle for lazy loading
  SEASON_CACHE.set(year, { db, season });

  return season;
}

/**
 * Get batters for a specific team (lazy load)
 */
export async function getBattersForTeam(year: number, teamId: string): Promise<Record<string, BatterStats>> {
  const cached = SEASON_CACHE.get(year);
  if (!cached) {
    const season = await loadSeason(year);
    return getBattersForTeam(year, teamId);
  }

  const { db, season } = cached;
  return await loadBattersByTeam(db, teamId);
}

/**
 * Get pitchers for a specific team (lazy load)
 */
export async function getPitchersForTeam(year: number, teamId: string): Promise<Record<string, PitcherStats>> {
  const cached = SEASON_CACHE.get(year);
  if (!cached) {
    const season = await loadSeason(year);
    return getPitchersForTeam(year, teamId);
  }

  const { db, season } = cached;
  return await loadPitchersByTeam(db, teamId);
}

/**
 * Get available years from manifest
 */
export async function getAvailableYears(): Promise<number[]> {
  const response = await fetch('/seasons/season-manifest.json');
  if (!response.ok) return [1976]; // Fallback

  const manifest: SeasonManifest = await response.json();
  return manifest.seasons.map(s => s.year).sort((a, b) => a - b);
}

/**
 * Clear cached seasons
 */
export function clearSeasonCache(): void {
  SEASON_CACHE.clear();
}
```

---

## Phase 3: Update Game Engine

### File: `app/src/lib/game/engine.ts`

**Current Behavior:**
- Calls `loadSeason(year)` which loads entire JSON into memory
- Accesses `season.batters[id]` and `season.pitchers[id]` directly
- Converts to model types using `toModelBatter()` and `toModelPitcher()`

**New Behavior:**
- Opens SQLite database connection
- Queries for specific batters/pitchers as needed
- Converts query results to model types

### Implementation Steps

#### 3.1 Update Imports

```typescript
// Replace:
import { loadSeason } from './season-loader.js';

// With:
import { loadSeason, getBattersForTeam, getPitchersForTeam } from './sqlite-season-loader.js';
```

#### 3.2 Update GameEngine Constructor

```typescript
export class GameEngine {
  private db: any; // wa-sqlite database handle
  private season: SeasonPackage;
  private year: number;
  private matchupModel: MatchupModel;
  private options: ManagerialOptions;
  private batters: Record<string, BatterStats> = {};
  private pitchers: Record<string, PitcherStats> = {};

  constructor(
    year: number,
    awayTeam: string,
    homeTeam: string,
    options: ManagerialOptions = {}
  ) {
    this.year = year;
    this.options = options;
    this.matchupModel = new MatchupModel();

    // Load season (this now opens SQLite connection)
    this.season = await loadSeason(year);

    // Load batters and pitchers for both teams
    const [awayBatters, homeBatters] = await Promise.all([
      getBattersForTeam(year, awayTeam),
      getBattersForTeam(year, homeTeam),
    ]);

    const [awayPitchers, homePitchers] = await Promise.all([
      getPitchersForTeam(year, awayTeam),
      getPitchersForTeam(year, homeTeam),
    ]);

    this.batters = { ...awayBatters, ...homeBatters };
    this.pitchers = { ...awayPitchers, ...homePitchers };

    // Initialize game state...
  }
}
```

#### 3.3 Update Substitution Methods

When adding players (pinch hitters, relief pitchers), query the database:

```typescript
async function addPinchHitter(teamId: string, batterId: string): Promise<void> {
  // Query this batter from SQLite
  const teamBatters = await getBattersForTeam(this.year, teamId);
  const batter = teamBatters[batterId];

  if (!batter) {
    throw new Error(`Batter ${batterId} not found`);
  }

  this.batters[batterId] = batter;
  // ... rest of substitution logic
}
```

---

## Phase 4: Test Updates

### Files to Update:
- `app/src/lib/game/engine.test.ts`
- `packages/model/src/MatchupModel.test.ts`
- `packages/model/src/managerial/*.test.ts`

### Implementation Steps

#### 4.1 Add better-sqlite3 to Test Dependencies

```bash
cd packages/model
pnpm add -D better-sqlite3
```

#### 4.2 Update Test Helpers

```typescript
// packages/model/test/helpers/season-db.ts

import Database from 'better-sqlite3';
import type { BatterStats, PitcherStats } from '../../src/types.js';

export class TestSeasonDB {
  private db: Database.Database;

  constructor(sqlitePath: string) {
    this.db = new Database(sqlitePath);
  }

  /**
   * Get batter stats by ID - same data as browser gets
   */
  getBatter(id: string): BatterStats | null {
    const batterRow = this.db.prepare(`
      SELECT * FROM batters WHERE id = ?
    `).get(id);

    if (!batterRow) return null;

    const ratesRows = this.db.prepare(`
      SELECT * FROM batter_rates WHERE batter_id = ?
    `).all(id);

    const rates: any = { vsLHP: {}, vsRHB: {} };
    for (const row of ratesRows) {
      rates[row.split === 'vsLHP' ? 'vsLHP' : 'vsRHP'] = {
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

    return {
      id: batterRow.id,
      name: batterRow.name,
      bats: batterRow.bats,
      teamId: batterRow.team_id,
      primaryPosition: batterRow.primary_position,
      positionEligibility: JSON.parse(batterRow.position_eligibility),
      pa: batterRow.pa,
      avg: batterRow.avg,
      obp: batterRow.obp,
      slg: batterRow.slg,
      ops: batterRow.ops,
      rates,
    };
  }

  /**
   * Get all batters for a team
   */
  getBattersByTeam(teamId: string): Record<string, BatterStats> {
    const rows = this.db.prepare(`
      SELECT id FROM batters WHERE team_id = ?
    `).all(teamId);

    const batters: Record<string, BatterStats> = {};
    for (const row of rows) {
      const batter = this.getBatter(row.id);
      if (batter) batters[row.id] = batter;
    }

    return batters;
  }

  /**
   * Get pitcher stats by ID
   */
  getPitcher(id: string): PitcherStats | null {
    // Similar to getBatter, but queries pitchers and pitcher_rates tables
    // ... implementation omitted for brevity
    return null;
  }

  close(): void {
    this.db.close();
  }
}
```

#### 4.3 Update Example Test

```typescript
// packages/model/src/MatchupModel.test.ts

import { describe, it, expect } from 'vitest';
import { MatchupModel } from '../MatchupModel.js';
import { TestSeasonDB } from '../test/helpers/season-db.js';

describe('MatchupModel - with real season data', () => {
  let seasonDb: TestSeasonDB;

  beforeAll(() => {
    // Open the SAME SQLite file that the browser will use
    seasonDb = new TestSeasonDB('../../app/static/seasons/1976.sqlite');
  });

  afterAll(() => {
    seasonDb.close();
  });

  it('should predict outcomes for actual players', () => {
    const batter = seasonDb.getBatter('carew001'); // Rod Carew
    const pitcher = seasonDb.getPitcher('palme001'); // Jim Palmer

    if (!batter || !pitcher) {
      throw new Error('Test data not found');
    }

    const model = new MatchupModel();
    const distribution = model.predict({
      batter: {
        id: batter.id,
        name: batter.name,
        handedness: batter.bats,
        rates: {
          vsLeft: batter.rates.vsLHP,
          vsRight: batter.rates.vsRHP,
        },
      },
      pitcher: {
        id: pitcher.id,
        name: pitcher.name,
        handedness: pitcher.throws,
        rates: {
          vsLeft: pitcher.rates.vsLHB,
          vsRight: pitcher.rates.vsRHB,
        },
      },
      league: {
        vsLeft: /* league averages from DB */,
        vsRight: /* league averages from DB */,
      },
    });

    // Validate distribution
    expect(Object.values(distribution).reduce((sum, val) => sum + val, 0)).toBeCloseTo(1, 4);
    expect(distribution.homeRun).toBeGreaterThan(0);
    expect(distribution.strikeout).toBeGreaterThan(0);
  });
});
```

---

## Phase 5: Compression and Static Serving

### 5.1 Compress SQLite Files

```bash
# Add to data-prep/package.json scripts:
{
  "scripts": {
    "export:season": "tsx src/export-season.ts",
    "compress:season": "gzip -9 -c app/static/seasons/1976.sqlite > app/static/seasons/1976.sqlite.gz"
  }
}
```

Or compress automatically in export script:

```typescript
// In export-season.ts
import { gzipSync } from 'zlib';
import { writeFileSync } from 'fs';

// After creating SQLite file:
const dbBuffer = fs.readFileSync(outputPath);
const gzipped = gzipSync(dbBuffer);
writeFileSync(`${outputPath}.gz`, gzipped);
```

### 5.2 Update Browser Loading to Handle Compressed Files

```typescript
// In sqlite-season-loader.ts
async function downloadSeasonToOPFS(year: number): Promise<void> {
  // Try compressed first
  let response = await fetch(`/seasons/${year}.sqlite.gz`);

  if (response.ok) {
    const compressed = await response.arrayBuffer();
    const decompressed = decompress(new Uint8Array(compressed));
    // ... write to OPFS
  } else {
    // Fallback to uncompressed
    response = await fetch(`/seasons/${year}.sqlite`);
    const arrayBuffer = await response.arrayBuffer();
    // ... write to OPFS
  }
}

// Use pako for decompression in browser:
// pnpm add pako
import { inflate } from 'pako';

function decompress(data: Uint8Array): Uint8Array {
  return new Uint8Array(inflate(data));
}
```

### 5.3 Update Manifest

```json
// app/static/seasons/season-manifest.json
{
  "meta": {
    "generatedAt": "2025-02-04T00:00:00Z",
    "totalYears": 1,
    "totalSize": 2500000
  },
  "seasons": [
    {
      "year": 1976,
      "file": "1976.sqlite",
      "compressedSize": 450000,
      "uncompressedSize": 1500000
    }
  ]
}
```

---

## Phase 6: Migration Path

### Step 1: Dual-Write Period
- Keep JSON export for backward compatibility
- Add SQLite export alongside
- Test both formats

### Step 2: Update Tests
- Convert tests to use SQLite files
- Verify parity with JSON-based tests

### Step 3: Update App
- Deploy wa-sqlite loader
- Keep JSON loader as fallback

### Step 4: Cutover
- Switch default to SQLite
- Remove JSON paths after validation

---

## Key Dependencies

```json
{
  "data-prep": {
    "better-sqlite3": "^9.0.0"
  },
  "app": {
    "wa-sqlite": "latest",
    "pako": "^2.1.0"
  },
  "packages/model": {
    "better-sqlite3": "^9.0.0"
  }
}
```

---

## Testing Checklist

- [ ] Data prep exports valid SQLite files
- [ ] SQLite files can be opened with DB Browser for SQLite
- [ ] Browser downloads and stores SQLite in OPFS correctly
- [ ] Season data loads correctly from SQLite
- [ ] Game engine queries return correct data
- [ ] All existing tests pass with SQLite
- [ ] New tests verify 100% parity between test and production data
- [ ] Compression works correctly
- [ ] Fallback to uncompressed files works
- [ ] Multiple seasons can be loaded simultaneously
- [ ] OPFS persistence survives page reloads
