# Bug Log - @bb/model

This file logs potential bugs, inconsistencies, and areas for improvement found in the `packages/model/src` directory.

## 2026-02-10 Investigation

### 1. `MatchupModel.ts`: normalization fallback could be improved
- **Issue:** In `MatchupModel.predict`, if the `sum` of raw probabilities is 0, it falls back to assigning 1.0 to `groundOut`.
- **Impact:** Low, but `groundOut` might not be the most sensible fallback for all players/eras.
- **Location:** `packages/model/src/MatchupModel.ts` line 147.

### 2. `managerial/pitching.ts`: `selectReliever` uses `gameState.isTopInning` to determine pitching team
- **Issue:** The logic says `isHomePitching = gameState.isTopInning`. In baseball, the home team pitches in the TOP of the inning. This is correct, but the comment then says `pitchingScoreDiff = scoreDiff` and notes `scoreDiff in GameState is already from the pitching team's perspective`. 
- **Verification needed:** If `scoreDiff` is already from the pitching team's perspective, then the `isTopInning` check might be redundant or confusing if it's used to adjust that perspective.
- **Location:** `packages/model/src/managerial/pitching.ts` line 347.

### 3. `managerial/pitcher-classifier.ts`: `hasClosers` logic
- **Issue:** `if (norms.year < 1950) return false;` then `if (norms.year < 1970) return norms.avgSavesPerTeam > 5;`.
- **Potential Bug:** If `norms.year` is 1960 and `avgSavesPerTeam` is 4, it returns false. This seems correct. However, the classifier might then fail to find a "best reliever" to be closer and put everything in `longRelief` or `remaining`.
- **Observation:** In `classifyPitchers`, if `eraHasClosers` is false, it skips the `closer` and `setup` logic entirely. This might result in an empty bullpen if not careful (though `remaining` should have them).

### 4. `managerial/lineup.ts`: `@deprecated` status
- **Issue:** The file is marked as `@deprecated` but is still present and tested.
- **Location:** `packages/model/src/managerial/lineup.ts`.

### 5. `managerial/lineup-strategies.ts`: `blendLineups` potential issue
- **Issue:** If `blendLineups` encounters a situation where both choices for a slot are already used, it returns one of the entire lineups as a fallback.
- **Impact:** This preserves validity (no duplicate players) but might cause a sudden "flip" in the strategy for that specific lineup generation.
- **Location:** `packages/model/src/managerial/lineup-strategies.ts` line 235.

### 6. `MatchupModel.ts`: `validateRates` tolerance
- **Issue:** Uses 25% tolerance for rate sums.
- **Observation:** This is quite high, but the comment justifies it for early eras and limited sample sizes. It might mask bugs in data preparation where rates aren't being normalized correctly.

### 7. `managerial/pitching.ts`: `shouldPullPitcher` default year
- **Issue:** Defaults to 1976 if not provided.
- **Location:** `packages/model/src/managerial/pitching.ts` line 155.
