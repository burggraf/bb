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

<div class="container mx-auto px-3 sm:px-4 py-4 sm:py-8 max-w-6xl">
	<header class="mb-4 sm:mb-8 text-center">
		<h1 class="text-2xl sm:text-3xl lg:text-4xl font-bold mb-1 sm:mb-2">⚾ Baseball Sim</h1>
		<p class="text-xs sm:text-sm lg:text-base text-zinc-400">Statistical baseball simulation powered by 115+ years of MLB data</p>
	</header>

	<main class="space-y-4 sm:space-y-6 lg:space-y-8">
		<!-- Mode Selection -->
		<section class="bg-zinc-900 rounded-lg p-4 sm:p-6">
			<h2 class="text-base sm:text-lg lg:text-xl font-semibold mb-3 sm:mb-4">Game Mode</h2>
			<div class="flex gap-2 sm:gap-4">
				<button
					class="flex-1 px-3 py-2 sm:px-4 sm:py-2 rounded {gameMode === 'quick'
						? 'bg-blue-600 text-white'
						: 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'} text-sm sm:text-base"
					onclick={() => {
						gameMode = 'quick';
						goto(`/game?year=${selectedYear}`);
					}}
				>
					Quick Match
				</button>
				<button
					class="flex-1 px-3 py-2 sm:px-4 sm:py-2 rounded {gameMode === 'historical'
						? 'bg-blue-600 text-white'
						: 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'} text-sm sm:text-base"
					onclick={() => (gameMode = 'historical')}
				>
					Historical Game
				</button>
			</div>
		</section>

		<!-- Season Selection -->
		<section class="bg-zinc-900 rounded-lg p-4 sm:p-6">
			<h2 class="text-base sm:text-lg lg:text-xl font-semibold mb-3 sm:mb-4">Select Season</h2>
			<select
				bind:value={selectedYear}
				class="w-full max-w-xs bg-zinc-800 border border-zinc-700 rounded px-3 py-2 sm:px-4 text-white text-sm sm:text-base"
			>
				{#each years as year}
					<option value={year}>{year}</option
					>{/each}
			</select>
		</section>

		{#if gameMode === 'quick'}
			<!-- Team Selection for Quick Match -->
			<section class="bg-zinc-900 rounded-lg p-4 sm:p-6">
				<h2 class="text-base sm:text-lg lg:text-xl font-semibold mb-3 sm:mb-4">Select Teams</h2>
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 lg:gap-8">
					<div>
						<h3 class="text-base sm:text-lg mb-2 sm:mb-3 text-zinc-300">Away Team</h3>
						<p class="text-zinc-500 text-xs sm:text-sm">Team selection coming soon...</p>
					</div>
					<div>
						<h3 class="text-base sm:text-lg mb-2 sm:mb-3 text-zinc-300">Home Team</h3>
						<p class="text-zinc-500 text-xs sm:text-sm">Team selection coming soon...</p>
					</div>
				</div>
			</section>
		{:else}
			<!-- Historical Game Info -->
			<section class="bg-zinc-900 rounded-lg p-4 sm:p-6">
				<h2 class="text-base sm:text-lg lg:text-xl font-semibold mb-3 sm:mb-4">Historical Games</h2>
				<p class="text-zinc-400 mb-3 sm:mb-4 text-sm sm:text-base">
					Browse the {selectedYear} schedule and select a game to replay with actual historical lineups.
				</p>
				<button
					class="px-3 py-2 sm:px-4 sm:py-2 bg-zinc-800 text-zinc-300 rounded hover:bg-zinc-700 text-sm sm:text-base"
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
				class="px-6 py-3 sm:px-8 sm:py-3 bg-green-600 text-white font-semibold rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-base sm:text-lg"
				onclick={startGame}
			>
				Start Game
			</button>
		</section>

		<!-- Info Section -->
		<section class="bg-zinc-900/50 rounded-lg p-4 sm:p-6 text-center">
			<h3 class="font-semibold mb-1.5 sm:mb-2 text-sm sm:text-base">About Baseball Sim</h3>
			<p class="text-xs sm:text-sm text-zinc-400 max-w-2xl mx-auto">
				This game uses a Bayesian hierarchical log5 model to simulate batter-pitcher matchups with
				statistical accuracy. All player stats are sourced from Retrosheet and Baseball Databank.
				Cross-era matchups are supported — pit the 1927 Yankees against the 1976 Reds!
			</p>
		</section>
	</main>
</div>
