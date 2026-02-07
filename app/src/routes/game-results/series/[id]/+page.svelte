<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import StandingsTable from '$lib/game-results/components/StandingsTable.svelte';
	import GamesList from '$lib/game-results/components/GamesList.svelte';
	import BattingLeadersTable from '$lib/game-results/components/BattingLeadersTable.svelte';
	import PitchingLeadersTable from '$lib/game-results/components/PitchingLeadersTable.svelte';
	import type { BattingStat, PitchingStat } from '$lib/game-results';

	interface Props {
		data: PageData;
	}
	let { data }: Props = $props();

	// Dynamic imports
	let getSeries: typeof import('$lib/game-results/index.js').getSeries;
	let getSeriesStandingsEnhanced: typeof import('$lib/game-results/index.js').getSeriesStandingsEnhanced;
	let getGamesBySeries: typeof import('$lib/game-results/index.js').getGamesBySeries;
	let getBattingStats: typeof import('$lib/game-results/index.js').getBattingStats;
	let getPitchingStats: typeof import('$lib/game-results/index.js').getPitchingStats;
	let getSeriesMetadata: typeof import('$lib/game-results/index.js').getSeriesMetadata;

	// State
	let loading = $state<boolean>(true);
	let error = $state<string | null>(null);
	let series: Awaited<ReturnType<typeof import('$lib/game-results/index.js').getSeries>> | null = null;
	let standings = $state<Awaited<ReturnType<typeof import('$lib/game-results/index.js').getSeriesStandingsEnhanced>>>([]);
	let games = $state<Awaited<ReturnType<typeof import('$lib/game-results/index.js').getGamesBySeries>>>([]);
	let battingStats = $state<BattingStat[]>([]);
	let pitchingStats = $state<PitchingStat[]>([]);
	let activeTab = $state<'standings' | 'games' | 'leaders'>('games');
	let leadersSubTab = $state<'batting' | 'pitching'>('batting');
	let isSeasonReplay = $state(false);
	let replayMetadata = $state<Awaited<ReturnType<typeof import('$lib/game-results/index.js').getSeriesMetadata>> | null>(null);

	onMount(async () => {
		try {
			const gameResults = await import('$lib/game-results/index.js');
			getSeries = gameResults.getSeries;
			getSeriesStandingsEnhanced = gameResults.getSeriesStandingsEnhanced;
			getGamesBySeries = gameResults.getGamesBySeries;
			getBattingStats = gameResults.getBattingStats;
			getPitchingStats = gameResults.getPitchingStats;
			getSeriesMetadata = gameResults.getSeriesMetadata;

			series = await getSeries(data.seriesId);
			standings = await getSeriesStandingsEnhanced(data.seriesId);
			games = await getGamesBySeries(data.seriesId);
			battingStats = await getBattingStats(data.seriesId);
			pitchingStats = await getPitchingStats(data.seriesId);

			isSeasonReplay = series?.seriesType === 'season_replay';
			if (isSeasonReplay) {
				replayMetadata = await gameResults.getSeriesMetadata(data.seriesId);
				activeTab = 'standings';
			}
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
		<div class="animate-pulse">
			<div class="h-8 bg-zinc-800 rounded w-1/3 mb-4"></div>
			<div class="h-10 bg-zinc-800 rounded w-2/3 mb-6"></div>
			<div class="h-64 bg-zinc-800 rounded"></div>
		</div>
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
					onclick={() => (activeTab = 'standings')}
				>
					Standings
				</button>
				<button
					class="pb-2 px-1 text-sm {activeTab === 'games' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-zinc-400 hover:text-white'}"
					onclick={() => (activeTab = 'games')}
				>
					Games
				</button>
				<button
					class="pb-2 px-1 text-sm {activeTab === 'leaders' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-zinc-400 hover:text-white'}"
					onclick={() => (activeTab = 'leaders')}
				>
					Leaders
				</button>
			</div>
		</div>

		<!-- Tab Content -->
		{#if activeTab === 'standings'}
			<StandingsTable {standings} {isSeasonReplay} {seriesId} />
		{:else if activeTab === 'games'}
			<GamesList {games} />
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
	{/if}
</div>
