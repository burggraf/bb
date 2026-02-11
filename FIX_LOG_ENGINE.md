# Engine Bug Fix Log

## 2026-02-10 - Task #6: Fixing Multiple Game Engine & Lineup Bugs

### Overview
Fixed several bugs in `engine.ts`, `transitions.ts`, and `lineup-builder.ts` as documented in `BUG_LOG_ENGINE.md`.

### Bug 1: Incorrect `positionOccupied` Check
- **File:** `app/src/lib/game/engine.ts`
- **Issue:** Used `!!lineup.players.find(...)` which returned true for position 0 (falsey).
- **Fix:** Changed to check if the found slot is not undefined.
- **Verification:** Unit tests for lineup building and engine state passing.

### Bug 2: Redundant Helper Functions
- **File:** `app/src/lib/game/engine.ts`
- **Issue:** `getPositionName` and `formatName` were duplicated in both `engine.ts` and `lineup-builder.ts`.
- **Fix:** Removed redundant copies. (Note: Kept them in `lineup-builder.ts` for now as it's the primary consumer, will consolidate to a shared `utils.ts` in Phase 2).

### Bug 3: Fragile Inning Summary Comments
- **File:** `app/src/lib/game/engine.ts`
- **Issue:** Hardcoded "End of 1st" etc. in comments was fragile.
- **Fix:** Switched to using `state.inning` and `state.half` for dynamic comments.
- **Verification:** Observed in test output logs.

### Bug 4: Incorrect Null Check in Lineup Builder
- **File:** `app/src/lib/game/lineup-builder.ts`
- **Issue:** Similar to Bug 1, checked position occupancy incorrectly for position 0/1.
- **Fix:** Verified `lineup-builder.ts` already handles this via `assignedPlayers` Set and Map, but ensured consistency.

### Bug 5: Run-Wiping Logic on 3rd Out
- **File:** `app/src/lib/game/state-machine/transitions.ts`
- **Issue:** Unconditionally wiped all runs scored on the 3rd out. Baseball allows runs to score on the 3rd out IF it's not a force out or the batter failing to reach 1st.
- **Fix:** Modified `applyOutcome` to only wipe runs on the 3rd out if the outcome is a "no-run" out (force, fly, strikeout, etc.).
- **Verification:** `transitions.test.ts` passing, including sacrifice fly/bunt scenarios with 2 outs (which should now correctly result in 0 runs).

### Bug 6: Inconsistent Position Numbering
- **File:** `app/src/lib/game/lineup-builder.ts`
- **Issue:** Mix of 1-based and 0-based indexing for positions in some logs.
- **Fix:** Standardized on standard MLB 1-9 numbering for defensive positions.

---
**Status:** All 6 addressed. Unit tests passing.
