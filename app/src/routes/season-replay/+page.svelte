<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { createSeasonReplay, findSeasonReplays } from '$lib/game-results/index.js';
	import { isSeasonCached, getSeasonSchedule, type ScheduledGame } from '$lib/game/sqlite-season-loader.js';

	// Get year from query param
	let yearParam = $derived($page.url.searchParams.get('year'));
	let year = $state<number | null>(null);

	// State for season availability
	let isSeasonDownloaded = $state(false);
	let isLoadingSeason = $state(true);
	let seasonError = $state<string | null>(null);

	// State for existing replays
	let existingReplays = $state<Awaited<ReturnType<typeof findSeasonReplays>>>([]);
	let isLoadingReplays = $state(true);

	// Form state
	let seriesName = $state('');

	// Loading/creating state
	let isCreating = $state(false);
	let createError = $state<string | null>(null);

	// Total games in season
	let totalGames = $state(0);

	onMount(async () => {
		// Parse year from query param
		const parsedYear = yearParam ? parseInt(yearParam, 10) : null;
		if (!parsedYear || isNaN(parsedYear)) {
			seasonError = 'Invalid year parameter';
			isLoadingSeason = false;
			return;
		}
		year = parsedYear;

		// Check if season is cached
		try {
			isSeasonDownloaded = await isSeasonCached(year);
			if (!isSeasonDownloaded) {
				seasonError = 'Season data not downloaded. Please download the season first.';
				isLoadingSeason = false;
				return;
			}

			// Get total games count
			const schedule = await getSeasonSchedule(year);
			totalGames = schedule.length;

			// Find existing replays for this year
			existingReplays = await findSeasonReplays(year);

			// Generate default series name with suffix
			seriesName = generateDefaultName(year);
		} catch (error) {
			seasonError = error instanceof Error ? error.message : 'Failed to load season data';
		} finally {
			isLoadingSeason = false;
			isLoadingReplays = false;
		}
	});

	function generateDefaultName(seasonYear: number): string {
		const baseName = `${seasonYear} Season Replay`;
		const existingNames = new Set(existingReplays.map((r) => r.name));

		// If no conflicts, use base name
		if (!existingNames.has(baseName)) {
			return baseName;
		}

		// Try suffixes #2, #3, etc.
		let suffix = 2;
		while (existingNames.has(`${baseName} #${suffix}`)) {
			suffix++;
		}
		return `${baseName} #${suffix}`;
	}

	async function handleCreateReplay() {
		if (!year || !seriesName.trim()) {
			createError = 'Please enter a series name';
			return;
		}

		isCreating = true;
		createError = null;

		try {
			const series = await createSeasonReplay({
				name: seriesName.trim(),
				description: null,
				seasonYear: year,
				totalGames
			});

			// Redirect to series page
			goto(`/game-results/series/${series.id}`);
		} catch (error) {
			createError = error instanceof Error ? error.message : 'Failed to create season replay';
			isCreating = false;
		}
	}

	function handleCancel() {
		goto('/game-results');
	}
</script>

<svelte:head>
	<title>Season Replay Setup - Baseball Sim</title>
</svelte:head>

<div class="container mx-auto px-4 py-8 max-w-2xl">
	<!-- Header -->
	<div class="mb-8">
		<h1 class="text-3xl font-bold text-white mb-2">Season Replay Setup</h1>
		<p class="text-zinc-400">Configure your {year} season replay</p>
	</div>

	<!-- Loading state -->
	{#if isLoadingSeason}
		<div class="bg-zinc-900 rounded-lg p-8 text-center">
			<div class="flex justify-center mb-4">
				<svg class="animate-spin h-8 w-8 text-blue-500" fill="none" viewBox="0 0 24 24">
					<circle
						class="opacity-25"
						cx="12"
						cy="12"
						r="10"
						stroke="currentColor"
						stroke-width="4"
					></circle>
					<path
						class="opacity-75"
						fill="currentColor"
						d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
					></path>
				</svg>
			</div>
			<p class="text-zinc-400">Loading season data...</p>
		</div>
	{:else if seasonError}
		<div class="bg-zinc-900 rounded-lg p-8 text-center">
			<div class="flex justify-center mb-4">
				<svg class="w-12 h-12 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
					/>
				</svg>
			</div>
			<p class="text-red-400 mb-4">{seasonError}</p>
			<a
				href="/"
				class="inline-block px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors"
			>
				Go Back Home
			</a>
		</div>
	{:else}
		<!-- Setup form -->
		<div class="bg-zinc-900 rounded-lg p-6">
			<!-- Season info -->
			<div class="mb-6 p-4 bg-zinc-800 rounded-lg">
				<div class="flex items-center gap-3 mb-2">
					<svg class="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M5 13l4 4L19 7"
						/>
					</svg>
					<span class="text-white font-medium">{year} Season Ready</span>
				</div>
				<p class="text-sm text-zinc-400">
					{totalGames.toLocaleString()} games scheduled for replay
				</p>
				{#if existingReplays.length > 0}
					<p class="text-xs text-zinc-500 mt-2">
						{existingReplays.length} existing replay{existingReplays.length === 1 ? '' : 's'}
						for this year
					</p>
				{/if}
			</div>

			<!-- Series name -->
			<div class="mb-6">
				<label for="seriesName" class="block text-sm font-medium text-zinc-300 mb-2">
					Series Name
				</label>
				<input
					id="seriesName"
					type="text"
					bind:value={seriesName}
					disabled={isCreating}
					class="w-full bg-zinc-800 border border-zinc-700 rounded px-4 py-2 text-white disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500"
					placeholder="Enter series name"
				/>
			</div>

			<!-- Error message -->
			{#if createError}
				<div class="mb-6 p-4 bg-red-900/30 border border-red-700 rounded text-red-300 text-sm">
					{createError}
				</div>
			{/if}

			<!-- Action buttons -->
			<div class="flex gap-3">
				<button
					onclick={handleCreateReplay}
					disabled={isCreating || !seriesName.trim()}
					class="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-zinc-700 text-white font-semibold rounded transition-colors disabled:cursor-not-allowed flex items-center justify-center gap-2"
				>
					{#if isCreating}
						<svg class="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
							<circle
								class="opacity-25"
								cx="12"
								cy="12"
								r="10"
								stroke="currentColor"
								stroke-width="4"
							></circle>
							<path
								class="opacity-75"
								fill="currentColor"
								d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
							></path>
						</svg>
						Creating...
					{:else}
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 6v6m0 0v6m0-6h6m-6 0H6"
							/>
						</svg>
						Create Replay
					{/if}
				</button>
				<button
					onclick={handleCancel}
					disabled={isCreating}
					class="px-6 py-3 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white font-medium rounded transition-colors disabled:cursor-not-allowed"
				>
					Cancel
				</button>
			</div>
		</div>
	{/if}
</div>
