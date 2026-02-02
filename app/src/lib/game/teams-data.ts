/**
 * Static teams data by year
 * Generated from database games table with historical name corrections
 */

interface TeamInfo {
	id: string;
	league: string;
	city: string;
	nickname: string;
}

export interface TeamsByYear {
	[year: string]: TeamInfo[];
}

let teamsCache: TeamsByYear | null = null;

/**
 * Load the static teams-by-year data file
 */
export async function loadTeamsData(): Promise<TeamsByYear> {
	if (teamsCache) {
		return teamsCache;
	}

	const response = await fetch('/teams-by-year.json');
	if (!response.ok) {
		throw new Error(`Failed to load teams data: ${response.statusText}`);
	}

	const data = await response.json() as TeamsByYear;
	teamsCache = data;
	return data;
}

/**
 * Get teams for a specific year
 */
export async function getTeamsForYear(year: number): Promise<TeamInfo[]> {
	const data = await loadTeamsData();
	return data[year.toString()] || [];
}

/**
 * Clear the cache (useful for testing)
 */
export function clearTeamsCache(): void {
	teamsCache = null;
}
