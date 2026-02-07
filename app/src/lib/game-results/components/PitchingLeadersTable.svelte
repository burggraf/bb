<script lang="ts">
	import type { PitchingStat } from '../types.js';

	interface Props {
		stats: PitchingStat[];
		minBf?: number;
	}

	let { stats, minBf = 10 }: Props = $props();

	type SortColumn = 'era' | 'whip' | 'strikeouts' | 'games' | 'outsRecorded' | 'battersFaced' | 'homeRunsAllowed';

	let sortBy = $state<SortColumn>('era');
	let sortDirection = $state<'ASC' | 'DESC'>('ASC');

	function toggleSort(column: SortColumn, defaultDirection: 'ASC' | 'DESC' = 'DESC') {
		if (sortBy === column) {
			sortDirection = sortDirection === 'DESC' ? 'ASC' : 'DESC';
		} else {
			sortBy = column;
			sortDirection = defaultDirection;
		}
	}

	// Calculate IP from outs
	function calcIP(outs: number): string {
		const innings = Math.floor(outs / 3);
		const partial = outs % 3;
		return partial > 0 ? `${innings}.${partial}` : `${innings}`;
	}

	// Helper to check if a row is a "total" or summary row that shouldn't be sorted
	function isTotalRow(stat: PitchingStat): boolean {
		return stat.pitcherName?.toLowerCase().includes('total') ||
		       stat.pitcherId?.toLowerCase().includes('total');
	}

	// Sort stats by current column and direction, then filter by minimum outs
	// Total/summary rows stay at the bottom and are not sorted
	const filteredStats = $derived(() => {
		const normalRows = stats.filter(s => !isTotalRow(s));
		const totalRows = stats.filter(s => isTotalRow(s));

		const sorted = [...normalRows].sort((a, b) => {
			const aVal = a[sortBy];
			const bVal = b[sortBy];
			const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
			return sortDirection === 'DESC' ? -comparison : comparison;
		});

		// Filter by minimum outs, then append total rows at the end
		return [...sorted.filter(s => s.outsRecorded >= minBf * 3).slice(0, 20), ...totalRows];
	});

	function getSortIndicator(column: SortColumn): string {
		if (sortBy !== column) return '';
		return sortDirection === 'DESC' ? ' ▼' : ' ▲';
	}
</script>

<div class="overflow-x-auto">
	{#if filteredStats().length === 0}
		<p class="text-zinc-500 text-center py-8">Not enough data for leaders (minimum {minBf} BF).</p>
	{:else}
		<table class="w-full text-sm">
			<thead>
				<tr class="border-b border-zinc-800">
					<th class="text-left py-2 px-3 text-zinc-400 font-medium">Player</th>
					<th class="text-left py-2 px-3 text-zinc-400 font-medium">Team</th>
					<th
						class="text-center py-2 px-3 text-zinc-400 font-medium cursor-pointer hover:text-white transition-colors"
						onclick={() => toggleSort('games')}
					>G{getSortIndicator('games')}</th>
					<th
						class="text-center py-2 px-3 text-zinc-400 font-medium cursor-pointer hover:text-white transition-colors"
						onclick={() => toggleSort('outsRecorded')}
					>IP{getSortIndicator('outsRecorded')}</th>
					<th
						class="text-center py-2 px-3 text-zinc-400 font-medium cursor-pointer hover:text-white transition-colors"
						onclick={() => toggleSort('era', 'ASC')}
					>ERA{getSortIndicator('era')}</th>
					<th
						class="text-center py-2 px-3 text-zinc-400 font-medium cursor-pointer hover:text-white transition-colors"
						onclick={() => toggleSort('whip', 'ASC')}
					>WHIP{getSortIndicator('whip')}</th>
					<th
						class="text-center py-2 px-3 text-zinc-400 font-medium cursor-pointer hover:text-white transition-colors"
						onclick={() => toggleSort('strikeouts')}
					>K{getSortIndicator('strikeouts')}</th>
				</tr>
			</thead>
			<tbody>
				{#each filteredStats() as s}
					<tr class="border-b border-zinc-800/50 hover:bg-zinc-900/50">
						<td class="py-2 px-3 text-white font-medium">{s.pitcherName}</td>
						<td class="py-2 px-3 text-zinc-400">{s.pitcherId.slice(0, 3).toUpperCase()}</td>
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
