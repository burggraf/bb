<script lang="ts">
	import { onMount } from 'svelte';
	import { MatchupModel } from '@bb/model';
	import { loadSeason } from '$lib/game/season-loader.js';
	import { GameEngine } from '$lib/game/engine.js';
	import type { GameState, PlayEvent } from '$lib/game/types.js';

	// Game state
	let awayScore = $state(0);
	let homeScore = $state(0);
	let inning = $state(1);
	let isTopInning = $state(true);
	let outs = $state(0);
	let balls = $state(0);
	let strikes = $state(0);

	let runners = $state([false, false, false]); // 1B, 2B, 3B
	let plays = $state<string[]>([]);

	// Current matchup display
	let currentBatter = $state('Loading...');
	let currentPitcher = $state('Loading...');

	// Auto-play state
	let autoPlay = $state(false);
	let simSpeed = $state(1000);
	let autoPlayInterval: ReturnType<typeof setInterval> | null = null;

	// Engine
	let engine: GameEngine | null = null;

	onMount(async () => {
		try {
			console.log('Loading 1976 season...');
			const season = await loadSeason(1976);
			console.log('Season loaded:', season);
			console.log('Creating game engine...');
			engine = new GameEngine(season, 'CIN', 'HOU'); // Reds vs Astros
			console.log('Engine created:', engine);
			updateFromEngine();
			currentBatter = 'Ready to play!';
		} catch (error) {
			console.error('Failed to load season:', error);
			currentBatter = 'Error: ' + (error as Error).message;
			currentPitcher = 'See console for details';
		}
	});

	function updateFromEngine() {
		if (!engine) return;

		const state = engine.getState();

		// Update score from plays
		let away = 0;
		let home = 0;
		for (const play of state.plays) {
			if (play.isTopInning) {
				away += play.runsScored;
			} else {
				home += play.runsScored;
			}
		}
		awayScore = away;
		homeScore = home;

		inning = state.inning;
		isTopInning = state.isTopInning;
		outs = state.outs;
		balls = state.balls;
		strikes = state.strikes;

		// Update runners (visual)
		runners = [
			state.bases[0] !== null,
			state.bases[1] !== null,
			state.bases[2] !== null,
		];

		// Update play-by-play feed
		plays = state.plays.map((p) => p.description);

		// Update current matchup (from last play or predict next)
		if (state.plays.length > 0) {
			const lastPlay = state.plays[0];
			currentBatter = lastPlay.batterName;
			currentPitcher = lastPlay.pitcherName;
		}
	}

	function simulatePA() {
		if (!engine) return;

		const play = engine.simulatePlateAppearance();
		updateFromEngine();

		if (engine.isComplete()) {
			stopAutoPlay();
		}
	}

	function toggleAutoPlay() {
		autoPlay = !autoPlay;
		if (autoPlay) {
			autoPlayInterval = setInterval(() => {
				if (!engine || engine.isComplete()) {
					stopAutoPlay();
					return;
				}
				simulatePA();
			}, simSpeed);
		} else {
			stopAutoPlay();
		}
	}

	function stopAutoPlay() {
		autoPlay = false;
		if (autoPlayInterval) {
			clearInterval(autoPlayInterval);
			autoPlayInterval = null;
		}
	}

	function quickSim() {
		stopAutoPlay();
		if (!engine) return;

		// Simulate remaining game quickly
		while (!engine.isComplete()) {
			engine.simulatePlateAppearance();
		}
		updateFromEngine();
	}
</script>

<svelte:head>
	<title>Game - Baseball Sim</title>
</svelte:head>

<div class="h-screen flex flex-col bg-zinc-950 overflow-hidden">
	<!-- Header -->
	<header class="flex-shrink-0 bg-zinc-900 border-b border-zinc-800 py-2 px-4">
		<div class="flex items-center justify-between">
			<a href="/" class="text-zinc-400 hover:text-white text-sm">← Home</a>
			<div class="flex gap-4 text-xs text-zinc-500">
				<span>1976 Season</span>
				<span>Reds vs Astros</span>
			</div>
		</div>
	</header>

	<!-- Scoreboard -->
	<div class="flex-shrink-0 bg-zinc-900 border-b border-zinc-800 py-2 px-4">
		<div class="flex items-center justify-center gap-8">
			<div class="text-center w-16">
				<p class="text-xs text-zinc-400">Away</p>
				<p class="text-2xl font-bold">{awayScore}</p>
			</div>
			<div class="text-center">
				<p class="text-sm">{isTopInning ? 'Top' : 'Bot'} {inning}</p>
				<p class="text-xs text-zinc-400">{outs} Out</p>
			</div>
			<div class="text-center w-16">
				<p class="text-xs text-zinc-400">Home</p>
				<p class="text-2xl font-bold">{homeScore}</p>
			</div>
			<div class="text-xs text-zinc-400">
				B: {balls} · S: {strikes}
			</div>
		</div>
	</div>

	<!-- Main Content -->
	<main class="flex-1 flex overflow-hidden">
		<!-- Left: Field and Controls -->
		<div class="flex-1 flex flex-col p-3 gap-3 overflow-hidden">
			<!-- Field View -->
			<div class="flex-shrink-0 bg-zinc-900 rounded-lg p-3">
				<svg viewBox="0 0 200 200" class="w-full h-auto" style="max-height: 280px;">
					<!-- Grass (outfield) -->
					<rect x="0" y="0" width="200" height="200" fill="#228B22" fill-opacity="0.3" />

					<!-- Infield dirt -->
					<polygon
						points="100,20 180,100 100,180 20,100"
						fill="#8B4513"
						opacity="0.5"
					/>

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
					<rect x="175" y="95" width="10" height="10" fill={runners[0] ? '#facc15' : 'white'} />

					<!-- Second base -->
					<rect x="95" y="15" width="10" height="10" fill={runners[1] ? '#facc15' : 'white'} />

					<!-- Third base -->
					<rect x="15" y="95" width="10" height="10" fill={runners[2] ? '#facc15' : 'white'} />

					<!-- Pitcher's mound -->
					<circle cx="100" cy="100" r="5" fill="#8B4513" />
				</svg>
			</div>

			<!-- Controls -->
			<div class="flex-shrink-0 bg-zinc-900 rounded-lg p-3">
				<div class="flex gap-2">
					<button
						onclick={simulatePA}
						class="flex-1 px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
						disabled={!engine}
					>
						Next PA
					</button>
					<button
						onclick={toggleAutoPlay}
						class="flex-1 px-3 py-2 {autoPlay
							? 'bg-red-600 hover:bg-red-700'
							: 'bg-green-600 hover:bg-green-700'} text-white text-sm rounded"
						disabled={!engine}
					>
						{autoPlay ? 'Pause' : 'Auto'}
					</button>
					<button
						onclick={quickSim}
						class="flex-1 px-3 py-2 bg-zinc-700 text-white text-sm rounded hover:bg-zinc-600 disabled:opacity-50"
						disabled={!engine}
					>
						Quick Sim
					</button>
				</div>
				<div class="mt-2 flex items-center gap-2">
					<span class="text-xs text-zinc-400">Speed:</span>
					<input
						type="range"
						min="200"
						max="2000"
						step="100"
						bind:value={simSpeed}
						class="flex-1"
					/>
					<span class="text-xs text-zinc-500 w-10">{simSpeed}ms</span>
				</div>
			</div>
		</div>

		<!-- Right: Play-by-Play and Matchup -->
		<div class="w-80 flex-shrink-0 flex flex-col p-3 gap-3 overflow-hidden">
			<!-- Current Matchup -->
			<div class="flex-shrink-0 bg-zinc-900 rounded-lg p-3">
				<h3 class="text-xs font-semibold text-zinc-400 mb-2">MATCHUP</h3>
				<div class="space-y-1 text-sm">
					<div class="flex items-center gap-2">
						<span class="text-zinc-500 w-12 text-xs">BAT</span>
						<span class="font-medium truncate">{currentBatter}</span>
					</div>
					<div class="flex items-center gap-2">
						<span class="text-zinc-500 w-12 text-xs">PIT</span>
						<span class="font-medium truncate">{currentPitcher}</span>
					</div>
				</div>
			</div>

			<!-- Play-by-Play Feed -->
			<div class="flex-1 bg-zinc-900 rounded-lg p-3 overflow-hidden flex flex-col">
				<h3 class="text-xs font-semibold text-zinc-400 mb-2">PLAY-BY-PLAY</h3>
				<div class="flex-1 overflow-y-auto space-y-1">
					{#each plays as play}
						<p class="text-xs text-zinc-300">{play}</p>
					{:else}
						<p class="text-xs text-zinc-500 italic">Game starting...</p>
					{/each}
				</div>
			</div>
		</div>
	</main>
</div>
