<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { SeasonReplayEngine } from '$lib/season-replay/index.js';
  import { loadSeason, type Season } from '$lib/game/sqlite-season-loader.js';
  import GameScoreboard from '$lib/components/GameScoreboard.svelte';
  import type { GameState, PlayEvent } from '$lib/game/types.js';

  interface Props {
    engine: SeasonReplayEngine | null;
    seasonYear: number;
    animated: boolean;
  }

  let { engine, seasonYear, animated }: Props = $props();

  // Game state for display
  let gameState = $state<GameState | null>(null);
  let season = $state<Season | null>(null);
  let awayTeamId = $state<string | null>(null);
  let homeTeamId = $state<string | null>(null);
  let error = $state<string | null>(null);

  // Computed values for GameScoreboard
  let awayScore = $derived(0);
  let homeScore = $derived(0);
  let runnerIds = $derived<[string | null, string | null, string | null]>([null, null, null]);
  let runnerNames = $derived<[string | null, string | null, string | null]>([null, null, null]);
  let currentBatter = $derived('Loading...');
  let currentPitcher = $derived('Loading...');

  // Subscribe to engine events
  let unsubscribe: (() => void) | null = null;

  onMount(async () => {
    if (!engine) return;

    // Subscribe to plate appearance events
    const handlePlateAppearance = (data: any) => {
      const { gameState: state, playEvent } = data;
      gameState = state;
      awayTeamId = state.meta.awayTeam;
      homeTeamId = state.meta.homeTeam;

      // Load season if not already loaded
      if (!season && seasonYear) {
        loadSeason(seasonYear).then(s => {
          season = s;
        });
      }

      // Update derived values from state
      updateDisplayValues();
    };

    engine.on('plateAppearance', handlePlateAppearance);

    unsubscribe = () => {
      engine.off('plateAppearance', handlePlateAppearance);
    };
  });

  onDestroy(() => {
    unsubscribe?.();
  });

  function updateDisplayValues() {
    if (!gameState) return;

    // Calculate scores
    let away = 0;
    let home = 0;
    for (const play of gameState.plays) {
      if (play.isTopInning) {
        away += play.runsScored;
      } else {
        home += play.runsScored;
      }
    }
    awayScore = away;
    homeScore = home;

    // Update runner IDs and names
    runnerIds = [gameState.bases[0], gameState.bases[1], gameState.bases[2]];
    runnerNames = [
      gameState.bases[0] && season?.batters[gameState.bases[0]] ? season.batters[gameState.bases[0]].name : null,
      gameState.bases[1] && season?.batters[gameState.bases[1]] ? season.batters[gameState.bases[1]].name : null,
      gameState.bases[2] && season?.batters[gameState.bases[2]] ? season.batters[gameState.bases[2]].name : null,
    ];

    // Update current matchup
    if (gameState.plays.length > 0) {
      const lastPlay = gameState.plays[0];
      currentBatter = lastPlay.batterName;
      currentPitcher = lastPlay.pitcherName;
    }
  }

  // Get team display names
  const awayTeamName = $derived(
    awayTeamId && season?.teams[awayTeamId]
      ? `${season.teams[awayTeamId].city} ${season.teams[awayTeamId].nickname}`
      : awayTeamId ?? 'Away'
  );
  const homeTeamName = $derived(
    homeTeamId && season?.teams[homeTeamId]
      ? `${season.teams[homeTeamId].city} ${season.teams[homeTeamId].nickname}`
      : homeTeamId ?? 'Home'
  );
</script>

{#if error}
  <div class="bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-300">
    {error}
  </div>
{:else if animated && gameState}
  <div class="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
    <div class="flex justify-center mb-4">
      <GameScoreboard
        {awayScore}
        {homeScore}
        inning={gameState.inning}
        isTopInning={gameState.isTopInning}
        outs={gameState.outs}
        runners={runnerIds}
        runnerNames={runnerNames}
        {currentBatter}
        {currentPitcher}
        awayTeam={awayTeamId ?? 'Away'}
        homeTeam={homeTeamId ?? 'Home'}
        awayTeamFull={awayTeamName}
        homeTeamFull={homeTeamName}
        plays={gameState.plays}
      />
    </div>
  </div>
{:else if animated}
  <div class="bg-zinc-900 rounded-lg p-8 border border-zinc-800 text-center">
    <p class="text-zinc-400">Starting game...</p>
  </div>
{/if}
