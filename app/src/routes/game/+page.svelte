<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { MatchupModel } from '@bb/model';
	import { loadSeasonForGame } from '$lib/game/sqlite-season-loader.js';
	import { GameEngine } from '$lib/game/engine.js';
	import type { GameState, PlayEvent } from '$lib/game/types.js';
	import GameScoreboard from '$lib/components/GameScoreboard.svelte';
	import { tick } from 'svelte';
	import type { Series } from '$lib/game-results/index.js';

	import { formatNameFirstLast } from '$lib/utils/name-format.js';

	// Dynamic imports for browser-only game-results database
	let createSeries: typeof import('$lib/game-results/index.js').createSeries;
	let listSeries: typeof import('$lib/game-results/index.js').listSeries;
	let addTeamToSeries: typeof import('$lib/game-results/index.js').addTeamToSeries;
	let saveGameFromState: typeof import('$lib/game-results/index.js').saveGameFromState;

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

	let runnerIds = $state<[string | null, string | null, string | null]>([null, null, null]); // 1B, 2B, 3B runner IDs
	let runnerNames = $state<[string | null, string | null, string | null]>([null, null, null]); // 1B, 2B, 3B runner names
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
	let awayTeamId = $state<string | null>(null);
	let homeTeamId = $state<string | null>(null);
	let gameYear = $state<number>(1976);

	// Lineup display
	let awayLineupDisplay = $state<Array<{ name: string; isCurrent: boolean; position: string }>>([]);
	let homeLineupDisplay = $state<Array<{ name: string; isCurrent: boolean; position: string }>>([]);
	let awayPitcherDisplay = $state('Loading...');
	let homePitcherDisplay = $state('Loading...');

	// Toast state
	let toast = $state<{ message: string; visible: boolean }>({ message: '', visible: false });

	// Team display names (derived from season data and team IDs)
	const awayTeamName = $derived(
		awayTeamId && season?.teams[awayTeamId]
			? `${season.teams[awayTeamId].city} ${season.teams[awayTeamId].nickname}`
			: awayTeamId ?? 'Away'
	);
	const homeTeamName = $derived(
		homeTeamId && season?.teams[homeTeamId]
			? `${season.teams[homeTeamId].city} ${season.teams[homeTeamId].nickname}`
			: homeTeamId ?? 'Home'
	);


	// Play-by-play modal state
	let showPlayByPlay = $state(false);

	// Derived plays in reverse order (newest first)
	const reversedPlays = $derived([...plays].reverse());

	// Save to database state
	let showSeriesModal = $state(false);
	let availableSeries = $state<Series[]>([]);
	let selectedSeries = $state<Series | null>(null);
	let isSavingGame = $state(false);

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

	onMount(() => {
		(async () => {
			// Load game-results database functions (browser-only)
			const gameResults = await import('$lib/game-results/index.js');
			createSeries = gameResults.createSeries;
			listSeries = gameResults.listSeries;
			addTeamToSeries = gameResults.addTeamToSeries;
			saveGameFromState = gameResults.saveGameFromState;

			// Load preferences first
			const prefs = loadPrefs();
			simSpeed = prefs.simSpeed;

			// Read URL parameters
			const urlParams = $page.url.searchParams;
			const yearParam = urlParams.get('year');
			const awayParam = urlParams.get('away');
			const homeParam = urlParams.get('home');

			// Set game year (default to 1976 if not specified)
			gameYear = yearParam ? parseInt(yearParam, 10) : 1976;
			awayTeamId = awayParam;
			homeTeamId = homeParam;

			// Validate that we have team IDs
			if (!awayTeamId || !homeTeamId) {
				currentBatter = 'Missing team selection';
				currentPitcher = 'Please select teams from the home page';
				return;
			}

			try {
				season = await loadSeasonForGame(gameYear, awayTeamId, homeTeamId);

				// Validate that teams exist in the season
				if (!season.teams[awayTeamId]) {
					currentBatter = `Invalid away team: ${awayTeamId}`;
					currentPitcher = 'Please select a valid team from the home page';
					return;
				}
				if (!season.teams[homeTeamId]) {
					currentBatter = `Invalid home team: ${homeTeamId}`;
					currentPitcher = 'Please select a valid team from the home page';
					return;
				}

				// Try to restore from saved state
				const savedState = await loadGameState();
				if (savedState) {
					// Check if saved state matches current teams
					if (
						savedState.meta?.awayTeam === awayTeamId &&
						savedState.meta?.homeTeam === homeTeamId &&
						savedState.meta?.season === gameYear
					) {
						// Restore the game engine from saved state
						engine = GameEngine.restore(savedState, season);
						showToast('Game restored!');
					} else {
						// Saved state is for a different game, start fresh
						engine = new GameEngine(season, awayTeamId, homeTeamId);
					}
				} else {
					// Start a new game
					engine = new GameEngine(season, awayTeamId, homeTeamId);
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
			console.error('Game loading error:', error);
			currentBatter = 'Error: ' + (error instanceof Error ? error.message : String(error));
			currentPitcher = 'See console for details';
		}
		})();
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

	// Scroll play-by-play to bottom when new plays are added (show newest at bottom above controls)
	$effect(() => {
		plays.length; // Track plays length
		(async () => {
			await tick();
			const container = document.getElementById('play-by-play-container');
			if (container) {
				container.scrollTop = container.scrollHeight;
			}
		})();
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

		// Update runner IDs and names
		runnerIds = [state.bases[0], state.bases[1], state.bases[2]];
		runnerNames = [
			state.bases[0] && season?.batters[state.bases[0]] ? season.batters[state.bases[0]].name : null,
			state.bases[1] && season?.batters[state.bases[1]] ? season.batters[state.bases[1]].name : null,
			state.bases[2] && season?.batters[state.bases[2]] ? season.batters[state.bases[2]].name : null,
		];

		// Force reactivity by creating new array reference
		plays = [...state.plays];

		if (state.plays.length > 0) {
			const lastPlay = state.plays[0];
			currentBatter = lastPlay.batterName;
			currentPitcher = lastPlay.pitcherName;
		}

		// Helper function to get player name from either batters or pitchers
		function getPlayerName(playerId: string): string {
			if (season?.batters[playerId]) return season.batters[playerId].name;
			if (season?.pitchers[playerId]) return season.pitchers[playerId].name;
			return 'Unknown';
		}

		// Helper function to get player position for display
		// Uses slotPosition (the actual position they're playing in this game)
		// not the player's primaryPosition from the database
		function getPlayerPosition(playerId: string, slotPosition: number): string {
			// Use the slot position which is where they're actually playing
			return getPositionAbbrev(slotPosition);
		}

		// Update lineup displays
		awayLineupDisplay = state.awayLineup.players.map((slot, i) => ({
			name: slot.playerId ? formatNameFirstLast(getPlayerName(slot.playerId)) : 'Unknown',
			position: slot.playerId ? getPlayerPosition(slot.playerId, slot.position) : '?',
			isCurrent: i === state.awayLineup.currentBatterIndex
		}));

		homeLineupDisplay = state.homeLineup.players.map((slot, i) => ({
			name: slot.playerId ? formatNameFirstLast(getPlayerName(slot.playerId)) : 'Unknown',
			position: slot.playerId ? getPlayerPosition(slot.playerId, slot.position) : '?',
			isCurrent: i === state.homeLineup.currentBatterIndex
		}));

		// Update current pitchers for display
		// Show each team's own pitcher (away pitcher on left, home pitcher on right)
		const awayPitcherId = state.awayLineup.pitcher;
		const awayPitcher = awayPitcherId && season?.pitchers[awayPitcherId]
			? formatNameFirstLast(season.pitchers[awayPitcherId].name)
			: 'Unknown';

		const homePitcherId = state.homeLineup.pitcher;
		const homePitcher = homePitcherId && season?.pitchers[homePitcherId]
			? formatNameFirstLast(season.pitchers[homePitcherId].name)
			: 'Unknown';

		// Update display with pitcher info
		awayPitcherDisplay = awayPitcher;
		homePitcherDisplay = homePitcher;
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

		// Start a fresh game first
		playAgain();

		// Now simulate the full game
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
		runnerIds = [null, null, null];
		runnerNames = [null, null, null];
		currentBatter = 'Ready to play!';
		currentPitcher = 'Loading...';

		// Create a new game engine with current teams
		if (season && awayTeamId && homeTeamId) {
			engine = new GameEngine(season, awayTeamId, homeTeamId);
			updateFromEngine();
		}
	}

	// Load available series for saving
	async function loadSeriesForSave() {
		try {
			const series = await listSeries();
			availableSeries = series;
			showSeriesModal = true;
		} catch (error) {
			console.error('Failed to load series:', error);
			showToast('Failed to load series. See console for details.');
		}
	}

	// Save game to selected series
	async function saveToSeries(series: Series) {
		if (!engine || !awayTeamId || !homeTeamId) return;

		isSavingGame = true;

		try {
			// Add teams to series if not already present
			await addTeamToSeries(series.id, {
				teamId: awayTeamId,
				seasonYear: gameYear,
				league: season?.teams[awayTeamId]?.league || null,
				division: season?.teams[awayTeamId]?.division || null
			});
			await addTeamToSeries(series.id, {
				teamId: homeTeamId,
				seasonYear: gameYear,
				league: season?.teams[homeTeamId]?.league || null,
				division: season?.teams[homeTeamId]?.division || null
			});

			// Get the game count in this series to determine game number
			const games = await (await import('$lib/game-results/index.js')).getGamesBySeries(series.id);
			const gameNumber = games.length + 1;

			// Save the game
			const gameId = await saveGameFromState(
				engine.getState(),
				series.id,
				gameNumber,
				null // no scheduled date for ad-hoc games
			);

			showSeriesModal = false;
			showToast(`Game saved to "${series.name}"!`);
		} catch (error) {
			console.error('Failed to save game:', error);
			showToast('Failed to save game. See console for details.');
		} finally {
			isSavingGame = false;
		}
	}

	// Create a new series and save to it
	async function createAndSaveSeries() {
		if (!engine) return;

		const seriesName = prompt('Enter series name (e.g., "1976 Season Replay", "Quick Games"):');
		if (!seriesName || seriesName.trim() === '') return;

		isSavingGame = true;

		try {
			// Create the series
			const series = await createSeries({
				name: seriesName.trim(),
				description: `Games played on ${new Date().toLocaleDateString()}`,
				seriesType: 'exhibition'
			});

			// Add teams to series
			if (awayTeamId) {
				await addTeamToSeries(series.id, {
					teamId: awayTeamId,
					seasonYear: gameYear,
					league: season?.teams[awayTeamId]?.league || null,
					division: season?.teams[awayTeamId]?.division || null
				});
			}
			if (homeTeamId) {
				await addTeamToSeries(series.id, {
					teamId: homeTeamId,
					seasonYear: gameYear,
					league: season?.teams[homeTeamId]?.league || null,
					division: season?.teams[homeTeamId]?.division || null
				});
			}

			// Save the game
			const gameId = await saveGameFromState(
				engine.getState(),
				series.id,
				1, // first game in new series
				null
			);

			showSeriesModal = false;
			showToast(`Created "${series.name}" and saved game!`);
		} catch (error) {
			console.error('Failed to create series:', error);
			showToast('Failed to create series. See console for details.');
		} finally {
			isSavingGame = false;
		}
	}

	// Format runner info for play-by-play display
	// Shows runners who advanced or just reached base, plus scorers
	// Order: scorers first, then highest base first (3rd, 2nd, 1st)
	function formatRunnerInfo(play: PlayEvent, playIndex: number, allReversedPlays: PlayEvent[]): string | null {
		// Only show runner info if there are scorers OR runners who moved/reached
		if (!play.runnersAfter) {
			return null;
		}

		const parts: string[] = [];
		const bases = ['1st', '2nd', '3rd'];

		// Add scorers FIRST
		if (play.scorerIds && play.scorerIds.length > 0) {
			const scorerNames = play.scorerIds
				.map((id) => season?.batters[id]?.name)
				.filter(Boolean)
				.map((name) => formatNameFirstLast(name!));

			if (scorerNames.length === 1) {
				parts.push(`${scorerNames[0]} scores`);
			} else {
				parts.push(`${scorerNames.join(', ')} score`);
			}
		}

		// Check if this play ends the inning (a summary play for the same inning exists earlier in reversed list)
		// Summary plays are added AFTER the final out of an inning
		const nextChronologicalPlay = playIndex > 0 ? allReversedPlays[playIndex - 1] : null;

		const isThirdOut = nextChronologicalPlay?.isSummary &&
			nextChronologicalPlay.inning === play.inning &&
			nextChronologicalPlay.isTopInning === play.isTopInning;

		// If this was the last out and there are no scorers, don't show runner advancement
		// (the exception is walk-offs, which are handled above by showing scorers)
		if (isThirdOut) {
			return parts.length > 0 ? parts.join(', ') : null;
		}

		// Add runners on base (excluding those who scored and the current batter)
		// Iterate in reverse order (3rd, 2nd, 1st) for highest base first
		for (let i = 2; i >= 0; i--) {
			const runnerId = play.runnersAfter[i];
			// Skip if this runner scored or is the current play's batter
			if (!runnerId || play.scorerIds?.includes(runnerId) || runnerId === play.batterId) {
				continue;
			}
			if (season?.batters[runnerId]) {
				const name = season.batters[runnerId].name;
				const formattedName = formatNameFirstLast(name);

				// Find where this runner was before (if at all)
				let fromIndex = -1;
				if (play.runnersBefore) {
					for (let j = 0; j < 3; j++) {
						if (play.runnersBefore[j] === runnerId) {
							fromIndex = j;
							break;
						}
					}
				}

				// If not on base before, just reached base
				if (fromIndex === -1) {
					parts.push(`${formattedName} on ${bases[i]}`);
				}
				// If moved to a different base, show advancement
				else if (fromIndex !== i) {
					parts.push(`${formattedName} to ${bases[i]}`);
				}
				// If stayed in same place, don't show
			}
		}

		return parts.length > 0 ? parts.join(', ') : null;
	}

	// Format score line for plays with runs
	function formatScoreLine(play: PlayEvent, awayScore: number, homeScore: number): string | null {
		// Only show score line if there are scorers
		if (!play.scorerIds || play.scorerIds.length === 0) {
			return null;
		}

		const awayTeam = season?.teams[awayTeamId!];
		const homeTeam = season?.teams[homeTeamId!];
		const awayName = awayTeam ? `${awayTeam.city} ${awayTeam.nickname}` : awayTeamId ?? 'Away';
		const homeName = homeTeam ? `${homeTeam.city} ${homeTeam.nickname}` : homeTeamId ?? 'Home';

		return `${awayName} ${awayScore}, ${homeName} ${homeScore}`;
	}

	// Format name from "Last, First" to "First Last"
	function formatName(name: string): string {
		const commaIndex = name.indexOf(',');
		if (commaIndex === -1) return name;
		return `${name.slice(commaIndex + 1).trim()} ${name.slice(0, commaIndex).trim()}`;
	}

	// Convert position number to abbreviation (1=P, 2=C, 3=1B, 4=2B, 5=3B, 6=SS, 7=LF, 8=CF, 9=RF, 10=DH)
	function getPositionAbbrev(position: number): string {
		const positions: Record<number, string> = {
			1: 'P',
			2: 'C',
			3: '1B',
			4: '2B',
			5: '3B',
			6: 'SS',
			7: 'LF',
			8: 'CF',
			9: 'RF',
			10: 'DH'
		};
		return positions[position] ?? '?';
	}

	// Calculate running score at a specific play index
	// If isReversed=true: assumes plays are in reverse order (newest first), calculates score from playIndex to end
	// If isReversed=false: assumes plays are in chronological order (oldest first), calculates score from start to playIndex
	function getScoreAtPlay(playIndex: number, totalPlays: PlayEvent[], isReversed = false): { away: number; home: number } {
		let away = 0;
		let home = 0;
		if (isReversed) {
			// Plays are in reverse order (newest first), iterate from playIndex to end
			for (let i = playIndex; i < totalPlays.length; i++) {
				const play = totalPlays[i];
				if (play.isTopInning) {
					away += play.runsScored;
				} else {
					home += play.runsScored;
				}
			}
		} else {
			// Plays are in chronological order (oldest first), iterate from start to playIndex
			for (let i = 0; i <= playIndex; i++) {
				const play = totalPlays[i];
				if (play.isTopInning) {
					away += play.runsScored;
				} else {
					home += play.runsScored;
				}
			}
		}
		return { away, home };
	}
</script>

<svelte:head>
	<title>Game - Baseball Sim</title>
</svelte:head>

<div class="h-screen flex flex-col bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white overflow-hidden">
	<!-- Game Info Header -->
	<header class="flex-shrink-0 bg-slate-950/50 border-b border-slate-700/50">
		<div class="flex items-center justify-center px-3 sm:px-6 py-2 sm:py-3 gap-2">
			<!-- Game Info -->
			<div class="flex items-center gap-2 sm:gap-4 text-xs sm:text-sm text-slate-400">
				<span>{gameYear} Season</span>
				<span class="text-slate-600">|</span>
				<span>{awayTeamName} vs {homeTeamName}</span>
			</div>
		</div>
	</header>

	<!-- Main Content -->
	<main class="flex-1 flex flex-col lg:flex-row overflow-hidden">
		<!-- Left Section: Field + Matchup -->
		<div class="flex-1 flex flex-col p-3 sm:p-4 lg:p-6 gap-3 sm:gap-4 lg:gap-6 overflow-y-auto min-h-0">
			<!-- Scoreboard Display -->
			<div class="flex items-center justify-center">
				<GameScoreboard
					{awayScore}
					{homeScore}
					{inning}
					{isTopInning}
					{outs}
					runners={runnerIds}
					{runnerNames}
					{currentBatter}
					{currentPitcher}
					awayTeam={awayTeamId ?? 'Away'}
					homeTeam={homeTeamId ?? 'Home'}
					awayTeamFull={awayTeamName}
					homeTeamFull={homeTeamName}
					{plays}
				/>
			</div>

			<!-- Lineups -->
			<div class="flex-shrink-0 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
				<!-- Away Lineup -->
				<div class="bg-slate-950/50 rounded-xl p-3 sm:p-4 backdrop-blur-sm border border-slate-700/30">
					<div class="text-[10px] sm:text-xs text-slate-400 uppercase tracking-wider mb-2 sm:mb-3">Away Lineup</div>
					<div class="space-y-1">
						{#each awayLineupDisplay as player, i (i)}
							<div class="flex items-center gap-2 py-1 px-2 rounded {player.isCurrent
								? 'bg-blue-600/30 border border-blue-500/50'
								: ''}">
								<span class="text-[10px] sm:text-xs w-4 text-slate-500">{i + 1}</span>
								<span class="text-[10px] sm:text-xs w-5 text-slate-400">{player.position}</span>
								<span class="text-xs sm:text-sm {player.isCurrent
									? 'text-white font-medium'
									: 'text-slate-300'} truncate">{player.name}</span>
								{#if player.isCurrent}
									<span class="ml-auto text-[10px] sm:text-xs text-blue-400 hidden sm:inline"> batting</span>
								{/if}
							</div>
						{/each}
					</div>
					<!-- Current Pitcher -->
					<div class="flex items-center gap-2 py-1 px-2 rounded border-t border-slate-700/30 mt-1 pt-2">
						<span class="text-[10px] sm:text-xs w-4 text-slate-500">P</span>
						<span class="text-[10px] sm:text-xs w-5 text-slate-400"></span>
						<span class="text-xs sm:text-sm text-slate-300 truncate">{awayPitcherDisplay}</span>
					</div>
				</div>

				<!-- Home Lineup -->
				<div class="bg-slate-950/50 rounded-xl p-3 sm:p-4 backdrop-blur-sm border border-slate-700/30">
					<div class="text-[10px] sm:text-xs text-slate-400 uppercase tracking-wider mb-2 sm:mb-3">Home Lineup</div>
					<div class="space-y-1">
						{#each homeLineupDisplay as player, i (i)}
							<div class="flex items-center gap-2 py-1 px-2 rounded {player.isCurrent
								? 'bg-blue-600/30 border border-blue-500/50'
								: ''}">
								<span class="text-[10px] sm:text-xs w-4 text-slate-500">{i + 1}</span>
								<span class="text-[10px] sm:text-xs w-5 text-slate-400">{player.position}</span>
								<span class="text-xs sm:text-sm {player.isCurrent
									? 'text-white font-medium'
									: 'text-slate-300'} truncate">{player.name}</span>
								{#if player.isCurrent}
									<span class="ml-auto text-[10px] sm:text-xs text-blue-400 hidden sm:inline"> batting</span>
								{/if}
							</div>
						{/each}
					</div>
					<!-- Current Pitcher -->
					<div class="flex items-center gap-2 py-1 px-2 rounded border-t border-slate-700/30 mt-1 pt-2">
						<span class="text-[10px] sm:text-xs w-4 text-slate-500">P</span>
						<span class="text-[10px] sm:text-xs w-5 text-slate-400"></span>
						<span class="text-xs sm:text-sm text-slate-300 truncate">{homePitcherDisplay}</span>
					</div>
				</div>
			</div>
		</div>

		<!-- Right Section: Play-by-Play + Controls -->
		<div class="w-full lg:w-96 flex-shrink-0 flex flex-col p-3 sm:p-4 lg:p-6 gap-3 sm:gap-4 lg:gap-6 overflow-hidden bg-slate-950/30 border-t lg:border-t-0 lg:border-l border-slate-700/30 min-h-0">
			<!-- Play-by-Play Feed -->
			<div class="flex-1 flex flex-col min-h-0">
				<div class="text-[10px] sm:text-xs text-slate-400 uppercase tracking-wider mb-2 sm:mb-3 flex-shrink-0">Play-by-Play</div>
				{#if reversedPlays.length > 0}
					<div class="flex-1 overflow-y-auto space-y-1.5 sm:space-y-2 pr-1 sm:pr-2 min-h-0" id="play-by-play-container">
						{#each reversedPlays as play, index (play.id || index)}
							{@const playNumber = reversedPlays.length - index}
							{@const runnerInfo = formatRunnerInfo(play, index, reversedPlays)}
							{@const scoreAtPlay = getScoreAtPlay(index, reversedPlays, true)}
							{@const scoreInfo = formatScoreLine(play, scoreAtPlay.away, scoreAtPlay.home)}
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
							{#if scoreInfo && !play.isSummary}
								<div class="pl-4 sm:pl-6 pr-2 sm:pr-3 py-1 text-xs text-emerald-400 font-medium">
									{scoreInfo}
								</div>
							{/if}
						{/each}
					</div>
				{:else}
					<div class="flex-1 flex items-center justify-center min-h-0">
						<div class="text-xs sm:text-sm text-slate-500 text-center">Game starting...</div>
					</div>
				{/if}
			</div>

			<!-- Controls -->
			<div class="flex-shrink-0 space-y-2 sm:space-y-3 pt-2 border-t border-slate-700/30">
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
					<div class="text-xs sm:text-sm lg:text-base text-slate-400 mb-2 sm:mb-3 lg:mb-4">{gameYear} Season - {awayTeamName} vs {homeTeamName}</div>
					<div class="text-sm font-medium text-emerald-400 mb-3 sm:mb-4 lg:mb-6">
						{isTopInning ? inning - 1 : inning} {isTopInning && inning - 1 === 1 || !isTopInning && inning === 1 ? 'inning' : 'innings'}
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
						{@const stats = getGameStats()!}
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

					<!-- Save to Database Button -->
					<button
						onclick={loadSeriesForSave}
						class="w-full px-4 py-3 sm:px-6 sm:py-4 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 text-sm sm:text-base mb-2 sm:mb-3"
					>
						<svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4" />
						</svg>
						Save to Database
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
						aria-label="Close play-by-play modal"
					>
						<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>

				{#if reversedPlays.length > 0}
					<div class="flex-1 overflow-y-auto space-y-2 pr-2">
						{#each reversedPlays as play, index (play.id || index)}
							{@const playNumber = reversedPlays.length - index}
							{@const runnerInfo = formatRunnerInfo(play, index, reversedPlays)}
							{@const scoreAtPlay = getScoreAtPlay(index, reversedPlays, true)}
							{@const scoreInfo = formatScoreLine(play, scoreAtPlay.away, scoreAtPlay.home)}
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
							{#if scoreInfo && !play.isSummary}
								<div class="pl-7 sm:pl-10 pr-3 sm:pr-4 py-1 text-sm text-emerald-400 font-medium">
									{scoreInfo}
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

	<!-- Series Selection Modal -->
	{#if showSeriesModal}
		<div class="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4">
			<div class="bg-slate-900 rounded-xl sm:rounded-2xl p-4 sm:p-6 lg:p-8 max-w-lg w-full mx-0 sm:mx-4 border border-slate-700 shadow-2xl">
				<div class="text-center">
					<h2 class="text-xl sm:text-2xl font-bold mb-2">Save Game to Database</h2>
					<p class="text-sm text-slate-400 mb-4 sm:mb-6">Choose a series to save this game to, or create a new one.</p>

					{#if availableSeries.length === 0}
						<div class="text-center py-6">
							<p class="text-slate-400 mb-4">No series found. Create one to save your games!</p>
							<button
								onclick={createAndSaveSeries}
								class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg transition-colors text-sm"
								disabled={isSavingGame}
							>
								{isSavingGame ? 'Creating...' : 'Create New Series'}
							</button>
						</div>
					{:else}
						<div class="space-y-2 mb-4 max-h-60 overflow-y-auto">
							{#each availableSeries as series}
								<button
									onclick={() => saveToSeries(series)}
									class="w-full text-left px-4 py-3 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors border border-slate-700 disabled:opacity-50"
									disabled={isSavingGame}
								>
									<div class="flex items-center justify-between">
										<div>
											<div class="font-semibold text-white">{series.name}</div>
											<div class="text-xs text-slate-400">
												{series.seriesType} • {series.status}
											</div>
										</div>
										<svg class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
										</svg>
									</div>
								</button>
							{/each}
						</div>

						<div class="border-t border-slate-700 pt-4">
							<button
								onclick={createAndSaveSeries}
								class="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg transition-colors text-sm"
								disabled={isSavingGame}
							>
								{isSavingGame ? 'Creating...' : '+ Create New Series'}
							</button>
						</div>
					{/if}

					<button
						onclick={() => showSeriesModal = false}
						class="w-full px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-lg transition-colors text-sm mt-2"
					>
						Cancel
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
