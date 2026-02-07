<script lang="ts">
	interface Props {
		standings: Array<{
			teamId: string;
			seasonYear: number;
			league: string | null;
			division: string | null;
			gamesPlayed: number;
			wins: number;
			losses: number;
			winPercentage: number;
			runsScored: number;
			runsAllowed: number;
			gamesBack: number;
			streak: string;
		}>;
	}

	let { standings }: Props = $props();

	interface DivisionGroup {
		division: string | null;
		standings: typeof standings;
	}

	// Track which leagues are expanded (all expanded by default)
	let expandedLeagues = $state<Set<string>>(new Set());

	// Initialize expanded leagues on first render
	$effect(() => {
		const leagues = new Set<string>();
		for (const s of standings) {
			const leagueKey = s.league || 'Other';
			leagues.add(leagueKey);
		}
		expandedLeagues = leagues;
	});

	// Group standings by league, then by division within each league
	const groupedByLeague = $derived(() => {
		const leagues = new Map<string, DivisionGroup[]>();

		for (const s of standings) {
			const leagueKey = s.league || 'Other';
			if (!leagues.has(leagueKey)) {
				leagues.set(leagueKey, []);
			}

			// Find if this division group already exists
			const leagueGroups = leagues.get(leagueKey)!;
			const divisionKey = s.division || null;
			let divGroup = leagueGroups.find(g => g.division === divisionKey);

			if (!divGroup) {
				divGroup = { division: divisionKey, standings: [] };
				leagueGroups.push(divGroup);
			}

			divGroup.standings.push(s);
		}

		// Convert to array and sort divisions alphabetically
		const result: Array<{ name: string; divisions: DivisionGroup[] }> = [];
		for (const [leagueName, divisions] of leagues) {
			result.push({
				name: leagueName,
				divisions: divisions
			});
		}

		// Sort leagues: AL, NL, then others
		return result.sort((a, b) => {
			const order = ['AL', 'NL'];
			const aIdx = order.indexOf(a.name);
			const bIdx = order.indexOf(b.name);
			if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
			if (aIdx >= 0) return -1;
			if (bIdx >= 0) return 1;
			return a.name.localeCompare(b.name);
		});
	});

	const getDivisionGroups = (leagueDivisions: DivisionGroup[]) => {
		const hasDivs = leagueDivisions.some(d => d.division);
		if (!hasDivs) return [{ division: null, standings: leagueDivisions.flatMap(d => d.standings) }];

		return leagueDivisions.map(d => ({
			division: d.division,
			standings: d.standings
		})).sort((a, b) => {
			if (!a.division) return 1;
			if (!b.division) return -1;
			return a.division.localeCompare(b.division);
		});
	};

	const getLeagueDisplayName = (league: string) => {
		if (league === 'AL') return 'American League';
		if (league === 'NL') return 'National League';
		return league;
	};

	const toggleLeague = (leagueName: string) => {
		const newSet = new Set(expandedLeagues);
		if (newSet.has(leagueName)) {
			newSet.delete(leagueName);
		} else {
			newSet.add(leagueName);
		}
		expandedLeagues = newSet;
	};
</script>

<div class="space-y-8">
	{#each groupedByLeague() as league}
		<div>
			<button
				onclick={() => toggleLeague(league.name)}
				class="flex items-center gap-2 text-xl font-bold text-white hover:text-zinc-300 transition-colors cursor-pointer mb-4"
			>
				<span class="transform transition-transform {expandedLeagues.has(league.name) ? 'rotate-90' : ''}">
					<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="9 18 15 12 9 6"></polyline>
					</svg>
				</span>
				{getLeagueDisplayName(league.name)}
			</button>

			{#if expandedLeagues.has(league.name)}
				<div class="space-y-6">
					{#each getDivisionGroups(league.divisions) as divGroup}
						<div>
							{#if divGroup.division}
								<h3 class="text-base font-semibold text-zinc-300 mb-3 ml-3">{divGroup.division}</h3>
							{/if}
							<div class="overflow-x-auto">
								<table class="w-full text-sm">
									<thead>
										<tr class="border-b border-zinc-800">
											<th class="text-left py-2 px-3 text-zinc-400 font-medium">Team</th>
											<th class="text-left py-2 px-3 text-zinc-400 font-medium">Yr</th>
											<th class="text-center py-2 px-3 text-zinc-400 font-medium">G</th>
											<th class="text-center py-2 px-3 text-zinc-400 font-medium">W-L</th>
											<th class="text-center py-2 px-3 text-zinc-400 font-medium">Win%</th>
											<th class="text-center py-2 px-3 text-zinc-400 font-medium">RS</th>
											<th class="text-center py-2 px-3 text-zinc-400 font-medium">RA</th>
											<th class="text-center py-2 px-3 text-zinc-400 font-medium">GB</th>
										</tr>
									</thead>
									<tbody>
										{#each divGroup.standings as s}
											<tr class="border-b border-zinc-800/50 hover:bg-zinc-900/50">
												<td class="py-2 px-3 text-white font-medium">{s.teamId}</td>
												<td class="py-2 px-3 text-zinc-400">{s.seasonYear}</td>
												<td class="py-2 px-3 text-zinc-400 text-center">{s.gamesPlayed}</td>
												<td class="py-2 px-3 text-white text-center">{s.wins}-{s.losses}</td>
												<td class="py-2 px-3 text-zinc-400 text-center">{s.winPercentage.toFixed(3)}</td>
												<td class="py-2 px-3 text-zinc-400 text-center">{s.runsScored}</td>
												<td class="py-2 px-3 text-zinc-400 text-center">{s.runsAllowed}</td>
												<td class="py-2 px-3 text-zinc-400 text-center">{s.gamesBack > 0 ? s.gamesBack.toFixed(1) : '-'}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/each}
</div>
