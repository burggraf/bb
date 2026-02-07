<script lang="ts">
	import type { BattingStat } from '../types.js';

	interface Props {
		stats: BattingStat[];
		minPa?: number;
	}

	let { stats, minPa = 10 }: Props = $props();

	type SortColumn = 'avg' | 'obp' | 'slg' | 'homeRuns' | 'rbi' | 'pa' | 'ab' | 'hits';

	let sortBy = $state<SortColumn>('avg');
	let sortDirection = $state<'ASC' | 'DESC'>('DESC');

	function toggleSort(column: SortColumn, defaultDirection: 'ASC' | 'DESC' = 'DESC') {
		if (sortBy === column) {
			sortDirection = sortDirection === 'DESC' ? 'ASC' : 'DESC';
		} else {
			sortBy = column;
			sortDirection = defaultDirection;
		}
	}

	// Helper to check if a row is a "total" or summary row that shouldn't be sorted
	function isTotalRow(stat: BattingStat): boolean {
		return stat.batterName?.toLowerCase().includes('total') ||
		       stat.batterId?.toLowerCase().includes('total');
	}

	// Sort stats by current column and direction, then filter by minimum PA
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

		// Filter by minimum PA, then append total rows at the end
		return [...sorted.filter(s => s.pa >= minPa).slice(0, 20), ...totalRows];
	});

	function getSortIndicator(column: SortColumn): string {
		if (sortBy !== column) return '';
		return sortDirection === 'DESC' ? ' ▼' : ' ▲';
	}
</script>

<div class="overflow-x-auto">
	{#if filteredStats().length === 0}
		<p class="text-zinc-500 text-center py-8">Not enough data for leaders (minimum {minPa} PA).</p>
	{:else}
		<table class="w-full text-sm">
			<thead>
				<tr class="border-b border-zinc-800">
					<th class="text-left py-2 px-3 text-zinc-400 font-medium">Player</th>
					<th class="text-left py-2 px-3 text-zinc-400 font-medium">Team</th>
					<th
						class="text-center py-2 px-3 text-zinc-400 font-medium cursor-pointer hover:text-white transition-colors"
						onclick={() => toggleSort('pa')}
					>PA{getSortIndicator('pa')}</th>
					<th
						class="text-center py-2 px-3 text-zinc-400 font-medium cursor-pointer hover:text-white transition-colors"
						onclick={() => toggleSort('ab')}
					>AB{getSortIndicator('ab')}</th>
					<th
						class="text-center py-2 px-3 text-zinc-400 font-medium cursor-pointer hover:text-white transition-colors"
						onclick={() => toggleSort('avg')}
					>AVG{getSortIndicator('avg')}</th>
					<th
						class="text-center py-2 px-3 text-zinc-400 font-medium cursor-pointer hover:text-white transition-colors"
						onclick={() => toggleSort('obp')}
					>OBP{getSortIndicator('obp')}</th>
					<th
						class="text-center py-2 px-3 text-zinc-400 font-medium cursor-pointer hover:text-white transition-colors"
						onclick={() => toggleSort('slg')}
					>SLG{getSortIndicator('slg')}</th>
					<th
						class="text-center py-2 px-3 text-zinc-400 font-medium cursor-pointer hover:text-white transition-colors"
						onclick={() => toggleSort('homeRuns')}
					>HR{getSortIndicator('homeRuns')}</th>
					<th
						class="text-center py-2 px-3 text-zinc-400 font-medium cursor-pointer hover:text-white transition-colors"
						onclick={() => toggleSort('rbi')}
					>RBI{getSortIndicator('rbi')}</th>
				</tr>
			</thead>
			<tbody>
				{#each filteredStats() as s}
					<tr class="border-b border-zinc-800/50 hover:bg-zinc-900/50">
						<td class="py-2 px-3 text-white font-medium">{s.batterName}</td>
						<td class="py-2 px-3 text-zinc-400">{s.batterId.slice(0, 3).toUpperCase()}</td>
						<td class="py-2 px-3 text-white text-center">{s.pa}</td>
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
