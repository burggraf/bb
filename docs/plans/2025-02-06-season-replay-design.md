# Season Replay Feature Design

**Date:** 2025-02-06
**Status:** Design Approved

## Overview

The season replay feature allows users to simulate an entire MLB season (1910-2024) in chronological order. Users can watch standings evolve in real-time as games are simulated, with options to play continuously, pause, or step through games one at a time.

## Data Flow

1. **Initiation:** User clicks "Replay Season" button on home page (next to "Select Season" section)
2. **Series Creation:** System creates a new series with `seriesType: 'season_replay'` and metadata
3. **Game Loading:** Fetch all games from the season's SQLite `games` table, sorted by `date`
4. **Simulation Loop:** Simulate each game, save results, update standings
5. **UI Updates:** Standings table refreshes after each game/day completes

## Database Schema Changes

### Series Table Addition

```sql
ALTER TABLE series ADD COLUMN metadata TEXT;
```

### Metadata Structure

```typescript
interface SeriesMetadata {
  seasonReplay?: {
    seasonYear: number;
    currentGameIndex: number;      // Last completed game index
    totalGames: number;             // Total games in schedule
    playbackSpeed: 'instant' | 'animated';
    gamesPerBatch: number;
    status: 'idle' | 'playing' | 'paused' | 'completed';
    lastPlayedDate?: string;        // ISO date
  };
}
```

## UI Components

### Home Page (`routes/+page.svelte`)

Add "Replay Season" button next to "Download Season" status:
- Enabled when `isSeasonReady === true`
- Uses play icon for visual distinction

### Season Replay Setup Page (`routes/season-replay/+page.svelte`)

New page for creating/confirming season replay:
- Shows selected season year
- Auto-generates series name with #2, #3 suffix for duplicates
- Prompts for playback mode (Instant/Animated)
- "Start Replay" creates series and redirects

### Series Page Modifications (`routes/game-results/series/[id]/+page.svelte`)

For `season_replay` series type:
- Default to Standings tab on load
- Pass replay state to components

### Standings Tab with Replay Controls

**Left side (70%):** Existing standings table

**Right side (30%):** Replay Control Panel
1. Progress indicator: "Game 45 of 1939" or "April 15, 1976"
2. Line Score Display:
   - Single-game mode: Box score of current game
   - Day/continuous mode: List of games scheduled for current day
3. Control Buttons:
   - Play/Pause (toggle)
   - Skip to next game (⏯)
   - Skip to next day (⏭)
   - Stop/End replay (⏹)

## Season Replay Engine

### New Module: `app/src/lib/season-replay/engine.ts`

```typescript
class SeasonReplayEngine {
  constructor(seriesId: string, year: number, options: ReplayOptions)

  // Core methods
  async initialize(): Promise<void
  async start(): Promise<void
  pause(): void
  resume(): void
  async playNextGame(): Promise<GameResult | null>
  async playNextDay(): Promise<GameResult[]>

  // State accessors
  getCurrentGameIndex(): number
  getCurrentDate(): string
  getProgress(): { current: number; total: number; percent: number }
  getStatus(): 'idle' | 'playing' | 'paused' | 'completed'

  // Events
  onGameComplete(callback: (game: GameResult) => void)
  onDayComplete(callback: (date: string, games: GameResult[]) => void)
  onProgress(callback: (progress: number) => void)
}
```

### Simulation Modes

**Instant Mode:**
- Simulate directly using GameEngine (no UI animation)
- Save result immediately, update standings
- Continue to next game/day

**Animated Mode:**
- Navigate to `/game` route with replay context
- Full game animation plays
- On complete, save and trigger next game
- Return to standings between games

### Helper Functions (`app/src/lib/game-results/series.ts`)

- `updateSeriesMetadata(seriesId, metadata)` - Update metadata
- `getSeriesMetadata(seriesId)` - Retrieve and parse
- `findSeasonReplays(year)` - Find existing for naming (#2, #3)
- `createSeasonReplay(name, year, options)` - Create with metadata

### Schedule Loading (`app/src/lib/game/sqlite-season-loader.ts`)

```typescript
async function getSeasonSchedule(year: number): Promise<ScheduledGame[]>
// Returns games table rows sorted by date
```

## Error Handling

| Scenario | Handling |
|----------|----------|
| Browser refresh | Metadata saves after each game; auto-resume on load |
| Season not available | Redirect to home with prompt to download |
| Database write fail | Retry with backoff; pause replay; show error |
| Empty schedule | Show error; mark series as 'error' |
| Partial completion | Save state; resume from last game |

## Visual Distinguishing

Season replay series on Game Results page:
- Badge indicator on SeriesCard
- Shows replay status (playing/paused/completed)
- Progress bar on card

## Testing

### Unit Tests
- SeasonReplayEngine state transitions
- Metadata CRUD operations
- Schedule loading and grouping

### Integration Tests
- Create → play → pause → refresh → resume flow
- Standings update correctness
- UI state management

### Manual Checklist
- [ ] Full 1939-game season completes
- [ ] Pause/refresh resume works
- [ ] Instant vs Animated toggle
- [ ] Multiple replays get #2, #3 suffixes
- [ ] Browser crash recovery

## Implementation Phases

1. **Phase 1:** Database schema, metadata functions, home page button
2. **Phase 2:** SeasonReplayEngine, schedule loading
3. **Phase 3:** Series page replay controls, standings integration
4. **Phase 4:** Line score display, playback modes
5. **Phase 5:** Polish, error handling, testing
