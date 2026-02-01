<script lang="ts">
	import { goto } from '$app/navigation';

	// TODO: Load from season data
	const years = Array.from({ length: 115 }, (_, i) => 1910 + i).reverse();

	let selectedYear = $state(1976);
	let gameMode = $state<'quick' | 'historical'>('quick');
	let selectedHomeTeam = $state<string | null>(null);
	let selectedAwayTeam = $state<string | null>(null);

	function startGame() {
		if (gameMode === 'quick') {
			goto(`/game?year=${selectedYear}`);
		} else {
			goto(`/schedule?year=${selectedYear}`);
		}
	}
</script>

<svelte:head>
	<title>Baseball Sim - Home</title>
</svelte:head>

<div class="container mx-auto px-4 py-8 max-w-6xl">
	<header class="mb-8 text-center">
		<h1 class="text-4xl font-bold mb-2">⚾ Baseball Sim</h1>
		<p class="text-zinc-400">Statistical baseball simulation powered by 115+ years of MLB data</p>
	</header>

	<main class="space-y-8">
		<!-- Mode Selection -->
		<section class="bg-zinc-900 rounded-lg p-6">
			<h2 class="text-xl font-semibold mb-4">Game Mode</h2>
			<div class="flex gap-4">
				<button
					class="px-4 py-2 rounded {gameMode === 'quick'
						? 'bg-blue-600 text-white'
						: 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}"
					onclick={() => {
						gameMode = 'quick';
						goto(`/game?year=${selectedYear}`);
					}}
				>
					Quick Match
				</button>
				<button
					class="px-4 py-2 rounded {gameMode === 'historical'
						? 'bg-blue-600 text-white'
						: 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}"
					onclick={() => (gameMode = 'historical')}
				>
					Historical Game
				</button>
			</div>
		</section>

		<!-- Season Selection -->
		<section class="bg-zinc-900 rounded-lg p-6">
			<h2 class="text-xl font-semibold mb-4">Select Season</h2>
			<select
				bind:value={selectedYear}
				class="w-full max-w-xs bg-zinc-800 border border-zinc-700 rounded px-4 py-2 text-white"
			>
				{#each years as year}
					<option value={year}>{year}</option
					>{/each}
			</select>
		</section>

		{#if gameMode === 'quick'}
			<!-- Team Selection for Quick Match -->
			<section class="bg-zinc-900 rounded-lg p-6">
				<h2 class="text-xl font-semibold mb-4">Select Teams</h2>
				<div class="grid grid-cols-2 gap-8">
					<div>
						<h3 class="text-lg mb-3 text-zinc-300">Away Team</h3>
						<p class="text-zinc-500 text-sm">Team selection coming soon...</p>
					</div>
					<div>
						<h3 class="text-lg mb-3 text-zinc-300">Home Team</h3>
						<p class="text-zinc-500 text-sm">Team selection coming soon...</p>
					</div>
				</div>
			</section>
		{:else}
			<!-- Historical Game Info -->
			<section class="bg-zinc-900 rounded-lg p-6">
				<h2 class="text-xl font-semibold mb-4">Historical Games</h2>
				<p class="text-zinc-400 mb-4">
					Browse the {selectedYear} schedule and select a game to replay with actual historical lineups.
				</p>
				<button
					class="px-4 py-2 bg-zinc-800 text-zinc-300 rounded hover:bg-zinc-700"
					onclick={() => goto(`/schedule?year=${selectedYear}`)}
				>
					View {selectedYear} Schedule
				</button>
			</section>
		{/if}

		<!-- Start Button -->
		<section class="text-center">
			<button
				disabled={gameMode === 'historical'}
				class="px-8 py-3 bg-green-600 text-white font-semibold rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-lg"
				onclick={startGame}
			>
				Start Game
			</button>
		</section>

		<!-- Info Section -->
		<section class="bg-zinc-900/50 rounded-lg p-6 text-center">
			<h3 class="font-semibold mb-2">About Baseball Sim</h3>
			<p class="text-sm text-zinc-400 max-w-2xl mx-auto">
				This game uses a Bayesian hierarchical log5 model to simulate batter-pitcher matchups with
				statistical accuracy. All player stats are sourced from Retrosheet and Baseball Databank.
				Cross-era matchups are supported — pit the 1927 Yankees against the 1976 Reds!
			</p>
		</section>
	</main>
</div>
