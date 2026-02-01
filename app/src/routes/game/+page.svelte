<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { MatchupModel } from '@bb/model';
	import { loadSeason } from '$lib/game/season-loader.js';
	import { GameEngine } from '$lib/game/engine.js';
	import type { GameState, PlayEvent } from '$lib/game/types.js';

	// Constants for localStorage
	const STORAGE_KEY = 'baseball-game-state';
	const PREFS_KEY = 'baseball-game-prefs';
	const SAVE_VERSION = 2; // Increment when save format changes to invalidate old saves

	// Game state
	let awayScore = $state(0);
	let homeScore = $state(0);
	let inning = $state(1);
	let isTopInning = $state(true);
	let outs = $state(0);

	let runners = $state([false, false, false]); // 1B, 2B, 3B
	let plays = $state<PlayEvent[]>([]);
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

	// Toast state
	let toast = $state<{ message: string; visible: boolean }>({ message: '', visible: false });

	// Play-by-play modal state
	let showPlayByPlay = $state(false);

	// Show toast message
	function showToast(message: string) {
		toast = { message, visible: true };
		setTimeout(() => {
			toast.visible = false;
		}, 3000);
	}

	// Load preferences from localStorage
	function loadPrefs() {
		if (!browser) return { simSpeed: 1000 };
		try {
			const stored = localStorage.getItem(PREFS_KEY);
			if (stored) {
				return JSON.parse(stored);
			}
		} catch {
			// Ignore storage errors
		}
		return { simSpeed: 1000 };
	}

	// Save preferences to localStorage
	function savePrefs() {
		if (!browser) return;
		try {
			localStorage.setItem(PREFS_KEY, JSON.stringify({ simSpeed }));
		} catch {
			// Ignore storage errors
		}
	}

	// Save game state to localStorage
	function saveGameState() {
		if (!browser || !engine) return;
		try {
			const saveData = JSON.stringify({ version: SAVE_VERSION, state: engine.serialize() });
			localStorage.setItem(STORAGE_KEY, saveData);
		} catch {
			// Ignore storage errors
		}
	}

	// Clear saved game state
	function clearGameState() {
		if (!browser) return;
		try {
			localStorage.removeItem(STORAGE_KEY);
		} catch {
			// Ignore storage errors
		}
	}

	// Load game state from localStorage
	async function loadGameState() {
		if (!browser) return null;
		try {
			const stored = localStorage.getItem(STORAGE_KEY);
			if (stored) {
				const parsed = JSON.parse(stored);
				// Check version - if old format or different version, clear and return null
				if (!parsed.version || parsed.version !== SAVE_VERSION) {
					clearGameState();
					return null;
				}
				return parsed.state;
			}
		} catch {
			// Ignore storage errors
		}
		return null;
	}

	onMount(async () => {
		// Load preferences first
		const prefs = loadPrefs();
		simSpeed = prefs.simSpeed;

		try {
			season = await loadSeason(1976);

			// Try to restore from saved state
			const savedState = await loadGameState();
			if (savedState) {
				// Restore the game engine from saved state
				engine = GameEngine.restore(savedState, season);
				showToast('Game restored!');
			} else {
				// Start a new game
				engine = new GameEngine(season, 'CIN', 'HOU');
			}

			updateFromEngine();

			// Save state on visibility change (user leaves/returns to tab)
			if (browser) {
				const handleVisibilityChange = () => {
					if (document.hidden) {
						// Save state when user leaves the tab
						saveGameState();
					}
				};
				document.addEventListener('visibilitychange', handleVisibilityChange);

				// Save state before page unload
				const handleBeforeUnload = () => {
					saveGameState();
				};
				window.addEventListener('beforeunload', handleBeforeUnload);

				// Cleanup listeners on unmount
				return () => {
					document.removeEventListener('visibilitychange', handleVisibilityChange);
					window.removeEventListener('beforeunload', handleBeforeUnload);
				};
			}
		} catch (error) {
			currentBatter = 'Error: ' + (error as Error).message;
			currentPitcher = 'See console for details';
		}
	});

	// Auto-save game state whenever the engine state changes
	$effect(() => {
		if (engine) {
			// Save state after any change
			saveGameState();
		}
	});

	// Auto-save preferences whenever simSpeed changes
	$effect(() => {
		savePrefs();
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

		runners = [
			state.bases[0] !== null,
			state.bases[1] !== null,
			state.bases[2] !== null,
		];

		plays = state.plays;

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
		// Clear the saved game state
		clearGameState();

		// Reset all state variables
		gameComplete = false;
		plays = [];
		awayScore = 0;
		homeScore = 0;
		inning = 1;
		isTopInning = true;
		outs = 0;
		runners = [false, false, false];
		currentBatter = 'Ready to play!';
		currentPitcher = 'Loading...';

		// Create a new game engine
		if (season) {
			engine = new GameEngine(season, 'CIN', 'HOU');
			updateFromEngine();
		}
	}

	// Format runner info for play-by-play display
	// Only shows runner info if there are scorers (walk-offs or runs scored)
	function formatRunnerInfo(play: PlayEvent): string | null {
		// Only show runner info if there are scorers
		if (!play.scorerIds || play.scorerIds.length === 0) {
			return null;
		}

		const parts: string[] = [];
		const bases = ['1st', '2nd', '3rd'];

		// Add runners on base (only when there are scorers)
		if (play.runnersAfter) {
			for (let i = 0; i < 3; i++) {
				const runnerId = play.runnersAfter[i];
				if (runnerId && season?.batters[runnerId]) {
					const name = season.batters[runnerId].name;
					const formattedName = formatName(name);

					// Check if runner advanced from another base
					let advancedFrom = -1;
					if (play.runnersBefore) {
						for (let j = 0; j < 3; j++) {
							if (play.runnersBefore[j] === runnerId) {
								advancedFrom = j;
								break;
							}
						}
					}

					// If runner advanced, use "to"; otherwise just show position
					if (advancedFrom !== -1 && advancedFrom !== i) {
						parts.push(`${formattedName} to ${bases[i]}`);
					} else {
						parts.push(`${formattedName} ${bases[i]}`);
					}
				}
			}
		}

		// Add scorers
		const scorerNames = play.scorerIds
			.map((id) => season?.batters[id]?.name)
			.filter(Boolean)
			.map((name) => formatName(name!));

		if (scorerNames.length === 1) {
			parts.push(`${scorerNames[0]} scores`);
		} else {
			parts.push(`${scorerNames.join(', ')} score`);
		}

		return parts.length > 0 ? parts.join(', ') : null;
	}

	// Format name from "Last, First" to "First Last"
	function formatName(name: string): string {
		const commaIndex = name.indexOf(',');
		if (commaIndex === -1) return name;
		return `${name.slice(commaIndex + 1).trim()} ${name.slice(0, commaIndex).trim()}`;
	}
</script>

<svelte:head>
	<title>Game - Baseball Sim</title>
</svelte:head>

<div class="min-h-screen flex flex-col bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
	<!-- Header -->
	<header class="flex-shrink-0 bg-slate-950/50 border-b border-slate-700/50">
		<div class="flex items-center justify-between px-3 sm:px-6 py-2 sm:py-3 gap-2">
			<!-- Back Link -->
			<a href="/" class="text-slate-400 hover:text-white transition-colors flex items-center gap-1 sm:gap-2">
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
				</svg>
				<span class="text-xs sm:text-sm font-medium hidden sm:inline">Home</span>
			</a>

			<!-- Game Info -->
			<div class="flex items-center gap-2 sm:gap-4 text-xs sm:text-sm text-slate-400">
				<span>1976 Season</span>
				<span class="text-slate-600">|</span>
				<span>Reds vs Astros</span>
			</div>
		</div>
	</header>

	<!-- Main Content -->
	<main class="flex-1 flex flex-col lg:flex-row overflow-hidden">
		<!-- Left Section: Field + Matchup -->
		<div class="flex-1 flex flex-col p-3 sm:p-4 lg:p-6 gap-3 sm:gap-4 lg:gap-6 overflow-y-auto">
			<!-- Field Display -->
			<div class="flex items-center justify-center">
				<div class="relative w-full max-w-xl aspect-square">
					<!-- Field SVG with embedded scoreboard -->
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

						<!-- === Scoreboard on Field === -->

						<!-- Away Score (top left) -->
						<text x="25" y="35" fill="white" font-size="28" font-weight="bold" text-anchor="start">{awayScore}</text>
						<text x="25" y="50" fill="rgba(255,255,255,0.6)" font-size="11" text-anchor="start" font-weight="500">AWAY</text>

						<!-- Home Score (top right) -->
						<text x="375" y="35" fill="white" font-size="28" font-weight="bold" text-anchor="end">{homeScore}</text>
						<text x="375" y="50" fill="rgba(255,255,255,0.6)" font-size="11" text-anchor="end" font-weight="500">HOME</text>

						<!-- Pitcher Name (above mound) -->
						<text x="200" y="165" fill="white" font-size="13" text-anchor="middle" font-weight="500">{currentPitcher}</text>

						<!-- Batter Name (below home plate) -->
						<text x="200" y="235" fill="white" font-size="13" text-anchor="middle" font-weight="500">{currentBatter}</text>

						<!-- Inning (bottom left) -->
						<text x="25" y="375" fill="white" font-size="18" font-weight="bold" text-anchor="start">{isTopInning ? '▲' : '▼'} {inning}</text>
						<text x="25" y="388" fill="rgba(255,255,255,0.6)" font-size="10" text-anchor="start" font-weight="500">INNING</text>

						<!-- Outs (bottom right) - using dot display -->
						<g transform="translate(348, 368)">
							<text x="27" y="-5" fill="rgba(255,255,255,0.6)" font-size="10" text-anchor="middle" font-weight="600">OUTS</text>
							{#each [0,1,2] as i}
								<circle cx="{i * 18}" cy="8" r="6" fill={i < outs ? '#f59e0b' : 'rgba(255,255,255,0.2)'} />
							{/each}
						</g>
					</svg>
				</div>
			</div>

			<!-- Lineups -->
			<div class="flex-shrink-0 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
				<!-- Away Lineup -->
				<div class="bg-slate-950/50 rounded-xl p-3 sm:p-4 backdrop-blur-sm border border-slate-700/30">
					<div class="text-[10px] sm:text-xs text-slate-400 uppercase tracking-wider mb-2 sm:mb-3">Away Lineup</div>
					<div class="space-y-1">
						{#each awayLineupDisplay as player, i}
							<div class="flex items-center gap-2 py-1 px-2 rounded {player.isCurrent
								? 'bg-blue-600/30 border border-blue-500/50'
								: ''}">
								<span class="text-[10px] sm:text-xs w-4 text-slate-500">{i + 1}</span>
								<span class="text-xs sm:text-sm {player.isCurrent
									? 'text-white font-medium'
									: 'text-slate-300'} truncate">{player.name}</span>
								{#if player.isCurrent}
									<span class="ml-auto text-[10px] sm:text-xs text-blue-400 hidden sm:inline"> batting</span>
								{/if}
							</div>
						{/each}
					</div>
				</div>

				<!-- Home Lineup -->
				<div class="bg-slate-950/50 rounded-xl p-3 sm:p-4 backdrop-blur-sm border border-slate-700/30">
					<div class="text-[10px] sm:text-xs text-slate-400 uppercase tracking-wider mb-2 sm:mb-3">Home Lineup</div>
					<div class="space-y-1">
						{#each homeLineupDisplay as player, i}
							<div class="flex items-center gap-2 py-1 px-2 rounded {player.isCurrent
								? 'bg-blue-600/30 border border-blue-500/50'
								: ''}">
								<span class="text-[10px] sm:text-xs w-4 text-slate-500">{i + 1}</span>
								<span class="text-xs sm:text-sm {player.isCurrent
									? 'text-white font-medium'
									: 'text-slate-300'} truncate">{player.name}</span>
								{#if player.isCurrent}
									<span class="ml-auto text-[10px] sm:text-xs text-blue-400 hidden sm:inline"> batting</span>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			</div>
		</div>

		<!-- Right Section: Play-by-Play + Controls -->
		<div class="w-full lg:w-96 flex-shrink-0 flex flex-col p-3 sm:p-4 lg:p-6 gap-3 sm:gap-4 lg:gap-6 overflow-y-auto lg:overflow-hidden bg-slate-950/30 border-t lg:border-t-0 lg:border-l border-slate-700/30 max-h-[50vh] lg:max-h-none">
			<!-- Play-by-Play Feed -->
			<div class="flex-1 flex flex-col overflow-hidden">
				<div class="text-[10px] sm:text-xs text-slate-400 uppercase tracking-wider mb-2 sm:mb-3">Play-by-Play</div>
				{#if plays.length > 0}
					<div class="flex-1 overflow-y-auto space-y-1.5 sm:space-y-2 pr-1 sm:pr-2" style="max-height: 200px; lg:max-height: none;">
						{#each plays.slice(0, 10) as play, index}
							{@const playNumber = plays.slice(0, index).filter(p => !p.isSummary).length + 1}
							{@const runnerInfo = formatRunnerInfo(play)}
							<div class="rounded-lg px-2 sm:px-3 py-1.5 sm:py-2 border {play.isSummary
								? 'bg-amber-900/30 border-amber-700/40'
								: 'bg-slate-800/50 border-slate-700/30'}">
								<div class="flex items-start gap-1.5 sm:gap-2">
									{#if !play.isSummary}
										<span class="text-[10px] sm:text-xs text-slate-500 mt-0.5">{playNumber}</span>
									{/if}
									<p class="text-xs sm:text-sm {play.isSummary
										? 'text-amber-200 font-medium'
										: 'text-slate-300'}">{play.description}</p>
								</div>
							</div>
							{#if runnerInfo && !play.isSummary}
								<div class="pl-4 sm:pl-6 pr-2 sm:pr-3 py-1 text-xs text-slate-400 italic">
									{runnerInfo}
								</div>
							{/if}
						{/each}
					</div>
				{:else}
					<div class="flex-1 flex items-center justify-center">
						<div class="text-xs sm:text-sm text-slate-500 text-center py-4 sm:py-8">Game starting...</div>
					</div>
				{/if}
			</div>

			<!-- Controls -->
			<div class="flex-shrink-0 space-y-2 sm:space-y-3">
				<div class="text-[10px] sm:text-xs text-slate-400 uppercase tracking-wider">Controls</div>

				<!-- Primary Buttons -->
				<div class="grid grid-cols-2 gap-2">
					<button
						onclick={simulatePA}
						class="px-3 py-2 sm:px-4 sm:py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 sm:gap-2 text-sm sm:text-base"
						disabled={!engine}
					>
						<svg class="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
						</svg>
						<span class="hidden sm:inline">Next PA</span>
						<span class="sm:hidden">Next</span>
					</button>
					<button
						onclick={toggleAutoPlay}
						class="px-3 py-2 sm:px-4 sm:py-3 {autoPlay
							? 'bg-amber-600 hover:bg-amber-500'
							: 'bg-emerald-600 hover:bg-emerald-500'} text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 sm:gap-2 text-sm sm:text-base"
						disabled={!engine}
					>
						{#if autoPlay}
							<svg class="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
							</svg>
							<span class="hidden sm:inline">Pause</span>
							<span class="sm:hidden">||</span>
						{:else}
							<svg class="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
							</svg>
							<span class="hidden sm:inline">Auto</span>
							<span class="sm:hidden">▶</span>
						{/if}
					</button>
				</div>

				<button
					onclick={quickSim}
					class="w-full px-3 py-2 sm:px-4 sm:py-3 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 sm:gap-2 text-sm sm:text-base"
					disabled={!engine}
				>
					<svg class="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
					</svg>
					<span class="hidden sm:inline">Quick Sim Full Game</span>
					<span class="sm:hidden">Quick Sim</span>
				</button>

				<!-- Speed Control -->
				<div class="bg-slate-800/50 rounded-lg p-2 sm:p-3 border border-slate-700/30">
					<div class="flex items-center justify-between mb-1.5 sm:mb-2">
						<span class="text-[10px] sm:text-xs text-slate-400">Sim Speed</span>
						<span class="text-[10px] sm:text-xs text-slate-500">{simSpeed}ms</span>
					</div>
					<input
						type="range"
						min="200"
						max="2000"
						step="100"
						bind:value={simSpeed}
						class="w-full accent-blue-500 h-1.5 sm:h-2"
					/>
				</div>
			</div>
		</div>
	</main>

	<!-- Game Completion Overlay -->
	{#if gameComplete}
		<div class="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
			<div class="bg-slate-900 rounded-xl sm:rounded-2xl p-4 sm:p-6 lg:p-8 max-w-lg w-full mx-0 sm:mx-4 border border-slate-700 shadow-2xl">
				<div class="text-center">
					<div class="text-2xl sm:text-3xl lg:text-4xl font-bold mb-1 sm:mb-2">🎉 GAME OVER</div>
					<div class="text-xs sm:text-sm lg:text-base text-slate-400 mb-2 sm:mb-3 lg:mb-4">1976 Season - Reds vs Astros</div>
					<div class="text-sm font-medium text-emerald-400 mb-3 sm:mb-4 lg:mb-6">
						{inning} {inning === 1 ? 'inning' : 'innings'}
					</div>

					<!-- Final Score -->
					<div class="flex items-center justify-center gap-4 sm:gap-6 lg:gap-8 mb-4 sm:mb-5 lg:mb-6">
						<div class="text-center">
							<div class="text-[10px] sm:text-xs text-slate-400 uppercase tracking-wider mb-1">Away</div>
							<div class="text-3xl sm:text-4xl lg:text-5xl font-bold">{awayScore}</div>
						</div>
						<div class="text-xl sm:text-2xl text-slate-500">-</div>
						<div class="text-center">
							<div class="text-[10px] sm:text-xs text-slate-400 uppercase tracking-wider mb-1">Home</div>
							<div class="text-3xl sm:text-4xl lg:text-5xl font-bold">{homeScore}</div>
						</div>
					</div>

					<!-- Winner Text -->
					<div class="text-base sm:text-lg lg:text-xl mb-4 sm:mb-5 lg:mb-6">
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
						<div class="bg-slate-800/50 rounded-lg p-3 sm:p-4 mb-4 sm:mb-5 lg:mb-6 text-left">
							<div class="grid grid-cols-2 gap-2 sm:gap-3 lg:gap-4 text-xs sm:text-sm">
								<div>
									<div class="text-slate-400">Total Plays</div>
									<div class="text-base sm:text-lg font-semibold">{stats.totalPlays}</div>
								</div>
								<div>
									<div class="text-slate-400">Total Hits</div>
									<div class="text-base sm:text-lg font-semibold">{stats.hits}</div>
								</div>
								<div>
									<div class="text-slate-400">Away</div>
									<div class="text-base sm:text-lg font-semibold">{stats.awayHits} for {stats.awayAtBats} AB</div>
								</div>
								<div>
									<div class="text-slate-400">Home</div>
									<div class="text-base sm:text-lg font-semibold">{stats.homeHits} for {stats.homeAtBats} AB</div>
								</div>
							</div>
						</div>
					{/if}

					<!-- View Play-by-Play Button -->
					<button
						onclick={() => showPlayByPlay = true}
						class="w-full px-4 py-3 sm:px-6 sm:py-4 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 text-sm sm:text-base mb-2 sm:mb-3"
					>
						<svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
						</svg>
						View Play-by-Play
					</button>

					<!-- Play Again Button -->
					<button
						onclick={playAgain}
						class="w-full px-4 py-3 sm:px-6 sm:py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 text-sm sm:text-base"
					>
						<svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 6m0 0H6m1.5 0h1.5m-7-1.5v.083a8.001 8.001 0 1114.915 0" />
						</svg>
						Play Again
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Play-by-Play Modal -->
	{#if showPlayByPlay}
		<div class="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4">
			<div class="bg-slate-900 rounded-xl sm:rounded-2xl p-4 sm:p-6 lg:p-8 max-w-2xl w-full mx-0 sm:mx-4 border border-slate-700 shadow-2xl max-h-[80vh] flex flex-col">
				<div class="flex items-center justify-between mb-4">
					<h2 class="text-xl sm:text-2xl font-bold">Play-by-Play</h2>
					<button
						onclick={() => showPlayByPlay = false}
						class="text-slate-400 hover:text-white transition-colors p-1 hover:bg-slate-800 rounded"
					>
						<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>

				{#if plays.length > 0}
					<div class="flex-1 overflow-y-auto space-y-2 pr-2">
						{#each plays.slice().reverse() as play, index}
							{@const reversedPlays = plays.slice().reverse()}
							{@const playNumber = reversedPlays.slice(0, index).filter(p => !p.isSummary).length + 1}
							{@const runnerInfo = formatRunnerInfo(play)}
							<div class="rounded-lg px-3 sm:px-4 py-2 sm:py-3 border {play.isSummary
								? 'bg-amber-900/30 border-amber-700/40'
								: 'bg-slate-800/50 border-slate-700/30'}">
								<div class="flex items-start gap-2 sm:gap-3">
									{#if !play.isSummary}
										<span class="text-xs sm:text-sm text-slate-500 mt-0.5 font-mono">{playNumber}</span>
									{/if}
									<p class="text-sm sm:text-base {play.isSummary
										? 'text-amber-200 font-medium'
										: 'text-slate-300'}">{play.description}</p>
								</div>
							</div>
							{#if runnerInfo && !play.isSummary}
								<div class="pl-7 sm:pl-10 pr-3 sm:pr-4 py-1 text-sm text-slate-400 italic">
									{runnerInfo}
								</div>
							{/if}
						{/each}
					</div>
				{:else}
					<div class="flex-1 flex items-center justify-center">
						<div class="text-sm sm:text-base text-slate-500 text-center py-8">No plays recorded</div>
					</div>
				{/if}

				<div class="flex-1 sm:flex-none">
					<button
						onclick={() => showPlayByPlay = false}
						class="w-full px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-lg transition-colors text-sm sm:text-base"
					>
						Close
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Toast Notification -->
	{#if toast.visible}
		<div class="fixed top-4 right-4 z-50 animate-slide-in">
			<div class="bg-slate-800 text-white px-4 py-3 rounded-lg shadow-lg border border-slate-700 flex items-center gap-2">
				<svg class="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
				</svg>
				<span class="text-sm font-medium">{toast.message}</span>
			</div>
		</div>
	{/if}
</div>

<style>
	@keyframes slide-in {
		from {
			transform: translateX(100%);
			opacity: 0;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}
	.animate-slide-in {
		animation: slide-in 0.3s ease-out;
	}
</style>
