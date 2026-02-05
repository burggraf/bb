/**
 * Load season data from compressed JSON files
 * Supports gzip decompression and persistent caching
 */

import type { SeasonPackage } from './types.js';

interface SeasonManifest {
	meta: {
		generatedAt: string;
		totalYears: number;
		totalCompressedSize: number;
	};
	seasons: Array<{
		year: number;
		file: string;
		compressedSize: number;
		generatedAt: string;
	}>;
}

interface CachedSeason {
	season: SeasonPackage;
	cachedAt: string;
	version: string;
}

const SEASON_CACHE = new Map<number, SeasonPackage>();
const CACHE_PREFIX = 'bb_season_';
const MANIFEST_CACHE_KEY = 'bb_manifest';

/**
 * Decompress gzip response using DecompressionStream API
 * Only needed if the server doesn't automatically decompress
 */
async function decompressResponse(response: Response): Promise<any> {
	if (!response.body) {
		throw new Error('Response body is null');
	}

	const decompressed = response.body.pipeThrough(
		new DecompressionStream('gzip')
	);
	const text = await new Response(decompressed).text();
	return JSON.parse(text);
}

/**
 * Fetch season data from .json.gz or .json files
 *
 * Note: Vite's dev server automatically serves .gz files with Content-Encoding: gzip,
 * which causes the browser to decompress them before our code sees the response.
 * Production servers may behave differently, so we handle both cases.
 */
async function fetchSeason(year: number): Promise<SeasonPackage> {
	// Try compressed file first
	let response = await fetch(`/seasons/${year}.json.gz`);

	if (response.ok) {
		// Check if server already decompressed (Vite dev server behavior)
		const contentEncoding = response.headers.get('Content-Encoding');
		if (contentEncoding === 'gzip') {
			// Browser auto-decompressed, just parse JSON
			return await response.json();
		} else {
			// Server didn't decompress, do it client-side
			return await decompressResponse(response);
		}
	}

	// Fallback to uncompressed JSON (for local development)
	response = await fetch(`/seasons/${year}.json`);
	if (!response.ok) {
		throw new Error(`Failed to load season ${year}: ${response.statusText}`);
	}

	return await response.json();
}

/**
 * Load season from localStorage cache if available and valid
 */
function loadFromCache(year: number): SeasonPackage | null {
	const cacheKey = `${CACHE_PREFIX}${year}`;
	try {
		const cached = localStorage.getItem(cacheKey);
		if (!cached) return null;

		const data = JSON.parse(cached) as CachedSeason;

		// Check if cache is valid (not too old, matching version)
		const cachedAge = Date.now() - new Date(data.cachedAt).getTime();
		const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days

		if (cachedAge > maxAge) {
			localStorage.removeItem(cacheKey);
			return null;
		}

		return data.season;
	} catch {
		return null;
	}
}

/**
 * Save season to localStorage cache
 */
function saveToCache(year: number, season: SeasonPackage): void {
	const cacheKey = `${CACHE_PREFIX}${year}`;
	const data: CachedSeason = {
		season,
		cachedAt: new Date().toISOString(),
		version: season.meta.version,
	};

	try {
		localStorage.setItem(cacheKey, JSON.stringify(data));
	} catch (error) {
		// Quota exceeded or other storage error - silently fail
		console.warn('Failed to cache season data:', error);
	}
}

/**
 * Load season data for a given year
 * Checks memory cache, then localStorage, then fetches from server
 */
export async function loadSeason(year: number): Promise<SeasonPackage> {
	// Check memory cache first
	if (SEASON_CACHE.has(year)) {
		return SEASON_CACHE.get(year)!;
	}

	// Check localStorage cache
	const cached = loadFromCache(year);
	if (cached) {
		SEASON_CACHE.set(year, cached);
		return cached;
	}

	// Fetch from server
	const season = await fetchSeason(year);

	// Cache in memory and localStorage
	SEASON_CACHE.set(year, season);
	saveToCache(year, season);

	return season;
}

/**
 * Load manifest file to get available years
 */
async function loadManifest(): Promise<SeasonManifest | null> {
	try {
		const response = await fetch('/seasons/season-manifest.json');
		if (!response.ok) return null;
		return await response.json();
	} catch {
		return null;
	}
}

/**
 * Get available years from manifest or fallback to hardcoded list
 */
export async function getAvailableYears(): Promise<number[]> {
	const manifest = await loadManifest();

	if (manifest?.seasons) {
		return manifest.seasons.map((s) => s.year).sort((a, b) => a - b);
	}

	// Fallback for local development
	return [1976];
}

/**
 * Get list of all seasons with metadata
 */
export async function getSeasonsList(): Promise<
	Array<{ year: number; teams: string[]; games: number }>
> {
	const years = await getAvailableYears();
	const seasons = await Promise.all(
		years.map(async (year) => {
			const season = await loadSeason(year);
			return {
				year,
				teams: Object.keys(season.teams),
				games: season.games.length,
			};
		})
	);

	return seasons;
}

/**
 * Clear all cached season data from memory and localStorage
 */
export function clearSeasonCache(): void {
	SEASON_CACHE.clear();

	// Clear all season data from localStorage
	const keys = Object.keys(localStorage);
	for (const key of keys) {
		if (key.startsWith(CACHE_PREFIX)) {
			localStorage.removeItem(key);
		}
	}
}

/**
 * Load season with players filtered to specific teams (for GameEngine)
 * This pre-loads batters and pitchers for the two teams that will play
 */
export async function loadSeasonForGame(
	year: number,
	awayTeam: string,
	homeTeam: string
): Promise<SeasonPackage> {
	// Load base season (includes all players)
	const season = await loadSeason(year);

	// Filter batters to only include players from the two teams
	const filteredBatters: Record<string, SeasonPackage['batters'][string]> = {};
	for (const [id, batter] of Object.entries(season.batters)) {
		if (batter.teamId === awayTeam || batter.teamId === homeTeam) {
			filteredBatters[id] = batter;
		}
	}

	// Filter pitchers to only include players from the two teams
	const filteredPitchers: Record<string, SeasonPackage['pitchers'][string]> = {};
	for (const [id, pitcher] of Object.entries(season.pitchers)) {
		if (pitcher.teamId === awayTeam || pitcher.teamId === homeTeam) {
			filteredPitchers[id] = pitcher;
		}
	}

	// Return filtered season package
	return {
		...season,
		batters: filteredBatters,
		pitchers: filteredPitchers,
	};
}
