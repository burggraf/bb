# Engine Bug Log

## Bug 1: Incorrect conditional check for `positionOccupied`
- **File:** `app/src/lib/game/engine.ts`
- **Line:** 2252
- **Description:** `positionOccupied === false` is used to check if a position is not occupied, but `Array.prototype.find()` returns `undefined` when no element is found. `undefined === false` is `false`, so this emergency fallback block never executes.
- **Impact:** Emergency mode for assigning a pinch hitter to an available position when bench is exhausted and shuffle fails might not work as intended.

## Bug 2: Duplicate `getPositionName` function
- **File:** `app/src/lib/game/engine.ts`
- **Lines:** 221 (module level), 356 (class private method)
- **Description:** The function `getPositionName` is defined both at the module level and as a private method in `GameEngine`. They have slightly different implementations.
- **Impact:** Redundancy and potential inconsistency.

## Bug 3: Fragile half-inning summary logic
- **File:** `app/src/lib/game/engine.ts`
- **Line:** 175
- **Description:** `addHalfInningSummary` comment states "uses current state values - may be wrong after inning change".
- **Impact:** Potential for incorrect summary data if called at the wrong time.

## Bug 5: Inappropriate run wiping on 3rd out
- **File:** `app/src/lib/game/state-machine/transitions.ts`
- **Lines:** 119-122
- **Description:** The code unconditionally wipes all runs scored on a play if it results in the 3rd out.
- **Impact:** In baseball, runs can score on a play that results in the 3rd out as long as it's not a force out or the batter-runner being put out before reaching first (time play). The current implementation incorrectly wipes these valid runs.

## Bug 7: Broken randomness logic in lineup builder
- **File:** `app/src/lib/game/lineup-builder.ts`
- **Lines:** 619-635
- **Description:** The randomness logic swaps the `battingOrder` property of the slot objects but does not re-sort the `battingOrder` array. Since the subsequent code iterates over the array in its original order, the randomness has no effect on the final lineup.
- **Impact:** The `randomness` option in `buildLineup` doesn't actually work.

## Bug 8: Significant dead code in lineup builder
- **File:** `app/src/lib/game/lineup-builder.ts`
- **Description:** Functions `insertPitcher`, `applyRandomness`, and `handlePositionScarcity` are defined but never used.
- **Impact:** Code bloat and confusion.

## Bug 9: Multiple duplicate helper functions
- **File:** `app/src/lib/game/engine.ts`
- **Description:** Functions like `formatName` and `getPositionName` are defined both at the module level and as private class methods.
- **Impact:** Redundancy, higher maintenance burden, and potential for inconsistent behavior.
