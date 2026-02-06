<script lang="ts">
	import GameDetailModal from './GameDetailModal.svelte';
	import type { SavedGame } from '../types';

	interface Props {
		games: SavedGame[];
	}

	let { games }: Props = $props();

	let selectedGame = $state<string | null>(null);

	// Format date for display
	function formatDate(dateStr: string | null): string {
		if (!dateStr) return 'Date TBD';
		return new Date(dateStr).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	// Determine winner
	function getWinner(awayScore: number, homeScore: number): 'away' | 'home' | 'tie' {
		if (awayScore > homeScore) return 'away';
		if (homeScore > awayScore) return 'home';
		return 'tie';
	}
</script>

<div class="overflow-x-auto">
	<table class="w-full text-sm">
		<thead>
			<tr class="border-b border-zinc-800">
				<th class="text-left py-2 px-3 text-zinc-400 font-medium">Date</th>
				<th class="text-left py-2 px-3 text-zinc-400 font-medium">Away</th>
				<th class="text-left py-2 px-3 text-zinc-400 font-medium">Home</th>
				<th class="text-center py-2 px-3 text-zinc-400 font-medium">Score</th>
				<th class="text-center py-2 px-3 text-zinc-400 font-medium">Winner</th>
			</tr>
		</thead>
		<tbody>
			{#each games as game}
				<tr
					class="border-b border-zinc-800/50 hover:bg-zinc-900/50 cursor-pointer"
					onclick={() => (selectedGame = game.id)}
				>
					<td class="py-2 px-3 text-zinc-400">{formatDate(game.scheduledDate || game.playedAt)}</td>
					<td
						class="py-2 px-3 {getWinner(game.awayScore, game.homeScore) === 'away'
							? 'text-green-400 font-medium'
							: 'text-white'}"
					>
						{game.awayTeamId}
					</td>
					<td
						class="py-2 px-3 {getWinner(game.awayScore, game.homeScore) === 'home'
							? 'text-green-400 font-medium'
							: 'text-white'}"
					>
						{game.homeTeamId}
					</td>
					<td class="py-2 px-3 text-white text-center">{game.awayScore}-{game.homeScore}</td>
					<td class="py-2 px-3 text-zinc-400 text-center">
						{game.innings} {game.innings === 9 ? '' : 'inn'}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
	{#if games.length === 0}
		<p class="text-zinc-500 text-center py-8">No games in this series yet.</p>
	{/if}
</div>

{#if selectedGame}
	<GameDetailModal gameId={selectedGame} onClose={() => (selectedGame = null)} />
{/if}
