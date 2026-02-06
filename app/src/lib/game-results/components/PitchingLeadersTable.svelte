<script lang="ts">
	interface PitchingStat {
		pitcherId: string;
		pitcherName: string;
		games: number;
		outsRecorded: number;
		era: number;
		whip: number;
		strikeouts: number;
		earnedRuns: number;
		runsAllowed: number;
	}

	interface Props {
		stats: PitchingStat[];
		minBf?: number;
	}

	let { stats, minBf = 10 }: Props = $props();

	// Calculate IP from outs
	function calcIP(outs: number): string {
		const innings = Math.floor(outs / 3);
		const partial = outs % 3;
		return partial > 0 ? `${innings}.${partial}` : `${innings}`;
	}

	// Filter by minimum batters faced (approximate from games for now)
	const filteredStats = $derived(
		stats.filter(s => s.outsRecorded >= minBf * 3).slice(0, 20)
	);
</script>

<div class="overflow-x-auto">
	{#if filteredStats.length === 0}
		<p class="text-zinc-500 text-center py-8">Not enough data for leaders (minimum {minBf} BF).</p>
	{:else}
		<table class="w-full text-sm">
			<thead>
				<tr class="border-b border-zinc-800">
					<th class="text-left py-2 px-3 text-zinc-400 font-medium">Player</th>
					<th class="text-left py-2 px-3 text-zinc-400 font-medium">Team</th>
					<th class="text-center py-2 px-3 text-zinc-400 font-medium">G</th>
					<th class="text-center py-2 px-3 text-zinc-400 font-medium">IP</th>
					<th class="text-center py-2 px-3 text-zinc-400 font-medium">ERA</th>
					<th class="text-center py-2 px-3 text-zinc-400 font-medium">WHIP</th>
					<th class="text-center py-2 px-3 text-zinc-400 font-medium">K</th>
				</tr>
			</thead>
			<tbody>
				{#each filteredStats as s}
					<tr class="border-b border-zinc-800/50 hover:bg-zinc-900/50">
						<td class="py-2 px-3 text-white font-medium">{s.pitcherName}</td>
						<td class="py-2 px-3 text-zinc-400">{s.pitcherId.slice(0, 3)}</td>
						<td class="py-2 px-3 text-white text-center">{s.games}</td>
						<td class="py-2 px-3 text-white text-center">{calcIP(s.outsRecorded)}</td>
						<td class="py-2 px-3 text-white text-center">{s.era.toFixed(2)}</td>
						<td class="py-2 px-3 text-white text-center">{s.whip.toFixed(2)}</td>
						<td class="py-2 px-3 text-white text-center">{s.strikeouts}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>
