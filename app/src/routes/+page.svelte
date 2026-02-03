<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { loadSeason } from '$lib/game/season-loader.js';
	import {
		downloadSeason,
		isSeasonDownloaded,
		type SeasonDownloadState
	} from '$lib/game/season-download.js';
	import {
		downloadTeamsData,
		isTeamsDataDownloaded,
		loadTeamsData,
		getTeamsForYear,
		getAvailableYearsFromTeams,
		type TeamInfo
	} from '$lib/game/teams-data.js';
	import type { Team, SeasonPackage } from '$lib/game/types.js';

	// Teams data download state
	let teamsDataDownloadState = $state<{
		isDownloaded: boolean;
		isDownloading: boolean;
		progress: number;
		error: string | null;
	}>({
		isDownloaded: false,
		isDownloading: false,
		progress: 0,
		error: null
	});

	// Available years (from teams data)
	let availableYears = $state<number[]>([]);
	let selectedYear = $state<number>(1976);

	// Season data and download state
	let seasonData = $state<SeasonPackage | null>(null);
	let downloadState = $state<SeasonDownloadState | null>(null);
	let isSeasonReady = $state(false);

	// Team selection (from teams data)
	let teams = $state<Team[]>([]);
	let selectedAwayTeam = $state<string | null>(null);
	let selectedHomeTeam = $state<string | null>(null);

	// Loading state
	let isLoadingYears = $state(true);

	// Load teams data and available years on mount
	onMount(async () => {
		// Check if teams data is already downloaded
		const teamsDownloaded = isTeamsDataDownloaded();

		if (teamsDownloaded) {
			try {
				await loadTeamsData();
				availableYears = await getAvailableYearsFromTeams();
				if (availableYears.length > 0 && !availableYears.includes(selectedYear)) {
					selectedYear = availableYears[0];
				}
				teamsDataDownloadState.isDownloaded = true;
			} catch (error) {
				console.error('Failed to load teams data:', error);
				teamsDataDownloadState.error = (error as Error).message;
			}
		}

		isLoadingYears = false;
	});

	// Download teams data
	async function downloadTeamsDataFile() {
		teamsDataDownloadState.isDownloading = true;
		teamsDataDownloadState.progress = 0;
		teamsDataDownloadState.error = null;

		try {
			await downloadTeamsData((progress) => {
				teamsDataDownloadState.progress = progress;
			});

			availableYears = await getAvailableYearsFromTeams();
			if (availableYears.length > 0 && !availableYears.includes(selectedYear)) {
				selectedYear = availableYears[0];
			}

			teamsDataDownloadState.isDownloaded = true;
			teamsDataDownloadState.isDownloading = false;
		} catch (error) {
			teamsDataDownloadState.error = (error as Error).message;
			teamsDataDownloadState.isDownloading = false;
		}
	}

	// When year changes, load teams for that year and check season status
	$effect(() => {
		const year = selectedYear;
		if (!year || !teamsDataDownloadState.isDownloaded) return;

		// Reset state
		seasonData = null;
		teams = [];
		selectedAwayTeam = null;
		selectedHomeTeam = null;
		isSeasonReady = false;
		downloadState = null;

		// Load teams for this year from teams data
		(async () => {
			try {
				const teamsData = await getTeamsForYear(year);
				teams = teamsData.map((t) => ({
					id: t.id,
					league: t.league,
					city: t.city,
					nickname: t.nickname
				})) as Team[];
			} catch (error) {
				console.error('Failed to load teams:', error);
			}
		})();

		// Check if season is downloaded
		(async () => {
			const downloaded = await isSeasonDownloaded(year);
			if (downloaded) {
				try {
					seasonData = await loadSeason(year);
					isSeasonReady = true;
				} catch (error) {
					console.error('Failed to load season:', error);
				}
			}
		})();
	});

	// Download the selected season
	async function downloadSelectedSeason() {
		if (!selectedYear) return;

		downloadState = { status: 'downloading', progress: 0, error: null };

		try {
			seasonData = await downloadSeason(selectedYear, (progress) => {
				if (downloadState) {
					downloadState.progress = progress;
				}
			});

			isSeasonReady = true;
			downloadState = { status: 'complete', progress: 1, error: null };
		} catch (error) {
			downloadState = {
				status: 'error',
				progress: 0,
				error: (error as Error).message
			};
		}
	}

	// Check if we can start the game
	const canStartGame = $derived(
		isSeasonReady && selectedAwayTeam && selectedHomeTeam && selectedAwayTeam !== selectedHomeTeam
	);

	// Start the game
	function startGame() {
		if (!canStartGame || !selectedYear) return;

		goto(
			`/game?year=${selectedYear}&away=${encodeURIComponent(selectedAwayTeam!)}&home=${encodeURIComponent(selectedHomeTeam!)}`
		);
	}

	// Get team display name
	function getTeamDisplayName(teamId: string): string {
		const team = teams.find((t) => t.id === teamId);
		return team ? `${team.city} ${team.nickname}` : teamId;
	}

	// Get league display name
	function getLeagueDisplayName(league: string): string {
		const leagueNames: Record<string, string> = {
			AL: 'American League',
			NL: 'National League'
		};
		return leagueNames[league] || league;
	}

	// Group teams by league for optgroups
	const teamsByLeague = $derived.by(() => {
		const groups = new Map<string, Team[]>();
		for (const team of teams) {
			// Handle teams with multiple leagues (e.g., "AL;NL")
			const league = team.league.includes('AL') ? 'AL' : team.league.includes('NL') ? 'NL' : team.league;
			if (!groups.has(league)) {
				groups.set(league, []);
			}
			groups.get(league)!.push(team);
		}
		return groups;
	});
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
		<!-- Teams Data Download -->
		{#if !teamsDataDownloadState.isDownloaded}
			<section class="bg-zinc-900 rounded-lg p-4 sm:p-6 text-center">
				<h2 class="text-base sm:text-lg lg:text-xl font-semibold mb-3 sm:mb-4">Download Teams Data</h2>
				<p class="text-sm sm:text-base text-zinc-400 mb-4 sm:mb-6">
					Download team information for all seasons (1910-2024). This is a one-time download (~5 KB).
				</p>

				{#if teamsDataDownloadState.isDownloading}
					<div class="flex flex-col items-center gap-3">
						<div class="w-full max-w-xs bg-zinc-800 rounded-full h-3 overflow-hidden">
							<div
								class="bg-blue-600 h-full transition-all duration-300"
								style="width: {teamsDataDownloadState.progress * 100}%"
							></div>
						</div>
						<p class="text-sm text-blue-400">
							Downloading {Math.round(teamsDataDownloadState.progress * 100)}%
						</p>
					</div>
				{:else if teamsDataDownloadState.error}
					<div class="mb-4 p-3 bg-red-900/30 border border-red-700 rounded text-red-300 text-sm">
						Error: {teamsDataDownloadState.error}
					</div>
					<button
						onclick={downloadTeamsDataFile}
						class="px-6 py-2 sm:px-8 sm:py-3 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition-colors"
					>
						Retry Download
					</button>
				{:else}
					<button
						onclick={downloadTeamsDataFile}
						class="px-6 py-2 sm:px-8 sm:py-3 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition-colors flex items-center gap-2 mx-auto"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
							/>
						</svg>
						Download Teams Data
					</button>
				{/if}
			</section>
		{/if}

		<!-- Season Selection -->
		{#if teamsDataDownloadState.isDownloaded}
			<section class="bg-zinc-900 rounded-lg p-4 sm:p-6">
				<h2 class="text-base sm:text-lg lg:text-xl font-semibold mb-3 sm:mb-4">Select Season</h2>

				<div class="flex flex-col sm:flex-row gap-3 sm:gap-4 items-start sm:items-center">
					<select
						bind:value={selectedYear}
						disabled={downloadState?.status === 'downloading'}
						class="flex-1 w-full max-w-xs bg-zinc-800 border border-zinc-700 rounded px-3 py-2 sm:px-4 text-white text-sm sm:text-base disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{#each availableYears as year}
							<option value={year}>{year}</option>
						{/each}
					</select>

					{#if isSeasonReady}
						<div class="flex items-center gap-2 text-emerald-400 text-sm">
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M5 13l4 4L19 7"
								/>
							</svg>
							<span>Downloaded</span>
						</div>
					{:else if downloadState?.status === 'downloading'}
						<div class="flex items-center gap-2 text-blue-400 text-sm">
							<svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
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
							<span>Downloading {Math.round(downloadState.progress * 100)}%</span>
						</div>
					{:else if downloadState?.status === 'error'}
						<div class="flex items-center gap-2 text-red-400 text-sm">
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M6 18L18 6M6 6l12 12"
								/>
							</svg>
							<span>Error: {downloadState.error}</span>
						</div>
					{:else}
						<button
							onclick={downloadSelectedSeason}
							class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
							disabled={!selectedYear}
						>
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
								/>
							</svg>
							Download Season
						</button>
					{/if}
				</div>
			</section>
		{/if}

		<!-- Team Selection -->
		{#if teamsDataDownloadState.isDownloaded}
			<section class="bg-zinc-900 rounded-lg p-4 sm:p-6">
				<h2 class="text-base sm:text-lg lg:text-xl font-semibold mb-3 sm:mb-4">Select Teams</h2>

				{#if teams.length === 0}
					<div class="text-center py-8 sm:py-12">
						<p class="text-zinc-400 text-sm sm:text-base">Select a season to see teams</p>
					</div>
				{:else}
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 lg:gap-8">
						<!-- Away Team -->
						<div>
							<h3 class="text-base sm:text-lg mb-2 sm:mb-3 text-zinc-300">Away Team</h3>
							<select
								bind:value={selectedAwayTeam}
								class="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 sm:px-4 text-white text-sm sm:text-base"
							>
								<option value="">-- Select team --</option>
								{#each Array.from(teamsByLeague.entries()).sort(([aLeague], [bLeague]) => {
									const leagueOrder = { AL: 1, NL: 2 };
									const aOrder = leagueOrder[aLeague as keyof typeof leagueOrder] ?? 3;
									const bOrder = leagueOrder[bLeague as keyof typeof leagueOrder] ?? 3;
									return aOrder - bOrder;
								}) as [league, leagueTeams]}
									<optgroup label={getLeagueDisplayName(league)}>
										{#each leagueTeams as team}
											<option value={team.id}>{team.city} {team.nickname}</option>
										{/each}
									</optgroup>
								{/each}
							</select>
							{#if selectedAwayTeam}
								<p class="mt-2 text-xs sm:text-sm text-zinc-400">
									{getTeamDisplayName(selectedAwayTeam)}
								</p>
							{/if}
						</div>

						<!-- Home Team -->
						<div>
							<h3 class="text-base sm:text-lg mb-2 sm:mb-3 text-zinc-300">Home Team</h3>
							<select
								bind:value={selectedHomeTeam}
								class="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 sm:px-4 text-white text-sm sm:text-base"
							>
								<option value="">-- Select team --</option>
								{#each Array.from(teamsByLeague.entries()).sort(([aLeague], [bLeague]) => {
									const leagueOrder = { AL: 1, NL: 2 };
									const aOrder = leagueOrder[aLeague as keyof typeof leagueOrder] ?? 3;
									const bOrder = leagueOrder[bLeague as keyof typeof leagueOrder] ?? 3;
									return aOrder - bOrder;
								}) as [league, leagueTeams]}
									<optgroup label={getLeagueDisplayName(league)}>
										{#each leagueTeams as team}
											<option value={team.id}>{team.city} {team.nickname}</option>
										{/each}
									</optgroup>
								{/each}
							</select>
							{#if selectedHomeTeam}
								<p class="mt-2 text-xs sm:text-sm text-zinc-400">
									{getTeamDisplayName(selectedHomeTeam)}
								</p>
							{/if}
						</div>
					</div>

					{#if selectedAwayTeam && selectedHomeTeam && selectedAwayTeam === selectedHomeTeam}
						<p class="mt-4 text-sm text-amber-400">Please select different teams for away and home.</p>
					{/if}
				{/if}
			</section>
		{/if}

		<!-- Start Button -->
		<section class="text-center">
			<button
				disabled={!canStartGame}
				class="px-6 py-3 sm:px-8 sm:py-3 bg-green-600 text-white font-semibold rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-base sm:text-lg transition-colors"
				onclick={startGame}
			>
				Start Game
			</button>
			{#if canStartGame}
				<p class="mt-2 text-xs sm:text-sm text-zinc-400">
					{getTeamDisplayName(selectedAwayTeam!)} @ {getTeamDisplayName(selectedHomeTeam!)} ({selectedYear})
				</p>
			{/if}
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
