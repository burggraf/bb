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
	let gameComplete = $state(false);

	// Current matchup display
	let currentBatter = $state('Loading...');
	let currentPitcher = $state('Loading...');

	// Auto-play state
	let autoPlay = $state(false);
	let simSpeed = $state(1000);
	let autoPlayInterval: ReturnType<typeof setInterval> | null = null;

	// Engine
	let engine = $state<GameEngine | null>(null);
	let season = $state<any>(null); // Store season for player lookups

	// Lineup display
	let awayLineupDisplay = $state<Array<{ name: string; isCurrent: boolean }>>([]);
	let homeLineupDisplay = $state<Array<{ name: string; isCurrent: boolean }>>([]);

	onMount(async () => {
		try {
			season = await loadSeason(1976);
			engine = new GameEngine(season, 'CIN', 'HOU');
			updateFromEngine();
			currentBatter = 'Ready to play!';
		} catch (error) {
			currentBatter = 'Error: ' + (error as Error).message;
			currentPitcher = 'See console for details';
		}
	});

	function updateFromEngine() {
		if (!engine) return;

		const state = engine.getState();

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

		runners = [
			state.bases[0] !== null,
			state.bases[1] !== null,
			state.bases[2] !== null,
		];

		plays = state.plays.map((p) => p.description);

		if (state.plays.length > 0) {
			const lastPlay = state.plays[0];
			currentBatter = lastPlay.batterName;
			currentPitcher = lastPlay.pitcherName;
		}

		// Update lineup displays
		awayLineupDisplay = state.awayLineup.players.map((slot, i) => ({
			name: slot.playerId && season?.batters[slot.playerId]
				? season.batters[slot.playerId].name
				: 'Unknown',
			isCurrent: i === state.awayLineup.currentBatterIndex
		}));

		homeLineupDisplay = state.homeLineup.players.map((slot, i) => ({
			name: slot.playerId && season?.batters[slot.playerId]
				? season.batters[slot.playerId].name
				: 'Unknown',
			isCurrent: i === state.homeLineup.currentBatterIndex
		}));
	}

	function simulatePA() {
		if (!engine) return;
		const play = engine.simulatePlateAppearance();
		updateFromEngine();
		if (engine.isComplete()) {
			gameComplete = true;
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
		while (!engine.isComplete()) {
			engine.simulatePlateAppearance();
		}
		updateFromEngine();
		gameComplete = true;
	}

	// Calculate game stats for summary
	function getGameStats() {
		if (!engine) return null;
		const state = engine.getState();

		let totalPlays = state.plays.length;
		let hits = 0;
		let homeHits = 0;
		let awayHits = 0;
		let homeAtBats = 0;
		let awayAtBats = 0;
		let homeRuns = 0;
		let awayRuns = 0;

		for (const play of state.plays) {
			const isHit = ['single', 'double', 'triple', 'homeRun'].includes(play.outcome);
			if (isHit) {
				hits++;
				if (play.isTopInning) {
					awayHits++;
				} else {
					homeHits++;
				}
			}
			// Approximate at-bats (each play is one at-bat)
			if (play.isTopInning) {
				awayAtBats++;
			} else {
				homeAtBats++;
			}
			homeRuns += play.runsScored;
		}
		awayRuns = awayScore;

		return { totalPlays, hits, homeHits, awayHits, homeAtBats, awayAtBats, homeRuns, awayRuns };
	}

	function playAgain() {
		gameComplete = false;
		plays = [];
		awayScore = 0;
		homeScore = 0;
		inning = 1;
		isTopInning = true;
		outs = 0;
		balls = 0;
		strikes = 0;
		runners = [false, false, false];
		currentBatter = 'Ready to play!';
		currentPitcher = 'Loading...';

		if (engine) {
			const state = engine.getState();
			// Reuse the same engine but reset would require creating a new one
			// For now, let's just navigate to refresh
		}
		window.location.reload();
	}

	// Helper for count display
	function countDisplay(balls: number, strikes: number) {
		const dots = [];
		for (let i = 0; i < 3; i++) dots.push({ type: 'ball', active: i < balls });
		for (let i = 0; i < 2; i++) dots.push({ type: 'strike', active: i < strikes });
		return dots;
	}
</script>

<svelte:head>
	<title>Game - Baseball Sim</title>
</svelte:head>

<div class="h-screen flex flex-col bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
	<!-- Header / Scoreboard -->
	<header class="flex-shrink-0 bg-slate-950/50 border-b border-slate-700/50">
		<div class="flex items-center justify-between px-6 py-3">
			<!-- Back Link -->
			<a href="/" class="text-slate-400 hover:text-white transition-colors flex items-center gap-2">
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
				</svg>
				<span class="text-sm font-medium">Home</span>
			</a>

			<!-- Game Info -->
			<div class="flex items-center gap-6 text-sm text-slate-400">
				<span>1976 Season</span>
				<span class="text-slate-600">|</span>
				<span>Reds vs Astros</span>
			</div>
		</div>

		<!-- Main Scoreboard -->
		<div class="px-6 pb-4">
			<div class="bg-slate-950/70 rounded-xl p-4 backdrop-blur-sm border border-slate-700/30">
				<div class="flex items-center justify-between">
					<!-- Away Team -->
					<div class="flex-1 text-center">
						<div class="text-xs text-slate-400 uppercase tracking-wider mb-1">Away</div>
						<div class="text-4xl font-bold tabular-nums">{awayScore}</div>
					</div>

					<!-- Inning & Game State -->
					<div class="flex-1 text-center">
						<div class="inline-flex items-center gap-2 bg-slate-800/50 rounded-lg px-4 py-2">
							<div class="text-center">
								<div class="text-xs text-slate-400 uppercase tracking-wider">Inning</div>
								<div class="text-xl font-semibold">
									{isTopInning ? '▲' : '▼'} {inning}
								</div>
							</div>
							<div class="w-px h-8 bg-slate-700"></div>
							<div class="text-center">
								<div class="text-xs text-slate-400 uppercase tracking-wider">Outs</div>
								<div class="text-xl font-semibold">{outs}</div>
							</div>
						</div>
					</div>

					<!-- Home Team -->
					<div class="flex-1 text-center">
						<div class="text-xs text-slate-400 uppercase tracking-wider mb-1">Home</div>
						<div class="text-4xl font-bold tabular-nums">{homeScore}</div>
					</div>
				</div>
			</div>
		</div>
	</header>

	<!-- Main Content -->
	<main class="flex-1 flex overflow-hidden">
		<!-- Left Section: Field + Matchup -->
		<div class="flex-1 flex flex-col p-6 gap-6 overflow-y-auto">
			<!-- Field Display -->
			<div class="flex items-center justify-center" style="max-height: 50vh;">
				<div class="relative w-full max-w-2xl aspect-square">
					<!-- Field SVG -->
					<svg viewBox="0 0 400 400" class="w-full h-full drop-shadow-2xl">
						<!-- Outfield grass -->
						<rect x="0" y="0" width="400" height="400" fill="#1a472a" rx="20" />

						<!-- Infield grass (lighter) -->
						<circle cx="200" cy="200" r="140" fill="#1e5a33" opacity="0.5" />

						<!-- Infield dirt -->
						<polygon
							points="200,60 340,200 200,340 60,200"
							fill="#8B4513"
							opacity="0.6"
						/>

						<!-- Base paths -->
						<polygon
							points="200,60 340,200 200,340 60,200"
							fill="none"
							stroke="rgba(255,255,255,0.2)"
							stroke-width="3"
						/>

						<!-- Pitcher's mound -->
						<circle cx="200" cy="200" r="15" fill="#8B4513" opacity="0.8" />
						<circle cx="200" cy="200" r="8" fill="#654321" />

						<!-- Home plate -->
						<polygon points="200,185 208,192 208,200 200,208 192,200 192,192" fill="white" />

						<!-- First base -->
						<rect x="330" y="192" width="20" height="20" fill={runners[0] ? '#fbbf24' : 'white'} rx="2" />
						{#if runners[0]}
							<circle cx="340" cy="182" r="12" fill="#fbbf24" opacity="0.8" />
						{/if}

						<!-- Second base -->
						<rect x="190" y="50" width="20" height="20" fill={runners[1] ? '#fbbf24' : 'white'} rx="2" />
						{#if runners[1]}
							<circle cx="200" cy="40" r="12" fill="#fbbf24" opacity="0.8" />
						{/if}

						<!-- Third base -->
						<rect x="50" y="192" width="20" height="20" fill={runners[2] ? '#fbbf24' : 'white'} rx="2" />
						{#if runners[2]}
							<circle cx="60" cy="182" r="12" fill="#fbbf24" opacity="0.8" />
						{/if}

						<!-- Foul lines -->
						<line x1="60" y1="200" x2="0" y2="140" stroke="rgba(255,255,255,0.15)" stroke-width="2" />
						<line x1="340" y1="200" x2="400" y2="140" stroke="rgba(255,255,255,0.15)" stroke-width="2" />
					</svg>

					<!-- Count Overlay -->
					<div class="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-6">
						<!-- Balls -->
						<div class="flex items-center gap-2">
							<span class="text-xs text-slate-300 uppercase tracking-wider font-medium">Balls</span>
							<div class="flex gap-2">
								{#each [0,1,2] as i}
									<div class="w-4 h-4 rounded-full {i < balls
										? 'bg-emerald-500 shadow-lg shadow-emerald-500/50'
										: 'bg-slate-700 border-2 border-slate-500'}"></div>
								{/each}
							</div>
						</div>

						<!-- Strikes -->
						<div class="flex items-center gap-2">
							<span class="text-xs text-slate-300 uppercase tracking-wider font-medium">Strikes</span>
							<div class="flex gap-2">
								{#each [0,1] as i}
									<div class="w-4 h-4 rounded-full {i < strikes
										? 'bg-red-500 shadow-lg shadow-red-500/50'
										: 'bg-slate-700 border-2 border-slate-500'}"></div>
								{/each}
							</div>
						</div>
					</div>
				</div>
			</div>

			<!-- Current Matchup -->
			<div class="flex-shrink-0">
				<div class="bg-slate-950/50 rounded-xl p-4 backdrop-blur-sm border border-slate-700/30">
					<div class="text-xs text-slate-400 uppercase tracking-wider mb-3">Current Matchup</div>
					<div class="flex items-center justify-between">
						<div class="flex-1">
							<div class="text-xs text-slate-500 mb-1">Batter</div>
							<div class="font-medium text-lg">{currentBatter}</div>
						</div>
						<div class="text-2xl text-slate-600 mx-4">vs</div>
						<div class="flex-1 text-right">
							<div class="text-xs text-slate-500 mb-1">Pitcher</div>
							<div class="font-medium text-lg">{currentPitcher}</div>
						</div>
					</div>
				</div>
			</div>

			<!-- Lineups -->
			<div class="flex-shrink-0 grid grid-cols-2 gap-4">
				<!-- Away Lineup -->
				<div class="bg-slate-950/50 rounded-xl p-4 backdrop-blur-sm border border-slate-700/30">
					<div class="text-xs text-slate-400 uppercase tracking-wider mb-3">Away Lineup</div>
					<div class="space-y-1">
						{#each awayLineupDisplay as player, i}
							<div class="flex items-center gap-2 py-1 px-2 rounded {player.isCurrent
								? 'bg-blue-600/30 border border-blue-500/50'
								: ''}">
								<span class="text-xs w-4 text-slate-500">{i + 1}</span>
								<span class="text-sm {player.isCurrent
									? 'text-white font-medium'
									: 'text-slate-300'}">{player.name}</span>
								{#if player.isCurrent}
									<span class="ml-auto text-xs text-blue-400"> batting</span>
								{/if}
							</div>
						{/each}
					</div>
				</div>

				<!-- Home Lineup -->
				<div class="bg-slate-950/50 rounded-xl p-4 backdrop-blur-sm border border-slate-700/30">
					<div class="text-xs text-slate-400 uppercase tracking-wider mb-3">Home Lineup</div>
					<div class="space-y-1">
						{#each homeLineupDisplay as player, i}
							<div class="flex items-center gap-2 py-1 px-2 rounded {player.isCurrent
								? 'bg-blue-600/30 border border-blue-500/50'
								: ''}">
								<span class="text-xs w-4 text-slate-500">{i + 1}</span>
								<span class="text-sm {player.isCurrent
									? 'text-white font-medium'
									: 'text-slate-300'}">{player.name}</span>
								{#if player.isCurrent}
									<span class="ml-auto text-xs text-blue-400"> batting</span>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			</div>
		</div>

		<!-- Right Section: Play-by-Play + Controls -->
		<div class="w-96 flex-shrink-0 flex flex-col p-6 gap-6 overflow-hidden bg-slate-950/30 border-l border-slate-700/30">
			<!-- Play-by-Play Feed -->
			<div class="flex-1 flex flex-col overflow-hidden">
				<div class="text-xs text-slate-400 uppercase tracking-wider mb-3">Play-by-Play</div>
				<div class="flex-1 overflow-y-auto space-y-2 pr-2">
					{#each plays as play, index}
						<div class="bg-slate-800/50 rounded-lg px-3 py-2 border border-slate-700/30">
							<div class="flex items-start gap-2">
								<span class="text-xs text-slate-500 mt-0.5">{plays.length - index}</span>
								<p class="text-sm text-slate-300">{play}</p>
							</div>
						</div>
					{:else}
						<div class="text-sm text-slate-500 text-center py-8">Game starting...</div>
					{/each}
				</div>
			</div>

			<!-- Controls -->
			<div class="flex-shrink-0 space-y-3">
				<div class="text-xs text-slate-400 uppercase tracking-wider">Controls</div>

				<!-- Primary Buttons -->
				<div class="grid grid-cols-2 gap-2">
					<button
						onclick={simulatePA}
						class="px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
						disabled={!engine}
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
						</svg>
						Next PA
					</button>
					<button
						onclick={toggleAutoPlay}
						class="px-4 py-3 {autoPlay
							? 'bg-amber-600 hover:bg-amber-500'
							: 'bg-emerald-600 hover:bg-emerald-500'} text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
						disabled={!engine}
					>
						{#if autoPlay}
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
							</svg>
							Pause
						{:else}
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
							</svg>
							Auto Play
						{/if}
					</button>
				</div>

				<button
					onclick={quickSim}
					class="w-full px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
					disabled={!engine}
				>
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
					</svg>
					Quick Sim Full Game
				</button>

				<!-- Speed Control -->
				<div class="bg-slate-800/50 rounded-lg p-3 border border-slate-700/30">
					<div class="flex items-center justify-between mb-2">
						<span class="text-xs text-slate-400">Sim Speed</span>
						<span class="text-xs text-slate-500">{simSpeed}ms</span>
					</div>
					<input
						type="range"
						min="200"
						max="2000"
						step="100"
						bind:value={simSpeed}
						class="w-full accent-blue-500"
					/>
				</div>
			</div>
		</div>
	</main>

	<!-- Game Completion Overlay -->
	{#if gameComplete}
		<div class="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
			<div class="bg-slate-900 rounded-2xl p-8 max-w-lg w-full mx-4 border border-slate-700 shadow-2xl">
				<div class="text-center">
					<div class="text-4xl font-bold mb-2">🎉 GAME OVER</div>
					<div class="text-slate-400 mb-6">1976 Season - Reds vs Astros</div>

					<!-- Final Score -->
					<div class="flex items-center justify-center gap-8 mb-6">
						<div class="text-center">
							<div class="text-xs text-slate-400 uppercase tracking-wider mb-1">Away</div>
							<div class="text-5xl font-bold">{awayScore}</div>
						</div>
						<div class="text-2xl text-slate-500">-</div>
						<div class="text-center">
							<div class="text-xs text-slate-400 uppercase tracking-wider mb-1">Home</div>
							<div class="text-5xl font-bold">{homeScore}</div>
						</div>
					</div>

					<!-- Winner Text -->
					<div class="text-xl mb-6">
						{#if awayScore > homeScore}
							<span class="text-slate-300">Away team wins by </span>
							<span class="font-bold text-white">{awayScore - homeScore}</span>
						{:else if homeScore > awayScore}
							<span class="text-slate-300">Home team wins by </span>
							<span class="font-bold text-white">{homeScore - awayScore}</span>
						{:else}
							<span class="text-yellow-400 font-semibold">It's a tie!</span>
						{/if}
					</div>

					<!-- Stats -->
					{#if getGameStats()}
						{@const stats = getGameStats()}
						<div class="bg-slate-800/50 rounded-lg p-4 mb-6 text-left">
							<div class="grid grid-cols-2 gap-4 text-sm">
								<div>
									<div class="text-slate-400">Total Plays</div>
									<div class="text-lg font-semibold">{stats.totalPlays}</div>
								</div>
								<div>
									<div class="text-slate-400">Total Hits</div>
									<div class="text-lg font-semibold">{stats.hits}</div>
								</div>
								<div>
									<div class="text-slate-400">Away</div>
									<div class="text-lg font-semibold">{stats.awayHits} for {stats.awayAtBats} AB</div>
								</div>
								<div>
									<div class="text-slate-400">Home</div>
									<div class="text-lg font-semibold">{stats.homeHits} for {stats.homeAtBats} AB</div>
								</div>
							</div>
						</div>
					{/if}

					<!-- Play Again Button -->
					<button
						onclick={playAgain}
						class="w-full px-6 py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
					>
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 6m0 0H6m1.5 0h1.5m-7-1.5v.083a8.001 8.001 0 1114.915 0" />
						</svg>
						Play Again
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
