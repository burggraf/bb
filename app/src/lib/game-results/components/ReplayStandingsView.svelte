<script lang="ts">
	import StandingsTable from './StandingsTable.svelte';
	import ReplayControls from './ReplayControls.svelte';
	import AnimatedGameDisplay from './AnimatedGameDisplay.svelte';
	import { SeasonReplayEngine } from '$lib/season-replay/index.js';

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
		seriesId: string;
		seasonYear: number;
		onStandingsUpdate: () => Promise<void>;
	}

	let props: Props = $props();
	let { seriesId, seasonYear, onStandingsUpdate } = props;

	// Engine state for animated display
	let engine = $state<SeasonReplayEngine | null>(null);
	let animatedMode = $state(false);

	// Handle engine ready from ReplayControls
	function onEngineReady(engineRef: SeasonReplayEngine) {
		engine = engineRef;
	}

	// Handle animated mode toggle from ReplayControls
	function handleAnimatedChange(animated: boolean) {
		animatedMode = animated;
	}
</script>

<div class="flex gap-6">
	<!-- Standings Table (flexible width) -->
	<div class="flex-1 flex flex-col gap-4">
		<!-- Animated Game Display (shown when animated mode is on) -->
		{#if animatedMode && engine}
			<AnimatedGameDisplay engine={engine} {seasonYear} animated={animatedMode} />
		{/if}

		<!-- Standings Table -->
		{#if props.standings.length === 0}
			<div class="bg-zinc-900 rounded-lg p-8 text-center">
				<p class="text-zinc-400 text-lg">No games played yet</p>
				<p class="text-zinc-500 text-sm mt-2">Use the controls on the right to start the season replay</p>
			</div>
		{:else}
			<StandingsTable standings={props.standings} />
		{/if}
	</div>

	<!-- Replay Controls (fixed width) -->
	<div class="w-80 flex-shrink-0">
		<ReplayControls
			{seriesId}
			{seasonYear}
			{onStandingsUpdate}
			onEngineReady={onEngineReady}
			onAnimatedChange={handleAnimatedChange}
		/>
	</div>
</div>
