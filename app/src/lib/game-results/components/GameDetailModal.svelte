<script lang="ts">
	interface Props {
		gameId: string;
		onClose: () => void;
	}

	let { gameId, onClose }: Props = $props();
	// TODO: Load game details, events, inning lines
</script>

<div class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onclick={onClose}>
	<div class="bg-zinc-900 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto" onclick={(e) => e.stopPropagation()}>
		<div class="p-6">
			<div class="flex justify-between items-center mb-4">
				<h2 class="text-xl font-bold text-white">Game Details</h2>
				<button onclick={onClose} class="text-zinc-400 hover:text-white text-2xl">&times;</button>
			</div>
			<p class="text-zinc-400">Game ID: {gameId}</p>
			<p class="text-zinc-400">Box score and play-by-play coming soon...</p>
		</div>
	</div>
</div>
