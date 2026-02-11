# UI Bug Log

## 1. Game Page (`app/src/routes/game/+page.svelte`)

### [BUG-UI-001] Incorrect Score Calculation in Play-by-Play Feed
- **Issue**: `getScoreAtPlay` is called with `isReversed = true` (default) while passing `reversedPlays`. The function implementation for `isReversed = true` calculates the score from `playIndex` to the end of the array. In a newest-first array, this correctly sums all runs from the current play to the oldest play, but the logic seems confusing.
- **Impact**: Potential for incorrect score display if the array indexing or summation logic doesn't perfectly match the expectation of "score at the end of this play".
- **Fix**: Verify `getScoreAtPlay` logic and ensure it's called with the correct parameters. Actually, looking at `getScoreAtPlay` implementation in `+page.svelte`:
  ```typescript
  if (isReversed) {
      for (let i = playIndex; i < totalPlays.length; i++) {
          const play = totalPlays[i];
          if (play.isTopInning) away += play.runsScored;
          else home += play.runsScored;
      }
  }
  ```
  If `totalPlays` is `reversedPlays` (newest first), then `totalPlays[playIndex]` is the current play, and `totalPlays[playIndex+1...length-1]` are all *previous* plays. Summing them gives the score *at the end* of the current play. This is correct. The bug log entry might be mistaken or referring to an older version.

### [BUG-UI-002] Broken `isThirdOut` Logic in `formatRunnerInfo`
- **Issue**: `isThirdOut` checks `reversedPlays[index - 1]` for a summary play.
- **Impact**: Correctly identifies the third out in a newest-first list.
- **Fix**: The current code already uses `index - 1`, so this may have been fixed or was a false alarm.

### [BUG-UI-003] Performance: Excessive `plays.slice().reverse()` calls
- **Issue**: The `reversedPlays` derived rune is good, but `getScoreAtPlay` and `formatRunnerInfo` are called inside the `#each` loop, and they might be doing redundant work.
- **Impact**: O(N^2) complexity for rendering the play-by-play list because `getScoreAtPlay` iterates over the previous plays for every play.
- **Fix**: Pre-calculate the score at each play once when `plays` changes.

### [BUG-UI-004] Name Formatting Inconsistency
- **Issue**: `BallparkField.svelte` and `GameScoreboard.svelte` format names as "F. Last", while `+page.svelte` formats them as "First Last".
- **Impact**: Inconsistent UI experience.
- **Fix**: Standardize on one format or provide a utility.

### [BUG-UI-005] Potential UI Freeze during Quick Sim
- **Issue**: `quickSim` calls `updateFromEngine()` in a tight loop for every plate appearance.
- **Impact**: UI freezes during simulation and performs many unnecessary reactive updates.
- **Fix**: Call `updateFromEngine()` once after the simulation loop completes.

### [BUG-UI-006] Missing `key` in `#each` loops
- **Issue**: Lineup and play-by-play loops lack keys.
- **Impact**: Potential for suboptimal DOM updates or state issues if items are reordered.
- **Fix**: Add unique keys (e.g., `(player.name)` or `(play.id)` if available).

## 2. Game Scoreboard (`app/src/lib/components/GameScoreboard.svelte`)

### [BUG-UI-007] Incomplete "Active Inning" logic in Line Score
- **Issue**: When it's the bottom of an inning, `computeLineScore` ensures `innings[currentIdx].home` is 0 if null, but doesn't ensure `away` is 0. 
- **Impact**: If the top of the inning had 0 runs and for some reason no plays were recorded, it would show `-` instead of `0`.
- **Fix**: Ensure both `away` and `home` are initialized or handled correctly for the current inning.

## 3. Season Replay (`app/src/lib/game-results/components/ReplayControls.svelte`)

### [BUG-UI-008] First Game Completion Not Detected in Animated Mode
- **Issue**: The logic to detect game completion `(data.currentGameIndex > previousGameIndex)` fails for the first game if `previousGameIndex` is initialized to 0 and the first game index is also 0 or 1 depending on implementation. 
- **Impact**: The "Game Complete!" message doesn't appear after the first game of a replay in animated mode.
- **Fix**: Check `SeasonReplayEngine` implementation to see how `currentGameIndex` starts.

## 4. General UI / UX Issues

### [BUG-UI-009] Redundant Game Engine Re-instantiation in `quickSim`
- **Issue**: `quickSim` calls `playAgain()` which creates a new `GameEngine`.
- **Impact**: If the user was halfway through a game and clicks "Quick Sim", it resets the game instead of finishing the current one.
- **Fix**: Only call `playAgain()` if the game hasn't started or is already complete, or let `quickSim` just finish the current engine state.

### [BUG-UI-010] Hardcoded Position Names in multiple files
- **Issue**: `getPositionAbbrev` in `+page.svelte`, `POSITION_NAMES` in `GameEngine.ts`, and implied in `BallparkField.svelte` and `GameScoreboard.svelte`.
- **Impact**: Maintenance burden; risk of inconsistency.
- **Fix**: Move to a shared constant or utility in `@bb/model` or `$lib/game/types.ts`.

### [BUG-UI-011] Memory Leak in `+page.svelte`
- **Issue**: `toggleAutoPlay` creates an interval but if the component unmounts while `autoPlay` is true, the interval might not be cleared. Svelte 5 `$effect` could handle this, but the interval is currently managed manually.
- **Impact**: Memory leak and background processing.
- **Fix**: Use `onDestroy` or an `$effect` cleanup to clear the interval. Actually, `onMount` returns a cleanup function, but it currently only cleans up event listeners. It should also stop auto-play.

### [BUG-UI-012] Missing Error Handling for Image/Data Loading
- **Issue**: If `loadSeasonForGame` or other async data loaders fail, the UI stays in "Loading..." or shows a raw error string.
- **Impact**: Poor UX on network failure or missing data.
- **Fix**: Add proper error boundary or UI state for load failures.

### [BUG-UI-013] `quickSim` Resets Current Game
- **Issue**: `quickSim()` calls `playAgain()` which creates a new `GameEngine`.
- **Impact**: Clicking "Quick Sim" in the middle of a game causes it to restart from the beginning.
- **Fix**: Either remove `playAgain()` or add a separate "Finish Game" button.

### [BUG-UI-014] `isTopInning` Logic in `getGameStats`
- **Issue**: `getGameStats` loop calculates `homeRuns += play.runsScored`, but doesn't have an `awayRuns` accumulator inside the loop. It then sets `awayRuns = awayScore` (which is reactive state).
- **Impact**: Inconsistent calculation logic.
- **Fix**: Standardize run calculation in `getGameStats`.
