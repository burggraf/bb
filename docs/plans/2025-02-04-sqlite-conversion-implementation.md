# SQLite Conversion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert the baseball simulation app from JSON-based season data to SQLite using wa-sqlite in the browser and better-sqlite3 for data prep and tests.

**Architecture:**
- Data prep uses better-sqlite3 to create `.sqlite` files from DuckDB queries
- Browser uses wa-sqlite with OPFS to download, cache, and query SQLite files
- Tests use better-sqlite3 to open the same `.sqlite` files for 100% parity with production
- Game engine queries SQLite on-demand instead of loading entire JSON into memory

**Tech Stack:**
- `better-sqlite3` (v9+) for Node.js (data prep, tests)
- `wa-sqlite` for browser SQLite with OPFS
- `pako` for gzip decompression in browser

---

## Task 1: Install better-sqlite3 in data-prep package

**Files:**
- Modify: `data-prep/package.json`

**Step 1: Add better-sqlite3 dependency**

Run: `cd data-prep && pnpm add better-sqlite3`

Expected: Package installed successfully, `better-sqlite3` appears in `package.json` dependencies

**Step 2: Verify installation**

Run: `cd data-prep && pnpm list better-sqlite3`

Expected: Shows version like `better-sqlite3 9.x.x`

**Step 3: Commit**

```bash
git add data-prep/package.json data-prep/pnpm-lock.yaml
git commit -m "deps: add better-sqlite3 for SQLite export"
```

---

## Task 2: Create SQLite schema module in data-prep

**Files:**
- Create: `data-prep/src/sqlite-schema.ts`

**Step 1: Write schema module with table creation SQL**

```typescript
import Database from 'better-sqlite3';

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
```

**Step 2: Commit**

```bash
git add data-prep/src/sqlite-schema.ts
git commit -m "feat: add SQLite schema for season data"
```

---

## Task 3: Add helper functions for EventRates conversion

**Files:**
- Modify: `data-prep/src/sqlite-schema.ts`

**Step 1: Add EventRates to SQL row conversion function**

```typescript
import type { EventRates } from '@bb/model';

/**
 * Convert EventRates object to flat SQL record (with underscore column names)
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
 * Convert SQL row back to EventRates
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
```

**Step 2: Commit**

```bash
git add data-prep/src/sqlite-schema.ts
git commit -m "feat: add EventRates SQL conversion helpers"
```

---

## Task 4: Create SQLite export function

**Files:**
- Create: `data-prep/src/export-sqlite.ts`

**Step 1: Write the SQLite export function**

```typescript
import Database from 'better-sqlite3';
import * as fs from 'fs';
import type { SeasonPackage, BatterStats, PitcherStats } from '../src/types.ts';
import { createSeasonSchema, eventRatesToSQL } from '../src/sqlite-schema.ts';
import { gzipSync } from 'zlib';

/**
 * Export a season to SQLite format
 */
export async function exportSeasonAsSqlite(
  season: SeasonPackage,
  outputPath: string,
  compress: boolean = true
): Promise<void> {
  console.log(`📦 Exporting ${season.meta.year} season to SQLite: ${outputPath}...\n`);

  // Remove existing file if present
  if (fs.existsSync(outputPath)) {
    fs.unlinkSync(outputPath);
  }

  // Create SQLite database
  const db = new Database(outputPath);
  createSeasonSchema(db);

  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL');

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

  // Compress if requested
  if (compress) {
    const compressedPath = `${outputPath}.gz`;
    const dbBuffer = fs.readFileSync(outputPath);
    const gzipped = gzipSync(dbBuffer);
    fs.writeFileSync(compressedPath, gzipped);
    const originalSize = dbBuffer.length;
    const compressedSize = gzipped.length;
    const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(1);
    console.log(`✅ Compressed to ${compressedPath} (${ratio}% reduction)`);
  }
}

function insertMeta(db: Database.Database, season: SeasonPackage): void {
  const stmt = db.prepare('INSERT OR REPLACE INTO meta (year, generated_at, version) VALUES (?, ?, ?)');
  stmt.run(season.meta.year, season.meta.generatedAt, season.meta.version);
  stmt.finalize();
  console.log('  ✓ Meta data');
}

function insertNorms(db: Database.Database, season: SeasonPackage): void {
  const stmt = db.prepare('INSERT OR REPLACE INTO norms (year, era, norms_json) VALUES (?, ?, ?)');
  stmt.run(season.norms.year, season.norms.era, JSON.stringify(season.norms));
  stmt.finalize();
  console.log('  ✓ Season norms');
}

function insertBatters(db: Database.Database, batters: Record<string, BatterStats>): void {
  const insertBatter = db.prepare(`
    INSERT OR REPLACE INTO batters (id, name, bats, team_id, primary_position, position_eligibility, pa, avg, obp, slg, ops)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertRates = db.prepare(`
    INSERT OR REPLACE INTO batter_rates (
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
  insertBatter.finalize();
  insertRates.finalize();
  console.log(`  ✓ ${Object.keys(batters).length} batters`);
}

function insertPitchers(db: Database.Database, pitchers: Record<string, PitcherStats>): void {
  const insertPitcher = db.prepare(`
    INSERT OR REPLACE INTO pitchers (
      id, name, throws, team_id, avg_bfp_as_starter, avg_bfp_as_reliever,
      games, games_started, complete_games, saves, innings_pitched, whip, era
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertRates = db.prepare(`
    INSERT OR REPLACE INTO pitcher_rates (
      pitcher_id, split, single, double, triple, home_run, walk, hit_by_pitch, strikeout,
      ground_out, fly_out, line_out, pop_out, sacrifice_fly, sacrifice_bunt,
      fielders_choice, reached_on_error, catcher_interference
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((pitcherList: PitcherStats[]) => {
    for (const pitcher of pitcherList) {
      insertPitcher.run(
        pitcher.id,
        pitcher.name,
        pitcher.throws,
        pitcher.teamId,
        pitcher.avgBfpAsStarter,
        pitcher.avgBfpAsReliever,
        pitcher.games,
        pitcher.gamesStarted,
        pitcher.completeGames,
        pitcher.saves,
        pitcher.inningsPitched,
        pitcher.whip,
        pitcher.era
      );

      // Insert vsLHB rates
      const vsLHB = eventRatesToSQL(pitcher.rates.vsLHB);
      insertRates.run(
        pitcher.id, 'vsLHB',
        vsLHB.single, vsLHB.double, vsLHB.triple, vsLHB.home_run,
        vsLHB.walk, vsLHB.hit_by_pitch, vsLHB.strikeout,
        vsLHB.ground_out, vsLHB.fly_out, vsLHB.line_out, vsLHB.pop_out,
        vsLHB.sacrifice_fly, vsLHB.sacrifice_bunt,
        vsLHB.fielders_choice, vsLHB.reached_on_error, vsLHB.catcher_interference
      );

      // Insert vsRHB rates
      const vsRHB = eventRatesToSQL(pitcher.rates.vsRHB);
      insertRates.run(
        pitcher.id, 'vsRHB',
        vsRHB.single, vsRHB.double, vsRHB.triple, vsRHB.home_run,
        vsRHB.walk, vsRHB.hit_by_pitch, vsRHB.strikeout,
        vsRHB.ground_out, vsRHB.fly_out, vsRHB.line_out, vsRHB.pop_out,
        vsRHB.sacrifice_fly, vsRHB.sacrifice_bunt,
        vsRHB.fielders_choice, vsRHB.reached_on_error, vsRHB.catcher_interference
      );
    }
  });

  insertMany(Object.values(pitchers));
  insertPitcher.finalize();
  insertRates.finalize();
  console.log(`  ✓ ${Object.keys(pitchers).length} pitchers`);
}

function insertLeagueAverages(db: Database.Database, league: SeasonPackage['league']): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO league_averages (
      split, single, double, triple, home_run, walk, hit_by_pitch, strikeout,
      ground_out, fly_out, line_out, pop_out, sacrifice_fly, sacrifice_bunt,
      fielders_choice, reached_on_error, catcher_interference
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const vsLHP = eventRatesToSQL(league.vsLHP);
  stmt.run(
    'vsLHP',
    vsLHP.single, vsLHP.double, vsLHP.triple, vsLHP.home_run,
    vsLHP.walk, vsLHP.hit_by_pitch, vsLHP.strikeout,
    vsLHP.ground_out, vsLHP.fly_out, vsLHP.line_out, vsLHP.pop_out,
    vsLHP.sacrifice_fly, vsLHP.sacrifice_bunt,
    vsLHP.fielders_choice, vsLHP.reached_on_error, vsLHP.catcher_interference
  );

  const vsRHP = eventRatesToSQL(league.vsRHP);
  stmt.run(
    'vsRHP',
    vsRHP.single, vsRHP.double, vsRHP.triple, vsRHP.home_run,
    vsRHP.walk, vsRHP.hit_by_pitch, vsRHP.strikeout,
    vsRHP.ground_out, vsRHP.fly_out, vsRHP.line_out, vsRHP.pop_out,
    vsRHP.sacrifice_fly, vsRHP.sacrifice_bunt,
    vsRHP.fielders_choice, vsRHP.reached_on_error, vsRHP.catcher_interference
  );

  stmt.finalize();
  console.log('  ✓ League averages');

  // Insert pitcher-batter league averages
  const pbStmt = db.prepare('INSERT OR REPLACE INTO pitcher_batter_league (split, rates_json) VALUES (?, ?)');
  pbStmt.run('vsLHP', JSON.stringify(league.pitcherBatter.vsLHP));
  pbStmt.run('vsRHP', JSON.stringify(league.pitcherBatter.vsRHP));
  pbStmt.finalize();
  console.log('  ✓ Pitcher-batter league averages');
}

function insertTeams(db: Database.Database, teams: SeasonPackage['teams']): void {
  const stmt = db.prepare('INSERT OR REPLACE INTO teams (id, league, city, nickname) VALUES (?, ?, ?, ?)');
  const insertMany = db.transaction((teamList: SeasonPackage['teams'][string][]) => {
    for (const team of Object.values(teams)) {
      stmt.run(team.id, team.league, team.city, team.nickname);
    }
  });
  insertMany(Object.values(teams));
  stmt.finalize();
  console.log(`  ✓ ${Object.keys(teams).length} teams`);
}

function insertGames(db: Database.Database, games: SeasonPackage['games']): void {
  const stmt = db.prepare('INSERT OR REPLACE INTO games (id, date, away_team, home_team, use_dh) VALUES (?, ?, ?, ?, ?)');
  const insertMany = db.transaction((gameList: SeasonPackage['games']) => {
    for (const game of gameList) {
      stmt.run(game.id, game.date, game.awayTeam, game.homeTeam, game.useDH ? 1 : 0);
    }
  });
  insertMany(games);
  stmt.finalize();
  console.log(`  ✓ ${games.length} games`);
}
```

**Step 2: Commit**

```bash
git add data-prep/src/export-sqlite.ts
git commit -m "feat: add SQLite export function with compression support"
```

---

## Task 5: Update export-season.ts to support SQLite output

**Files:**
- Modify: `data-prep/src/export-season.ts`

**Step 1: Add SQLite export option to CLI**

Find the `main()` function and add format parameter:

```typescript
// At the top of the file, add:
import { exportSeasonAsSqlite } from './export-sqlite.js';

// In main() function, replace with:
async function main() {
  const year = parseInt(process.argv[2]) || 1976;
  const dbPath = process.argv[3] || '../baseball.duckdb';
  const outputPath = process.argv[4] || `../app/static/seasons/${year}`;
  const format = process.argv[5] || 'sqlite'; // 'json' or 'sqlite'

  // Ensure output directory exists
  const outputDir = outputPath.substring(0, outputPath.lastIndexOf('/'));
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Export season data (reuse existing logic)
  const season = await exportSeason(year, dbPath, '/tmp/unused.json');

  // Export in requested format
  if (format === 'sqlite') {
    await exportSeasonAsSqlite(season, `${outputPath}.sqlite`, compress = true);
  } else {
    // Original JSON export
    fs.writeFileSync(`${outputPath}.json`, JSON.stringify(season, null, 2));
    console.log(`\n✅ Season exported to ${outputPath}.json`);
  }
}
```

**Step 2: Test SQLite export for 1976**

Run: `cd data-prep && pnpm exec tsx src/export-season.ts 1976 ../baseball.duckdb ../app/static/seasons/1976 sqlite`

Expected:
- Creates `app/static/seasons/1976.sqlite`
- Creates `app/static/seasons/1976.sqlite.gz`
- Shows compression ratio (typically 60-70%)

**Step 3: Verify SQLite file with CLI**

Run: `sqlite3 app/static/seasons/1976.sqlite "SELECT COUNT(*) FROM batters;"`

Expected: Returns a number (batter count for 1976)

Run: `sqlite3 app/static/seasons/1976.sqlite "SELECT name FROM batters LIMIT 3;"`

Expected: Shows 3 batter names

**Step 4: Commit**

```bash
git add data-prep/src/export-season.ts
git commit -m "feat: add SQLite export format option to export-season CLI"
```

---

## Task 6: Create compressed season manifest

**Files:**
- Create: `data-prep/src/update-manifest.ts`

**Step 1: Write manifest generator**

```typescript
import * as fs from 'fs';
import * as path from 'path';

interface SeasonEntry {
  year: number;
  file: string;
  size: number;
  compressedSize: number;
}

interface Manifest {
  meta: {
    generatedAt: string;
    totalYears: number;
    totalSize: number;
    totalCompressedSize: number;
  };
  seasons: SeasonEntry[];
}

export function generateManifest(seasonsDir: string): Manifest {
  const files = fs.readdirSync(seasonsDir);
  const sqliteFiles = files.filter(f => f.endsWith('.sqlite'));

  const seasons: SeasonEntry[] = sqliteFiles.map(file => {
    const filePath = path.join(seasonsDir, file);
    const compressedPath = `${filePath}.gz`;
    const stat = fs.statSync(filePath);
    const compressedStat = fs.statSync(compressedPath);
    const year = parseInt(file.replace('.sqlite', ''));

    return {
      year,
      file,
      size: stat.size,
      compressedSize: compressedStat.size,
    };
  });

  const totalSize = seasons.reduce((sum, s) => sum + s.size, 0);
  const totalCompressedSize = seasons.reduce((sum, s) => sum + s.compressedSize, 0);

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      totalYears: seasons.length,
      totalSize,
      totalCompressedSize,
    },
    seasons: seasons.sort((a, b) => a.year - b.year),
  };
}

export function writeManifest(seasonsDir: string): void {
  const manifest = generateManifest(seasonsDir);
  const manifestPath = path.join(seasonsDir, 'season-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`✅ Manifest written to ${manifestPath}`);
  console.log(`   ${manifest.meta.totalYears} seasons`);
  console.log(`   Total: ${(manifest.meta.totalSize / 1024 / 1024).toFixed(2)} MB → ${(manifest.meta.totalCompressedSize / 1024 / 1024).toFixed(2)} MB compressed`);
}
```

**Step 2: Commit**

```bash
git add data-prep/src/update-manifest.ts
git commit -m "feat: add season manifest generator for SQLite files"
```

---

## Task 7: Install wa-sqlite and pako in app

**Files:**
- Modify: `app/package.json`

**Step 1: Install wa-sqlite dependency**

Run: `cd app && pnpm add wa-sqlite`

Expected: Package installed successfully

**Step 2: Install pako for decompression**

Run: `cd app && pnpm add pako`

Expected: Package installed successfully

**Step 3: Verify installations**

Run: `cd app && pnpm list wa-sqlite pako`

Expected: Shows both packages with versions

**Step 4: Commit**

```bash
git add app/package.json app/pnpm-lock.yaml
git commit -m "deps: add wa-sqlite and pako for browser SQLite"
```

---

## Task 8: Create SQLite season loader for browser

**Files:**
- Create: `app/src/lib/game/sqlite-season-loader.ts`

**Step 1: Write the SQLite season loader module**

```typescript
/**
 * Load season data from SQLite files using wa-sqlite
 * Downloads .sqlite files to OPFS and queries them directly
 */

import waSqlite from 'wa-sqlite';
import { inflate } from 'pako';
import type { SeasonPackage, BatterStats, PitcherStats, EventRates } from './types.js';

const SEASON_CACHE = new Map<number, { db: any; season: SeasonPackage }>();

interface SeasonManifest {
  meta: {
    generatedAt: string;
    totalYears: number;
  };
  seasons: Array<{
    year: number;
    file: string;
    compressedSize: number;
  }>;
}

/**
 * Download and decompress season SQLite file to OPFS
 */
async function downloadSeasonToOPFS(year: number): Promise<void> {
  // Try compressed first
  let response = await fetch(`/seasons/${year}.sqlite.gz`);

  if (response.ok) {
    const compressed = await response.arrayBuffer();
    const decompressed = inflate(new Uint8Array(compressed));
    await writeToOPFS(year, decompressed);
    console.log(`📦 Downloaded and decompressed season ${year}`);
  } else {
    // Fallback to uncompressed
    response = await fetch(`/seasons/${year}.sqlite`);
    if (!response.ok) {
      throw new Error(`Failed to load season ${year}: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    await writeToOPFS(year, new Uint8Array(arrayBuffer));
    console.log(`📦 Downloaded season ${year}`);
  }
}

async function writeToOPFS(year: number, data: Uint8Array): Promise<void> {
  const opfsRoot = await navigator.storage.getDirectory();
  const fileHandle = await opfsRoot.getFileHandle(`${year}.sqlite`, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(data);
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
  const rows = await db.exec('SELECT year, generated_at, version FROM meta LIMIT 1');
  const row = rows[0];
  return {
    year: row.year,
    generatedAt: row.generated_at,
    version: row.version,
  };
}

/**
 * Load season norms
 */
async function loadSeasonNorms(db: any): Promise<any> {
  const rows = await db.exec('SELECT year, era, norms_json FROM norms LIMIT 1');
  const row = rows[0];
  return JSON.parse(row.norms_json);
}

/**
 * Load all batters for a team from SQLite
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
 * Load all pitchers for a team from SQLite
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
        completeGames,
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
 * Load league averages from SQLite
 */
async function loadLeagueAverages(db: any): Promise<{ vsLHP: EventRates; vsRHP: EventRates }> {
  const rows = await db.exec('SELECT * FROM league_averages');

  const result: any = { vsLHP: {} as EventRates, vsRHP: {} as EventRates };

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
 * Load pitcher-batter league averages from SQLite
 */
async function loadPitcherBatterLeague(db: any): Promise<{ vsLHP: EventRates; vsRHP: EventRates }> {
  const rows = await db.exec('SELECT split, rates_json FROM pitcher_batter_league');

  const result: any = { vsLHP: {} as EventRates, vsRHP: {} as EventRates };

  for (const row of rows) {
    const rates = JSON.parse(row.rates_json) as EventRates;
    const key = row.split === 'vsLHP' ? 'vsLHP' : 'vsRHP';
    result[key] = rates;
  }

  return result;
}

/**
 * Load teams from SQLite
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
 * Load games from SQLite
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
 * Main function to load a season (lazy loading - metadata only initially)
 */
export async function loadSeason(year: number): Promise<SeasonPackage> {
  // Check cache first
  if (SEASON_CACHE.has(year)) {
    return SEASON_CACHE.get(year)!.season;
  }

  // Open database (downloads if needed)
  const db = await openSeasonDatabase(year);

  // Load metadata
  const meta = await loadSeasonMeta(db);
  const norms = await loadSeasonNorms(db);
  const teams = await loadTeams(db);
  const games = await loadGames(db);
  const league = await loadLeagueAverages(db);
  const pitcherBatter = await loadPitcherBatterLeague(db);

  // Build season package (batters/pitchers loaded on-demand)
  const season: SeasonPackage = {
    meta,
    norms,
    batters: {}, // Loaded on-demand by team
    pitchers: {}, // Loaded on-demand by team
    league: {
      vsLHP: league.vsLHP,
      vsRHP: league.vsRHP,
      pitcherBatter,
    },
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
    await loadSeason(year);
    return getBattersForTeam(year, teamId);
  }

  const { db } = cached;
  return await loadBattersByTeam(db, teamId);
}

/**
 * Get pitchers for a specific team (lazy load)
 */
export async function getPitchersForTeam(year: number, teamId: string): Promise<Record<string, PitcherStats>> {
  const cached = SEASON_CACHE.get(year);
  if (!cached) {
    await loadSeason(year);
    return getPitchersForTeam(year, teamId);
  }

  const { db } = cached;
  return await loadPitchersByTeam(db, teamId);
}

/**
 * Get available years from manifest
 */
export async function getAvailableYears(): Promise<number[]> {
  try {
    const response = await fetch('/seasons/season-manifest.json');
    if (!response.ok) return [1976]; // Fallback

    const manifest: SeasonManifest = await response.json();
    return manifest.seasons.map(s => s.year).sort((a, b) => a - b);
  } catch {
    return [1976];
  }
}

/**
 * Clear cached seasons (closes database connections)
 */
export function clearSeasonCache(): void {
  SEASON_CACHE.clear();
}
```

**Step 2: Commit**

```bash
git add app/src/lib/game/sqlite-season-loader.ts
git commit -m "feat: add wa-sqlite season loader with OPFS and compression support"
```

---

## Task 9: Add test for SQLite season loader

**Files:**
- Create: `app/src/lib/game/sqlite-season-loader.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { clearSeasonCache } from './sqlite-season-loader.js';

describe('sqlite-season-loader', () => {
  afterEach(() => {
    clearSeasonCache();
  });

  it('should be importable', () => {
    expect(() => import('./sqlite-season-loader.js')).not.toThrow();
  });
});
```

**Step 2: Run test to verify it passes**

Run: `cd app && pnpm test sqlite-season-loader`

Expected: PASS

**Step 3: Commit**

```bash
git add app/src/lib/game/sqlite-season-loader.test.ts
git commit -m "test: add basic test for sqlite-season-loader"
```

---

## Task 10: Update game engine to use SQLite loader (simple imports first)

**Files:**
- Modify: `app/src/lib/game/engine.ts`

**Step 1: Update imports**

Find line 21-36 (imports section) and replace:

```typescript
// OLD imports:
// import { loadSeason } from './season-loader.js';
// import type { SeasonPackage, BatterStats, PitcherStats, ... }

// NEW imports:
import {
  loadSeason,
  getBattersForTeam,
  getPitchersForTeam,
  clearSeasonCache
} from './sqlite-season-loader.js';
import type {
  GameState,
  LineupState,
  PlayEvent,
  Outcome,
  SeasonPackage,
  BatterStats,
  PitcherStats,
  LineupPlayer
} from './types.js';
```

**Step 2: Commit**

```bash
git add app/src/lib/game/engine.ts
git commit -m "refactor: update engine imports to use sqlite-season-loader"
```

---

## Task 11: Update GameEngine constructor to load teams from SQLite

**Files:**
- Modify: `app/src/lib/game/engine.ts`

**Step 1: Find the GameEngine class constructor**

The constructor should be around line 400-500. Look for:

```typescript
export class GameEngine {
  constructor(year: number, awayTeam: string, homeTeam: string, ...) {
    // ...
    this.season = await loadSeason(year);
    // ...
  }
}
```

**Step 2: Update constructor to load batters/pitchers by team**

Replace the season loading part with:

```typescript
async function initSeasonData(year: number, awayTeam: string, homeTeam: string) {
  // Load season metadata
  const season = await loadSeason(year);

  // Load batters and pitchers for both teams
  const [awayBatters, homeBatters] = await Promise.all([
    getBattersForTeam(year, awayTeam),
    getBattersForTeam(year, homeTeam),
  ]);

  const [awayPitchers, homePitchers] = await Promise.all([
    getPitchersForTeam(year, awayTeam),
    getPitchersForTeam(year, homeTeam),
  ]);

  const batters = { ...awayBatters, ...homeBatters };
  const pitchers = { ...awayPitchers, ...homePitchers };

  return { season, batters, pitchers };
}

export class GameEngine {
  // ... existing properties ...

  constructor(
    year: number,
    awayTeam: string,
    homeTeam: string,
    options: ManagerialOptions = {}
  ) {
    // ... existing initialization ...

    // NEW: Load season data from SQLite
    const { season, batters, pitchers } = await initSeasonData(year, awayTeam, homeTeam);
    this.season = season;
    this.batters = batters;
    this.pitchers = pitchers;

    // ... rest of constructor ...
  }
}
```

**Step 3: Commit**

```bash
git add app/src/lib/game/engine.ts
git commit -m "refactor: load team batters/pitchers from SQLite instead of JSON"
```

---

## Task 12: Run existing game tests to check for breakage

**Files:**
- Test: `app/src/lib/game/engine.test.ts`

**Step 1: Run game engine tests**

Run: `cd app && pnpm test engine`

Expected: May fail due to async constructor changes

**Step 2: Note any failures**

If tests fail, note what needs to be fixed (will address in next tasks)

**Step 3: Commit test results documentation**

```bash
# Create notes file if needed
echo "# Test Results - $(date)" > app/test-results-sqlite-migration.md
pnpm test engine 2>&1 | tee -a app/test-results-sqlite-migration.md
git add app/test-results-sqlite-migration.md
git commit -m "docs: record baseline test results for SQLite migration"
```

---

## Task 13: Install better-sqlite3 in model package for tests

**Files:**
- Modify: `packages/model/package.json`

**Step 1: Add better-sqlite3 to devDependencies**

Run: `cd packages/model && pnpm add -D better-sqlite3`

Expected: Package installed successfully

**Step 2: Verify installation**

Run: `cd packages/model && pnpm list better-sqlite3`

Expected: Shows version

**Step 3: Commit**

```bash
git add packages/model/package.json packages/model/pnpm-lock.yaml
git commit -m "deps(model): add better-sqlite3 for SQLite testing"
```

---

## Task 14: Create test helper for SQLite database access

**Files:**
- Create: `packages/model/test/helpers/season-db.ts`

**Step 1: Create the SeasonDB test helper class**

```typescript
import Database from 'better-sqlite3';
import type { BatterStats, PitcherStats, EventRates } from '../../src/types.js';

/**
 * Test helper for accessing season SQLite databases
 * Opens the same SQLite files used in production for 100% parity
 */
export class TestSeasonDB {
  private db: Database.Database;

  constructor(sqlitePath: string) {
    this.db = new Database(sqlitePath, { readonly: true });
  }

  /**
   * Get a single batter by ID
   */
  getBatter(id: string): BatterStats | null {
    const batterRow = this.db.prepare(`
      SELECT * FROM batters WHERE id = ?
    `).get(id);

    if (!batterRow) return null;

    const ratesRows = this.db.prepare(`
      SELECT * FROM batter_rates WHERE batter_id = ?
    `).all(id);

    const rates: any = { vsLHP: {} as EventRates, vsRHP: {} as EventRates };
    for (const row of ratesRows) {
      const key = row.split === 'vsLHP' ? 'vsLHP' : 'vsRHP';
      rates[key] = {
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
      const batter = this.getBatter(row.id as string);
      if (batter) batters[row.id as string] = batter;
    }

    return batters;
  }

  /**
   * Get all batters
   */
  getAllBatters(): Record<string, BatterStats> {
    const rows = this.db.prepare(`SELECT id FROM batters`).all();

    const batters: Record<string, BatterStats> = {};
    for (const row of rows) {
      const batter = this.getBatter(row.id as string);
      if (batter) batters[row.id as string] = batter;
    }

    return batters;
  }

  /**
   * Get a single pitcher by ID
   */
  getPitcher(id: string): PitcherStats | null {
    const pitcherRow = this.db.prepare(`
      SELECT * FROM pitchers WHERE id = ?
    `).get(id);

    if (!pitcherRow) return null;

    const ratesRows = this.db.prepare(`
      SELECT * FROM pitcher_rates WHERE pitcher_id = ?
    `).all(id);

    const rates: any = { vsLHB: {} as EventRates, vsRHB: {} as EventRates };
    for (const row of ratesRows) {
      const key = row.split === 'vsLHB' ? 'vsLHB' : 'vsRHB';
      rates[key] = {
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
      id: pitcherRow.id,
      name: pitcherRow.name,
      throws: pitcherRow.throws,
      teamId: pitcherRow.team_id,
      avgBfpAsStarter: pitcherRow.avg_bfp_as_starter,
      avgBfpAsReliever: pitcherRow.avg_bfp_as_reliever,
      games: pitcherRow.games,
      gamesStarted: pitcherRow.games_started,
      completeGames: pitcherRow.complete_games,
      saves: pitcherRow.saves,
      inningsPitched: pitcherRow.innings_pitched,
      whip: pitcherRow.whip,
      era: pitcherRow.era,
      rates,
    };
  }

  /**
   * Get all pitchers for a team
   */
  getPitchersByTeam(teamId: string): Record<string, PitcherStats> {
    const rows = this.db.prepare(`
      SELECT id FROM pitchers WHERE team_id = ?
    `).all(teamId);

    const pitchers: Record<string, PitcherStats> = {};
    for (const row of rows) {
      const pitcher = this.getPitcher(row.id as string);
      if (pitcher) pitchers[row.id as string] = pitcher;
    }

    return pitchers;
  }

  /**
   * Get league averages
   */
  getLeagueAverages(): { vsLHP: EventRates; vsRHP: EventRates } {
    const rows = this.db.exec('SELECT * FROM league_averages');

    const result: any = { vsLHP: {} as EventRates, vsRHP: {} as EventRates };

    for (const row of rows) {
      const key = row.split === 'vsLHP' ? 'vsLHP' : 'vsRHP';
      result[key] = {
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

    return result;
  }

  /**
   * Get season metadata
   */
  getMeta(): { year: number; generatedAt: string; version: string } {
    const row = this.db.prepare('SELECT * FROM meta LIMIT 1').get() as any;
    return {
      year: row.year,
      generatedAt: row.generated_at,
      version: row.version,
    };
  }

  close(): void {
    this.db.close();
  }
}
```

**Step 2: Commit**

```bash
git add packages/model/test/helpers/season-db.ts
git commit -m "test: add TestSeasonDB helper for SQLite test access"
```

---

## Task 15: Write test that verifies SQLite data matches expected structure

**Files:**
- Create: `packages/model/test/season-db.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestSeasonDB } from './helpers/season-db.js';

describe('TestSeasonDB', () => {
  let db: TestSeasonDB;

  beforeEach(() => {
    db = new TestSeasonDB('../../app/static/seasons/1976.sqlite');
  });

  afterEach(() => {
    db.close();
  });

  it('should load season metadata', () => {
    const meta = db.getMeta();
    expect(meta.year).toBe(1976);
    expect(meta.generatedAt).toBeTruthy();
    expect(meta.version).toBeTruthy();
  });

  it('should get a batter by ID', () => {
    const batter = db.getBatter('carew001'); // Rod Carew

    expect(batter).not.toBeNull();
    expect(batter!.name).toBeTruthy();
    expect(batter!.bats).toMatch(/^[LRS]$/);
    expect(batter!.rates.vsLHP).toBeDefined();
    expect(batter!.rates.vsRHP).toBeDefined();
  });

  it('should get all batters for a team', () => {
    const batters = db.getBattersByTeam('MIN'); // Minnesota Twins

    expect(Object.keys(batters).length).toBeGreaterThan(0);

    // Verify structure
    const firstBatter = Object.values(batters)[0];
    expect(firstBatter.id).toBeTruthy();
    expect(firstBatter.rates.vsLHP).toBeDefined();
    expect(firstBatter.rates.vsRHP).toBeDefined();
  });

  it('should get a pitcher by ID', () => {
    const pitcher = db.getPitcher('palme001'); // Jim Palmer

    expect(pitcher).not.toBeNull();
    expect(pitcher!.name).toBeTruthy();
    expect(pitcher!.throws).toMatch(/^[LR]$/);
    expect(pitcher!.rates.vsLHB).toBeDefined();
    expect(pitcher!.rates.vsRHB).toBeDefined();
  });

  it('should get league averages', () => {
    const league = db.getLeagueAverages();

    expect(league.vsLHP).toBeDefined();
    expect(league.vsRHP).toBeDefined();

    // Verify rates sum to approximately 1.0 (probabilities)
    const vsLHPSum = Object.values(league.vsLHP).reduce((sum, val) => sum + val, 0);
    expect(vsLHPSum).toBeCloseTo(1.0, 3);
  });
});
```

**Step 2: Run test to verify it fails (SQLite file doesn't exist yet)**

Run: `cd packages/model && pnpm test season-db`

Expected: FAIL - "ENOENT: no such file or directory" or similar

**Step 3: Export a test SQLite file**

Run: `cd data-prep && pnpm exec tsx src/export-season.ts 1976 ../../baseball.duckdb ../../app/static/seasons/1976 sqlite`

Expected: Creates `app/static/seasons/1976.sqlite` and `.gz` file

**Step 4: Run test again to verify it passes**

Run: `cd packages/model && pnpm test season-db`

Expected: PASS (all tests pass)

**Step 5: Commit**

```bash
git add packages/model/test/season-db.test.ts
git commit -m "test: add SeasonDB tests with real SQLite data"
```

---

## Task 16: Update MatchupModel tests to use SQLite data

**Files:**
- Modify: `packages/model/src/MatchupModel.test.ts`

**Step 1: Add TestSeasonDB import and setup**

At the top of the file, add:

```typescript
import { TestSeasonDB } from '../test/helpers/season-db.js';
```

**Step 2: Update the describe block for real data tests**

Find the test that uses real 1976 data and update:

```typescript
describe('MatchupModel - with real season data', () => {
  let db: TestSeasonDB;

  beforeAll(() => {
    db = new TestSeasonDB('../../app/static/seasons/1976.sqlite');
  });

  afterAll(() => {
    db.close();
  });

  it('should predict outcomes for actual players', () => {
    const batter = db.getBatter('carew001'); // Rod Carew
    const pitcher = db.getPitcher('palme001'); // Jim Palmer
    const league = db.getLeagueAverages();

    if (!batter || !pitcher) {
      throw new Error('Test data not found - ensure SQLite file exists');
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
        vsLeft: league.vsLHP,
        vsRight: league.vsRHP,
      },
    });

    // Validate distribution
    const sum = Object.values(distribution).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1, 4);
    expect(distribution.homeRun).toBeGreaterThan(0);
    expect(distribution.strikeout).toBeGreaterThan(0);
    expect(distribution.walk).toBeGreaterThan(0);
  });
});
```

**Step 3: Run the updated tests**

Run: `cd packages/model && pnpm test MatchupModel.test.ts`

Expected: PASS

**Step 4: Commit**

```bash
git add packages/model/src/MatchupModel.test.ts
git commit -m "test: use SQLite data in MatchupModel tests for parity"
```

---

## Task 17: Update season manifest generation

**Files:**
- Modify: `data-prep/src/export-season.ts`

**Step 1: Add manifest generation to export function**

At the end of `exportSeasonAsSqlite()` function, add:

```typescript
import { writeManifest } from './update-manifest.js';

// In exportSeasonAsSqlite(), after compression:
// Regenerate manifest
writeManifest(path.dirname(outputPath));
```

**Step 2: Run export to generate manifest**

Run: `cd data-prep && pnpm exec tsx src/export-season.ts 1976 ../../baseball.duckdb ../../app/static/seasons/1976 sqlite`

Expected: Creates `app/static/seasons/season-manifest.json`

**Step 3: Verify manifest contents**

Run: `cat app/static/seasons/season-manifest.json`

Expected: Valid JSON with 1976 season info, file sizes

**Step 4: Commit**

```bash
git add data-prep/src/export-season.ts
git commit -m "feat: auto-generate season manifest after SQLite export"
```

---

## Task 18: Update Vite config to serve compressed SQLite files

**Files:**
- Modify: `app/vite.config.ts`

**Step 1: Check current Vite config**

Run: `cat app/vite.config.ts`

Expected: See existing Vite configuration

**Step 2: Ensure static assets are served correctly**

Verify the config includes static file serving (usually default in Vite). No changes typically needed, but verify that `.sqlite` and `.sqlite.gz` files are served.

**Step 3: Test compressed file serving in dev**

Run: `cd app && pnpm dev`

Visit: `http://localhost:5173/seasons/1976.sqlite.gz`

Expected: File downloads or serves with correct Content-Encoding

**Step 4: Test manifest serving**

Visit: `http://localhost:5173/seasons/season-manifest.json`

Expected: Valid JSON manifest

**Step 5: Commit if changes needed**

If config was modified:

```bash
git add app/vite.config.ts
git commit -m "config: ensure SQLite files are served with correct headers"
```

---

## Task 19: Write integration test for full SQLite workflow

**Files:**
- Create: `app/test/integration/sqlite-workflow.test.ts`

**Step 1: Write the integration test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { clearSeasonCache } from '../../src/lib/game/sqlite-season-loader.js';

describe('SQLite workflow integration', () => {
  afterEach(() => {
    clearSeasonCache();
  });

  it('should load season manifest', async () => {
    const response = await fetch('/seasons/season-manifest.json');
    expect(response.ok).toBe(true);

    const manifest = await response.json();
    expect(manifest.seasons).toBeInstanceOf(Array);
    expect(manifest.seasons.length).toBeGreaterThan(0);
  });

  it('should download and cache season in OPFS', async () => {
    const { loadSeason } = await import('../../src/lib/game/sqlite-season-loader.js');

    // First load should download
    const season1 = await loadSeason(1976);
    expect(season1.meta.year).toBe(1976);

    // Clear cache and load again
    clearSeasonCache();
    const season2 = await loadSeason(1976);
    expect(season2.meta.year).toBe(1976);
  });

  it('should load batters for a specific team', async () => {
    const { getBattersForTeam } = await import('../../src/lib/game/sqlite-season-loader.js');

    const batters = await getBattersForTeam(1976, 'MIN');
    expect(Object.keys(batters).length).toBeGreaterThan(0);

    const firstBatter = Object.values(batters)[0];
    expect(firstBatter.rates.vsLHP).toBeDefined();
    expect(firstBatter.rates.vsRHP).toBeDefined();
  });
});
```

**Step 2: Update vitest config to include integration tests**

Check `app/vitest.config.ts` and ensure it includes `app/test`:

```typescript
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,js}', 'test/**/*.{test,spec}.{ts,js}'],
    // ...
  },
});
```

**Step 3: Run integration tests**

Run: `cd app && pnpm test integration`

Expected: May fail initially (need to set up test environment)

**Step 4: Commit**

```bash
git add app/test/integration/sqlite-workflow.test.ts
git commit -m "test: add SQLite workflow integration tests"
```

---

## Task 20: Run full test suite to verify everything works

**Files:**
- Test: All tests in `packages/model` and `app`

**Step 1: Run model tests**

Run: `cd packages/model && pnpm test`

Expected: All tests pass

**Step 2: Run app tests**

Run: `cd app && pnpm test`

Expected: All tests pass (may need fixes for async constructor)

**Step 3: Document test results**

Run:
```bash
cd packages/model && pnpm test > test-results.txt 2>&1
cd ../app && pnpm test >> ../test-results.txt 2>&1
cat test-results.txt
```

**Step 4: Commit test results**

```bash
git add test-results.txt
git commit -m "test: record full test suite results for SQLite migration"
```

---

## Task 21: Clean up old JSON loader (optional, after verification)

**Files:**
- Modify: `app/src/lib/game/season-loader.ts` (mark as deprecated)
- Delete: `app/static/seasons/*.json` (after verification)

**Step 1: Add deprecation notice to JSON loader**

At the top of `season-loader.ts`:

```typescript
/**
 * @deprecated Use sqlite-season-loader.ts instead
 * This loader is kept for backward compatibility during migration
 */
```

**Step 2: Update any remaining references**

Search for imports of the old loader:

Run: `cd app && grep -r "from './season-loader'" src/`

Update any remaining imports to use sqlite-season-loader

**Step 3: Commit**

```bash
git add app/src/lib/game/season-loader.ts
git commit -m "refactor: deprecate JSON season-loader in favor of SQLite"
```

---

## Execution Handoff

**Plan complete and saved to `docs/plans/2025-02-04-sqlite-conversion-implementation.md`**

**Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans skill, batch execution with checkpoints

**Which approach?**
