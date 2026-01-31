<script lang="ts">
	import type { PageData } from './$types';

	export let data: PageData;

	// TODO: Load from season data based on query params
	let awayScore = $state(0);
	let homeScore = $state(0);
	let inning = $state(1);
	let isTopInning = $state(true);
	let outs = $state(0);
	let balls = $state(0);
	let strikes = $state(0);

	let runners = $state([false, false, false]); // 1B, 2B, 3B
	let plays = $state<string[]>([]);

	let autoPlay = $state(false);
	let simSpeed = $state(1000);

	function simulatePA() {
		// TODO: Use actual MatchupModel
		const outcomes = ['out', 'single', 'double', 'triple', 'homeRun', 'walk', 'hitByPitch'];
		const outcome = outcomes[Math.floor(Math.random() * outcomes.length)];

		let playText = '';
		switch (outcome) {
			case 'out':
				outs = Math.min(outs + 1, 3);
				playText = `Out recorded (${outs}/3)`;
				break;
			case 'single':
				playText = 'Single!';
				break;
			case 'double':
				playText = 'Double!';
				break;
			case 'triple':
				playText = 'Triple!';
				break;
			case 'homeRun':
				awayScore += isTopInning ? 1 : 0;
				homeScore += !isTopInning ? 1 : 0;
				playText = 'Home Run!';
				break;
			case 'walk':
				playText = 'Walk';
				break;
			case 'hitByPitch':
				playText = 'Hit by pitch';
				break;
		}

		plays = [playText, ...plays];
		balls = 0;
		strikes = 0;

		// Inning logic
		if (outs >= 3) {
			outs = 0;
			runners = [false, false, false];
			if (isTopInning) {
				isTopInning = false;
			} else {
				isTopInning = true;
				inning++;
			}
		}
	}

	function toggleAutoPlay() {
		autoPlay = !autoPlay;
		if (autoPlay) {
			const interval = setInterval(() => {
				if (!autoPlay) {
					clearInterval(interval);
					return;
				}
				simulatePA();
			}, simSpeed);
		}
	}

	function quickSim() {
		// TODO: Simulate full game
		for (let i = 0; i < 50; i++) {
			setTimeout(() => simulatePA(), i * 50);
		}
	}
</script>

<svelte:head>
	<title>Game - Baseball Sim</title>
</svelte:head>

<div class="min-h-screen flex flex-col">
	<!-- Header -->
	<header class="bg-zinc-900 border-b border-zinc-800 py-4">
		<div class="container mx-auto px-4">
			<a href="/" class="text-zinc-400 hover:text-white">← Back to Home</a>
		</div>
	</header>

	<!-- Main Game Area -->
	<main class="flex-1 container mx-auto px-4 py-6">
		<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
			<!-- Left: Field View -->
			<div class="lg:col-span-2 space-y-4">
				<!-- Scoreboard -->
				<div class="bg-zinc-900 rounded-lg p-4">
					<div class="flex justify-between items-center">
						<div class="text-center">
							<p class="text-sm text-zinc-400">Away</p>
							<p class="text-3xl font-bold">{awayScore}</p>
						</div>
						<div class="text-center">
							<p class="text-lg">
								{isTopInning ? 'Top' : 'Bot'} {inning}
							</p>
							<p class="text-sm text-zinc-400">{outs} Out</p>
						</div>
						<div class="text-center">
							<p class="text-sm text-zinc-400">Home</p>
							<p class="text-3xl font-bold">{homeScore}</p>
						</div>
					</div>
					<div class="mt-4 flex justify-center gap-8 text-sm">
						<p>Balls: {balls}</p>
						<p>Strikes: {strikes}</p>
					</div>
				</div>

				<!-- Field View -->
				<div class="bg-zinc-900 rounded-lg p-6 aspect-square max-w-md mx-auto">
					<svg viewBox="0 0 200 200" class="w-full h-full">
						<!-- Infield dirt -->
						<polygon
							points="100,20 180,100 100,180 20,100"
							fill="#8B4513"
							opacity="0.5"
						/>

						<!-- Grass (outfield) -->
						<rect x="0" y="0" width="200" height="200" fill="#228B22" fill-opacity="0.3" />

						<!-- Bases (diamond) -->
						<polygon
							points="100,20 180,100 100,180 20,100"
							fill="none"
							stroke="white"
							stroke-width="2"
						/>

						<!-- Home plate -->
						<rect x="95" y="95" width="10" height="10" fill="white" />

						<!-- First base -->
						<rect x="175" y="95" width="10" height="10" fill={runners[0] ? 'yellow' : 'white'} />

						<!-- Second base -->
						<rect x="95" y="15" width="10" height="10" fill={runners[1] ? 'yellow' : 'white'} />

						<!-- Third base -->
						<rect x="15" y="95" width="10" height="10" fill={runners[2] ? 'yellow' : 'white'} />

						<!-- Pitcher's mound -->
						<circle cx="100" cy="100" r="5" fill="#8B4513" />
					</svg>
				</div>

				<!-- Play-by-Play Feed -->
				<div class="bg-zinc-900 rounded-lg p-4">
					<h3 class="text-lg font-semibold mb-2">Play-by-Play</h3>
					<div class="h-48 overflow-y-auto space-y-1">
						{#each plays as play}
							<p class="text-sm text-zinc-300">{play}</p
							>{:else}
							<p class="text-sm text-zinc-500 italic">Game starting...</p>
						{/each}
					</div>
				</div>
			</div>

			<!-- Right: Controls -->
			<div class="space-y-4">
				<div class="bg-zinc-900 rounded-lg p-4">
					<h3 class="text-lg font-semibold mb-4">Game Controls</h3>
					<div class="space-y-3">
						<button
							onclick={simulatePA}
							class="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
						>
							Next Plate Appearance
						</button>
						<button
							onclick={toggleAutoPlay}
							class="w-full px-4 py-2 {autoPlay
								? 'bg-red-600 hover:bg-red-700'
								: 'bg-green-600 hover:bg-green-700'} text-white rounded"
						>
							{autoPlay ? 'Pause' : 'Auto Play'}
						</button>
						<button
							onclick={quickSim}
							class="w-full px-4 py-2 bg-zinc-700 text-white rounded hover:bg-zinc-600"
						>
							Quick Sim (Full Game)
						</button>
					</div>

					<div class="mt-4">
						<label class="block text-sm text-zinc-400 mb-2">Sim Speed</label>
						<input
							type="range"
							min="200"
							max="2000"
							step="100"
							bind:value={simSpeed}
							class="w-full"
						/>
						<p class="text-xs text-zinc-500 text-center">{simSpeed}ms</p>
					</div>
				</div>

				<!-- Current Matchup -->
				<div class="bg-zinc-900 rounded-lg p-4">
					<h3 class="text-lg font-semibold mb-2">Current Matchup</h3>
					<div class="space-y-2 text-sm">
						<div>
							<p class="text-zinc-400">Batter:</p>
							<p class="font-medium">Player Name (R)</p>
						</div>
						<div>
							<p class="text-zinc-400">Pitcher:</p>
							<p class="font-medium">Player Name (R)</p>
						</div>
					</div>
					<p class="text-xs text-zinc-500 mt-2 italic">
						Real player stats coming soon
					</p>
				</div>

				<!-- Game Info -->
				<div class="bg-zinc-900 rounded-lg p-4">
					<h3 class="text-lg font-semibold mb-2">Game Info</h3>
					<p class="text-sm text-zinc-400">1976 Season</p>
					<p class="text-sm text-zinc-400">Historical Lineups</p>
				</div>
			</div>
		</div>
	</main>
</div>
