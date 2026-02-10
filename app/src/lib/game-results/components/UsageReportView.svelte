<script lang="ts">
	import { onMount } from 'svelte';
	import type { PlayerUsageRecord, UsageViolation, Standing } from '$lib/game-results';
	import type { SeriesTeam } from '$lib/game-results';
	import type { TeamInfo } from '$lib/game/teams-data';
	import { getSeriesTeams } from '$lib/game-results';
	import { loadTeamsData } from '$lib/game/teams-data';
	import type { SeasonPackage } from '$lib/game/types.js';
	import { loadSeason } from '$lib/game/sqlite-season-loader.js';

	interface Props {
		seriesId: string;
		seasonYear: number;
	}

	let { seriesId, seasonYear }: Props = $props();

	// Dynamic imports
	let getTeamUsage: typeof import('$lib/game-results/index.js').UsageTracker['prototype']['getTeamUsage'];
	let checkThresholds: typeof import('$lib/game-results/index.js').UsageTracker['prototype']['checkThresholds'];
	let getSeriesStandingsEnhanced: typeof import('$lib/game-results/index.js').getSeriesStandingsEnhanced;

	// State
	let loading = $state(true);
	let error = $state<string | null>(null);
	let seriesTeams = $state<SeriesTeam[]>([]);
	let teamsData = $state<Record<string, TeamInfo>>({});
	let usageRecords = $state<PlayerUsageRecord[]>([]);
	let violations = $state<UsageViolation[]>([]);
	let standings = $state<Standing[]>([]);
	let seasonData = $state<SeasonPackage | null>(null);
	let playerNames = $state<Record<string, string>>({}); // Cache of playerId -> name

	// Filters
	let selectedTeam = $state<string | null>(null);
	let selectedStatus = $state<'all' | 'under' | 'inRange' | 'over'>('all');
	let selectedPlayerType = $state<'all' | 'batters' | 'pitchers'>('all');

	// Sort
	type SortColumn = 'name' | 'percentage' | 'status' | 'actual' | 'replay';
	let sortBy = $state<SortColumn>('percentage');
	let sortDirection = $state<'asc' | 'desc'>('desc');

	// Expanded team sections
	let expandedTeams = $state<Set<string>>(new Set());

	onMount(async () => {
		try {
			// Load teams
			const gameResults = await import('$lib/game-results/index.js');
			const UsageTrackerClass = gameResults.UsageTracker;
			getSeriesStandingsEnhanced = gameResults.getSeriesStandingsEnhanced;

			// Create UsageTracker instance and bind methods
			const tracker = new UsageTrackerClass(seriesId, seasonYear);
			getTeamUsage = tracker.getTeamUsage.bind(tracker);
			checkThresholds = tracker.checkThresholds.bind(tracker);

			// Get series teams
			seriesTeams = await getSeriesTeams(seriesId);

			// Load teams data
			const allTeamsData = await loadTeamsData();
			const yearTeams = allTeamsData[seasonYear.toString()] || [];
			teamsData = Object.fromEntries(yearTeams.map((t) => [t.id, t]));

			// Get standings (for team games played)
			standings = await getSeriesStandingsEnhanced(seriesId);

			// Load season data for player names
			seasonData = await loadSeason(seasonYear);

			// Get all usage data
			const allRecords: PlayerUsageRecord[] = [];
			for (const team of seriesTeams) {
				const teamRecords = await getTeamUsage(team.teamId);
				allRecords.push(...teamRecords);
			}
			usageRecords = allRecords;

			// Get violations
			violations = await checkThresholds();

			// Load player names from game events
			await loadPlayerNames();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load usage data';
		} finally {
			loading = false;
		}
	});

	// Derived: filtered and sorted records
	const filteredRecords = $derived(() => {
		let filtered = usageRecords;

		// Filter by team
		if (selectedTeam) {
			filtered = filtered.filter((r) => r.teamId === selectedTeam);
		}

		// Filter by status
		if (selectedStatus !== 'all') {
			filtered = filtered.filter((r) => r.status === selectedStatus);
		}

		// Filter by player type
		if (selectedPlayerType === 'batters') {
			filtered = filtered.filter((r) => !r.isPitcher);
		} else if (selectedPlayerType === 'pitchers') {
			filtered = filtered.filter((r) => r.isPitcher);
		}

		// Sort
		filtered = [...filtered].sort((a, b) => {
			let aVal: any, bVal: any;

			switch (sortBy) {
				case 'name':
					aVal = (teamsData[a.teamId]?.nickname || a.teamId) + a.playerId;
					bVal = (teamsData[b.teamId]?.nickname || b.teamId) + b.playerId;
					break;
				case 'percentage':
					// Calculate display percentage for sorting
					const aExpected = a.actualSeasonTotal * (getTeamGamesPlayed(a.teamId) / getSeasonLength());
					const bExpected = b.actualSeasonTotal * (getTeamGamesPlayed(b.teamId) / getSeasonLength());
					aVal = aExpected > 0 ? (a.replayCurrentTotal / aExpected) : 0;
					bVal = bExpected > 0 ? (b.replayCurrentTotal / bExpected) : 0;
					break;
				case 'status':
					const order = { under: 0, inRange: 1, over: 2 };
					aVal = order[a.status];
					bVal = order[b.status];
					break;
				case 'actual':
					aVal = a.actualSeasonTotal;
					bVal = b.actualSeasonTotal;
					break;
				case 'replay':
					aVal = a.replayCurrentTotal;
					bVal = b.replayCurrentTotal;
					break;
				default:
					return 0;
			}

			const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
			return sortDirection === 'asc' ? comparison : -comparison;
		});

		return filtered;
	});

	// Derived: summary stats
	const summary = $derived(() => {
		const batters = usageRecords.filter((r) => !r.isPitcher);
		const pitchers = usageRecords.filter((r) => r.isPitcher);
		const under = violations.filter((v) => v.status === 'under');
		const over = violations.filter((v) => v.status === 'over');

		return {
			totalPlayers: usageRecords.length,
			totalBatters: batters.length,
			totalPitchers: pitchers.length,
			violations: violations.length,
			underUsed: under.length,
			overUsed: over.length
		};
	});

	// Derived: team summaries
	const teamSummaries = $derived(() => {
		return seriesTeams.map((team) => {
			const teamRecords = usageRecords.filter((r) => r.teamId === team.teamId);
			const teamViolations = violations.filter((v) => {
				const record = usageRecords.find((r) => r.playerId === v.playerId);
				return record?.teamId === team.teamId;
			});

			return {
				team,
				teamInfo: teamsData[team.teamId],
				totalPlayers: teamRecords.length,
				batters: teamRecords.filter((r) => !r.isPitcher).length,
				pitchers: teamRecords.filter((r) => r.isPitcher).length,
				violations: teamViolations.length,
				avgPercentage:
					teamRecords.length > 0
						? teamRecords.reduce((sum, r) => {
								const expected = r.actualSeasonTotal * (getTeamGamesPlayed(r.teamId) / getSeasonLength());
								const displayPct = expected > 0 ? (r.replayCurrentTotal / expected) : 0;
								return sum + displayPct;
							}, 0) / teamRecords.length
						: 0
			};
		});
	});

	function toggleSort(column: SortColumn) {
		if (sortBy === column) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		} else {
			sortBy = column;
			sortDirection = 'desc';
		}
	}

	function getSortIndicator(column: SortColumn): string {
		if (sortBy !== column) return '';
		return sortDirection === 'asc' ? ' ▲' : ' ▼';
	}

	function toggleTeamExpansion(teamId: string) {
		const newExpanded = new Set(expandedTeams);
		if (newExpanded.has(teamId)) {
			newExpanded.delete(teamId);
		} else {
			newExpanded.add(teamId);
		}
		expandedTeams = newExpanded;
	}

	function getStatusBadgeClass(status: string): string {
		switch (status) {
			case 'under':
				return 'bg-yellow-900/30 text-yellow-400 border-yellow-800';
			case 'over':
				return 'bg-red-900/30 text-red-400 border-red-800';
			default:
				return 'bg-green-900/30 text-green-400 border-green-800';
		}
	}

	function getTeamName(teamId: string): string {
		const team = teamsData[teamId];
		if (team) {
			return `${team.city} ${team.nickname}`;
		}
		return teamId;
	}

	function getFormattedValue(record: PlayerUsageRecord): string {
		if (record.isPitcher) {
			// Convert outs to IP (outs / 3)
			const ip = (record.replayCurrentTotal / 3).toFixed(1);
			const actualIp = (record.actualSeasonTotal / 3).toFixed(1);
			return `${ip} / ${actualIp} IP`;
		}
		return `${record.replayCurrentTotal} / ${record.actualSeasonTotal} PA`;
	}

	// Get team games played in replay (from standings)
	function getTeamGamesPlayed(teamId: string): number {
		const standing = standings.find((s) => s.teamId === teamId && s.seasonYear === seasonYear);
		return standing?.gamesPlayed || 0;
	}

	// Get season length for a given year (154 for pre-1962, 162 for 1962+)
	function getSeasonLength(): number {
		return seasonYear < 1962 ? 154 : 162;
	}

	// Get proration percentage based on team season progress
	// Expected = actual * (teamGamesPlayed / seasonLength)
	function getProrationPercentage(record: PlayerUsageRecord): number {
		const teamGamesPlayed = getTeamGamesPlayed(record.teamId);
		const seasonLength = getSeasonLength();
		return seasonLength > 0 ? teamGamesPlayed / seasonLength : 0;
	}

	// Calculate expected PA/IP based on team season progress
	function getExpectedTotal(record: PlayerUsageRecord): number {
		const teamGamesPlayed = getTeamGamesPlayed(record.teamId);
		const seasonLength = getSeasonLength();
		const proration = seasonLength > 0 ? teamGamesPlayed / seasonLength : 0;
		return Math.round(record.actualSeasonTotal * proration);
	}

	// Get player name from cached data
	function getPlayerName(playerId: string): string {
		return playerNames[playerId] || playerId;
	}

	// Load player names from the database batting/pitching stats views
	async function loadPlayerNames(): Promise<void> {
		const db = await import('$lib/game-results/database.js').then(m => m.getGameDatabase());

		// Load batter names - join with games table to filter by series_id
		const batterStmt = db.prepare(`
			SELECT DISTINCT e.batter_id as playerId, e.batter_name as name
			FROM game_events e
			JOIN games g ON e.game_id = g.id
			WHERE g.series_id = ? AND e.batter_id IS NOT NULL AND e.batter_name IS NOT NULL
		`);
		batterStmt.bind([seriesId]);
		while (batterStmt.step()) {
			const row = batterStmt.getAsObject() as { playerId: string; name: string };
			if (row.playerId && row.name) {
				playerNames[row.playerId] = row.name;
			}
		}
		batterStmt.free();

		// Load pitcher names - join with games table to filter by series_id
		const pitcherStmt = db.prepare(`
			SELECT DISTINCT e.pitcher_id as playerId, e.pitcher_name as name
			FROM game_events e
			JOIN games g ON e.game_id = g.id
			WHERE g.series_id = ? AND e.pitcher_id IS NOT NULL AND e.pitcher_name IS NOT NULL
		`);
		pitcherStmt.bind([seriesId]);
		while (pitcherStmt.step()) {
			const row = pitcherStmt.getAsObject() as { playerId: string; name: string };
			if (row.playerId && row.name) {
				playerNames[row.playerId] = row.name;
			}
		}
		pitcherStmt.free();
	}

	// Calculate the actual percentage of expected (not capped)
	function calculateActualPercentage(record: PlayerUsageRecord): number {
		const expected = getExpectedTotal(record);
		return expected > 0 ? record.replayCurrentTotal / expected : 0;
	}
</script>

<div class="usage-report-view">
	{#if loading}
		<div class="animate-pulse">
			<div class="h-8 bg-zinc-800 rounded w-1/3 mb-4"></div>
			<div class="h-64 bg-zinc-800 rounded"></div>
		</div>
	{:else if error}
		<div class="text-red-400 p-4 bg-red-900/20 border border-red-800 rounded">
			{error}
		</div>
	{:else}
		<!-- Summary Dashboard -->
		<div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
			<div class="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
				<div class="text-zinc-400 text-xs uppercase mb-1">Total Players</div>
				<div class="text-2xl font-bold text-white">{summary().totalPlayers}</div>
				<div class="text-zinc-500 text-xs mt-1">
					{summary().totalBatters} batters, {summary().totalPitchers} pitchers
				</div>
			</div>

			<div class="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
				<div class="text-zinc-400 text-xs uppercase mb-1">Violations</div>
				<div class="text-2xl font-bold text-yellow-400">{summary().violations}</div>
				<div class="text-zinc-500 text-xs mt-1">
					{summary().underUsed} under, {summary().overUsed} over
				</div>
			</div>

			<div class="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
				<div class="text-zinc-400 text-xs uppercase mb-1">Under Used</div>
				<div class="text-2xl font-bold text-yellow-400">{summary().underUsed}</div>
				<div class="text-zinc-500 text-xs mt-1">&lt; 75% of actual</div>
			</div>

			<div class="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
				<div class="text-zinc-400 text-xs uppercase mb-1">Over Used</div>
				<div class="text-2xl font-bold text-red-400">{summary().overUsed}</div>
				<div class="text-zinc-500 text-xs mt-1">&gt; 125% of actual</div>
			</div>
		</div>

		<!-- Teams Breakdown -->
		<div class="mb-6">
			<h2 class="text-lg font-semibold text-white mb-3">Teams Breakdown</h2>
			<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
				{#each teamSummaries() as summary}
					<button
						type="button"
						class="bg-zinc-900 border border-zinc-800 rounded-lg p-4 cursor-pointer hover:bg-zinc-800/50 transition-colors text-left w-full"
						onclick={() => toggleTeamExpansion(summary.team.teamId)}
						aria-pressed={expandedTeams.has(summary.team.teamId)}
					>
						<div class="flex justify-between items-start mb-2">
							<div>
								<div class="text-white font-medium">{getTeamName(summary.team.teamId)}</div>
								<div class="text-zinc-500 text-xs">
									{summary.team.league || '-'}
									{summary.team.division ? ` / ${summary.team.division}` : ''}
								</div>
							</div>
							<div class="flex gap-1">
								<span class="text-zinc-400 text-xs">
									{summary.totalPlayers} players
								</span>
								{#if summary.violations > 0}
									<span class="text-yellow-400 text-xs">
										({summary.violations} issues)
									</span>
								{/if}
							</div>
						</div>
						<div class="flex justify-between text-xs text-zinc-400">
							<span>{summary.batters} batters</span>
							<span>{summary.pitchers} pitchers</span>
							<span>{(summary.avgPercentage * 100).toFixed(0)}% avg usage</span>
						</div>
					</button>
				{/each}
			</div>
		</div>

		<!-- Filters -->
		<div class="mb-4 flex flex-wrap gap-3 items-center">
			<div>
				<label for="usage-team-filter" class="text-zinc-400 text-xs block mb-1">Team</label>
				<select
					id="usage-team-filter"
					bind:value={selectedTeam}
					class="bg-zinc-900 border border-zinc-700 text-white text-sm rounded px-3 py-1.5 focus:outline-none focus:border-blue-500"
				>
					<option value={null}>All Teams</option>
					{#each seriesTeams as team}
						<option value={team.teamId}>{getTeamName(team.teamId)}</option>
					{/each}
				</select>
			</div>

			<div>
				<label for="usage-status-filter" class="text-zinc-400 text-xs block mb-1">Status</label>
				<select
					id="usage-status-filter"
					bind:value={selectedStatus}
					class="bg-zinc-900 border border-zinc-700 text-white text-sm rounded px-3 py-1.5 focus:outline-none focus:border-blue-500"
				>
					<option value="all">All Statuses</option>
					<option value="under">Under Used (&lt; 75%)</option>
					<option value="inRange">In Range (75-125%)</option>
					<option value="over">Over Used (&gt; 125%)</option>
				</select>
			</div>

			<div>
				<label for="usage-type-filter" class="text-zinc-400 text-xs block mb-1">Player Type</label>
				<select
					id="usage-type-filter"
					bind:value={selectedPlayerType}
					class="bg-zinc-900 border border-zinc-700 text-white text-sm rounded px-3 py-1.5 focus:outline-none focus:border-blue-500"
				>
					<option value="all">All Players</option>
					<option value="batters">Batters Only</option>
					<option value="pitchers">Pitchers Only</option>
				</select>
			</div>

			<div class="ml-auto text-zinc-400 text-sm">
				Showing {filteredRecords().length} of {usageRecords.length} players
			</div>
		</div>

		<!-- Players Table -->
		<div class="overflow-x-auto border border-zinc-800 rounded-lg">
			{#if filteredRecords().length === 0}
				<div class="text-center py-12 text-zinc-500">
					No players match the current filters.
				</div>
			{:else}
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-zinc-800 bg-zinc-900/50">
							<th class="text-left py-3 px-4 text-zinc-400 font-medium">ID</th>
							<th
								class="text-left py-3 px-4 text-zinc-400 font-medium cursor-pointer hover:text-white transition-colors"
								onclick={() => toggleSort('name')}
							>
								Player{getSortIndicator('name')}
							</th>
							<th class="text-left py-3 px-4 text-zinc-400 font-medium">Type</th>
							<th class="text-center py-3 px-4 text-zinc-400 font-medium">
								Team Games<br/>(Replay/Season)
							</th>
							<th class="text-center py-3 px-4 text-zinc-400 font-medium">
								{#if selectedPlayerType === 'pitchers'}
									IP
								{:else}
									PA
								{/if}
								<br/>(Replay/Expected/Actual)
							</th>
							<th
								class="text-center py-3 px-4 text-zinc-400 font-medium cursor-pointer hover:text-white transition-colors"
								onclick={() => toggleSort('percentage')}
							>
								% of Expected{getSortIndicator('percentage')}
							</th>
							<th
								class="text-center py-3 px-4 text-zinc-400 font-medium cursor-pointer hover:text-white transition-colors"
								onclick={() => toggleSort('status')}
							>
								Status{getSortIndicator('status')}
							</th>
						</tr>
					</thead>
					<tbody>
						{#each filteredRecords() as record}
							{@const teamGamesPlayed = getTeamGamesPlayed(record.teamId)}
							{@const seasonLength = getSeasonLength()}
							{@const prorationPct = getProrationPercentage(record)}
							{@const expectedTotal = getExpectedTotal(record)}
							{@const actualPercentage = calculateActualPercentage(record)}
							<tr class="border-b border-zinc-800/50 hover:bg-zinc-900/30">
								<td class="py-3 px-4 text-zinc-400 font-mono text-xs">{record.playerId} ({record.teamId})</td>
								<td class="py-3 px-4 text-white font-medium">{getPlayerName(record.playerId)}</td>
								<td class="py-3 px-4 text-zinc-400">
									{record.isPitcher ? 'P' : 'B'}
								</td>
								<td class="py-3 px-4 text-center text-zinc-400 font-mono text-xs">
									{teamGamesPlayed}/{seasonLength}
									<div class="text-zinc-500">{((teamGamesPlayed / seasonLength) * 100).toFixed(0)}%</div>
								</td>
								<td class="py-3 px-4 text-center">
									{#if record.isPitcher}
										<div class="font-mono text-xs">
											{(record.replayCurrentTotal / 3).toFixed(1)} / {(expectedTotal / 3).toFixed(1)} / {(record.actualSeasonTotal / 3).toFixed(1)}
											<div class="text-zinc-500">IP</div>
										</div>
									{:else}
										<div class="font-mono text-xs">
											{record.replayCurrentTotal} / {expectedTotal} / {record.actualSeasonTotal}
											<div class="text-zinc-500">PA</div>
										</div>
									{/if}
								</td>
								<td class="py-3 px-4 text-center">
									<span
										class="font-mono {(actualPercentage < 0.75 ||
											actualPercentage > 1.25)
											? 'text-yellow-400'
											: 'text-white'}"
									>
										{(actualPercentage * 100).toFixed(0)}%
									</span>
								</td>
								<td class="py-3 px-4 text-center">
									<span
										class="text-xs px-2 py-1 rounded border {getStatusBadgeClass(
											record.status
										)}"
									>
										{record.status === 'under'
											? 'Under'
											: record.status === 'over'
												? 'Over'
												: 'OK'}
									</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>

		<!-- Legend -->
		<div class="mt-4 text-xs text-zinc-500">
			<span class="font-medium">Thresholds:</span> Under Used &lt; 75% |
			<span class="text-green-400">In Range 75-125%</span> |
			<span class="text-red-400">Over Used &gt; 125%</span>
		</div>
	{/if}
</div>
