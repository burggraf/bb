# UI Bug Log

## 1. Game Page (`app/src/routes/game/+page.svelte`)

### [BUG-UI-001] Incorrect Score Calculation in Play-by-Play Feed
- **Issue**: `getScoreAtPlay` is called with `isReversed = false` while passing `reversedPlays`.
- **Impact**: The score displayed for each play in the feed is incorrect, showing a reverse-cumulative sum of runs scored after the play instead of the actual game score at that point.
- **Fix**: Call `getScoreAtPlay` with `isReversed: true`.

### [BUG-UI-002] Broken `isThirdOut` Logic in `formatRunnerInfo`
- **Issue**: `isThirdOut` checks `reversedPlays[index + 1]` for a summary play. In a newest-first list, `index + 1` is the chronologically *previous* play. The summary play (marker for end of inning) happens *after* the third out.
- **Impact**: Runner advancement info might be hidden incorrectly or shown when it shouldn't be at the end of an inning.
- **Fix**: Check `reversedPlays[index - 1]` for the summary play.

### [BUG-UI-003] Performance: Excessive `plays.slice().reverse()` calls
- **Issue**: The play-by-play feed and modal call `plays.slice().reverse()` multiple times per loop iteration.
- **Impact**: Unnecessary memory allocation and CPU usage, especially as the number of plays grows (300+ plays per game).
- **Fix**: Use a `$derived` rune to compute `reversedPlays` once.

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
- **Issue**: The logic to detect game completion `(data.currentGameIndex > previousGameIndex && previousGameIndex > 0)` fails for the first game because `previousGameIndex` is 0.
- **Impact**: The "Game Complete!" message doesn't appear after the first game of a replay in animated mode.
- **Fix**: Change condition to `previousGameIndex >= 0` or handle the first game case specifically.
