# Animated Season Replay Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add functional animated playback mode to season replay that shows a live scoreboard updating plate appearance by plate appearance, with variable speed controls and pause/resume functionality.

**Architecture:** Modify SeasonReplayEngine to emit events during simulation, create new AnimatedGameDisplay component that subscribes to these events and renders the existing GameScoreboard component, update ReplayControls to add animated mode toggle and speed controls, and remove the non-functional playback mode from the season replay setup page.

**Tech Stack:** Svelte 5 with runes ($state, $derived, $effect), TypeScript, IndexedDB for persistence

---

## Task 1: Update season-replay types to support animated options

**Files:**
- Modify: `app/src/lib/season-replay/types.ts`

**Step 1: Add new event type for plate appearance updates**

Add this interface to `types.ts`:

```typescript
export interface PlateAppearanceEvent {
  gameState: GameState;  // Import from $lib/game/types
  playEvent: PlayEvent;
}
```

**Step 2: Update ReplayOptions to support animated mode**

Replace the existing `ReplayOptions` interface:

```typescript
export interface ReplayOptions {
  animated: boolean;
  simSpeed: number;  // Delay in milliseconds between PAs (50-2000)
  gamesPerBatch?: number;
}
```

**Step 3: Run type check**

```bash
cd app && pnpm check
```

Expected: Type errors in `engine.ts` and `ReplayControls.svelte` due to changed interface

**Step 4: Commit**

```bash
git add app/src/lib/season-replay/types.ts
git commit -m "refactor(types): update ReplayOptions for animated mode support

- Add animated flag and simSpeed to ReplayOptions
- Add PlateAppearanceEvent interface for real-time updates
- Remove unused playbackSpeed enum
"
```

---

## Task 2: Update SeasonReplayEngine to emit events and support animation

**Files:**
- Modify: `app/src/lib/season-replay/engine.ts`
- Test: N/A (manual testing required for engine behavior)

**Step 1: Add getCurrentGameState method**

Add after the `getStatus()` method:

```typescript
getCurrentGameState(): GameState | null {
  return this.gameEngine?.getState() || null;
}
```

**Step 2: Add setOptions method to update options at runtime**

Add after the constructor:

```typescript
setOptions(options: Partial<ReplayOptions>): void {
  this.options = { ...this.options, ...options };
}
```

**Step 3: Modify simulateGame to emit events and support delays**

Replace the existing `simulateGame` method's simulation loop with:

```typescript
// Simulate the full game with event emission for animated mode
while (!this.gameEngine.isComplete()) {
  this.gameEngine.simulatePlateAppearance();

  // Emit event for animated mode listeners
  const currentState = this.gameEngine.getState();
  this.emit('plateAppearance', {
    gameState: currentState,
    playEvent: currentState.plays[0]
  });

  // Delay if in animated mode
  if (this.options.animated) {
    await this.delay(this.options.simSpeed);
  }
}
```

**Step 4: Add helper delay method**

Add as a private method:

```typescript
private delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

**Step 5: Run type check**

```bash
cd app && pnpm check
```

Expected: PASS ( GameState and PlayEvent types need to be imported )

**Step 6: Add missing imports**

Update the imports at top of file:

```typescript
import { getSeasonSchedule, loadSeason, loadSeasonForGame, type ScheduledGame } from '$lib/game/sqlite-season-loader.js';
import { getSeriesMetadata, updateSeriesMetadata, updateSeries, saveGameFromState, saveGameDatabase } from '$lib/game-results/index.js';
import { GameEngine, type GameState, type PlayEvent } from '$lib/game/engine.js';
import type { ReplayOptions, ReplayProgress, ReplayStatus, GameResult, PlateAppearanceEvent } from './types.js';
```

**Step 7: Run type check again**

```bash
cd app && pnpm check
```

Expected: PASS

**Step 8: Commit**

```bash
git add app/src/lib/season-replay/engine.ts
git commit -m "feat(engine): add event emission and animated mode support

- Add getCurrentGameState() method for external access
- Add setOptions() method to update options at runtime
- Emit plateAppearance events during simulation
- Support delay between PAs when animated mode is enabled
- Import GameState and PlayEvent types
"
```

---

## Task 3: Remove playback mode selection from season-replay setup page

**Files:**
- Modify: `app/src/routes/season-replay/+page.svelte`

**Step 1: Remove playbackMode state variable**

Find and remove this line (around line 23):

```typescript
let playbackMode = $state<'instant' | 'animated'>('instant');
```

**Step 2: Remove playbackMode parameter from createSeasonReplay call**

Find the `handleCreateReplay` function and modify the `createSeasonReplay` call (around line 95-101):

Replace:
```typescript
const series = await createSeasonReplay({
  name: seriesName.trim(),
  description: null,
  seasonYear: year,
  totalGames,
  playbackSpeed: playbackMode
});
```

With:
```typescript
const series = await createSeasonReplay({
  name: seriesName.trim(),
  description: null,
  seasonYear: year,
  totalGames
});
```

**Step 3: Remove the playback mode UI section**

Delete the entire "Playback mode" section from the template (lines 211-253):

Find this comment and delete until the next section:
```svelte
<!-- Playback mode -->
<div class="mb-6">
  <label class="block text-sm font-medium text-zinc-300 mb-2">Playback Mode</label>
  ...
</div>
```

**Step 4: Run type check**

```bash
cd app && pnpm check
```

Expected: PASS (may have error in createSeasonReplay if it still expects playbackSpeed)

**Step 5: Update createSeasonReplay function signature**

Check `app/src/lib/game-results/index.ts` for the `createSeasonReplay` function and update if needed. If it still expects `playbackSpeed`, modify to:

```typescript
export async function createSeasonReplay(options: {
  name: string;
  description: string | null;
  seasonYear: number;
  totalGames: number;
}): Promise<Series> {
  // ... implementation, use default options { animated: false, simSpeed: 500 }
}
```

**Step 6: Run type check**

```bash
cd app && pnpm check
```

Expected: PASS

**Step 7: Test the page manually**

```bash
cd app && pnpm dev
```

Visit http://localhost:5173/season-replay?year=1976

Expected: Page loads without playback mode selection, only shows series name input

**Step 8: Commit**

```bash
git add app/src/routes/season-replay/+page.svelte app/src/lib/game-results/index.ts
git commit -m "refactor(season-replay): remove non-functional playback mode selection

- Remove playbackMode state from setup page
- Remove playback mode UI section
- Update createSeasonReplay to not require playbackSpeed
- Simplify season replay creation flow
"
```

---

## Task 4: Create AnimatedGameDisplay component

**Files:**
- Create: `app/src/lib/game-results/components/AnimatedGameDisplay.svelte`

**Step 1: Create the component file**

Create `app/src/lib/game-results/components/AnimatedGameDisplay.svelte` with:

```svelte
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
    const handlePlateAppearance = ({ gameState: state, playEvent }: { gameState: GameState; playEvent: PlayEvent }) => {
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

    engine.on('plateAppearance', handlePlateAppearance as any);

    unsubscribe = () => {
      engine.off('plateAppearance', handlePlateAppearance as any);
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
```

**Step 2: Run type check**

```bash
cd app && pnpm check
```

Expected: May have type errors for SeasonReplayEngine event types

**Step 3: Fix any type issues**

If there are type errors with the event subscription, update the type assertion in the onMount:

```typescript
// Subscribe to plate appearance events
const handlePlateAppearance = (data: any) => {
  const { gameState: state, playEvent } = data;
  // ... rest of handler
};

engine.on('plateAppearance', handlePlateAppearance);
```

**Step 4: Run type check**

```bash
cd app && pnpm check
```

Expected: PASS

**Step 5: Commit**

```bash
git add app/src/lib/game-results/components/AnimatedGameDisplay.svelte
git commit -m "feat(components): create AnimatedGameDisplay component

- New component for displaying live game scoreboard during animated replay
- Subscribes to SeasonReplayEngine plateAppearance events
- Uses existing GameScoreboard component for display
- Shows game state, scores, runners, and current matchup
"
```

---

## Task 5: Update ReplayControls to add animated mode toggle and speed controls

**Files:**
- Modify: `app/src/lib/game-results/components/ReplayControls.svelte`

**Step 1: Add animated mode and speed state**

Add after the existing state declarations (around line 28):

```typescript
// Animated mode state
let animatedMode = $state(false);
let simSpeed = $state(500); // Default to medium speed
```

**Step 2: Add toggle and speed control functions**

Add after the `stop()` function:

```typescript
// Toggle animated mode
function toggleAnimatedMode() {
  animatedMode = !animatedMode;
  if (engine) {
    engine.setOptions({ animated: animatedMode, simSpeed });
  }
}

// Update simulation speed
function updateSpeed(newSpeed: number) {
  simSpeed = newSpeed;
  if (engine && animatedMode) {
    engine.setOptions({ animated: animatedMode, simSpeed });
  }
}
```

**Step 3: Update engine initialization to use new options**

Modify the engine initialization (around line 34):

Replace:
```typescript
engine = new SeasonReplayEngine(seriesId, seasonYear, { playbackSpeed: 'instant' });
```

With:
```typescript
engine = new SeasonReplayEngine(seriesId, seasonYear, { animated: false, simSpeed: 500 });
```

**Step 4: Add animated mode toggle and speed controls to the UI**

Add these controls before the "Progress bar" section (after the header, around line 195):

```svelte
<!-- Animated Mode Toggle -->
<div class="flex items-center justify-between mb-4">
  <span class="text-sm text-zinc-300">Animated Mode</span>
  <button
    onclick={toggleAnimatedMode}
    disabled={status === 'completed' || !engine}
    class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed
      {animatedMode ? 'bg-blue-600' : 'bg-zinc-700'}"
  >
    <span
      class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform
        {animatedMode ? 'translate-x-6' : 'translate-x-1'}"
    />
  </button>
</div>

<!-- Speed Control (shown when animated mode is on) -->
{#if animatedMode}
  <div class="mb-4 bg-zinc-800 rounded-lg p-3 border border-zinc-700">
    <div class="flex items-center justify-between mb-2">
      <span class="text-xs text-zinc-400">Simulation Speed</span>
      <span class="text-xs text-zinc-500">{simSpeed}ms</span>
    </div>
    <input
      type="range"
      min="50"
      max="2000"
      step="50"
      bind:value={simSpeed}
      oninput={(e) => updateSpeed(Number(e.target.value))}
      class="w-full accent-blue-500 h-2"
      disabled={status === 'completed' || !engine}
    />
    <div class="flex justify-between text-xs text-zinc-600 mt-1">
      <span>Fast</span>
      <span>Slow</span>
    </div>
  </div>
{/if}
```

**Step 5: Expose animated mode and speed to parent**

Update the Props interface to include these outputs (add to Props interface around line 11):

```typescript
interface Props {
  seriesId: string;
  seasonYear: number;
  onStandingsUpdate: () => Promise<void>;
  onStatusChange?: (status: ReplayStatus) => void;
  onAnimatedChange?: (animated: boolean) => void;  // Add this
}

let { seriesId, seasonYear, onStandingsUpdate, onStatusChange, onAnimatedChange }: Props = $props();
```

**Step 6: Emit animated mode changes**

Update the `toggleAnimatedMode` function:

```typescript
function toggleAnimatedMode() {
  animatedMode = !animatedMode;
  if (engine) {
    engine.setOptions({ animated: animatedMode, simSpeed });
  }
  onAnimatedChange?.(animatedMode);
}
```

**Step 7: Run type check**

```bash
cd app && pnpm check
```

Expected: PASS

**Step 8: Commit**

```bash
git add app/src/lib/game-results/components/ReplayControls.svelte
git commit -m "feat(replay): add animated mode toggle and speed controls

- Add animated mode toggle switch
- Add speed slider (50-2000ms) for animated simulation
- Update engine initialization to use new options format
- Expose animated mode state to parent component
- Show speed controls only when animated mode is enabled
"
```

---

## Task 6: Update ReplayStandingsView to include AnimatedGameDisplay

**Files:**
- Modify: `app/src/lib/game-results/components/ReplayStandingsView.svelte`

**Step 1: Add engine and animated mode state**

Add after the existing props destructuring (around line 26):

```typescript
let { seriesId, seasonYear, onStandingsUpdate } = props;

// Add these:
let { onMount }: import('svelte').OnMountProps = $props();
let engine = $state<SeasonReplayEngine | null>(null);
let animatedMode = $state(false);
```

**Step 2: Import and create engine**

Add the import at top:

```svelte
<script lang="ts">
  import StandingsTable from './StandingsTable.svelte';
  import ReplayControls from './ReplayControls.svelte';
  import AnimatedGameDisplay from './AnimatedGameDisplay.svelte';  // Add
  import { SeasonReplayEngine } from '$lib/season-replay/index.js';  // Add
```

**Step 3: Handle animated mode changes**

Add this function after the props:

```typescript
function handleAnimatedChange(animated: boolean) {
  animatedMode = animated;
}
```

**Step 4: Update the template to include AnimatedGameDisplay**

Replace the entire template (lines 29-46) with:

```svelte
<div class="flex flex-col gap-6">
  <!-- Animated Game Display (shown above when animated mode is on) -->
  {#if animatedMode && engine}
    <div class="w-full">
      <AnimatedGameDisplay {engine} {seasonYear} animated={animatedMode} />
    </div>
  {/if}

  <!-- Main content: Standings + Controls -->
  <div class="flex gap-6">
    <!-- Standings Table (flexible width) -->
    <div class="flex-1">
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
        onStandingsUpdate={onStandingsUpdate}
        onAnimatedChange={handleAnimatedChange}
        onEngineReady={(eng) => engine = eng}
      />
    </div>
  </div>
</div>
```

**Step 5: Update ReplayControls to emit engine reference**

We need to modify ReplayControls to emit the engine when it's ready. Go back to `ReplayControls.svelte` and:

Add to Props interface:
```typescript
onEngineReady?: (engine: SeasonReplayEngine | null) => void;
```

Add to props destructuring:
```typescript
let { seriesId, seasonYear, onStandingsUpdate, onStatusChange, onAnimatedChange, onEngineReady }: Props = $props();
```

Emit engine after initialization (after line 57):
```typescript
// Get initial progress and status
progress = engine.getProgress();
status = engine.getStatus();

// Notify parent that engine is ready
onEngineReady?.(engine);
```

**Step 6: Run type check**

```bash
cd app && pnpm check
```

Expected: PASS (may need to fix onEngineReady type)

**Step 7: Fix any type issues**

If there are issues with the onMount import, remove it and just use $effect for the engine reference.

**Step 8: Commit**

```bash
git add app/src/lib/game-results/components/ReplayStandingsView.svelte app/src/lib/game-results/components/ReplayControls.svelte
git commit -m "feat(replay): integrate AnimatedGameDisplay into series page

- Add AnimatedGameDisplay above standings when animated mode is on
- Pass engine reference from ReplayControls to ReplayStandingsView
- Handle animated mode state changes
- Update layout to flex-col for proper stacking
"
```

---

## Task 7: Handle pause between games in animated mode

**Files:**
- Modify: `app/src/lib/game-results/components/ReplayControls.svelte`
- Modify: `app/src/lib/season-replay/engine.ts`

**Step 1: Add game completion state to ReplayControls**

Add state after existing state:

```typescript
let gameComplete = $state(false);
let currentGameTeams = $state<{ away: string; home: string } | null>(null);
```

**Step 2: Listen for game completion events**

Update the event listener setup in onMount:

```typescript
// Set up event listeners
engine.on('statusChange', (data: { status: ReplayStatus }) => {
  status = data.status;
  onStatusChange?.(data.status);
});

engine.on('progress', (data: ReplayProgress) => {
  progress = data;
});

// Listen for game completion (when progress advances to next game)
engine.on('progress', (data: ReplayProgress) => {
  progress = data;
  // Check if we just finished a game in animated mode
  if (animatedMode && data.currentGameIndex > 0) {
    gameComplete = true;
    shouldContinuePlaying = false; // Pause the loop
  }
});
```

**Step 3: Add continue button for next game**

Add this UI after the speed control (before progress bar):

```svelte
<!-- Game Complete - Continue button -->
{#if gameComplete && animatedMode}
  <div class="mb-4 p-4 bg-green-900/30 border border-green-700 rounded-lg">
    <p class="text-sm text-green-300 mb-3">Game Complete!</p>
    <button
      onclick={continueToNextGame}
      class="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded transition-colors"
    >
      Continue to Next Game
    </button>
  </div>
{/if}
```

**Step 4: Add continue handler**

Add this function:

```typescript
async function continueToNextGame() {
  gameComplete = false;
  await playNextGame();
}
```

**Step 5: Run type check**

```bash
cd app && pnpm check
```

Expected: PASS

**Step 6: Test manually**

1. Start a season replay
2. Enable animated mode
3. Click Play
4. Watch game complete
5. Verify "Continue" button appears
6. Click continue and verify next game starts

**Step 7: Commit**

```bash
git add app/src/lib/game-results/components/ReplayControls.svelte
git commit -m "feat(replay): add pause between games in animated mode

- Show game complete message when game finishes
- Require user to click Continue to start next game
- Reset game completion state when continuing
- Improve animated mode UX for watching multiple games
"
```

---

## Task 8: Add error handling for game simulation failures

**Files:**
- Modify: `app/src/lib/game-results/components/ReplayControls.svelte`
- Modify: `app/src/lib/season-replay/engine.ts`

**Step 1: Emit error events from engine**

Update `simulateGame` in engine.ts to emit errors:

Wrap the simulation loop in try-catch:

```typescript
private async simulateGame(game: ScheduledGame): Promise<GameResult | null> {
  try {
    // ... existing setup ...

    while (!this.gameEngine.isComplete()) {
      this.gameEngine.simulatePlateAppearance();

      const currentState = this.gameEngine.getState();
      this.emit('plateAppearance', {
        gameState: currentState,
        playEvent: currentState.plays[0]
      });

      if (this.options.animated) {
        await this.delay(this.options.simSpeed);
      }
    }

    // ... existing save logic ...

    return result;
  } catch (error) {
    console.error('[SeasonReplay] Error simulating game:', error);
    this.emit('gameError', {
      game,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}
```

**Step 2: Handle errors in ReplayControls**

Add error handler in onMount:

```typescript
engine.on('gameError', (data: { game: ScheduledGame; error: string }) => {
  error = `Error simulating ${data.game.awayTeam} vs ${data.game.homeTeam}: ${data.error}`;
  shouldContinuePlaying = false;
  status = 'paused';
});
```

**Step 3: Add skip button when error occurs**

Add to error display section:

```svelte
<!-- Error message with skip option -->
{#if error}
  <div class="text-red-400 text-sm mb-3">
    <p>{error}</p>
    <button
      onclick={skipToNextGame}
      class="mt-2 px-3 py-1 bg-red-900/50 hover:bg-red-900/70 text-red-300 text-xs rounded transition-colors"
    >
      Skip to Next Game
    </button>
  </div>
{/if}
```

**Step 4: Add skip handler**

```typescript
async function skipToNextGame() {
  error = null;
  await playNextGame();
}
```

**Step 5: Run type check**

```bash
cd app && pnpm check
```

Expected: PASS

**Step 6: Commit**

```bash
git add app/src/lib/game-results/components/ReplayControls.svelte app/src/lib/season-replay/engine.ts
git commit -m "feat(replay): add error handling for game simulation failures

- Emit gameError events from engine when simulation fails
- Display error message with skip option in controls
- Allow user to skip failed games and continue
- Improve error recovery in season replay
"
```

---

## Task 9: Final polish and testing

**Files:**
- All modified files

**Step 1: Run full type check**

```bash
cd app && pnpm check
```

Expected: PASS with no errors

**Step 2: Run linter**

```bash
cd app && pnpm lint
```

Expected: PASS or fix any linting issues

**Step 3: Manual testing checklist**

Test each scenario:

1. **Create season replay** (without playback mode)
   - Visit `/season-replay?year=1976`
   - Verify no playback mode selection
   - Enter name and create
   - Verify redirect to series page

2. **Instant mode (default)**
   - Click "Next Game"
   - Game completes instantly
   - Standings update

3. **Animated mode - basic**
   - Toggle animated mode ON
   - Click Play
   - Watch scoreboard update
   - Verify speed slider works

4. **Animated mode - game completion**
   - Watch game complete
   - Verify "Continue" button appears
   - Click continue
   - Next game starts animated

5. **Animated mode - pause/resume**
   - Start animated game
   - Click Pause
   - Verify game pauses
   - Click Resume
   - Verify game continues

6. **Animated mode - speed control**
   - Test fast (50ms)
   - Test medium (500ms)
   - Test slow (2000ms)
   - Verify speed changes mid-game

7. **Switch modes mid-season**
   - Start in instant mode
   - Toggle animated ON
   - Next game animates
   - Toggle animated OFF
   - Next game is instant

8. **Error handling**
   - (Cannot easily test without injecting errors)
   - Review error handling code

**Step 4: Fix any issues found during testing**

**Step 5: Final commit**

```bash
git add -A
git commit -m "polish: final cleanup for animated season replay mode

- Complete all manual testing scenarios
- Fix issues found during testing
- Ensure consistent UX across all modes
"
```

---

## Summary

This implementation plan:

1. **Removes** the non-functional playback mode from `/season-replay` setup
2. **Adds** animated mode toggle to the series page ReplayControls
3. **Creates** new AnimatedGameDisplay component showing live scoreboard
4. **Updates** SeasonReplayEngine to emit events during simulation
5. **Supports** variable speed control (50-2000ms)
6. **Pauses** between games in animated mode
7. **Handles** errors gracefully with skip option

**Total estimated changes:**
- 6 files modified
- 1 new file created
- ~400 lines added/changed

**Testing approach:**
- Type checking throughout
- Manual end-to-end testing
- No automated tests for this feature (requires full browser environment)
