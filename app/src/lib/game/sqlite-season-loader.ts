/**
 * Load season data from SQLite files using wa-sqlite
 * Downloads .sqlite files to OPFS and queries them directly
 */

import * as SQLite from 'wa-sqlite';
import SQLiteESMFactory from 'wa-sqlite/dist/wa-sqlite.mjs';
import { OriginPrivateFileSystemVFS } from 'wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js';
import { inflate } from 'pako';
import type { SeasonPackage, BatterStats, PitcherStats, EventRates } from './types.js';

// Type for SQLite compatible values (from wa-sqlite types)
type SQLiteCompatibleType = number | string | Uint8Array | number[] | bigint | null;

// Global SQLite API instance (initialized once)
let sqlite3: ReturnType<typeof SQLite.Factory> | null = null;
let module: any = null;

const SEASON_CACHE = new Map<number, { db: number; season: SeasonPackage }>();

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
 * Initialize SQLite API with OPFS VFS
 */
async function initializeSQLite(): Promise<void> {
  if (sqlite3) return; // Already initialized

  // Load the WASM module
  module = await SQLiteESMFactory();
  sqlite3 = SQLite.Factory(module);

  // Register OPFS VFS
  const opfsVfs = new OriginPrivateFileSystemVFS();
  await opfsVfs.mkdir('');
  // @ts-expect-error - OPFS VFS uses async methods which are compatible with async SQLite build
  sqlite3.vfs_register(opfsVfs, true); // Make default
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
  // Create a proper ArrayBuffer from the Uint8Array
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  await writable.write(buffer);
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
async function openSeasonDatabase(year: number): Promise<number> {
  await initializeSQLite();

  // Download if not already present
  if (!(await isSeasonDownloaded(year))) {
    await downloadSeasonToOPFS(year);
  }

  // Open with wa-sqlite (OPFS VFS is default)
  const db = await sqlite3!.open_v2(`${year}.sqlite`);
  return db;
}

/**
 * Execute a query and return all rows as objects
 */
async function queryAll(db: number, sql: string, params?: SQLiteCompatibleType[]): Promise<Record<string, any>[]> {
  const result = await sqlite3!.execWithParams(db, sql, params || []);
  const columns = result.columns;
  return result.rows.map(row => {
    const obj: Record<string, any> = {};
    columns.forEach((col: string, i: number) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

/**
 * Load season meta information
 */
async function loadSeasonMeta(db: number): Promise<{ year: number; generatedAt: string; version: string }> {
  const rows = await queryAll(db, 'SELECT year, generated_at, version FROM meta LIMIT 1');
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
async function loadSeasonNorms(db: number): Promise<any> {
  const rows = await queryAll(db, 'SELECT year, era, norms_json FROM norms LIMIT 1');
  const row = rows[0];
  return JSON.parse(row.norms_json);
}

/**
 * Load all batters for a team from SQLite
 */
async function loadBattersByTeam(db: number, teamId: string): Promise<Record<string, BatterStats>> {
  const rows = await queryAll(
    db,
    `
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
  `,
    [teamId]
  );

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
async function loadPitchersByTeam(db: number, teamId: string): Promise<Record<string, PitcherStats>> {
  const rows = await queryAll(
    db,
    `
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
  `,
    [teamId]
  );

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
 * Load league averages from SQLite
 */
async function loadLeagueAverages(db: number): Promise<{ vsLHP: EventRates; vsRHP: EventRates }> {
  const rows = await queryAll(db, 'SELECT * FROM league_averages');

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
async function loadPitcherBatterLeague(db: number): Promise<{ vsLHP: EventRates; vsRHP: EventRates }> {
  const rows = await queryAll(db, 'SELECT split, rates_json FROM pitcher_batter_league');

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
async function loadTeams(db: number): Promise<Record<string, { id: string; league: string; city: string; nickname: string }>> {
  const rows = await queryAll(db, 'SELECT * FROM teams');

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
async function loadGames(db: number): Promise<Array<{ id: string; date: string; awayTeam: string; homeTeam: string; useDH: boolean }>> {
  const rows = await queryAll(db, 'SELECT * FROM games');

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
 * Load a season with players for specific teams (for GameEngine)
 * This pre-loads batters and pitchers for the two teams that will play
 */
export async function loadSeasonForGame(
  year: number,
  awayTeam: string,
  homeTeam: string
): Promise<SeasonPackage> {
  // Load base season (metadata)
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

  // Merge into season package
  season.batters = { ...awayBatters, ...homeBatters };
  season.pitchers = { ...awayPitchers, ...homePitchers };

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
export async function clearSeasonCache(): Promise<void> {
  for (const { db } of SEASON_CACHE.values()) {
    await sqlite3!.close(db);
  }
  SEASON_CACHE.clear();
}
