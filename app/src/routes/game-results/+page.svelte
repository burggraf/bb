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
