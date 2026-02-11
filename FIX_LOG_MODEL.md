# Fix Log - @bb/model

Log of fixes applied to the `@bb/model` package.

## 2026-02-10 Fixes

### 1. Improved MatchupModel normalization fallback
- **Issue:** Fallback to `groundOut` on zero sum in `predict`.
- **Fix:** ...

### 2. Clarified/Corrected pitching team logic in `selectReliever`
- **Issue:** Redundant or confusing `isTopInning` check.
- **Fix:** ...

### 3. Pitcher classifier `hasClosers` refinement
- **Issue:** Potential for empty bullpen in early eras.
- **Fix:** ...

### 4. Deprecated `lineup.ts` handling
- **Issue:** File is deprecated but still present and tested.
- **Fix:** ...

### 5. `blendLineups` fallback logic
- **Issue:** Potential strategy "flip" when both choices are used.
- **Fix:** ...

### 6. `MatchupModel` rate validation tolerance
- **Issue:** High tolerance (25%) might mask bugs.
- **Fix:** ...

### 7. `shouldPullPitcher` default year
- **Issue:** Defaults to 1976.
- **Fix:** ...
