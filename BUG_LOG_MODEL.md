# Bug Log - packages/model

## Logic Bugs

### 1. `blendLineups` produces duplicate players
- **File:** `packages/model/src/managerial/lineup-strategies.ts`
- **Description:** The `blendLineups` function iterates through slots 1-9 and for each slot, randomly chooses between the player in the primary lineup and the player in the secondary lineup. Since the two lineups contain the same players but potentially in different orders, this can result in the same player being selected for multiple slots, and other players being omitted.
- **Impact:** Invalid lineups with duplicate players, causing game crashes or statistical errors.

### 2. `isHomePitching` logic inversion
- **File:** `packages/model/src/managerial/pitching.ts`
- **Description:** `const isHomePitching = !gameState.isTopInning;` is logically inverted. In baseball, the Home team pitches in the Top of the inning (when Away team bats).
- **Impact:** Reliever selection logic uses the wrong team's score and bullpen when deciding which pitcher to bring in.

### 3. `scoreDiff` perspective mismatch
- **File:** `packages/model/src/managerial/pitching.ts` and `app/src/lib/game/engine.ts`
- **Description:** `engine.ts` passes `scoreDiff` from the batting team's perspective. However, `shouldPullPitcher` in `pitching.ts` uses it assuming it's from the pitching team's perspective (e.g., `if (scoreDiff >= 4)` means a comfortable lead for the pitcher).
- **Impact:** Pitchers are managed as if they have a lead when they are losing, and vice versa.

### 4. Shadowed `variance` variable and bad indentation
- **File:** `packages/model/src/managerial/pitching.ts`
- **Description:** In `shouldPullPitcher`, `variance` is declared with `let` at the top of the function but then redeclared with `const` inside the reliever logic block. Also, indentation of `lowerThreshold` and `upperThreshold` is incorrect.
- **Impact:** Code quality/readability issue, potential for subtle bugs if the outer `variance` was intended to be used.

## Type & Documentation Issues

### 5. Outcome count inconsistency
- **File:** `packages/model/src/types.ts`
- **Description:** Comments mention 17 plate appearance outcomes, but only 16 are defined in the `Outcome` type and `EVENT_RATE_KEYS` array.
- **Impact:** Confusion for developers; potentially missing a rare outcome like `intentionalWalk` (though `walk` usually covers it).

### 6. `MatchupModel` debug log rare risk
- **File:** `packages/model/src/MatchupModel.ts`
- **Description:** The debug log `sum.toFixed(4)` is inside a `Math.random() < 0.0001` block. While `sum` is initialized to 0, it's better to ensure it's not null/undefined and handle potential 0 sum (though 0 sum is unlikely due to eps clamping).
- **Impact:** Extremely rare potential crash in production if `sum` is not what's expected.

### 7. Division by zero in `calculatePitcherQuality`
- **File:** `packages/model/src/managerial/pitcher-quality.ts`
- **Description:** `eraRatio = norms.avgERA / pitcher.era` and `whipRatio = norms.avgWHIP / pitcher.whip` can result in `Infinity` if a pitcher has a 0.00 ERA or WHIP (common in small samples).
- **Impact:** Pitchers with 0 ERA/WHIP get infinite quality scores, potentially breaking selection logic or causing other mathematical issues.

### 8. Unweighted averages in `calculateLeagueNorms`
- **File:** `packages/model/src/managerial/norms-calculator.ts`
- **Description:** League norms for ERA and WHIP are calculated as simple averages of all pitchers' ERAs/WHIPs, rather than weighted by Innings Pitched (ERA) or Innings/Batters Faced (WHIP).
- **Impact:** Pitchers with very small sample sizes (e.g. 1 IP, 0.00 ERA or 54.00 ERA) disproportionately skew the "league average" used for quality normalization, making quality scores less accurate.
