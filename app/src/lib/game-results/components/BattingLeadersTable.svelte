<script lang="ts">
	interface BattingStat {
		batterId: string;
		batterName: string;
		pa: number;
		ab: number;
		avg: number;
		obp: number;
		slg: number;
		homeRuns: number;
		rbi: number;
	}

	interface Props {
		stats: BattingStat[];
		minPa?: number;
	}

	let { stats, minPa = 10 }: Props = $props();

	// Filter by minimum PA
	const filteredStats = $derived(
		stats.filter(s => s.pa >= minPa).slice(0, 20)
	);
</script>

<div class="overflow-x-auto">
	{#if filteredStats.length === 0}
		<p class="text-zinc-500 text-center py-8">Not enough data for leaders (minimum {minPa} PA).</p>
	{:else}
		<table class="w-full text-sm">
			<thead>
				<tr class="border-b border-zinc-800">
					<th class="text-left py-2 px-3 text-zinc-400 font-medium">Player</th>
					<th class="text-left py-2 px-3 text-zinc-400 font-medium">Team</th>
					<th class="text-center py-2 px-3 text-zinc-400 font-medium">G</th>
					<th class="text-center py-2 px-3 text-zinc-400 font-medium">AB</th>
					<th class="text-center py-2 px-3 text-zinc-400 font-medium">AVG</th>
					<th class="text-center py-2 px-3 text-zinc-400 font-medium">OBP</th>
					<th class="text-center py-2 px-3 text-zinc-400 font-medium">SLG</th>
					<th class="text-center py-2 px-3 text-zinc-400 font-medium">HR</th>
					<th class="text-center py-2 px-3 text-zinc-400 font-medium">RBI</th>
				</tr>
			</thead>
			<tbody>
				{#each filteredStats as s}
					<tr class="border-b border-zinc-800/50 hover:bg-zinc-900/50">
						<td class="py-2 px-3 text-white font-medium">{s.batterName}</td>
						<td class="py-2 px-3 text-zinc-400">{s.batterId.slice(0, 3)}</td>
						<td class="py-2 px-3 text-zinc-400 text-center">-</td>
						<td class="py-2 px-3 text-white text-center">{s.ab}</td>
						<td class="py-2 px-3 text-white text-center">{s.avg.toFixed(3)}</td>
						<td class="py-2 px-3 text-white text-center">{s.obp.toFixed(3)}</td>
						<td class="py-2 px-3 text-white text-center">{s.slg.toFixed(3)}</td>
						<td class="py-2 px-3 text-white text-center">{s.homeRuns}</td>
						<td class="py-2 px-3 text-white text-center">{s.rbi}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>
