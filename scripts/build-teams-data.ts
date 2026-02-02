/**
 * Build teams-by-year.json from the baseball database
 *
 * This script queries the games table to find all teams that played in each year,
 * then combines it with team info from dim.teams, applying historical name corrections
 * and league transitions.
 *
 * Usage: pnpm exec tsx scripts/build-teams-data.ts
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.dirname(__dirname);
const DB_PATH = path.join(ROOT_DIR, 'baseball.duckdb');
const OUTPUT_PATH = path.join(ROOT_DIR, 'app/static/teams-by-year.json');
const GZIP_OUTPUT_PATH = path.join(ROOT_DIR, 'app/static/teams-by-year.json.gz');

console.log('📊 Building teams-by-year data from database...\n');

// Get all team-year combinations from games table
console.log('  🔍 Fetching teams by year from games table...');
const teamsQuery = `SELECT DISTINCT EXTRACT(YEAR FROM date) as year, COALESCE(away_team_id, home_team_id) as team_id FROM game.games ORDER BY year, team_id;`;
const teamsResult = execSync(`echo "${teamsQuery}" | duckdb "${DB_PATH}" -csv`, { encoding: 'utf-8' });
const teamsLines = teamsResult.trim().split('\n').slice(1);

// Build year->team_ids mapping
const teamsByYear: Record<number, string[]> = {};
for (const line of teamsLines) {
	const [year, teamId] = line.split(',');
	const yearNum = parseInt(year);
	if (!teamsByYear[yearNum]) {
		teamsByYear[yearNum] = [];
	}
	if (!teamsByYear[yearNum].includes(teamId)) {
		teamsByYear[yearNum].push(teamId);
	}
}

const yearCount = Object.keys(teamsByYear).length;
const teamYears = teamsLines.length;
const teamCount = Object.values(teamsByYear).reduce((sum, teams) => sum + teams.length, 0);
console.log(`    ✓ Found ${teamCount} team-year combinations across ${yearCount} years`);

// Get team info from dim.teams
console.log('  🏟️  Fetching team info from dim.teams...');
const teamsInfoQuery = `SELECT team_id, league, city, nickname FROM dim.teams;`;
const teamsInfoResult = execSync(`echo "${teamsInfoQuery}" | duckdb "${DB_PATH}" -csv`, { encoding: 'utf-8' });
const teamsInfoLines = teamsInfoResult.trim().split('\n').slice(1);

const teamsInfo: Record<string, { id: string; league: string; city: string; nickname: string }> = {};
for (const line of teamsInfoLines) {
	const [id, league, city, nickname] = line.split(',');
	teamsInfo[id] = { id, league, city, nickname };
}
console.log(`    ✓ Loaded ${Object.keys(teamsInfo).length} teams`);

// League transition years - when teams switched leagues
// The year is when they STARTED in the new league
const leagueTransitions: Record<string, Array<{ year: number; league: string }>> = {
	HOU: [
		{ year: 1962, league: 'NL' },
		{ year: 2013, league: 'AL' },
	],
	MIL: [
		{ year: 1969, league: 'AL' },
		{ year: 1998, league: 'NL' },
	],
	// Add more as needed
};

/**
 * Get the correct league for a team in a specific year
 */
function getLeagueForYear(teamId: string, year: number, defaultLeague: string): string {
	const transitions = leagueTransitions[teamId];
	if (!transitions) {
		// Handle multi-league strings like "AL;NL"
		if (defaultLeague.includes('AL') && defaultLeague.includes('NL')) {
			// Default to the first league mentioned
			return defaultLeague.split(';')[0];
		}
		return defaultLeague;
	}

	// Sort transitions by year descending, find the most recent one <= query year
	const sorted = [...transitions].sort((a, b) => b.year - a.year);
	for (const transition of sorted) {
		if (year >= transition.year) {
			return transition.league;
		}
	}

	// Fallback to first league
	return transitions[0]?.league || defaultLeague.split(';')[0];
}

// Historical team name overrides - year is when the name STARTED being used
const historicalNames: Record<string, Array<{ year: number; city: string; nickname: string }>> = {
	CLE: [
		{ year: 1915, city: 'Cleveland', nickname: 'Indians' },
		{ year: 2022, city: 'Cleveland', nickname: 'Guardians' },
	],
	TBA: [
		{ year: 1998, city: 'Tampa Bay', nickname: 'Devil Rays' },
		{ year: 2008, city: 'Tampa Bay', nickname: 'Rays' },
	],
	MIA: [
		{ year: 1993, city: 'Florida', nickname: 'Marlins' },
		{ year: 2012, city: 'Miami', nickname: 'Marlins' },
	],
	WAS: [
		{ year: 1969, city: 'Montreal', nickname: 'Expos' },
		{ year: 2005, city: 'Washington', nickname: 'Nationals' },
	],
	LAA: [
		{ year: 1961, city: 'Los Angeles', nickname: 'Angels' },
		{ year: 1965, city: 'California', nickname: 'Angels' },
		{ year: 1994, city: 'Anaheim', nickname: 'Angels' },
		{ year: 2003, city: 'Los Angeles', nickname: 'Angels' },
	],
	ANA: [
		{ year: 1994, city: 'Anaheim', nickname: 'Angels' },
	],
	CAL: [
		{ year: 1965, city: 'California', nickname: 'Angels' },
	],
};

/**
 * Get historical name for a team in a specific year
 */
function getHistoricalName(teamId: string, year: number): { city: string; nickname: string } | null {
	const overrides = historicalNames[teamId];
	if (!overrides) return null;

	const sorted = [...overrides].sort((a, b) => b.year - a.year);
	for (const entry of sorted) {
		if (year >= entry.year) {
			return { city: entry.city, nickname: entry.nickname };
		}
	}
	return null;
}

// Build final output
console.log('  📝 Building teams-by-year data...');
const output: Record<
	number,
	Array<{ id: string; league: string; city: string; nickname: string }>
> = {};
for (const [year, teamIds] of Object.entries(teamsByYear)) {
	const yearNum = parseInt(year);
	output[yearNum] = [];

	for (const teamId of teamIds) {
		const team = teamsInfo[teamId];
		if (!team) continue;

		// Get the correct league for this year
		const league = getLeagueForYear(teamId, yearNum, team.league);

		// Apply historical name override if available
		const historical = getHistoricalName(teamId, yearNum);
		const city = historical?.city || team.city;
		const nickname = historical?.nickname || team.nickname;

		output[yearNum].push({
			id: team.id,
			league,
			city,
			nickname,
		});
	}

	// Sort by league (AL, NL, others) then by city
	output[yearNum].sort((a, b) => {
		const leagueOrder = { AL: 1, NL: 2 };
		const aLeague = a.league;
		const bLeague = b.league;

		const aOrder = leagueOrder[aLeague as keyof typeof leagueOrder] ?? 3;
		const bOrder = leagueOrder[bLeague as keyof typeof leagueOrder] ?? 3;

		if (aOrder !== bOrder) return aOrder - bOrder;
		return a.city.localeCompare(b.city);
	});
}

// Write to file
console.log(`  💾 Writing to ${OUTPUT_PATH}...`);
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

const fileSize = fs.statSync(OUTPUT_PATH).size;
console.log(`    ✓ File size: ${(fileSize / 1024).toFixed(1)} KB`);

// Gzip the file
console.log(`  🗜️  Compressing to ${GZIP_OUTPUT_PATH}...`);
execSync(`gzip -c "${OUTPUT_PATH}" > "${GZIP_OUTPUT_PATH}"`);

const gzippedSize = fs.statSync(GZIP_OUTPUT_PATH).size;
console.log(
	`    ✓ Compressed size: ${(gzippedSize / 1024).toFixed(1)} KB (${((1 - gzippedSize / fileSize) * 100).toFixed(1)}% reduction)`
);

// Remove the uncompressed file
console.log(`  🧹 Cleaning up ${OUTPUT_PATH}...`);
fs.unlinkSync(OUTPUT_PATH);
console.log(`    ✓ Removed uncompressed file`);

console.log(`\n✅ Teams data built successfully!`);
console.log(`   Output: ${GZIP_OUTPUT_PATH}`);
console.log(
	`   Years: ${Object.keys(output)
		.map(Number)
		.sort((a, b) => a - b)[0]}-${Object.keys(output)
		.map(Number)
		.sort((a, b) => b - a)[0]}`
);
