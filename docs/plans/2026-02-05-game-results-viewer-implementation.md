# Game Results Viewer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a UI for viewing saved baseball game results from SQLite database with progressive drill-down from series list → standings/games/leaders → game box scores and play-by-play.

**Architecture:** Client-side only SvelteKit app using sql.js WASM for SQLite queries. Two main routes (/game-results and /game-results/series/[id]) with SSR-safe dynamic imports. Modal for game details with lazy-loaded play-by-play.

**Tech Stack:** Svelte 5 with runes ($state, $derived), Tailwind CSS, sql.js WASM, IndexedDB persistence, TypeScript

---

## Task 1: Add Navigation Link to Main Layout

**Files:**
- Modify: `app/src/routes/+layout.svelte`

**Step 1: Add Game Results link to navigation**

Find the navigation links section and add a "Game Results" link between "Home" and "Data Browser".

```svelte
<!-- Navigation Links -->
<div class="flex items-center gap-4 sm:gap-6">
	<a
		href="/"
		class="text-zinc-400 hover:text-white text-sm transition-colors"
	>
		Home
	</a>
	<a
		href="/game-results"
		class="text-zinc-400 hover:text-white text-sm transition-colors"
	>
		Game Results
	</a>
	<a
		href="/data-browser"
		class="text-zinc-400 hover:text-white text-sm transition-colors"
	>
		Data Browser
	</a>
</div>
```

**Step 2: Commit**

```bash
git add app/src/routes/+layout.svelte
git commit -m "feat: add Game Results link to main navigation"
```

---

## Task 2: Create Game Results Routes Structure

**Files:**
- Create: `app/src/routes/game-results/+page.svelte`

**Step 1: Create series list page skeleton**

Create `app/src/routes/game-results/+page.svelte` with basic structure:

```svelte
<script lang="ts">
	import { onMount } from 'svelte';

	// Dynamic imports for SSR compatibility
	let listSeries: typeof import('$lib/game-results/index.js').listSeries;
	let loading = $state<boolean>(true);
	let error = $state<string | null>(null);
	let series = $state<Awaited<ReturnType<typeof import('$lib/game-results/index.js').listSeries>>>([]);

	onMount(async () => {
		try {
			const gameResults = await import('$lib/game-results/index.js');
			listSeries = gameResults.listSeries;
			series = await listSeries();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load series';
		} finally {
			loading = false;
		}
	});
</script>

<svelte:head>
	<title>Game Results - Baseball Sim</title>
</svelte:head>

<div class="container mx-auto px-4 py-8 max-w-6xl">
	<h1 class="text-3xl font-bold text-white mb-8">Game Results</h1>

	{#if loading}
		<div class="text-zinc-400">Loading...</div>
	{:else if error}
		<div class="text-red-400">{error}</div>
	{:else if series.length === 0}
		<div class="text-center py-12">
			<p class="text-zinc-400 text-lg mb-4">No games saved yet. Simulate a game to get started!</p>
			<a href="/game" class="inline-block bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded">
				Simulate a Game
			</a>
		</div>
	{:else}
		<!-- TODO: Series cards grid -->
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each series as s}
				<!-- TODO: SeriesCard component -->
				<div class="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
					<a href="/game-results/series/{s.id}" class="block">
						<h2 class="text-xl font-semibold text-white">{s.name}</h2>
						<p class="text-zinc-400 text-sm">{s.seriesType}</p>
					</a>
				</div>
			{/each}
		</div>
	{/if}
</div>
```

**Step 2: Commit**

```bash
git add app/src/routes/game-results/+page.svelte
git commit -m "feat: create game results series list page skeleton"
```

---

## Task 3: Create Series Detail Route Structure

**Files:**
- Create: `app/src/routes/game-results/series/[id]/+page.svelte`
- Create: `app/src/routes/game-results/series/[id]/+page.ts`

**Step 1: Create page load function for series data**

Create `app/src/routes/game-results/series/[id]/+page.ts`:

```typescript
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	// We'll load most data client-side, but pass the seriesId
	return {
		seriesId: params.id
	};
};
```

**Step 2: Create series detail page skeleton**

Create `app/src/routes/game-results/series/[id]/+page.svelte`:

```svelte
<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}
	let { data }: Props = $props();

	// Dynamic imports
	let getSeries: typeof import('$lib/game-results/index.js').getSeries;
	let getSeriesStandingsEnhanced: typeof import('$lib/game-results/index.js').getSeriesStandingsEnhanced;
	let getGamesBySeries: typeof import('$lib/game-results/index.js').getGamesBySeries;

	// State
	let loading = $state<boolean>(true);
	let error = $state<string | null>(null);
	let series: Awaited<ReturnType<typeof import('$lib/game-results/index.js').getSeries>> | null = null;
	let standings = $state<Awaited<ReturnType<typeof import('$lib/game-results/index.js').getSeriesStandingsEnhanced>>>([]);
	let games = $state<Awaited<ReturnType<typeof import('$lib/game-results/index.js').getGamesBySeries>>>([]);
	let activeTab = $state<'standings' | 'games' | 'leaders'>('games');

	onMount(async () => {
		try {
			const gameResults = await import('$lib/game-results/index.js');
			getSeries = gameResults.getSeries;
			getSeriesStandingsEnhanced = gameResults.getSeriesStandingsEnhanced;
			getGamesBySeries = gameResults.getGamesBySeries;

			series = await getSeries(data.seriesId);
			standings = await getSeriesStandingsEnhanced(data.seriesId);
			games = await getGamesBySeries(data.seriesId);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load series';
		} finally {
			loading = false;
		}
	});
</script>

<svelte:head>
	<title>{series?.name || 'Series'} - Game Results</title>
</svelte:head>

<div class="container mx-auto px-4 py-8 max-w-7xl">
	{#if loading}
		<div class="text-zinc-400">Loading...</div>
	{:else if error}
		<div class="text-red-400">{error}</div>
	{:else if series}
		<!-- Header -->
		<div class="mb-6">
			<a href="/game-results" class="text-blue-400 hover:text-blue-300 text-sm">← Back to all series</a>
			<h1 class="text-3xl font-bold text-white mt-2">{series.name}</h1>
			<div class="flex gap-2 mt-2">
				<span class="bg-zinc-800 text-zinc-300 text-xs px-2 py-1 rounded">{series.seriesType}</span>
				<span class="bg-zinc-800 text-zinc-300 text-xs px-2 py-1 rounded">{series.status}</span>
			</div>
		</div>

		<!-- Tabs -->
		<div class="border-b border-zinc-800 mb-6">
			<div class="flex gap-4">
				<button
					class="pb-2 px-1 text-sm {activeTab === 'standings' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-zinc-400 hover:text-white'}"
					onclick={() => activeTab = 'standings'}
				>
					Standings
				</button>
				<button
					class="pb-2 px-1 text-sm {activeTab === 'games' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-zinc-400 hover:text-white'}"
					onclick={() => activeTab = 'games'}
				>
					Games
				</button>
				<button
					class="pb-2 px-1 text-sm {activeTab === 'leaders' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-zinc-400 hover:text-white'}"
					onclick={() => activeTab = 'leaders'}
				>
					Leaders
				</button>
			</div>
		</div>

		<!-- Tab Content -->
		{#if activeTab === 'standings'}
			<!-- TODO: Standings table -->
			<div class="text-zinc-400">Standings coming soon...</div>
		{:else if activeTab === 'games'}
			<!-- TODO: Games list -->
			<div class="text-zinc-400">Games coming soon...</div>
		{:else}
			<!-- TODO: Leaders -->
			<div class="text-zinc-400">Leaders coming soon...</div>
		{/if}
	{/if}
</div>
```

**Step 3: Commit**

```bash
git add app/src/routes/game-results/series/
git commit -m "feat: create series detail page skeleton with tabs"
```

---

## Task 4: Build Standings Table Component

**Files:**
- Create: `app/src/lib/game-results/components/StandingsTable.svelte`

**Step 1: Create StandingsTable component**

Create `app/src/lib/game-results/components/StandingsTable.svelte`:

```svelte
<script lang="ts">
	interface Props {
		standings: Array<{
			teamId: string;
			seasonYear: number;
			league: string | null;
			division: string | null;
			gamesPlayed: number;
			wins: number;
			losses: number;
			winPercentage: number;
			runsScored: number;
			runsAllowed: number;
			gamesBack: number;
			streak: string;
		}>;
	}

	let { standings }: Props = $props();

	// Group standings by division if applicable
	const groupedStandings = $derived(() => {
		const hasDivisions = standings.some(s => s.division);
		if (!hasDivisions) return { 'Overall': standings };

		const groups: Record<string, typeof standings> = {};
		for (const s of standings) {
			const key = `${s.league || ''} ${s.division || ''}`.trim() || 'Overall';
			if (!groups[key]) groups[key] = [];
			groups[key].push(s);
		}
		return groups;
	});
</script>

<div class="space-y-6">
	{#each Object.entries(groupedStandings()) as [groupName, groupStandings]}
		<div>
			{#if groupName !== 'Overall'}
				<h3 class="text-lg font-semibold text-white mb-3">{groupName}</h3>
			{/if}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-zinc-800">
							<th class="text-left py-2 px-3 text-zinc-400 font-medium">Team</th>
							<th class="text-left py-2 px-3 text-zinc-400 font-medium">Yr</th>
							<th class="text-center py-2 px-3 text-zinc-400 font-medium">G</th>
							<th class="text-center py-2 px-3 text-zinc-400 font-medium">W-L</th>
							<th class="text-center py-2 px-3 text-zinc-400 font-medium">Win%</th>
							<th class="text-center py-2 px-3 text-zinc-400 font-medium">RS</th>
							<th class="text-center py-2 px-3 text-zinc-400 font-medium">RA</th>
							<th class="text-center py-2 px-3 text-zinc-400 font-medium">GB</th>
						</tr>
					</thead>
					<tbody>
						{#each groupStandings as s}
							<tr class="border-b border-zinc-800/50 hover:bg-zinc-900/50">
								<td class="py-2 px-3 text-white font-medium">{s.teamId}</td>
								<td class="py-2 px-3 text-zinc-400">{s.seasonYear}</td>
								<td class="py-2 px-3 text-zinc-400 text-center">{s.gamesPlayed}</td>
								<td class="py-2 px-3 text-white text-center">{s.wins}-{s.losses}</td>
								<td class="py-2 px-3 text-zinc-400 text-center">{s.winPercentage.toFixed(3)}</td>
								<td class="py-2 px-3 text-zinc-400 text-center">{s.runsScored}</td>
								<td class="py-2 px-3 text-zinc-400 text-center">{s.runsAllowed}</td>
								<td class="py-2 px-3 text-zinc-400 text-center">{s.gamesBack > 0 ? s.gamesBack.toFixed(1) : '-'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/each}
</div>
```

**Step 2: Update series detail page to use StandingsTable**

In `app/src/routes/game-results/series/[id]/+page.svelte`, update the standings tab:

```svelte
{#if activeTab === 'standings'}
	<StandingsTable standings={standings} />
{:else if activeTab === 'games'}
```

And add the import at the top:

```svelte
<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import StandingsTable from '$lib/game-results/components/StandingsTable.svelte';
	// ... rest of script
```

**Step 3: Commit**

```bash
git add app/src/lib/game-results/components/StandingsTable.svelte
git commit -m "feat: add StandingsTable component with division grouping"
```

---

## Task 5: Build Games List Component

**Files:**
- Create: `app/src/lib/game-results/components/GamesList.svelte`
- Create: `app/src/lib/game-results/components/GameDetailModal.svelte` (stub for now)

**Step 1: Create GamesList component**

Create `app/src/lib/game-results/components/GamesList.svelte`:

```svelte
<script lang="ts">
	interface Props {
		games: Array<{
			id: string;
			awayTeamId: string;
			homeTeamId: string;
			awayScore: number;
			homeScore: number;
			scheduledDate: string | null;
			playedAt: string;
			innings: number;
		}>;
	}

	let { games }: Props = $props();

	let selectedGame = $state<string | null>(null);

	// Format date for display
	function formatDate(dateStr: string | null): string {
		if (!dateStr) return 'Date TBD';
		return new Date(dateStr).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	// Determine winner
	function getWinner(awayScore: number, homeScore: number): 'away' | 'home' | 'tie' {
		if (awayScore > homeScore) return 'away';
		if (homeScore > awayScore) return 'home';
		return 'tie';
	}
</script>

<div class="overflow-x-auto">
	<table class="w-full text-sm">
		<thead>
			<tr class="border-b border-zinc-800">
				<th class="text-left py-2 px-3 text-zinc-400 font-medium">Date</th>
				<th class="text-left py-2 px-3 text-zinc-400 font-medium">Away</th>
				<th class="text-left py-2 px-3 text-zinc-400 font-medium">Home</th>
				<th class="text-center py-2 px-3 text-zinc-400 font-medium">Score</th>
				<th class="text-center py-2 px-3 text-zinc-400 font-medium">Winner</th>
			</tr>
		</thead>
		<tbody>
			{#each games as game}
				<tr
					class="border-b border-zinc-800/50 hover:bg-zinc-900/50 cursor-pointer"
					onclick={() => selectedGame = game.id}
				>
					<td class="py-2 px-3 text-zinc-400">{formatDate(game.scheduledDate || game.playedAt)}</td>
					<td class="py-2 px-3 {getWinner(game.awayScore, game.homeScore) === 'away' ? 'text-green-400 font-medium' : 'text-white'}">
						{game.awayTeamId}
					</td>
					<td class="py-2 px-3 {getWinner(game.awayScore, game.homeScore) === 'home' ? 'text-green-400 font-medium' : 'text-white'}">
						{game.homeTeamId}
					</td>
					<td class="py-2 px-3 text-white text-center">{game.awayScore}-{game.homeScore}</td>
					<td class="py-2 px-3 text-zinc-400 text-center">
						{game.innings} {game.innings === 9 ? '' : 'inn'}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
	{#if games.length === 0}
		<p class="text-zinc-500 text-center py-8">No games in this series yet.</p>
	{/if}
</div>

{#if selectedGame}
	<!-- TODO: GameDetailModal -->
	<GameDetailModal gameId={selectedGame} onClose={() => selectedGame = null} />
{/if}
```

**Step 2: Create GameDetailModal stub**

Create `app/src/lib/game-results/components/GameDetailModal.svelte`:

```svelte
<script lang="ts">
	interface Props {
		gameId: string;
		onClose: () => void;
	}

	let { gameId, onClose }: Props = $props();
	// TODO: Load game details, events, inning lines
</script>

<div class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onclick={onClose}>
	<div class="bg-zinc-900 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto" onclick={(e) => e.stopPropagation()}>
		<div class="p-6">
			<div class="flex justify-between items-center mb-4">
				<h2 class="text-xl font-bold text-white">Game Details</h2>
				<button onclick={onClose} class="text-zinc-400 hover:text-white text-2xl">&times;</button>
			</div>
			<p class="text-zinc-400">Game ID: {gameId}</p>
			<p class="text-zinc-400">Box score and play-by-play coming soon...</p>
		</div>
	</div>
</div>
```

**Step 3: Update series detail page to use GamesList**

In `app/src/routes/game-results/series/[id]/+page.svelte`:

```svelte
import StandingsTable from '$lib/game-results/components/StandingsTable.svelte';
import GamesList from '$lib/game-results/components/GamesList.svelte';

// ...

{:else if activeTab === 'games'}
	<GamesList games={games} />
{:else}
```

**Step 4: Commit**

```bash
git add app/src/lib/game-results/components/
git commit -m "feat: add GamesList component with game detail modal stub"
```

---

## Task 6: Build Batting Leaders Table Component

**Files:**
- Create: `app/src/lib/game-results/components/BattingLeadersTable.svelte`

**Step 1: Create BattingLeadersTable component**

Create `app/src/lib/game-results/components/BattingLeadersTable.svelte`:

```svelte
<script lang="ts">
	interface BattingStat {
		batterId: string;
		batterName: string;
		pa: number;
		ab: number;
		avg: number;
		obp: number;
		slg: number;
		homeRuns: number;
		rbi: number;
	}

	interface Props {
		stats: BattingStat[];
		minPa?: number;
	}

	let { stats, minPa = 10 }: Props = $props();

	// Filter by minimum PA
	const filteredStats = $derived(
		stats.filter(s => s.pa >= minPa).slice(0, 20)
	);
</script>

<div class="overflow-x-auto">
	{#if filteredStats.length === 0}
		<p class="text-zinc-500 text-center py-8">Not enough data for leaders (minimum {minPa} PA).</p>
	{:else}
		<table class="w-full text-sm">
			<thead>
				<tr class="border-b border-zinc-800">
					<th class="text-left py-2 px-3 text-zinc-400 font-medium">Player</th>
					<th class="text-left py-2 px-3 text-zinc-400 font-medium">Team</th>
					<th class="text-center py-2 px-3 text-zinc-400 font-medium">G</th>
					<th class="text-center py-2 px-3 text-zinc-400 font-medium">AB</th>
					<th class="text-center py-2 px-3 text-zinc-400 font-medium">AVG</th>
					<th class="text-center py-2 px-3 text-zinc-400 font-medium">OBP</th>
					<th class="text-center py-2 px-3 text-zinc-400 font-medium">SLG</th>
					<th class="text-center py-2 px-3 text-zinc-400 font-medium">HR</th>
					<th class="text-center py-2 px-3 text-zinc-400 font-medium">RBI</th>
				</tr>
			</thead>
			<tbody>
				{#each filteredStats as s}
					<tr class="border-b border-zinc-800/50 hover:bg-zinc-900/50">
						<td class="py-2 px-3 text-white font-medium">{s.batterName}</td>
						<td class="py-2 px-3 text-zinc-400">{s.batterId.slice(0, 3)}</td>
						<td class="py-2 px-3 text-zinc-400 text-center">-</td>
						<td class="py-2 px-3 text-white text-center">{s.ab}</td>
						<td class="py-2 px-3 text-white text-center">{s.avg.toFixed(3)}</td>
						<td class="py-2 px-3 text-white text-center">{s.obp.toFixed(3)}</td>
						<td class="py-2 px-3 text-white text-center">{s.slg.toFixed(3)}</td>
						<td class="py-2 px-3 text-white text-center">{s.homeRuns}</td>
						<td class="py-2 px-3 text-white text-center">{s.rbi}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>
```

**Step 2: Commit**

```bash
git add app/src/lib/game-results/components/BattingLeadersTable.svelte
git commit -m "feat: add BattingLeadersTable component"
```

---

## Task 7: Build Pitching Leaders Table Component

**Files:**
- Create: `app/src/lib/game-results/components/PitchingLeadersTable.svelte`

**Step 1: Create PitchingLeadersTable component**

Create `app/src/lib/game-results/components/PitchingLeadersTable.svelte`:

```svelte
<script lang="ts">
	interface PitchingStat {
		pitcherId: string;
		pitcherName: string;
		games: number;
		outsRecorded: number;
		era: number;
		whip: number;
		strikeouts: number;
		earnedRuns: number;
		runsAllowed: number;
	}

	interface Props {
		stats: PitchingStat[];
		minBf?: number;
	}

	let { stats, minBf = 10 }: Props = $props();

	// Calculate IP from outs
	function calcIP(outs: number): string {
		const innings = Math.floor(outs / 3);
		const partial = outs % 3;
		return partial > 0 ? `${innings}.${partial}` : `${innings}`;
	}

	// Filter by minimum batters faced (approximate from games for now)
	const filteredStats = $derived(
		stats.filter(s => s.outsRecorded >= minBf * 3).slice(0, 20)
	);
</script>

<div class="overflow-x-auto">
	{#if filteredStats.length === 0}
		<p class="text-zinc-500 text-center py-8">Not enough data for leaders (minimum {minBf} BF).</p>
	{:else}
		<table class="w-full text-sm">
			<thead>
				<tr class="border-b border-zinc-800">
					<th class="text-left py-2 px-3 text-zinc-400 font-medium">Player</th>
					<th class="text-left py-2 px-3 text-zinc-400 font-medium">Team</th>
					<th class="text-center py-2 px-3 text-zinc-400 font-medium">G</th>
					<th class="text-center py-2 px-3 text-zinc-400 font-medium">IP</th>
					<th class="text-center py-2 px-3 text-zinc-400 font-medium">ERA</th>
					<th class="text-center py-2 px-3 text-zinc-400 font-medium">WHIP</th>
					<th class="text-center py-2 px-3 text-zinc-400 font-medium">K</th>
				</tr>
			</thead>
			<tbody>
				{#each filteredStats as s}
					<tr class="border-b border-zinc-800/50 hover:bg-zinc-900/50">
						<td class="py-2 px-3 text-white font-medium">{s.pitcherName}</td>
						<td class="py-2 px-3 text-zinc-400">{s.pitcherId.slice(0, 3)}</td>
						<td class="py-2 px-3 text-white text-center">{s.games}</td>
						<td class="py-2 px-3 text-white text-center">{calcIP(s.outsRecorded)}</td>
						<td class="py-2 px-3 text-white text-center">{s.era.toFixed(2)}</td>
						<td class="py-2 px-3 text-white text-center">{s.whip.toFixed(2)}</td>
						<td class="py-2 px-3 text-white text-center">{s.strikeouts}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>
```

**Step 2: Commit**

```bash
git add app/src/lib/game-results/components/PitchingLeadersTable.svelte
git commit -m "feat: add PitchingLeadersTable component"
```

---

## Task 8: Integrate Leaders Tables into Series Detail

**Files:**
- Modify: `app/src/routes/game-results/series/[id]/+page.svelte`

**Step 1: Add state for batting/pitching stats and sub-tab**

Update the script section to add:

```svelte
// Dynamic imports
let getBattingStats: typeof import('$lib/game-results/index.js').getBattingStats;
let getPitchingStats: typeof import('$lib/game-results/index.js').getPitchingStats;

// State
let battingStats = $state<Awaited<ReturnType<typeof import('$lib/game-results/index.js').getBattingStats>>>([]);
let pitchingStats = $state<Awaited<ReturnType<typeof import('$lib/game-results/index.js').getPitchingStats>>>([]);
let leadersSubTab = $state<'batting' | 'pitching'>('batting');

// Load in onMount
getBattingStats = gameResults.getBattingStats;
getPitchingStats = gameResults.getPitchingStats;
// ...
battingStats = await getBattingStats({ seriesId: data.seriesId });
pitchingStats = await getPitchingStats({ seriesId: data.seriesId });
```

**Step 2: Update leaders tab with sub-tabs**

Replace the leaders tab content:

```svelte
{:else}
	<!-- Leaders sub-tabs -->
	<div class="mb-4">
		<div class="flex gap-4 border-b border-zinc-800">
			<button
				class="pb-2 px-1 text-sm {leadersSubTab === 'batting' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-zinc-400 hover:text-white'}"
				onclick={() => leadersSubTab = 'batting'}
			>
				Batting Leaders
			</button>
			<button
				class="pb-2 px-1 text-sm {leadersSubTab === 'pitching' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-zinc-400 hover:text-white'}"
				onclick={() => leadersSubTab = 'pitching'}
			>
				Pitching Leaders
			</button>
		</div>
	</div>

	{#if leadersSubTab === 'batting'}
		<BattingLeadersTable stats={battingStats} />
	{:else}
		<PitchingLeadersTable stats={pitchingStats} />
	{/if}
{/if}
```

**Step 3: Add imports**

```svelte
import BattingLeadersTable from '$lib/game-results/components/BattingLeadersTable.svelte';
import PitchingLeadersTable from '$lib/game-results/components/PitchingLeadersTable.svelte';
```

**Step 4: Commit**

```bash
git add app/src/routes/game-results/series/[id]/+page.svelte
git commit -m "feat: integrate batting and pitching leaders tables with sub-tabs"
```

---

## Task 8.5: Add Missing API Functions for Game Details

**Files:**
- Modify: `app/src/lib/game-results/games.ts`
- Modify: `app/src/lib/game-results/index.ts`

**Step 1: Add getGameEvents function to games.ts**

Add to `app/src/lib/game-results/games.ts`:

```typescript
/**
 * Get all game events for a game (play-by-play)
 *
 * @param gameId - Game UUID
 * @returns Promise<GameEvent[]> Array of game events ordered by sequence
 */
export async function getGameEvents(gameId: string): Promise<import('./types.js').GameEvent[]> {
  const db = await getGameDatabase();
  const stmt = db.prepare('SELECT * FROM game_events WHERE game_id = ? ORDER BY sequence');

  try {
    stmt.bind([gameId]);

    const events: import('./types.js').GameEvent[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as any;
      events.push({
        id: row.id,
        gameId: row.game_id,
        sequence: row.sequence,
        inning: row.inning,
        isTopInning: row.is_top_inning === 1,
        outs: row.outs,
        eventType: row.event_type,
        outcome: row.outcome,
        batterId: row.batter_id,
        batterName: row.batter_name,
        pitcherId: row.pitcher_id,
        pitcherName: row.pitcher_name,
        runsScored: row.runs_scored,
        earnedRuns: row.earned_runs,
        unearnedRuns: row.unearned_runs,
        runner1bBefore: row.runner_1b_before,
        runner2bBefore: row.runner_2b_before,
        runner3bBefore: row.runner_3b_before,
        runner1bAfter: row.runner_1b_after,
        runner2bAfter: row.runner_2b_after,
        runner3bAfter: row.runner_3b_after,
        description: row.description,
        lineupJson: row.lineup_json,
        substitutedPlayer: row.substituted_player,
        position: row.position,
        isSummary: row.is_summary === 1
      });
    }

    return events;
  } catch (error) {
    console.error('[Games] Failed to get game events:', error);
    throw new Error(`Failed to get game events: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    stmt.free();
  }
}
```

**Step 2: Add getInningLines function to games.ts**

Add to `app/src/lib/game-results/games.ts`:

```typescript
/**
 * Get all inning lines for a game (box score data)
 *
 * @param gameId - Game UUID
 * @returns Promise<InningLine[]> Array of inning lines
 */
export async function getInningLines(gameId: string): Promise<import('./types.js').InningLine[]> {
  const db = await getGameDatabase();
  const stmt = db.prepare('SELECT * FROM inning_lines WHERE game_id = ? ORDER BY team_id, inning');

  try {
    stmt.bind([gameId]);

    const lines: import('./types.js').InningLine[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as any;
      lines.push({
        gameId: row.game_id,
        teamId: row.team_id,
        inning: row.inning,
        runs: row.runs,
        hits: row.hits,
        errors: row.errors
      });
    }

    return lines;
  } catch (error) {
    console.error('[Games] Failed to get inning lines:', error);
    throw new Error(`Failed to get inning lines: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    stmt.free();
  }
}
```

**Step 3: Export new functions from index.ts**

Update `app/src/lib/game-results/index.ts` Game Management section:

```typescript
// ====================================================================
// Game Management
// ====================================================================
export {
  saveGame,
  getGame,
  getGamesBySeries,
  getGameEvents,
  getInningLines,
  calculateEarnedRuns,
  determinePitchingDecisions
} from './games.js';
```

**Step 4: Commit**

```bash
git add app/src/lib/game-results/games.ts app/src/lib/game-results/index.ts
git commit -m "feat: add getGameEvents and getInningLines API functions"
```

---

## Task 9: Build Box Score Component for Game Modal

**Files:**
- Create: `app/src/lib/game-results/components/BoxScore.svelte`
- Modify: `app/src/lib/game-results/components/GameDetailModal.svelte`

**Step 1: Create BoxScore component**

Create `app/src/lib/game-results/components/BoxScore.svelte`:

```svelte
<script lang="ts">
	interface InningLine {
		teamId: string;
		inning: number;
		runs: number;
		hits: number;
		errors: number;
	}

	interface Props {
		awayTeamId: string;
		homeTeamId: string;
		awayScore: number;
		homeScore: number;
		innings: number;
		inningLines: InningLine[];
	}

	let { awayTeamId, homeTeamId, awayScore, homeScore, innings, inningLines }: Props = $props();

	// Group by team and sort by inning
	const awayLines = $derived(
		inningLines.filter(l => l.teamId === awayTeamId).sort((a, b) => a.inning - b.inning)
	);
	const homeLines = $derived(
		inningLines.filter(l => l.teamId === homeTeamId).sort((a, b) => a.inning - b.inning)
	);

	// Calculate totals from lines or use provided scores
	const awayHits = $derived(awayLines.reduce((sum, l) => sum + l.hits, 0));
	const homeHits = $derived(homeLines.reduce((sum, l) => sum + l.hits, 0));
	const awayErrors = $derived(awayLines.reduce((sum, l) => sum + l.errors, 0));
	const homeErrors = $derived(homeLines.reduce((sum, l) => sum + l.errors, 0));

	// Create array for all innings
	const allInnings = $derived(Array.from({ length: Math.max(innings, 9) }, (_, i) => i + 1));
</script>

<div class="mb-6">
	<h3 class="text-lg font-semibold text-white mb-3">Box Score</h3>
	<div class="overflow-x-auto">
		<table class="w-full text-sm font-mono">
			<thead>
				<tr class="border-b border-zinc-800">
					<th class="text-left py-2 px-2 text-zinc-400"></th>
					{#each allInnings as i}
						<th class="text-center py-2 px-2 text-zinc-400">{i}</th>
					{/each}
					<th class="text-center py-2 px-2 text-zinc-400 font-bold">R</th>
					<th class="text-center py-2 px-2 text-zinc-400 font-bold">H</th>
					<th class="text-center py-2 px-2 text-zinc-400 font-bold">E</th>
				</tr>
			</thead>
			<tbody>
				<tr class="border-b border-zinc-800/50">
					<td class="py-2 px-2 text-white font-semibold">{awayTeamId}</td>
					{#each allInnings as i}
						{@const line = awayLines.find(l => l.inning === i)}
						<td class="py-2 px-2 text-center text-zinc-300">{line?.runs ?? '-'}</td>
					{/each}
					<td class="py-2 px-2 text-center text-white font-bold">{awayScore}</td>
					<td class="py-2 px-2 text-center text-zinc-300">{awayHits}</td>
					<td class="py-2 px-2 text-center text-zinc-300">{awayErrors}</td>
				</tr>
				<tr class="border-b border-zinc-800/50">
					<td class="py-2 px-2 text-white font-semibold">{homeTeamId}</td>
					{#each allInnings as i}
						{@const line = homeLines.find(l => l.inning === i)}
						<td class="py-2 px-2 text-center text-zinc-300">{line?.runs ?? '-'}</td>
					{/each}
					<td class="py-2 px-2 text-center text-white font-bold">{homeScore}</td>
					<td class="py-2 px-2 text-center text-zinc-300">{homeHits}</td>
					<td class="py-2 px-2 text-center text-zinc-300">{homeErrors}</td>
				</tr>
			</tbody>
		</table>
	</div>
</div>
```

**Step 2: Update GameDetailModal to use BoxScore**

Update `app/src/lib/game-results/components/GameDetailModal.svelte`:

```svelte
<script lang="ts">
	import { onMount } from 'svelte';
	import BoxScore from './BoxScore.svelte';
	import type { InningLine } from '$lib/game-results/types.js';

	interface Props {
		gameId: string;
		onClose: () => void;
	}

	let { gameId, onClose }: Props = $props();

	let loading = $state(true);
	let game: Awaited<ReturnType<typeof import('$lib/game-results/index.js').getGame>> | null = null;
	let inningLines: InningLine[] = [];

	onMount(async () => {
		try {
			const { getGame, getInningLines } = await import('$lib/game-results/index.js');
			game = await getGame(gameId);
			inningLines = await getInningLines(gameId);
		} catch (e) {
			console.error('Failed to load game details:', e);
		} finally {
			loading = false;
		}
	});

	function formatDate(dateStr: string | null): string {
		if (!dateStr) return 'Unknown';
		return new Date(dateStr).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}
</script>

<div class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onclick={onClose}>
	<div class="bg-zinc-900 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto" onclick={(e) => e.stopPropagation()}>
		<div class="p-6">
			<div class="flex justify-between items-center mb-4">
				<h2 class="text-xl font-bold text-white">Game Details</h2>
				<button onclick={onClose} class="text-zinc-400 hover:text-white text-2xl">&times;</button>
			</div>

			{#if loading}
				<p class="text-zinc-400">Loading...</p>
			{:else if game}
				<!-- Box Score -->
				{#if inningLines.length > 0}
					<BoxScore
						awayTeamId={game.awayTeamId}
						homeTeamId={game.homeTeamId}
						awayScore={game.awayScore}
						homeScore={game.homeScore}
						innings={game.innings}
						{inningLines}
					/>
				{/if}

				<!-- Game Info -->
				<div class="mb-6">
					<h3 class="text-lg font-semibold text-white mb-3">Game Info</h3>
					<div class="grid grid-cols-2 gap-4 text-sm">
						<div>
							<span class="text-zinc-400">Date:</span>
							<span class="text-white ml-2">{formatDate(game.scheduledDate)}</span>
						</div>
						<div>
							<span class="text-zinc-400">Innings:</span>
							<span class="text-white ml-2">{game.innings}</span>
						</div>
					</div>
				</div>

				<!-- Play-by-play coming soon -->
				<div>
					<h3 class="text-lg font-semibold text-white mb-3">Play-by-Play</h3>
					<p class="text-zinc-400 text-sm">Play-by-play details coming soon...</p>
				</div>
			{/if}
		</div>
	</div>
</div>
```

**Step 3: Commit**

```bash
git add app/src/lib/game-results/components/
git commit -m "feat: add BoxScore component and integrate into GameDetailModal"
```

---

## Task 10: Enhance Series List Page with Better Cards

**Files:**
- Modify: `app/src/routes/game-results/+page.svelte`
- Create: `app/src/lib/game-results/components/SeriesCard.svelte`

**Step 1: Create SeriesCard component**

Create `app/src/lib/game-results/components/SeriesCard.svelte`:

```svelte
<script lang="ts">
	interface Props {
		series: {
			id: string;
			name: string;
			seriesType: string;
			status: string;
			updatedAt: string;
			description: string | null;
		};
		gameCount?: number;
	}

	let { series, gameCount = 0 }: Props = $props();

	const typeColors: Record<string, string> = {
		season_replay: 'bg-blue-900/50 text-blue-300 border-blue-700',
		tournament: 'bg-purple-900/50 text-purple-300 border-purple-700',
		exhibition: 'bg-green-900/50 text-green-300 border-green-700',
		custom: 'bg-zinc-800 text-zinc-300 border-zinc-700'
	};

	const statusColors: Record<string, string> = {
		active: 'bg-green-500/20 text-green-400',
		completed: 'bg-zinc-700 text-zinc-300',
		archived: 'bg-yellow-500/20 text-yellow-400'
	};

	function formatDate(dateStr: string): string {
		return new Date(dateStr).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}
</script>

<a
	href="/game-results/series/{series.id}"
	class="block bg-zinc-900 border border-zinc-800 rounded-lg p-5 hover:border-zinc-700 hover:bg-zinc-800/50 transition-all"
>
	<div class="flex justify-between items-start mb-3">
		<h3 class="text-lg font-semibold text-white">{series.name}</h3>
		<span class="text-xs px-2 py-1 rounded {statusColors[series.status] || statusColors.custom}">
			{series.status}
		</span>
	</div>

	{#if series.description}
		<p class="text-zinc-400 text-sm mb-3 line-clamp-2">{series.description}</p>
	{/if}

	<div class="flex items-center gap-2 text-xs">
		<span class="px-2 py-1 rounded border {typeColors[series.seriesType] || typeColors.custom}">
			{series.seriesType.replace('_', ' ')}
		</span>
		{#if gameCount > 0}
			<span class="text-zinc-500">{gameCount} game{gameCount === 1 ? '' : 's'}</span>
		{/if}
		<span class="text-zinc-600 ml-auto">Updated {formatDate(series.updatedAt)}</span>
	</div>
</a>
```

**Step 2: Update series list page to use SeriesCard**

Update `app/src/routes/game-results/+page.svelte`:

```svelte
<script lang="ts">
	import { onMount } from 'svelte';
	import SeriesCard from '$lib/game-results/components/SeriesCard.svelte';

	// Dynamic imports for SSR compatibility
	let listSeries: typeof import('$lib/game-results/index.js').listSeries;
	let getGamesBySeries: typeof import('$lib/game-results/index.js').getGamesBySeries;

	let loading = $state<boolean>(true);
	let error = $state<string | null>(null);
	let series = $state<Awaited<ReturnType<typeof import('$lib/game-results/index.js').listSeries>>>([]);
	let gameCounts = $state<Record<string, number>>({});

	onMount(async () => {
		try {
			const gameResults = await import('$lib/game-results/index.js');
			listSeries = gameResults.listSeries;
			getGamesBySeries = gameResults.getGamesBySeries;
			series = await listSeries();

			// Load game counts for each series
			for (const s of series) {
				const games = await getGamesBySeries(s.id);
				gameCounts[s.id] = games.length;
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load series';
		} finally {
			loading = false;
		}
	});
</script>

<!-- ... rest of template ... -->

{:else}
	<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
		{#each series as s}
			<SeriesCard series={s} gameCount={gameCounts[s.id]} />
		{/each}
	</div>
{/if}
```

**Step 3: Commit**

```bash
git add app/src/routes/game-results/+page.svelte app/src/lib/game-results/components/SeriesCard.svelte
git commit -m "feat: add SeriesCard component with enhanced styling"
```

---

## Task 11: Add Loading Skeletons and Better Empty States

**Files:**
- Modify: `app/src/routes/game-results/+page.svelte`
- Modify: `app/src/routes/game-results/series/[id]/+page.svelte`

**Step 1: Add loading skeleton to series list**

Update the loading state in `app/src/routes/game-results/+page.svelte`:

```svelte
{#if loading}
	<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
		{#each Array(3) as _}
			<div class="bg-zinc-900 border border-zinc-800 rounded-lg p-5 animate-pulse">
				<div class="h-5 bg-zinc-800 rounded mb-3 w-3/4"></div>
				<div class="h-4 bg-zinc-800 rounded mb-2 w-full"></div>
				<div class="h-4 bg-zinc-800 rounded w-1/2"></div>
			</div>
		{/each}
	</div>
```

**Step 2: Add loading skeleton to series detail**

Update the loading state in `app/src/routes/game-results/series/[id]/+page.svelte`:

```svelte
{#if loading}
	<div class="animate-pulse">
		<div class="h-8 bg-zinc-800 rounded w-1/3 mb-4"></div>
		<div class="h-10 bg-zinc-800 rounded w-2/3 mb-6"></div>
		<div class="h-64 bg-zinc-800 rounded"></div>
	</div>
```

**Step 3: Commit**

```bash
git add app/src/routes/game-results/
git commit -m "feat: add loading skeletons and improve empty states"
```

---

## Task 12: Final Polish and Testing

**Files:**
- Various

**Step 1: Test complete user flow**

Manually test:
1. Navigate to /game-results
2. View empty state (if no series)
3. Create a series and save a game from /game
4. View series list with cards
5. Click into a series
6. View standings, games, and leaders tabs
7. Click a game to view box score modal
8. Test back button navigation

**Step 2: Verify responsive design**

Test on mobile viewport to ensure:
- Navigation collapses properly
- Tables are horizontally scrollable
- Grid adapts to single column
- Modal fits on small screens

**Step 3: Check for console errors**

Open browser DevTools and verify no errors when:
- Loading pages
- Switching tabs
- Opening/closing modals
- Loading game data

**Step 4: Final commit if any fixes needed**

```bash
git commit -m "fix: address issues found during testing"
```

---

## Summary

This implementation plan builds the Game Results Viewer feature in 12 tasks:

1. Navigation link
2. Series list page
3. Series detail page with tabs
4. Standings table component
5. Games list component
6. Batting leaders component
7. Pitching leaders component
8. Leaders integration
8.5. Missing API functions (getGameEvents, getInningLines)
9. Box score component
10. Enhanced series cards
11. Loading skeletons
12. Final polish and testing

Each task includes specific file paths, complete code snippets, and commit messages for granular progress tracking.
