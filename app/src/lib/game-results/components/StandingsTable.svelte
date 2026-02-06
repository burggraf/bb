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

	// Group standings by division if applicable
	const groupedStandings = $derived(() => {
		const hasDivisions = standings.some(s => s.division);
		if (!hasDivisions) return { 'Overall': standings };

		const groups: Record<string, typeof standings> = {};
		for (const s of standings) {
			const key = `${s.league || ''} ${s.division || ''}`.trim() || 'Overall';
			if (!groups[key]) groups[key] = [];
			groups[key].push(s);
		}
		return groups;
	});
</script>

<div class="space-y-6">
	{#each Object.entries(groupedStandings()) as [groupName, groupStandings]}
		<div>
			{#if groupName !== 'Overall'}
				<h3 class="text-lg font-semibold text-white mb-3">{groupName}</h3>
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
						{#each groupStandings as s}
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
