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

<svelte:head>
	<title>Game Results - Baseball Sim</title>
</svelte:head>

<div class="container mx-auto px-4 py-8">
	<div class="mb-8">
		<h1 class="text-3xl font-bold text-white mb-2">Game Results</h1>
		<p class="text-zinc-400">View your saved baseball game results</p>
	</div>

	{#if loading}
		<p class="text-zinc-400">Loading...</p>
	{:else if error}
		<p class="text-red-400">Error: {error}</p>
	{:else if series.length === 0}
		<div class="text-center py-12">
			<p class="text-zinc-400 mb-4">No games saved yet.</p>
			<a href="/game" class="text-blue-400 hover:text-blue-300">Simulate a game to get started!</a>
		</div>
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each series as s}
				<SeriesCard series={s} gameCount={gameCounts[s.id] ?? 0} />
			{/each}
		</div>
	{/if}
</div>
