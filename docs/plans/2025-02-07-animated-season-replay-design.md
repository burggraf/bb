# Animated Season Replay Mode Design

## Overview

Remove the non-functional "Playback Mode" (instant/animated) selection from the `/season-replay` setup page. Instead, add an "Animated Mode" toggle on the series page (`/game-results/series/[id]`) within the Season Replay control box. When enabled, show a live scoreboard (similar to `/game` page) above the standings table that updates plate appearance by plate appearance with variable speed controls and pause/resume functionality.

## Problem Statement

The current "Playback Mode" setting on the season replay setup page has two options (instant/animated) but the animated mode does nothing. This option doesn't belong on the setup page and should be a per-session control on the series page where games are actually played.

## Requirements

1. Remove playback mode selection from `/season-replay` setup page
2. Add animated mode toggle to the Season Replay control box on series page
3. Display live game scoreboard above standings when animated mode is active
4. Support variable speed control (50ms - 2000ms between plate appearances)
5. Pause between games, requiring user to continue
6. Show game state progression (score, inning, outs, runners, current matchup)

## Architecture

### Components

| Component | Changes | Purpose |
|-----------|---------|---------|
| `ReplayControls.svelte` | Add animated mode toggle switch | User control for animation mode |
| `ReplayStandingsView.svelte` | Add container for game display | Layout wrapper for animated display |
| `AnimatedGameDisplay.svelte` | **New component** | Live scoreboard display |
| `SeasonReplayEngine` | Add PA event emission | Real-time game state updates |

### Data Flow

```
User Toggle → ReplayControls.animatedMode
     ↓
ReplayControls calls SeasonReplayEngine with animation flag
     ↓
Engine emits 'plateAppearance' events during simulation
     ↓
AnimatedGameDisplay subscribes to events
     ↓
GameScoreboard component renders current state
     ↓
User controls Play/Pause/Speed via ReplayControls
```

### State Management

- **ReplayControls**: `animatedMode: boolean`, `simSpeed: number`
- **SeasonReplayEngine**: Event emission for each PA, current game engine reference
- **AnimatedGameDisplay**: Current game state, play/pause status

## UI Design

### Series Page Layout (Animated Mode ON)

```
┌─────────────────────────────────────────────────────────────┐
│ ← Back to all series    1976 Season Replay            [Delete] │
├─────────────────────────────────────────────────────────────┤
│ [CURRENT GAME SCOREBOARD]                                   │
│   BOS 0 0 1 0 0 0 0 0 0 - 1                                │
│   NYY 0 0 0 0 0 0 0 0 0 - 0                                │
│   Bottom 5 | Outs: 2 | 🏃 🏃 on 2B, 3B                     │
│   Batter: Jane Doe | Pitcher: John Smith                   │
│                                                              │
│   Controls: [⏸ Pause] [Speed: ▁▃▅█ 500ms]                  │
├───────────────────────────┬─────────────────────────────────┤
│ Season Replay             │ Standings                       │
│ Progress: 45/162 (28%)    │ AL East                         │
│ Status: Playing           │ NYY 28-18 .609  -              │
│ [Animated Mode: ON]       │ BOS 27-19 .587 1.0             │
│                           │ BAL 25-21 .543 3.0             │
│ [Next Game] [Next Day]    │ ...                            │
│ [Stop]                    │                                 │
└───────────────────────────┴─────────────────────────────────┘
```

### Controls

| Control | Behavior |
|---------|----------|
| Animated Mode Toggle | Switch between instant and animated playback |
| Play/Pause | Start/pause the current game simulation |
| Speed Slider | Adjust delay between PAs (50-2000ms) |
| Next Game | Skip to next game instantly |
| Next Day | Simulate all games for current date |
| Stop | End replay session |

## Implementation Details

### SeasonReplayEngine Changes

```typescript
// New event type
on('plateAppearance', (data: {
  gameState: Partial<GameState>,
  playEvent: PlayEvent
}) => void)

// New method
getCurrentGameState(): GameState | null {
  return this.gameEngine?.getState() || null;
}

// Modified simulateGame for event emission
private async simulateGame(game: ScheduledGame): Promise<GameResult | null> {
  // ... setup ...

  while (!this.gameEngine.isComplete()) {
    this.gameEngine.simulatePlateAppearance();

    // Emit event for animated mode
    this.emit('plateAppearance', {
      gameState: this.gameEngine.getState(),
      playEvent: this.gameEngine.getState().plays[0]
    });

    // Delay if animated mode
    if (this.options.animated) {
      await this.delay(this.options.simSpeed);
    }
  }
  // ... save game ...
}
```

### ReplayControls Changes

```typescript
// Add state
let animatedMode = $state(false);
let simSpeed = $state(500); // Default to medium speed

// Toggle handler
function toggleAnimatedMode() {
  animatedMode = !animatedMode;
  // Update engine options
  engine?.setOptions({ animated: animatedMode, simSpeed });
}
```

### AnimatedGameDisplay Component

```svelte
<script lang="ts">
  import GameScoreboard from '$lib/components/GameScoreboard.svelte';
  import type { GameState } from '$lib/game/types.js';

  interface Props {
    seriesId: string;
    seasonYear: number;
    animated: boolean;
    simSpeed: number;
  }

  let gameState = $state<GameState | null>(null);
  let isPlaying = $state(false);

  // Subscribe to engine events
  onMount(() => {
    engine.on('plateAppearance', ({ gameState: state }) => {
      gameState = state;
    });
  });
</script>

{#if gameState}
  <GameScoreboard
    awayScore={/* calculated from plays */}
    homeScore={/* calculated from plays */}
    {gameState.inning}
    {gameState.isTopInning}
    {gameState.outs}
    runners={gameState.bases}
    <!-- ... other props -->
  />
{/if}
```

### Speed Control Logic

| Mode | Speed | Use Case |
|------|-------|----------|
| Fast | 50-200ms | Quick sim, watch key moments |
| Normal | 500-1000ms | Default, similar to /game |
| Slow | 1500-2000ms | Watch each PA carefully |

## Error Handling

| Scenario | Handling |
|----------|----------|
| Game simulation fails | Show error in display, allow skip to next game |
| User navigates away | Auto-pause animation, preserve state |
| Browser tab inactive | Slow down simulation to save resources |
| Database save fails | Retry with exponential backoff, show warning |

## Edge Cases

| Case | Behavior |
|------|----------|
| Switch to animated mid-season | Start animating from next game |
| Switch to instant mid-game | Finish current game instantly |
| Extra innings | Display shows all innings (> 9) |
| Season complete | Show completion message, hide controls |

## Testing

1. **Unit Tests**: Event emission in SeasonReplayEngine
2. **Component Tests**: AnimatedGameDisplay state management
3. **Integration**: Full season replay with animated mode
4. **Manual**: Speed control variations, pause/resume scenarios

## Files to Modify

1. `app/src/routes/season-replay/+page.svelte` - Remove playback mode UI
2. `app/src/lib/game-results/components/ReplayControls.svelte` - Add animated toggle
3. `app/src/lib/game-results/components/ReplayStandingsView.svelte` - Add game display container
4. `app/src/lib/game-results/components/AnimatedGameDisplay.svelte` - **New file**
5. `app/src/lib/season-replay/engine.ts` - Add event emission
6. `app/src/lib/season-replay/types.ts` - Add animation option types
