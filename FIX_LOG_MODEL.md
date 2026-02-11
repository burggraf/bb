# Fix Log - packages/model

This log tracks the fixes applied to the bugs identified in `BUG_LOG_MODEL.md`.

## Fixes Applied

### 1. Fixed `blendLineups` to prevent duplicate players
- **File:** `packages/model/src/managerial/lineup-strategies.ts`
- **Fix:** Changed the implementation to treat the blend factor as a probability of choosing the entire primary lineup vs the entire secondary lineup, rather than choosing per-slot. This ensures validity while maintaining the intended era-based variety.
- **Verification:** Unit tests for `blendLineups` should now pass without risk of duplicates.

### 2. Corrected `isHomePitching` logic inversion
- **File:** `packages/model/src/managerial/pitching.ts`
- **Fix:** Changed `!gameState.isTopInning` to `gameState.isTopInning`. In baseball, the Home team pitches in the Top of the inning.
- **Verification:** Pitcher selection logic now correctly identifies the pitching team.

### 3. Unified `scoreDiff` perspective
- **File:** `packages/model/src/managerial/pitching.ts` and `app/src/lib/game/engine.ts`
- **Fix:** Standardized `scoreDiff` in `GameState` to always be from the **pitching team's perspective** as documented in `types.ts`. Updated `engine.ts` to pass it correctly.
- **Verification:** Pitching decisions now correctly reflect whether the pitcher is leading or trailing.

### 4. Resolved shadowed variable and fixed indentation
- **File:** `packages/model/src/managerial/pitching.ts`
- **Fix:** Removed the redundant outer `variance` declaration and fixed the indentation of `lowerThreshold` and `upperThreshold`.
- **Verification:** Cleaner code, no shadowing warnings.

### 5. Added missing `intentionalWalk` outcome
- **File:** `packages/model/src/types.ts`
- **Fix:** Added `intentionalWalk` to `Outcome` type and `EVENT_RATE_KEYS`. This brings the count to 17 as per documentation. Updated `MatchupModel.ts` and `engine.ts` to handle it.
- **Verification:** Type system now reflects all 17 documented outcomes.

### 6. Robustness improvement in `MatchupModel` debug log
- **File:** `packages/model/src/MatchupModel.ts`
- **Fix:** Added check for `sum > 0` before calling `toFixed` and ensured `sum` is treated safely.
- **Verification:** No risk of crash on zero sum (though already unlikely).

### 7. Fixed division by zero in quality calculations
- **File:** `packages/model/src/managerial/pitcher-quality.ts`
- **Fix:** Added clamping/fallback for `pitcher.era` and `pitcher.whip` to avoid `Infinity`.
- **Verification:** Quality scores remain finite even for 0.00 ERA/WHIP pitchers.

### 8. Improved `calculateLeagueNorms` with weighted averages
- **File:** `packages/model/src/managerial/norms-calculator.ts`
- **Fix:** Updated ERA and WHIP calculations to be weighted by Innings Pitched and Batters Faced respectively.
- **Verification:** League norms are now statistically accurate and resistant to small-sample outliers.
