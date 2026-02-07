# Season Replay Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a season replay feature that allows users to simulate an entire MLB season (1910-2024) in chronological order, watching standings evolve in real-time with options to play continuously, pause, or step through games.

**Architecture:** Client-side only using Svelte 5 + sql.js. Season data stored in SQLite files with schedule in `games` table. Replay state tracked via JSON metadata column on series table in IndexedDB. Simulation engine orchestrates game loop, saving results after each game.

**Tech Stack:** Svelte 5 (runes), TypeScript, sql.js, IndexedDB, Tailwind CSS

---

## Phase 1: Database Schema and Metadata Infrastructure

### Task 1: Update Series Type Definition

**Files:**
- Modify: `app/src/lib/game-results/types.ts:4`

**Step 1: Add metadata type to types.ts**

Add this after the `SeriesStatus` type definition:

```typescript
/**
 * Metadata stored in series.metadata column (JSON)
 */
export interface SeriesMetadata {
  seasonReplay?: {
    seasonYear: number;
    currentGameIndex: number;
    totalGames: number;
    playbackSpeed: 'instant' | 'animated';
    gamesPerBatch: number;
    status: 'idle' | 'playing' | 'paused' | 'completed';
    lastPlayedDate?: string;
  };
}
```

**Step 2: Export the new type**

Add `SeriesMetadata` to the exports in the types file (around line 58).

**Step 3: Commit**

```bash
git add app/src/lib/game-results/types.ts
git commit -m "feat(season-replay): add SeriesMetadata type definition"
```

### Task 2: Update Series Schema with Metadata Column

**Files:**
- Modify: `app/src/lib/game-results/schema.ts:6-14`

**Step 1: Add metadata column to series table**

Modify the series table definition to include metadata:

```sql
CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  series_type TEXT NOT NULL CHECK(series_type IN ('season_replay', 'tournament', 'exhibition', 'custom')),
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'archived'))
);
```

**Step 2: Add migration function to schema.ts**

Add after the `createGameResultsSchema` function:

```typescript
/**
 * Migration: Add metadata column to series table (schema version 2)
 * Call this if database exists but doesn't have metadata column
 */
export function migrateSeriesMetadata(db: Database): void {
  try {
    // Check if metadata column exists
    const stmt = db.prepare('PRAGMA table_info(series)');
    const hasMetadata = Array.from(stmt.iterateAsObject() as any[]).some((col: any) => col.name === 'metadata');
    stmt.free();

    if (!hasMetadata) {
      console.log('[Schema] Adding metadata column to series table');
      db.exec('ALTER TABLE series ADD COLUMN metadata TEXT');
    }
  } catch (error) {
    console.error('[Schema] Migration error:', error);
    throw error;
  }
}
```

**Step 3: Export migration function**

Add to exports at bottom of file.

**Step 4: Update database initialization**

**Step 4a: Read database.ts to find initialization point**

**Step 4b: Modify database initialization to call migration**

After `createGameResultsSchema(db)` call in `getGameDatabase()`, add:

```typescript
// Apply migrations
import { migrateSeriesMetadata } from './schema.js';
// ... inside getGameDatabase after schema creation ...
migrateSeriesMetadata(db);
```

**Step 5: Commit**

```bash
git add app/src/lib/game-results/schema.ts app/src/lib/game-results/database.ts
git commit -m "feat(season-replay): add metadata column to series table with migration"
```

### Task 3: Add Metadata CRUD Functions

**Files:**
- Modify: `app/src/lib/game-results/series.ts`

**Step 1: Add getSeriesMetadata function**

Add after the `getSeries` function:

```typescript
/**
 * Get metadata for a series
 */
export async function getSeriesMetadata(seriesId: string): Promise<SeriesMetadata | null> {
  try {
    const db = await getGameDatabase();

    const stmt = db.prepare('SELECT metadata FROM series WHERE id = ?');
    stmt.bind([seriesId]);

    if (!stmt.step()) {
      stmt.free();
      return null;
    }

    const row = stmt.getAsObject() as any;
    stmt.free();

    if (!row.metadata) return null;

    return JSON.parse(row.metadata) as SeriesMetadata;
  } catch (error) {
    console.error('[Series] Failed to get metadata:', error);
    throw new Error(`Failed to get metadata: ${error instanceof Error ? error.message : String(error)}`);
  }
}
```

**Step 2: Add updateSeriesMetadata function**

Add after getSeriesMetadata:

```typescript
/**
 * Update metadata for a series
 */
export async function updateSeriesMetadata(seriesId: string, metadata: SeriesMetadata): Promise<void> {
  try {
    const db = await getGameDatabase();
    const now = new Date().toISOString();

    db.run(
      'UPDATE series SET metadata = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(metadata), now, seriesId]
    );
  } catch (error) {
    console.error('[Series] Failed to update metadata:', error);
    throw new Error(`Failed to update metadata: ${error instanceof Error ? error.message : String(error)}`);
  }
}
```

**Step 3: Add findSeasonReplays function**

Add after updateSeriesMetadata:

```typescript
/**
 * Find existing season replay series for a given year
 * Returns count for generating #2, #3 suffixes
 */
export async function findSeasonReplays(year: number): Promise<Array<{ id: string; name: string }>> {
  try {
    const db = await getGameDatabase();

    const stmt = db.prepare(`
      SELECT id, name FROM series
      WHERE series_type = 'season_replay'
      AND json_extract(metadata, '$.seasonReplay.seasonYear') = ?
      ORDER BY created_at DESC
    `);
    stmt.bind([year]);

    const results: Array<{ id: string; name: string }> = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as any;
      results.push({ id: row.id, name: row.name });
    }
    stmt.free();

    return results;
  } catch (error) {
    console.error('[Series] Failed to find season replays:', error);
    return [];
  }
}
```

**Step 4: Add createSeasonReplay function**

Add after findSeasonReplays:

```typescript
/**
 * Create a season replay series with initial metadata
 */
export async function createSeasonReplay(data: {
  name: string;
  year: number;
  playbackSpeed?: 'instant' | 'animated';
}): Promise<Series> {
  try {
    const db = await getGameDatabase();

    const id = generateUUID();
    const now = new Date().toISOString();

    const metadata: SeriesMetadata = {
      seasonReplay: {
        seasonYear: data.year,
        currentGameIndex: 0,
        totalGames: 0, // Will be set when schedule loads
        playbackSpeed: data.playbackSpeed ?? 'instant',
        gamesPerBatch: 1,
        status: 'idle'
      }
    };

    db.run(
      `INSERT INTO series (id, name, description, series_type, metadata, created_at, updated_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.name, null, 'season_replay', JSON.stringify(metadata), now, now, 'active']
    );

    return {
      id,
      name: data.name,
      description: null,
      seriesType: 'season_replay',
      createdAt: now,
      updatedAt: now,
      status: 'active'
    };
  } catch (error) {
    console.error('[Series] Failed to create season replay:', error);
    throw new Error(`Failed to create season replay: ${error instanceof Error ? error.message : String(error)}`);
  }
}
```

**Step 5: Export new functions from index.ts**

Add to exports in `app/src/lib/game-results/index.ts` after series exports:

```typescript
export {
  createSeries,
  getSeries,
  listSeries,
  updateSeries,
  deleteSeries,
  addTeamToSeries,
  getSeriesTeams,
  getSeriesMetadata,
  updateSeriesMetadata,
  findSeasonReplays,
  createSeasonReplay
} from './series.js';
```

**Step 6: Commit**

```bash
git add app/src/lib/game-results/series.ts app/src/lib/game-results/index.ts
git commit -m "feat(season-replay): add metadata CRUD and season replay creation functions"
```

---

## Phase 2: Schedule Loading

### Task 4: Add Schedule Loading Function

**Files:**
- Modify: `app/src/lib/game/sqlite-season-loader.ts`

**Step 1: Add ScheduledGame type**

Add near other type definitions at top of file:

```typescript
export interface ScheduledGame {
  id: string;
  date: string;
  awayTeam: string;
  homeTeam: string;
  useDh: boolean;
  parkId?: string;
}
```

**Step 2: Add getSeasonSchedule function**

Add after the existing export functions:

```typescript
/**
 * Get the schedule (all games) for a season sorted by date
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
```

**Step 3: Commit**

```bash
git add app/src/lib/game/sqlite-season-loader.ts
git commit -m "feat(season-replay): add getSeasonSchedule function"
```

---

## Phase 3: Season Replay Engine

### Task 5: Create Season Replay Engine

**Files:**
- Create: `app/src/lib/season-replay/types.ts`
- Create: `app/src/lib/season-replay/engine.ts`
- Create: `app/src/lib/season-replay/index.ts`

**Step 1: Create types file**

```typescript
// app/src/lib/season-replay/types.ts
export interface ReplayOptions {
  playbackSpeed: 'instant' | 'animated';
  gamesPerBatch?: number;
}

export interface ReplayProgress {
  currentGameIndex: number;
  totalGames: number;
  percent: number;
  currentDate: string;
}

export type ReplayStatus = 'idle' | 'playing' | 'paused' | 'completed';

export interface GameResult {
  gameId: string;
  awayTeam: string;
  homeTeam: string;
  awayScore: number;
  homeScore: number;
  date: string;
}
```

**Step 2: Create engine file skeleton**

```typescript
// app/src/lib/season-replay/engine.ts
import { getSeasonSchedule, type ScheduledGame } from '$lib/game/sqlite-season-loader.js';
import {
  getSeriesMetadata,
  updateSeriesMetadata,
  saveGameFromState,
  getGamesBySeries
} from '$lib/game-results/index.js';
import { GameEngine } from '$lib/game/engine.js';
import { loadSeason } from '$lib/game/sqlite-season-loader.js';
import type { ReplayOptions, ReplayProgress, ReplayStatus, GameResult } from './types.js';
import type { GameState } from '$lib/game/types.js';

export class SeasonReplayEngine {
  private seriesId: string;
  private year: number;
  private options: ReplayOptions;
  private schedule: ScheduledGame[] = [];
  private currentStatus: ReplayStatus = 'idle';
  private eventCallbacks: Map<string, Set<Function>> = new Map();

  constructor(seriesId: string, year: number, options: ReplayOptions) {
    this.seriesId = seriesId;
    this.year = year;
    this.options = options;
  }

  /**
   * Initialize the engine by loading schedule and metadata
   */
  async initialize(): Promise<void> {
    console.log('[SeasonReplay] Initializing for year', this.year);

    // Load schedule
    this.schedule = await getSeasonSchedule(this.year);
    console.log('[SeasonReplay] Loaded', this.schedule.length, 'games');

    // Get current metadata
    const metadata = await getSeriesMetadata(this.seriesId);
    if (!metadata?.seasonReplay) {
      throw new Error('Series metadata not found or invalid');
    }

    // Update total games count
    metadata.seasonReplay.totalGames = this.schedule.length;
    await updateSeriesMetadata(this.seriesId, metadata);

    this.currentStatus = metadata.seasonReplay.status;
    console.log('[SeasonReplay] Status:', this.currentStatus);
  }

  /**
   * Start the replay
   */
  async start(): Promise<void> {
    console.log('[SeasonReplay] Starting replay');
    this.currentStatus = 'playing';
    await this.updateMetadataStatus('playing');
    this.emit('statusChange', 'playing');
  }

  /**
   * Pause the replay
   */
  pause(): void {
    console.log('[SeasonReplay] Pausing');
    this.currentStatus = 'paused';
    this.updateMetadataStatus('paused');
    this.emit('statusChange', 'paused');
  }

  /**
   * Resume the replay
   */
  resume(): void {
    console.log('[SeasonReplay] Resuming');
    this.currentStatus = 'playing';
    this.updateMetadataStatus('playing');
    this.emit('statusChange', 'playing');
  }

  /**
   * Play the next game in the schedule
   */
  async playNextGame(): Promise<GameResult | null> {
    const metadata = await getSeriesMetadata(this.seriesId);
    if (!metadata?.seasonReplay) return null;

    const idx = metadata.seasonReplay.currentGameIndex;
    if (idx >= this.schedule.length) {
      await this.updateMetadataStatus('completed');
      this.currentStatus = 'completed';
      this.emit('completed');
      return null;
    }

    const game = this.schedule[idx];
    console.log('[SeasonReplay] Playing game', idx + 1, 'of', this.schedule.length, ':', game.date);

    const result = await this.simulateGame(game);

    // Update metadata
    metadata.seasonReplay.currentGameIndex = idx + 1;
    metadata.seasonReplay.lastPlayedDate = game.date;
    await updateSeriesMetadata(this.seriesId, metadata);

    this.emit('gameComplete', result);
    this.emit('progress', this.getProgress());

    return result;
  }

  /**
   * Play all games for the next date
   */
  async playNextDay(): Promise<GameResult[]> {
    const metadata = await getSeriesMetadata(this.seriesId);
    if (!metadata?.seasonReplay) return [];

    const idx = metadata.seasonReplay.currentGameIndex;
    if (idx >= this.schedule.length) return [];

    const targetDate = this.schedule[idx].date;
    const results: GameResult[] = [];

    while (metadata.seasonReplay.currentGameIndex < this.schedule.length) {
      const game = this.schedule[metadata.seasonReplay.currentGameIndex];
      if (game.date !== targetDate) break;

      const result = await this.simulateGame(game);
      results.push(result);

      metadata.seasonReplay.currentGameIndex++;
      metadata.seasonReplay.lastPlayedDate = game.date;
    }

    await updateSeriesMetadata(this.seriesId, metadata);

    for (const result of results) {
      this.emit('gameComplete', result);
    }
    this.emit('dayComplete', targetDate, results);
    this.emit('progress', this.getProgress());

    return results;
  }

  /**
   * Simulate a single game
   */
  private async simulateGame(scheduledGame: ScheduledGame): Promise<GameResult> {
    // Load season data
    const season = await loadSeason(this.year);

    // Create game engine
    const engine = new GameEngine({
      awayTeam: scheduledGame.awayTeam,
      homeTeam: scheduledGame.homeTeam,
      seasonPackage: season,
      useDh: scheduledGame.useDh
    });

    // Simulate game
    const finalState = engine.simulateGame();

    // Save result
    const gameId = await saveGameFromState(
      finalState,
      this.seriesId,
      null,
      scheduledGame.date
    );

    return {
      gameId,
      awayTeam: scheduledGame.awayTeam,
      homeTeam: scheduledGame.homeTeam,
      awayScore: finalState.awayScore,
      homeScore: finalState.homeScore,
      date: scheduledGame.date
    };
  }

  /**
   * Get current game index
   */
  async getCurrentGameIndex(): Promise<number> {
    const metadata = await getSeriesMetadata(this.seriesId);
    return metadata?.seasonReplay?.currentGameIndex ?? 0;
  }

  /**
   * Get current date being played
   */
  async getCurrentDate(): Promise<string> {
    const idx = await this.getCurrentGameIndex();
    if (idx < this.schedule.length) {
      return this.schedule[idx].date;
    }
    const metadata = await getSeriesMetadata(this.seriesId);
    return metadata?.seasonReplay?.lastPlayedDate ?? '';
  }

  /**
   * Get progress information
   */
  async getProgress(): Promise<ReplayProgress> {
    const metadata = await getSeriesMetadata(this.seriesId);
    if (!metadata?.seasonReplay) {
      return { currentGameIndex: 0, totalGames: 0, percent: 0, currentDate: '' };
    }

    const current = metadata.seasonReplay.currentGameIndex;
    const total = metadata.seasonReplay.totalGames;
    const percent = total > 0 ? (current / total) * 100 : 0;
    const currentDate = await this.getCurrentDate();

    return { currentGameIndex: current, totalGames: total, percent, currentDate };
  }

  /**
   * Get current status
   */
  getStatus(): ReplayStatus {
    return this.currentStatus;
  }

  /**
   * Register event callback
   */
  on(event: 'gameComplete' | 'dayComplete' | 'progress' | 'statusChange' | 'completed', callback: Function): void {
    if (!this.eventCallbacks.has(event)) {
      this.eventCallbacks.set(event, new Set());
    }
    this.eventCallbacks.get(event)!.add(callback);
  }

  /**
   * Unregister event callback
   */
  off(event: string, callback: Function): void {
    this.eventCallbacks.get(event)?.delete(callback);
  }

  /**
   * Emit event to all registered callbacks
   */
  private emit(event: string, ...args: any[]): void {
    this.eventCallbacks.get(event)?.forEach(cb => cb(...args));
  }

  /**
   * Update metadata status
   */
  private async updateMetadataStatus(status: ReplayStatus): Promise<void> {
    const metadata = await getSeriesMetadata(this.seriesId);
    if (metadata?.seasonReplay) {
      metadata.seasonReplay.status = status;
      await updateSeriesMetadata(this.seriesId, metadata);
    }
  }
}
```

**Step 3: Create index file**

```typescript
// app/src/lib/season-replay/index.ts
export { SeasonReplayEngine } from './engine.js';
export type { ReplayOptions, ReplayProgress, ReplayStatus, GameResult } from './types.js';
```

**Step 4: Commit**

```bash
git add app/src/lib/season-replay/
git commit -m "feat(season-replay): implement SeasonReplayEngine class"
```

---

## Phase 4: Home Page Button

### Task 6: Add Replay Button to Home Page

**Files:**
- Modify: `app/src/routes/+page.svelte`

**Step 1: Add navigation handler**

Add in the script section after `startGame` function:

```typescript
// Start season replay
function startSeasonReplay() {
	if (!selectedYear || !isSeasonReady) return;
	goto(`/season-replay?year=${selectedYear}`);
}
```

**Step 2: Add Replay button to UI**

Modify the "Select Season" section to include the Replay button. Find the section with the download status (around line 289) and add the Replay button:

```svelte
{#if isSeasonReady}
	<div class="flex items-center gap-3">
		<div class="flex items-center gap-2 text-emerald-400 text-sm">
			<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M5 13l4 4L19 7"
				/>
			</svg>
			<span>Downloaded</span>
		</div>
		<button
			onclick={startSeasonReplay}
			class="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm font-medium transition-colors flex items-center gap-2"
		>
			<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
				<path d="M8 5v14l11-7z"/>
			</svg>
			Replay Season
		</button>
	</div>
```

**Step 3: Commit**

```bash
git add app/src/routes/+page.svelte
git commit -m "feat(season-replay): add Replay Season button to home page"
```

---

## Phase 5: Season Replay Setup Page

### Task 7: Create Season Replay Setup Page

**Files:**
- Create: `app/src/routes/season-replay/+page.svelte`

**Step 1: Create the setup page component**

```svelte
<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { createSeasonReplay, findSeasonReplays, isSeasonCached, loadSeason } from '$lib/game-results/index.js';
	import { getSeasonSchedule } from '$lib/game/sqlite-season-loader.js';

	let year = $state<number | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let existingReplays = $state<Array<{ id: string; name: string }>>([]);
	let seriesName = $state('');
	let playbackSpeed = $state<'instant' | 'animated'>('instant');
	let creating = $state(false);

	onMount(async () => {
		// Get year from query param
		const yearParam = $page.url.searchParams.get('year');
		if (!yearParam) {
			error = 'No year specified';
			loading = false;
			return;
		}

		year = parseInt(yearParam, 10);

		// Check if season is downloaded
		const cached = await isSeasonCached(year);
		if (!cached) {
			error = `Season ${year} data not downloaded. Please download from home page first.`;
			loading = false;
			return;
		}

		// Find existing replays
		existingReplays = await findSeasonReplays(year);

		// Generate default name
		const count = existingReplays.length;
		seriesName = count === 0 ? `${year} Season Replay` : `${year} Season Replay #${count + 1}`;

		loading = false;
	});

	async function startReplay() {
		if (!year) return;

		creating = true;
		error = null;

		try {
			const series = await createSeasonReplay({
				name: seriesName,
				year,
				playbackSpeed
			});

			goto(`/game-results/series/${series.id}`);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to create season replay';
			creating = false;
		}
	}

	function goBack() {
		goto('/?year=' + year);
	}
</script>

<svelte:head>
	<title>Season Replay Setup - Baseball Sim</title>
</svelte:head>

<div class="container mx-auto px-4 py-8 max-w-2xl">
	{#if loading}
		<div class="text-center py-12">
			<p class="text-zinc-400">Loading...</p>
		</div>
	{:else if error}
		<div class="text-center py-12">
			<p class="text-red-400 mb-4">{error}</p>
			<button
				onclick={goBack}
				class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
			>
				Go Back
			</button>
		</div>
	{:else}
		<div class="bg-zinc-900 rounded-lg p-6">
			<h1 class="text-2xl font-bold text-white mb-6">Season Replay Setup</h1>

			{#if existingReplays.length > 0}
				<div class="mb-6 p-4 bg-zinc-800 rounded-lg">
					<p class="text-zinc-300 mb-2">Existing replays for {year}:</p>
					<ul class="text-sm text-zinc-400 space-y-1">
						{#each existingReplays as replay}
							<li><a href="/game-results/series/{replay.id}" class="text-blue-400 hover:text-blue-300">{replay.name}</a></li>
						{/each}
					</ul>
				</div>
			{/if}

			<div class="space-y-4">
				<div>
					<label class="block text-sm font-medium text-zinc-300 mb-2">Series Name</label>
					<input
						type="text"
						bind:value={seriesName}
						class="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white"
						disabled={creating}
					/>
				</div>

				<div>
					<label class="block text-sm font-medium text-zinc-300 mb-2">Playback Mode</label>
					<div class="space-y-2">
						<label class="flex items-center gap-3 p-3 bg-zinc-800 rounded cursor-pointer hover:bg-zinc-700">
							<input
								type="radio"
								bind:group={playbackSpeed}
								value="instant"
								disabled={creating}
							/>
							<div>
								<div class="text-white font-medium">Instant</div>
								<div class="text-sm text-zinc-400">Games simulate instantly, watch standings update</div>
							</div>
						</label>
						<label class="flex items-center gap-3 p-3 bg-zinc-800 rounded cursor-pointer hover:bg-zinc-700">
							<input
								type="radio"
								bind:group={playbackSpeed}
								value="animated"
								disabled={creating}
							/>
							<div>
								<div class="text-white font-medium">Animated</div>
								<div class="text-sm text-zinc-400">Watch full game animation (slower)</div>
							</div>
						</label>
					</div>
				</div>

				<div class="flex gap-4 pt-4">
					<button
						onclick={goBack}
						disabled={creating}
						class="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded disabled:opacity-50"
					>
						Cancel
					</button>
					<button
						onclick={startReplay}
						disabled={creating || !seriesName}
						class="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded font-medium disabled:opacity-50 flex-1"
					>
						{creating ? 'Creating...' : 'Start Replay'}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
```

**Step 2: Fix import in setup page**

The setup page needs proper imports. Update imports:

```typescript
import { goto } from '$app/navigation';
import { page } from '$app/stores';
import { onMount } from 'svelte';
import { createSeasonReplay, findSeasonReplays } from '$lib/game-results/index.js';
import { isSeasonCached } from '$lib/game/sqlite-season-loader.js';
```

**Step 3: Commit**

```bash
git add app/src/routes/season-replay/
git commit -m "feat(season-replay): add season replay setup page"
```

---

## Phase 6: Series Page Replay Integration

### Task 8: Detect Season Replay on Series Page

**Files:**
- Modify: `app/src/routes/game-results/series/[id]/+page.svelte`

**Step 1: Add replay detection and state**

Add after existing state declarations:

```typescript
let isSeasonReplay = $state(false);
let replayMetadata = $state<Awaited<ReturnType<typeof import('$lib/game-results/index.js').getSeriesMetadata>> | null>(null);
```

**Step 2: Load metadata in onMount**

Modify the onMount to load metadata:

```typescript
onMount(async () => {
	try {
		const gameResults = await import('$lib/game-results/index.js');
		getSeries = gameResults.getSeries;
		getSeriesStandingsEnhanced = gameResults.getSeriesStandingsEnhanced;
		getGamesBySeries = gameResults.getGamesBySeries;
		getBattingStats = gameResults.getBattingStats;
		getPitchingStats = gameResults.getPitchingStats;

		series = await getSeries(data.seriesId);
		standings = await getSeriesStandingsEnhanced(data.seriesId);
		games = await getGamesBySeries(data.seriesId);
		battingStats = await getBattingStats(data.seriesId);
		pitchingStats = await getPitchingStats(data.seriesId);

		// Check if this is a season replay
		isSeasonReplay = series?.seriesType === 'season_replay';
		if (isSeasonReplay) {
			replayMetadata = await gameResults.getSeriesMetadata(data.seriesId);
			activeTab = 'standings'; // Default to standings for replays
		}
	} catch (e) {
		error = e instanceof Error ? e.message : 'Failed to load series';
	} finally {
		loading = false;
	}
});
```

**Step 3: Pass props to StandingsTable**

Modify the standings tab section:

```svelte
{#if activeTab === 'standings'}
	<StandingsTable {standings} {isSeasonReplay} {seriesId} />
{/if}
```

**Step 4: Commit**

```bash
git add app/src/routes/game-results/series/[id]/+page.svelte
git commit -m "feat(season-replay): detect season replay on series page"
```

### Task 9: Create Replay Controls Component

**Files:**
- Create: `app/src/lib/game-results/components/ReplayControls.svelte`

**Step 1: Create the ReplayControls component**

```svelte
<script lang="ts">
	import { onMount } from 'svelte';
	import { SeasonReplayEngine } from '$lib/season-replay/index.js';
	import { getSeriesMetadata, getSeries, getSeriesStandingsEnhanced } from '$lib/game-results/index.js';
	import type { ReplayProgress } from '$lib/season-replay/index.js';

	interface Props {
		seriesId: string;
		onStandingsUpdate: () => Promise<void>;
	}

	let { seriesId, onStandingsUpdate }: Props = $props();

	let engine = $state<SeasonReplayEngine | null>(null);
	let progress = $state<ReplayProgress | null>(null);
	let status = $state<'idle' | 'playing' | 'paused' | 'completed'>('idle');
	let currentGameDisplay = $state('');
	let loading = $state(true);

	onMount(async () => {
		try {
			const metadata = await getSeriesMetadata(seriesId);
			if (!metadata?.seasonReplay) {
				loading = false;
				return;
			}

			const series = await getSeries(seriesId);
			if (!series) return;

			engine = new SeasonReplayEngine(seriesId, metadata.seasonReplay.seasonYear, {
				playbackSpeed: metadata.seasonReplay.playbackSpeed ?? 'instant'
			});

			await engine.initialize();

			// Set up event listeners
			engine.on('gameComplete', () => {
				onStandingsUpdate();
			});

			engine.on('progress', (p: ReplayProgress) => {
				progress = p;
			});

			engine.on('statusChange', (s: string) => {
				status = s as any;
			});

			engine.on('completed', () => {
				status = 'completed';
				onStandingsUpdate();
			});

			// Get initial state
			progress = await engine.getProgress();
			status = engine.getStatus();

			// Auto-resume if was playing
			if (metadata.seasonReplay.status === 'playing') {
				await engine.resume();
				await playNext();
			}
		} catch (e) {
			console.error('Failed to initialize replay:', e);
		} finally {
			loading = false;
		}
	});

	async function playNext() {
		if (!engine) return;
		await engine.playNextGame();
	}

	async function playNextDay() {
		if (!engine) return;
		await engine.playNextDay();
	}

	function togglePlayPause() {
		if (!engine) return;
		if (status === 'playing') {
			engine.pause();
		} else if (status === 'paused' || status === 'idle') {
			engine.resume();
			playNext();
		}
	}

	function stopReplay() {
		if (!engine) return;
		engine.pause();
		status = 'paused';
	}
</script>

{#if loading}
	<div class="bg-zinc-900 rounded-lg p-4 animate-pulse">
		<div class="h-4 bg-zinc-800 rounded w-3/4 mb-2"></div>
		<div class="h-3 bg-zinc-800 rounded w-1/2"></div>
	</div>
{:else if engine && progress}
	<div class="bg-zinc-900 rounded-lg p-4 space-y-4">
		<!-- Progress -->
		<div>
			<div class="flex justify-between text-sm mb-1">
				<span class="text-zinc-400">Progress</span>
				<span class="text-white">{progress.currentGameIndex} / {progress.totalGames}</span>
			</div>
			<div class="w-full bg-zinc-800 rounded-full h-2">
				<div
					class="bg-blue-600 h-2 rounded-full transition-all"
					style="width: {progress.percent}%"
				></div>
			</div>
			<p class="text-xs text-zinc-500 mt-1">{progress.currentDate}</p>
		</div>

		<!-- Status -->
		<div class="text-center">
			<span class="inline-block px-2 py-1 rounded text-xs font-medium
				{status === 'playing' ? 'bg-green-900 text-green-300' :
				  status === 'paused' ? 'bg-amber-900 text-amber-300' :
				  status === 'completed' ? 'bg-blue-900 text-blue-300' :
				  'bg-zinc-700 text-zinc-300'}">
				{status === 'playing' ? 'Playing' :
				  status === 'paused' ? 'Paused' :
				  status === 'completed' ? 'Completed' :
				  'Idle'}
			</span>
		</div>

		<!-- Controls -->
		<div class="grid grid-cols-2 gap-2">
			<button
				onclick={togglePlayPause}
				disabled={status === 'completed'}
				class="px-3 py-2 rounded text-sm font-medium transition-colors
					{status === 'playing' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-green-600 hover:bg-green-700'}
					disabled:opacity-50"
			>
				{status === 'playing' ? '⏸ Pause' : '▶ Play'}
			</button>
			<button
				onclick={playNextDay}
				disabled={status === 'completed'}
				class="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition-colors disabled:opacity-50"
			>
				⏭ Next Day
			</button>
			<button
				onclick={playNext}
				disabled={status === 'completed'}
				class="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded text-sm font-medium transition-colors disabled:opacity-50"
			>
				⏯ Next Game
			</button>
			<button
				onclick={stopReplay}
				disabled={status === 'idle' || status === 'paused'}
				class="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium transition-colors disabled:opacity-50"
			>
				⏹ Stop
			</button>
		</div>
	</div>
{/if}
```

**Step 2: Update StandingsTable to accept replay props**

**Step 2a: Modify StandingsTable props**

Add to interface in `StandingsTable.svelte`:

```typescript
interface Props {
	standings: typeof standings;
	isSeasonReplay?: boolean;
	seriesId?: string;
	onStandingsUpdate?: () => Promise<void>;
}

let { standings, isSeasonReplay = false, seriesId, onStandingsUpdate }: Props = $props();
```

**Step 2b: Add ReplayControls to StandingsTable**

Modify the template to have two-column layout for replays:

```svelte
<div class="flex gap-6">
	<!-- Standings (left, 70%) -->
	<div class:flex-1>
		<!-- existing standings content -->
	</div>

	<!-- Replay Controls (right, 30%) -->
	{#if isSeasonReplay && seriesId}
		<div class="w-80 flex-shrink-0">
			<svelte:component this={ReplayControls} {seriesId} {onStandingsUpdate} />
		</div>
	{/if}
</div>
```

Actually, we need to import ReplayControls. Let's fix that properly.

**Step 2c: Proper StandingsTable update**

```svelte
<script lang="ts">
	import ReplayControls from '$lib/game-results/components/ReplayControls.svelte';

	// ... existing imports ...

	interface Props {
		standings: typeof standings;
		isSeasonReplay?: boolean;
		seriesId?: string;
		onStandingsUpdate?: () => Promise<void>;
	}

	let { standings, isSeasonReplay = false, seriesId, onStandingsUpdate }: Props = $props();

	// ... existing code ...
</script>

{#if isSeasonReplay && seriesId}
	<div class="flex gap-6">
		<div class="flex-1">
			<!-- standings content wrapped -->
			<div class="space-y-8">
				<!-- existing standings table code -->
			</div>
		</div>
		<div class="w-80 flex-shrink-0">
			<ReplayControls {seriesId} onStandingsUpdate={onStandingsUpdate ?? (() => Promise.resolve())} />
		</div>
	</div>
{:else}
	<!-- original standings content without wrapper -->
{/if}
```

Actually, this is getting complex. Let's simplify - the series page should handle the layout, not StandingsTable. We'll modify the approach.

**Step 2d: Simpler approach - create ReplayStandingsView wrapper**

Create new component instead:

**File: `app/src/lib/game-results/components/ReplayStandingsView.svelte`**

```svelte
<script lang="ts">
	import StandingsTable from './StandingsTable.svelte';
	import ReplayControls from './ReplayControls.svelte';

	interface Props {
		standings: typeof StandingsTable['$$propDef']['standings']['type'];
		seriesId: string;
		onStandingsUpdate: () => Promise<void>;
	}

	let { standings, seriesId, onStandingsUpdate }: Props = $props();
</script>

<div class="flex gap-6">
	<div class="flex-1">
		<StandingsTable {standings} />
	</div>
	<div class="w-80 flex-shrink-0">
		<ReplayControls {seriesId} {onStandingsUpdate} />
	</div>
</div>
```

**Step 2e: Update series page to use ReplayStandingsView**

Modify series page standings section:

```svelte
{#if activeTab === 'standings'}
	{#if isSeasonReplay}
		<ReplayStandingsView
			{standings}
			{seriesId}
			onStandingsUpdate={async () => {
				standings = await getSeriesStandingsEnhanced(data.seriesId);
			}}
		/>
	{:else}
		<StandingsTable {standings} />
	{/if}
{/if}
```

**Step 3: Commit**

```bash
git add app/src/lib/game-results/components/
git commit -m "feat(season-replay): add ReplayControls and ReplayStandingsView components"
```

---

## Phase 7: Series Card Badge

### Task 10: Add Replay Badge to Series Card

**Files:**
- Modify: `app/src/lib/game-results/components/SeriesCard.svelte`

**Step 1: Add props for replay status**

Add to props interface:

```typescript
interface Props {
  series: Series;
  gameCount: number;
  replayStatus?: 'idle' | 'playing' | 'paused' | 'completed';
  replayProgress?: number;
}
```

**Step 2: Add badge display**

Add badge in the card header:

```svelte
<div class="flex items-start justify-between mb-3">
  <h3 class="text-lg font-semibold text-white truncate pr-2">{series.name}</h3>
  {#if series.seriesType === 'season_replay'}
    <span class="flex-shrink-0 px-2 py-0.5 text-xs rounded-full
      {replayStatus === 'playing' ? 'bg-green-900 text-green-300' :
        replayStatus === 'paused' ? 'bg-amber-900 text-amber-300' :
        replayStatus === 'completed' ? 'bg-blue-900 text-blue-300' :
        'bg-zinc-700 text-zinc-300'}">
      {replayStatus === 'playing' ? '▶ Playing' :
        replayStatus === 'paused' ? '⏸ Paused' :
        replayStatus === 'completed' ? '✓ Done' :
        'Replay'}
    </span>
  {/if}
</div>

{#if replayProgress !== undefined && series.seriesType === 'season_replay'}
  <div class="mb-3">
    <div class="w-full bg-zinc-800 rounded-full h-1.5">
      <div
        class="bg-blue-600 h-1.5 rounded-full"
        style="width: {replayProgress}%"
      ></div>
    </div>
  </div>
{/if}
```

**Step 3: Update game-results page to pass replay props**

Modify `app/src/routes/game-results/+page.svelte`:

```typescript
let replayMetadata = $state<Record<string, any>>({});

onMount(async () => {
  // ... existing code ...
  for (const s of series) {
    const games = await getGamesBySeries(s.id);
    gameCounts[s.id] = games.length;
    if (s.seriesType === 'season_replay') {
      replayMetadata[s.id] = await getSeriesMetadata(s.id);
    }
  }
});
```

Update the SeriesCard call:

```svelte
<SeriesCard
  series={s}
  gameCount={gameCounts[s.id] ?? 0}
  replayStatus={replayMetadata[s.id]?.seasonReplay?.status}
  replayProgress={replayMetadata[s.id]?.seasonReplay ?
    (replayMetadata[s.id].seasonReplay.currentGameIndex / replayMetadata[s.id].seasonReplay.totalGames) * 100 :
    undefined}
/>
```

**Step 4: Commit**

```bash
git add app/src/routes/game-results/+page.svelte app/src/lib/game-results/components/SeriesCard.svelte
git commit -m "feat(season-replay): add replay status badge to series cards"
```

---

## Phase 8: Testing and Polish

### Task 11: Manual Testing

**Step 1: Test full flow**

1. Go to home page
2. Select a year (e.g., 1976)
3. Download season if not already
4. Click "Replay Season"
5. Verify setup page loads with correct year
6. Click "Start Replay"
7. Verify series page opens with standings tab active
8. Verify replay controls show on right
9. Click "Next Game" - verify standings update
10. Click "Play" - verify auto-plays games
11. Refresh page - verify state preserved and auto-resumes
12. Click "Pause" - verify stops
13. Click "Next Day" - verify multiple games play

**Step 2: Test edge cases**

1. Create second replay for same year - verify #2 suffix
2. Let replay complete - verify status shows "Completed"
3. Start replay, close tab, reopen - verify resume prompt

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(season-replay): polish and bug fixes from testing"
```

### Task 12: Documentation

**Step 1: Update MEMORY.md if needed**

Add any learnings or patterns discovered.

**Step 2: Final commit**

```bash
git add docs/
git commit -m "docs(season-replay): add implementation notes"
```

---

## Completion Checklist

- [ ] All tests pass
- [ ] Manual testing completed successfully
- [ ] No console errors during replay
- [ ] Browser refresh preserves state
- [ ] Multiple replays of same year work correctly
- [ ] Series cards show correct status
- [ ] Standings update in real-time
- [ ] Play/Pause/Stop controls work
- [ ] Next Game and Next Day work

---

**Total estimated implementation time:** 4-6 hours

**Key files modified:**
- `app/src/lib/game-results/types.ts`
- `app/src/lib/game-results/schema.ts`
- `app/src/lib/game-results/series.ts`
- `app/src/lib/game-results/index.ts`
- `app/src/lib/game/sqlite-season-loader.ts`
- `app/src/routes/+page.svelte`
- `app/src/routes/game-results/+page.svelte`
- `app/src/routes/game-results/series/[id]/+page.svelte`

**Key files created:**
- `app/src/lib/season-replay/types.ts`
- `app/src/lib/season-replay/engine.ts`
- `app/src/lib/season-replay/index.ts`
- `app/src/routes/season-replay/+page.svelte`
- `app/src/lib/game-results/components/ReplayControls.svelte`
- `app/src/lib/game-results/components/ReplayStandingsView.svelte`
