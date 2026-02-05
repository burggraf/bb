/**
 * Static teams data by year
 * Downloaded and cached permanently
 */

const TEAMS_DATA_VERSION = '1.0';
const CACHE_KEY = 'bb_teams_data';

export interface TeamInfo {
	id: string;
	league: string;
	city: string;
	nickname: string;
}

export interface TeamsByYear {
	[year: string]: TeamInfo[];
}

interface CachedTeamsData {
	data: TeamsByYear;
	cachedAt: string;
	version: string;
}

let memoryCache: TeamsByYear | null = null;

/**
 * Check if teams data is downloaded (cached permanently)
 */
export function isTeamsDataDownloaded(): boolean {
	const cached = localStorage.getItem(CACHE_KEY);
	if (!cached) return false;

	try {
		const data = JSON.parse(cached) as CachedTeamsData;
		// Only check version match, no expiry
		return data.version === TEAMS_DATA_VERSION;
	} catch {
		return false;
	}
}

/**
 * Load teams data from cache or fetch from server
 */
export async function loadTeamsData(): Promise<TeamsByYear> {
	// Check memory cache first
	if (memoryCache) {
		return memoryCache;
	}

	// Check localStorage cache (permanent, only check version)
	try {
		const cached = localStorage.getItem(CACHE_KEY);
		if (cached) {
			const data = JSON.parse(cached) as CachedTeamsData;

			if (data.version === TEAMS_DATA_VERSION) {
				memoryCache = data.data;
				return memoryCache;
			}
		}
	} catch {
		// Cache invalid, fall through to fetch
	}

	// Fetch from server (try gzipped first, fallback to uncompressed)
	let response = await fetch('/teams-by-year.json.gz');

	if (response.ok) {
		// Vite dev server auto-decompresses
		const data = await response.json();
		memoryCache = data;
		saveToCache(data);
		return memoryCache;
	}

	// Fallback to uncompressed
	response = await fetch('/teams-by-year.json');
	if (!response.ok) {
		throw new Error(`Failed to load teams data: ${response.statusText}`);
	}

	const data = (await response.json()) as TeamsByYear;
	memoryCache = data;
	saveToCache(data);
	return memoryCache;
}

/**
 * Save teams data to localStorage cache
 */
function saveToCache(data: TeamsByYear): void {
	const cachedData: CachedTeamsData = {
		data,
		cachedAt: new Date().toISOString(),
		version: TEAMS_DATA_VERSION
	};

	try {
		localStorage.setItem(CACHE_KEY, JSON.stringify(cachedData));
	} catch (error) {
		console.warn('Failed to cache teams data:', error);
	}
}

/**
 * Download teams data with progress callback
 */
export async function downloadTeamsData(
	progressCallback?: (progress: number) => void
): Promise<TeamsByYear> {
	// Try gzipped first
	let response = await fetch('/teams-by-year.json.gz');

	if (!response.ok) {
		// Fallback to uncompressed
		response = await fetch('/teams-by-year.json');
	}

	if (!response.ok) {
		throw new Error(`Failed to download teams data: ${response.statusText}`);
	}

	const contentLength = response.headers.get('content-length');
	const total = contentLength ? parseInt(contentLength, 10) : 0;

	const reader = response.body?.getReader();
	if (!reader) {
		throw new Error('Response body is null');
	}

	let receivedLength = 0;
	const chunks: Uint8Array[] = [];

	while (true) {
		const { done, value } = await reader.read();

		if (done) break;

		chunks.push(value);
		receivedLength += value.length;

		if (total > 0 && progressCallback) {
			progressCallback(receivedLength / total);
		}
	}

	const arrayBuffer = chunks.reduce(
		(acc, chunk) => {
			const combined = new Uint8Array(acc.length + chunk.length);
			combined.set(acc, 0);
			combined.set(chunk, acc.length);
			return combined;
		},
		new Uint8Array(0)
	);

	const text = new TextDecoder().decode(arrayBuffer);
	const data = JSON.parse(text) as TeamsByYear;

	memoryCache = data;
	saveToCache(data);

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
 * Get all available years from teams data
 */
export async function getAvailableYearsFromTeams(): Promise<number[]> {
	const data = await loadTeamsData();
	return Object.keys(data)
		.map(Number)
		.sort((a, b) => b - a); // Newest first
}

/**
 * Clear the teams data cache
 */
export function clearTeamsDataCache(): void {
	memoryCache = null;
	localStorage.removeItem(CACHE_KEY);
}
