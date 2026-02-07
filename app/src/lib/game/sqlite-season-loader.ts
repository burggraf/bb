/**
 * Load season data from SQLite files using sql.js
 * Downloads SQLite files and caches them in IndexedDB as raw bytes
 */

import initSqlJs, { type Database } from 'sql.js';
import type { SeasonPackage, BatterStats, PitcherStats, EventRates } from './types.js';

// Global SQL.js instance (initialized once)
let SQL: any = null;

// Cache for open database instances and season data
const SEASON_CACHE = new Map<number, { db: Database; season: SeasonPackage }>();

// IndexedDB database name for caching downloaded SQLite files
const CACHE_DB_NAME = 'bb-sqlite-cache';
const CACHE_STORE_NAME = 'databases';

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

export interface ScheduledGame {
	id: string;
	date: string;
	awayTeam: string;
	homeTeam: string;
	useDh: boolean;
	parkId?: string;
}

/**
 * Initialize SQL.js
 */
export async function initializeSQLJS(): Promise<void> {
	if (SQL) return;

	console.log('[SQLite] Initializing sql.js...');
	SQL = await initSqlJs({
		// Load the wasm file from CDN
		locateFile: (file: string) => `https://sql.js.org/dist/${file}`
	});
	console.log('[SQLite] sql.js initialized');

	// Clean up old JSON caches from localStorage (migration)
	clearOldJsonCaches();
}

/**
 * Open the cache IndexedDB
 */
function openCacheDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(CACHE_DB_NAME, 1);

		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
				db.createObjectStore(CACHE_STORE_NAME);
			}
		};

		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

/**
 * Get cached database bytes from IndexedDB
 */
async function getCached(year: number): Promise<Uint8Array | null> {
	const db = await openCacheDB();
	return new Promise((resolve) => {
		const tx = db.transaction(CACHE_STORE_NAME, 'readonly');
		const store = tx.objectStore(CACHE_STORE_NAME);
		const request = store.get(year);
		request.onsuccess = () => {
			db.close();
			resolve(request.result || null);
		};
		request.onerror = () => {
			db.close();
			resolve(null);
		};
	});
}

/**
 * Cache database bytes in IndexedDB
 */
async function setCache(year: number, data: Uint8Array): Promise<void> {
	const db = await openCacheDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(CACHE_STORE_NAME, 'readwrite');
		const store = tx.objectStore(CACHE_STORE_NAME);
		store.put(data, year);
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
 * Download SQLite file from server
 * The browser automatically decompresses .gz files served with Content-Encoding: gzip
 */
async function downloadDatabase(year: number): Promise<Uint8Array> {
	console.log(`[SQLite] Downloading season ${year}...`);
	try {
		const response = await fetch(`/seasons/${year}.sqlite.gz`);
		if (!response.ok) {
			throw new Error(`Failed to download ${year}.sqlite.gz: ${response.statusText}`);
		}

		// Browser automatically decompresses when Content-Encoding: gzip is set
		const buffer = await response.arrayBuffer();
		const data = new Uint8Array(buffer);

		console.log(`[SQLite] Downloaded ${year}.sqlite.gz: ${data.length} bytes (decompressed)`);
		return data;
	} catch (error: any) {
		console.error(`[SQLite] Error downloading ${year}:`, error.message, error);
		throw error;
	}
}

/**
 * Get database bytes (from cache or download)
 */
export async function getDatabaseBytes(year: number): Promise<Uint8Array> {
	// Check cache first
	const cached = await getCached(year);
	if (cached) {
		console.log(`[SQLite] Using cached ${year}.sqlite: ${cached.length} bytes`);
		return cached;
	}

	// Download and cache
	const data = await downloadDatabase(year);
	await setCache(year, data);
	console.log(`[SQLite] Cached ${year}.sqlite`);
	return data;
}

/**
 * Open database from bytes using sql.js
 */
export async function openDatabaseFromBytes(year: number, data: Uint8Array): Promise<Database> {
	await initializeSQLJS();

	console.log(`[SQLite] Opening database from ${data.length} bytes...`);
	const db = new SQL.Database(data);
	console.log(`[SQLite] Database opened successfully`);

	// Verify database is valid by checking sqlite_master
	const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
	const tableNames = tables[0]?.values.map((row: any[]) => row[0]) || [];
	console.log(`[SQLite] Found tables:`, tableNames);

	return db;
}

/**
 * Execute a query and return all rows as objects
 */
function queryAll(db: Database, sql: string, params?: any[]): Record<string, any>[] {
	const stmt = db.prepare(sql);
	if (params) {
		stmt.bind(params);
	}

	const rows: Record<string, any>[] = [];
	while (stmt.step()) {
		rows.push(stmt.getAsObject());
	}
	stmt.free();

	return rows;
}

/**
 * Load season metadata
 */
function loadSeasonMeta(db: Database): { year: number; generatedAt: string; version: string } {
	const rows = queryAll(db, 'SELECT year, generated_at, version FROM meta LIMIT 1');
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
function loadSeasonNorms(db: Database): any {
	const rows = queryAll(db, 'SELECT year, era, norms_json FROM norms LIMIT 1');
	const row = rows[0];
	return JSON.parse(row.norms_json);
}

/**
 * Load all batters for a team
 */
function loadBattersByTeam(db: Database, teamId: string): Record<string, BatterStats> {
	const rows = queryAll(
		db,
		`SELECT
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
		ORDER BY b.id`,
		[teamId]
	);

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
function loadPitchersByTeam(db: Database, teamId: string): Record<string, PitcherStats> {
	const rows = queryAll(
		db,
		`SELECT
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
		ORDER BY p.id`,
		[teamId]
	);

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
function loadLeagueAverages(db: Database): { vsLHP: EventRates; vsRHP: EventRates } {
	const rows = queryAll(db, `
		SELECT split, single, double, triple, home_run, walk, hit_by_pitch, strikeout,
			ground_out, fly_out, line_out, pop_out, sacrifice_fly, sacrifice_bunt,
			fielders_choice, reached_on_error, catcher_interference
		FROM league_averages
	`);

	const result: any = { vsLHP: {} as EventRates, vsRHP: {} as EventRates };

	for (const row of rows) {
		const rates = {
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
		const key = row.split === 'vsLHP' ? 'vsLHP' : 'vsRHP';
		result[key] = rates;
	}

	return result;
}

/**
 * Load pitcher-batter league averages
 */
function loadPitcherBatterLeague(db: Database): { vsLHP: EventRates; vsRHP: EventRates } {
	const rows = queryAll(db, 'SELECT split, rates_json FROM pitcher_batter_league');

	const result: any = { vsLHP: {} as EventRates, vsRHP: {} as EventRates };

	for (const row of rows) {
		const rates = JSON.parse(row.rates_json) as EventRates;
		const key = row.split === 'vsLHP' ? 'vsLHP' : 'vsRHP';
		result[key] = rates;
	}

	return result;
}

/**
 * Load teams
 */
function loadTeams(db: Database): Record<string, { id: string; league: string; city: string; nickname: string }> {
	const rows = queryAll(db, 'SELECT * FROM teams');

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
function loadGames(db: Database): any[] {
	const rows = queryAll(db, 'SELECT * FROM games');
	return rows;
}

/**
 * Open a season database
 */
async function openSeasonDatabase(year: number): Promise<Database> {
	const data = await getDatabaseBytes(year);
	return openDatabaseFromBytes(year, data);
}

/**
 * Load a complete season
 */
export async function loadSeason(year: number): Promise<SeasonPackage> {
	if (SEASON_CACHE.has(year)) {
		return SEASON_CACHE.get(year)!.season;
	}

	const db = await openSeasonDatabase(year);

	const meta = loadSeasonMeta(db);
	const norms = loadSeasonNorms(db);
	const teams = loadTeams(db);
	const games = loadGames(db);
	const league = loadLeagueAverages(db);
	const pitcherBatter = loadPitcherBatterLeague(db);

	const season: SeasonPackage = {
		meta,
		norms,
		batters: {},
		pitchers: {},
		league: {
			vsLHP: league.vsLHP,
			vsRHP: league.vsRHP,
			pitcherBatter,
		},
		teams,
		games,
	};

	SEASON_CACHE.set(year, { db, season });

	return season;
}

/**
 * Load a season with players for specific teams (for GameEngine)
 */
export async function loadSeasonForGame(
	year: number,
	awayTeam: string,
	homeTeam: string
): Promise<SeasonPackage> {
	console.log(`[SQLite] loadSeasonForGame: year=${year}, away=${awayTeam}, home=${homeTeam}`);

	const season = await loadSeason(year);
	const cached = SEASON_CACHE.get(year);
	if (!cached) {
		throw new Error('Season not found in cache after loading');
	}
	const { db } = cached;

	const awayBatters = loadBattersByTeam(db, awayTeam);
	const homeBatters = loadBattersByTeam(db, homeTeam);
	console.log(`[SQLite] Loaded ${Object.keys(awayBatters).length} away batters, ${Object.keys(homeBatters).length} home batters`);

	const awayPitchers = loadPitchersByTeam(db, awayTeam);
	const homePitchers = loadPitchersByTeam(db, homeTeam);
	console.log(`[SQLite] Loaded ${Object.keys(awayPitchers).length} away pitchers, ${Object.keys(homePitchers).length} home pitchers`);

	season.batters = { ...awayBatters, ...homeBatters };
	season.pitchers = { ...awayPitchers, ...homePitchers };

	return season;
}

/**
 * Get batters for a team (lazy load)
 */
export async function getBattersForTeam(year: number, teamId: string): Promise<Record<string, BatterStats>> {
	const cached = SEASON_CACHE.get(year);
	if (!cached) {
		await loadSeason(year);
		return getBattersForTeam(year, teamId);
	}
	return loadBattersByTeam(cached.db, teamId);
}

/**
 * Get pitchers for a team (lazy load)
 */
export async function getPitchersForTeam(year: number, teamId: string): Promise<Record<string, PitcherStats>> {
	const cached = SEASON_CACHE.get(year);
	if (!cached) {
		await loadSeason(year);
		return getPitchersForTeam(year, teamId);
	}
	return loadPitchersByTeam(cached.db, teamId);
}

/**
 * Get available years from manifest
 */
export async function getAvailableYears(): Promise<number[]> {
	try {
		const response = await fetch('/seasons/season-manifest.json');
		if (!response.ok) return [1976];

		const manifest: SeasonManifest = await response.json();
		return manifest.seasons.map(s => s.year).sort((a, b) => a - b);
	} catch {
		return [1976];
	}
}

/**
 * Check if a season is cached in IndexedDB
 */
export async function isSeasonCached(year: number): Promise<boolean> {
	const cached = await getCached(year);
	return cached !== null;
}

/**
 * Download a season (fetch and cache, returns when ready)
 */
export async function downloadSeason(
	year: number,
	onProgress?: (progress: number) => void
): Promise<void> {
	// Check if already cached
	const cached = await getCached(year);
	if (cached) {
		onProgress?.(1);
		return;
	}

	// Download
	onProgress?.(0.1);
	const data = await downloadDatabase(year);
	onProgress?.(0.8);

	// Cache
	await setCache(year, data);
	onProgress?.(1);
}

/**
 * Get season schedule (games) from SQLite database
 */
export async function getSeasonSchedule(year: number): Promise<ScheduledGame[]> {
	await initializeSQLJS();
	const bytes = await getDatabaseBytes(year);
	const db = new SQL.Database(bytes);
	try {
		const stmt = db.prepare(`
      SELECT id, date, away_team, home_team, use_dh, park_id
      FROM games
      ORDER BY date, id
    `);
		const games: ScheduledGame[] = [];
		while (stmt.step()) {
			const row = stmt.getAsObject() as any;
			games.push({
				id: row.id,
				date: row.date,
				awayTeam: row.away_team,
				homeTeam: row.home_team,
				useDh: row.use_dh === 1,
				parkId: row.park_id
			});
		}
		stmt.free();
		return games;
	} finally {
		db.close();
	}
}

/**
 * Clear cached seasons
 */
export async function clearSeasonCache(): Promise<void> {
	for (const { db } of SEASON_CACHE.values()) {
		db.close();
	}
	SEASON_CACHE.clear();
}

/**
 * Clear IndexedDB cache (for debugging)
 */
export async function clearDatabaseCache(): Promise<void> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.deleteDatabase(CACHE_DB_NAME);
		request.onsuccess = () => {
			console.log('[SQLite] Cleared database cache');
			resolve();
		};
		request.onerror = () => reject(request.error);
	});
}

/**
 * Clear old JSON localStorage caches (migration helper)
 */
export function clearOldJsonCaches(): void {
	if (typeof localStorage === 'undefined') return;

	const keysToRemove: string[] = [];
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i);
		if (key && key.startsWith('bb_season_')) {
			keysToRemove.push(key);
		}
	}
	keysToRemove.forEach(key => localStorage.removeItem(key));
	console.log(`[SQLite] Cleared ${keysToRemove.length} old JSON season caches from localStorage`);
}

// Expose debug functions to window
if (typeof window !== 'undefined') {
	(window as any).clearDatabaseCache = clearDatabaseCache;
	(window as any).clearSeasonCache = clearSeasonCache;
	(window as any).clearOldJsonCaches = clearOldJsonCaches;
}
