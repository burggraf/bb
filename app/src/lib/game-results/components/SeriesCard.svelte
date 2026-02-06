<script lang="ts">
	interface Props {
		series: {
			id: string;
			name: string;
			seriesType: string;
			status: string;
			updatedAt: string;
			description: string | null;
		};
		gameCount?: number;
	}

	let { series, gameCount = 0 }: Props = $props();

	const typeColors: Record<string, string> = {
		season_replay: 'bg-blue-900/50 text-blue-300 border-blue-700',
		tournament: 'bg-purple-900/50 text-purple-300 border-purple-700',
		exhibition: 'bg-green-900/50 text-green-300 border-green-700',
		custom: 'bg-zinc-800 text-zinc-300 border-zinc-700'
	};

	const statusColors: Record<string, string> = {
		active: 'bg-green-500/20 text-green-400',
		completed: 'bg-zinc-700 text-zinc-300',
		archived: 'bg-yellow-500/20 text-yellow-400'
	};

	function formatDate(dateStr: string): string {
		return new Date(dateStr).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}
</script>

<a
	href="/game-results/series/{series.id}"
	class="block bg-zinc-900 border border-zinc-800 rounded-lg p-5 hover:border-zinc-700 hover:bg-zinc-800/50 transition-all"
>
	<div class="flex justify-between items-start mb-3">
		<h3 class="text-lg font-semibold text-white">{series.name}</h3>
		<span class="text-xs px-2 py-1 rounded {statusColors[series.status] || statusColors.custom}">
			{series.status}
		</span>
	</div>

	{#if series.description}
		<p class="text-zinc-400 text-sm mb-3 line-clamp-2">{series.description}</p>
	{/if}

	<div class="flex items-center gap-2 text-xs">
		<span class="px-2 py-1 rounded border {typeColors[series.seriesType] || typeColors.custom}">
			{series.seriesType.replace('_', ' ')}
		</span>
		{#if gameCount > 0}
			<span class="text-zinc-500">{gameCount} game{gameCount === 1 ? '' : 's'}</span>
		{/if}
		<span class="text-zinc-600 ml-auto">Updated {formatDate(series.updatedAt)}</span>
	</div>
</a>
