<script lang="ts">
	import { onMount } from 'svelte';
	import BoxScore from './BoxScore.svelte';
	import { getGame, getInningLines } from '../index.js';
	import type { InningLine, SavedGame } from '../types.js';

	interface Props {
		gameId: string;
		onClose: () => void;
	}

	let { gameId, onClose }: Props = $props();

	let loading = $state(true);
	let game = $state<SavedGame | null>(null);
	let inningLines = $state<InningLine[]>([]);

	onMount(async () => {
		try {
			game = await getGame(gameId);
			inningLines = await getInningLines(gameId);
		} catch (e) {
			console.error('Failed to load game details:', e);
		} finally {
			loading = false;
		}
	});

	function formatDate(dateStr: string | null): string {
		if (!dateStr) return 'Unknown';
		return new Date(dateStr).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}
</script>

<div class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onclick={onClose}>
	<div class="bg-zinc-900 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto" onclick={(e) => e.stopPropagation()}>
		<div class="p-6">
			<div class="flex justify-between items-center mb-4">
				<h2 class="text-xl font-bold text-white">Game Details</h2>
				<button onclick={onClose} class="text-zinc-400 hover:text-white text-2xl">&times;</button>
			</div>

			{#if loading}
				<p class="text-zinc-400">Loading...</p>
			{:else if game}
				<!-- Box Score -->
				{#if inningLines.length > 0}
					<BoxScore
						awayTeamId={game.awayTeamId}
						homeTeamId={game.homeTeamId}
						awayScore={game.awayScore}
						homeScore={game.homeScore}
						innings={game.innings}
						{inningLines}
					/>
				{/if}

				<!-- Game Info -->
				<div class="mb-6">
					<h3 class="text-lg font-semibold text-white mb-3">Game Info</h3>
					<div class="grid grid-cols-2 gap-4 text-sm">
						<div>
							<span class="text-zinc-400">Date:</span>
							<span class="text-white ml-2">{formatDate(game.scheduledDate)}</span>
						</div>
						<div>
							<span class="text-zinc-400">Innings:</span>
							<span class="text-white ml-2">{game.innings}</span>
						</div>
					</div>
				</div>

				<!-- Play-by-play coming soon -->
				<div>
					<h3 class="text-lg font-semibold text-white mb-3">Play-by-Play</h3>
					<p class="text-zinc-400 text-sm">Play-by-play details coming soon...</p>
				</div>
			{/if}
		</div>
	</div>
</div>
