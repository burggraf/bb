<script lang="ts">
	import type { InningLine } from '../types.js';

	interface Props {
		awayTeamId: string;
		homeTeamId: string;
		awayScore: number;
		homeScore: number;
		innings: number;
		inningLines: InningLine[];
	}

	let { awayTeamId, homeTeamId, awayScore, homeScore, innings, inningLines }: Props = $props();

	// Group by team and sort by inning
	const awayLines = $derived(
		inningLines.filter((l) => l.teamId === awayTeamId).sort((a, b) => a.inning - b.inning)
	);
	const homeLines = $derived(
		inningLines.filter((l) => l.teamId === homeTeamId).sort((a, b) => a.inning - b.inning)
	);

	// Calculate totals from lines or use provided scores
	const awayHits = $derived(awayLines.reduce((sum, l) => sum + l.hits, 0));
	const homeHits = $derived(homeLines.reduce((sum, l) => sum + l.hits, 0));
	const awayErrors = $derived(awayLines.reduce((sum, l) => sum + l.errors, 0));
	const homeErrors = $derived(homeLines.reduce((sum, l) => sum + l.errors, 0));

	// Create array for all innings
	const allInnings = $derived(Array.from({ length: Math.max(innings, 9) }, (_, i) => i + 1));
</script>

<div class="mb-6">
	<h3 class="text-lg font-semibold text-white mb-3">Box Score</h3>
	<div class="overflow-x-auto">
		<table class="w-full text-sm font-mono">
			<thead>
				<tr class="border-b border-zinc-800">
					<th class="text-left py-2 px-2 text-zinc-400"></th>
					{#each allInnings as i}
						<th class="text-center py-2 px-2 text-zinc-400">{i}</th>
					{/each}
					<th class="text-center py-2 px-2 text-zinc-400 font-bold">R</th>
					<th class="text-center py-2 px-2 text-zinc-400 font-bold">H</th>
					<th class="text-center py-2 px-2 text-zinc-400 font-bold">E</th>
				</tr>
			</thead>
			<tbody>
				<tr class="border-b border-zinc-800/50">
					<td class="py-2 px-2 text-white font-semibold">{awayTeamId}</td>
					{#each allInnings as i}
						{@const line = awayLines.find((l) => l.inning === i)}
						<td class="py-2 px-2 text-center text-zinc-300">{line?.runs ?? '-'}</td>
					{/each}
					<td class="py-2 px-2 text-center text-white font-bold">{awayScore}</td>
					<td class="py-2 px-2 text-center text-zinc-300">{awayHits}</td>
					<td class="py-2 px-2 text-center text-zinc-300">{awayErrors}</td>
				</tr>
				<tr class="border-b border-zinc-800/50">
					<td class="py-2 px-2 text-white font-semibold">{homeTeamId}</td>
					{#each allInnings as i}
						{@const line = homeLines.find((l) => l.inning === i)}
						<td class="py-2 px-2 text-center text-zinc-300">{line?.runs ?? '-'}</td>
					{/each}
					<td class="py-2 px-2 text-center text-white font-bold">{homeScore}</td>
					<td class="py-2 px-2 text-center text-zinc-300">{homeHits}</td>
					<td class="py-2 px-2 text-center text-zinc-300">{homeErrors}</td>
				</tr>
			</tbody>
		</table>
	</div>
</div>
