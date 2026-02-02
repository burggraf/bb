/**
 * Season download manager with progress tracking
 * Handles downloading seasons that aren't cached yet
 */

import type { SeasonPackage } from './types.js';

export type DownloadStatus = 'idle' | 'downloading' | 'complete' | 'error';

export interface SeasonDownloadState {
	status: DownloadStatus;
	progress: number; // 0-1
	error: string | null;
}

// Track downloads in progress and completed seasons
const downloadStates = new Map<number, SeasonDownloadState>();
const downloadedSeasons = new Set<number>();

/**
 * Check if a season is already in cache (memory or localStorage)
 */
async function isSeasonCached(year: number): Promise<boolean> {
	const CACHE_PREFIX = 'bb_season_';

	// Check memory cache
	if (downloadedSeasons.has(year)) {
		return true;
	}

	// Check localStorage
	try {
		const cacheKey = `${CACHE_PREFIX}${year}`;
		const cached = localStorage.getItem(cacheKey);
		if (cached) {
			const data = JSON.parse(cached);
			// Check if cache is valid (not too old)
			const cachedAge = Date.now() - new Date(data.cachedAt).getTime();
			const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
			if (cachedAge <= maxAge) {
				downloadedSeasons.add(year);
				return true;
			}
		}
	} catch {
		// Ignore storage errors
	}

	return false;
}

/**
 * Decompress gzip response using DecompressionStream API
 */
async function decompressResponse(response: Response): Promise<any> {
	if (!response.body) {
		throw new Error('Response body is null');
	}

	const decompressed = response.body.pipeThrough(new DecompressionStream('gzip'));
	const text = await new Response(decompressed).text();
	return JSON.parse(text);
}

/**
 * Fetch season data with progress tracking
 */
async function fetchSeasonWithProgress(
	year: number,
	onProgress: (progress: number) => void
): Promise<SeasonPackage> {
	const compressedUrl = `/seasons/${year}.json.gz`;
	const uncompressedUrl = `/seasons/${year}.json`;

	// Try compressed file first
	let response = await fetch(compressedUrl);

	if (response.ok) {
		const contentLength = response.headers.get('Content-Length');
		const total = contentLength ? parseInt(contentLength, 10) : 0;

		if (!response.body) {
			throw new Error('Response body is null');
		}

		// Check if server already decompressed (Vite dev server behavior)
		const contentEncoding = response.headers.get('Content-Encoding');
		if (contentEncoding === 'gzip') {
			// Browser auto-decompressed, just parse JSON
			onProgress(1);
			return await response.json();
		}

		// For tracking progress with compressed responses, we need to read the body
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let receivedLength = 0;

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			chunks.push(value);
			receivedLength += value.length;

			if (total > 0) {
				onProgress(receivedLength / total);
			}
		}

		// Decompress the chunks
		const uint8Arrays = chunks.map(chunk => new Uint8Array(chunk));
		const blob = new Blob(uint8Arrays);
		const decompressed = new Response(
			blob.stream().pipeThrough(new DecompressionStream('gzip'))
		);
		const text = await decompressed.text();
		onProgress(1);
		return JSON.parse(text);
	}

	// Fallback to uncompressed JSON
	response = await fetch(uncompressedUrl);
	if (!response.ok) {
		throw new Error(`Failed to load season ${year}: ${response.statusText}`);
	}

	onProgress(1);
	return await response.json();
}

/**
 * Download a season with progress tracking
 * Returns a state tracker that can be polled for progress
 */
export async function downloadSeason(
	year: number,
	onProgress?: (progress: number) => void
): Promise<SeasonPackage> {
	// Initialize state
	const state: SeasonDownloadState = {
		status: 'downloading',
		progress: 0,
		error: null
	};
	downloadStates.set(year, state);

	try {
		const season = await fetchSeasonWithProgress(year, (progress) => {
			state.progress = progress;
			onProgress?.(progress);
		});

		// Cache in localStorage
		const CACHE_PREFIX = 'bb_season_';
		const cacheKey = `${CACHE_PREFIX}${year}`;
		const data = {
			season,
			cachedAt: new Date().toISOString(),
			version: season.meta.version
		};

		try {
			localStorage.setItem(cacheKey, JSON.stringify(data));
		} catch (error) {
			console.warn('Failed to cache season data:', error);
		}

		// Update state
		state.status = 'complete';
		state.progress = 1;
		downloadedSeasons.add(year);

		return season;
	} catch (error) {
		state.status = 'error';
		state.error = (error as Error).message;
		throw error;
	}
}

/**
 * Get the current download state for a season
 */
export function getDownloadState(year: number): SeasonDownloadState | undefined {
	return downloadStates.get(year);
}

/**
 * Check if a season is downloaded (cached locally)
 */
export async function isSeasonDownloaded(year: number): Promise<boolean> {
	return await isSeasonCached(year);
}

/**
 * Mark a season as downloaded (after loading via loadSeason)
 */
export function markSeasonDownloaded(year: number): void {
	downloadedSeasons.add(year);
}

/**
 * Clear the download state for a season
 */
export function clearDownloadState(year: number): void {
	downloadStates.delete(year);
}
