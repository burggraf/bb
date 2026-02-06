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
