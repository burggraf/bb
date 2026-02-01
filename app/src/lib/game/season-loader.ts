/**
 * Load season data from static JSON files
 */

import type { SeasonPackage } from './types.js';

const SEASON_CACHE = new Map<number, SeasonPackage>();

export async function loadSeason(year: number): Promise<SeasonPackage> {
	// Check cache first
	if (SEASON_CACHE.has(year)) {
		return SEASON_CACHE.get(year)!;
	}

	const response = await fetch(`/seasons/${year}.json`);
	if (!response.ok) {
		throw new Error(`Failed to load season ${year}: ${response.statusText}`);
	}

	const season = (await response.json()) as SeasonPackage;
	SEASON_CACHE.set(year, season);

	return season;
}

export function getAvailableYears(): number[] {
	// For now, hardcode available seasons
	// In the future, this could be discovered from the filesystem or an API
	return [1976];
}

export async function getSeasonsList(): Promise<
	Array<{ year: number; teams: string[]; games: number }>
> {
	const years = getAvailableYears();
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
