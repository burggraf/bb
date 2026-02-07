<script lang="ts">
	import StandingsTable from './StandingsTable.svelte';
	import ReplayControls from './ReplayControls.svelte';

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

	let { standings, seriesId, seasonYear, onStandingsUpdate }: Props = $props();
</script>

<div class="flex gap-6">
	<!-- Standings Table (flexible width) -->
	<div class="flex-1">
		<StandingsTable {standings} />
	</div>

	<!-- Replay Controls (fixed width) -->
	<div class="w-80 flex-shrink-0">
		<ReplayControls {seriesId} {seasonYear} {onStandingsUpdate} />
	</div>
</div>
