# FIX LOG UI

## 2026-02-10 Fixes

### [BUG-UI-003] Performance: Excessive `plays.slice().reverse()` calls
- **Action**: Created `$derived` `reversedPlays` in `app/src/routes/game/+page.svelte`.
- **Status**: Pending

### [BUG-UI-001] Incorrect Score Calculation in Play-by-Play Feed
- **Action**: Fixed `getScoreAtPlay` call in `app/src/routes/game/+page.svelte`.
- **Status**: Pending

### [BUG-UI-002] Broken `isThirdOut` Logic in `formatRunnerInfo`
- **Action**: Corrected index check in `formatRunnerInfo` in `app/src/routes/game/+page.svelte`.
- **Status**: Pending

### [BUG-UI-005] Potential UI Freeze during Quick Sim
- **Action**: Moved `updateFromEngine()` outside the loop in `quickSim` in `app/src/routes/game/+page.svelte`.
- **Status**: Pending

### [BUG-UI-006] Missing `key` in `#each` loops
- **Action**: Added keys to `#each` loops in `app/src/routes/game/+page.svelte`.
- **Status**: Pending

### [BUG-UI-004] Name Formatting Inconsistency
- **Action**: Investigating standardization.
- **Status**: Pending

### [BUG-UI-007] Incomplete "Active Inning" logic in Line Score
- **Action**: Fixed `computeLineScore` in `app/src/lib/components/GameScoreboard.svelte`.
- **Status**: Pending

### [BUG-UI-008] First Game Completion Not Detected in Animated Mode
- **Action**: Fixed condition in `app/src/lib/game-results/components/ReplayControls.svelte`.
- **Status**: Pending
