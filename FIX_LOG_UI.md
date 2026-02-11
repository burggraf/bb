# UI Fix Log

## BUG-UI-001: Incorrect Score Calculation in Play-by-Play Feed
- **Status**: Fixed
- **Fix**: Call `getScoreAtPlay` with `isReversed: true` in `app/src/routes/game/+page.svelte`.

## BUG-UI-002: Broken `isThirdOut` Logic in `formatRunnerInfo`
- **Status**: Fixed
- **Fix**: Check `reversedPlays[index - 1]` for the summary play in `app/src/routes/game/+page.svelte`.

## BUG-UI-003: Performance: Excessive `plays.slice().reverse()` calls
- **Status**: Fixed
- **Fix**: Use a `$derived` rune to compute `reversedPlays` once in `app/src/routes/game/+page.svelte`.

## BUG-UI-004: Name Formatting Inconsistency
- **Status**: Fixed
- **Fix**: Applied `formatName` to lineup and pitcher displays in `app/src/routes/game/+page.svelte` to match component style.

## BUG-UI-005: Potential UI Freeze during Quick Sim
- **Status**: Fixed
- **Fix**: Moved `updateFromEngine()` out of the simulation loop in `quickSim` function in `app/src/routes/game/+page.svelte`.

## BUG-UI-006: Missing `key` in `#each` loops
- **Status**: Fixed
- **Fix**: Added unique keys `(i)` and `(play.id || index)` to `#each` loops in `app/src/routes/game/+page.svelte`.

## BUG-UI-007: Incomplete "Active Inning" logic in Line Score
- **Status**: Fixed
- **Fix**: Ensured both `away` and `home` scores are initialized for the current inning in `app/src/lib/components/GameScoreboard.svelte`.

## BUG-UI-008: First Game Completion Not Detected in Animated Mode
- **Status**: Fixed
- **Fix**: Updated condition in `app/src/lib/game-results/components/ReplayControls.svelte` to detect completion even when `previousGameIndex` is 0.
