# Situational Plays to Fix

This document tracks game situations where the simulation generates unrealistic plays due to lack of contextual constraints.

## Priority Issues

### 1. Sacrifice Bunt with 2 Outs

**Example:**
```
Top 9th: 0 R, 2 H, 0 E, 2 LOB — Houston Astros 3, Kansas City Royals 0
70. John Mayberry flies out
71. Bob Stinson lines out
72. Amos Otis singles off J.R. Richard
73. Freddie Patek lays down a sacrifice bunt
```

**Issue:** Sacrifice bunts are impossible/unrealistic with 2 outs. With 2 outs, a bunt cannot advance a runner to create a scoring opportunity - the batter needs to reach base safely.

**Expected Behavior:**
- Sacrifice bunts should be excluded from possible outcomes when `outs === 2`
- This constraint should be applied in the `simulatePlateAppearance()` method similar to how fielder's choice, sacrifice fly, and sacrifice bunt are excluded with empty bases

**Fix Location:** `app/src/lib/game/engine.ts` in the `simulatePlateAppearance()` method

**Current Code:**
```typescript
if (areBasesEmpty(state.bases)) {
    // Fielder's choice, sacrifice fly, and sacrifice bunt are impossible with empty bases
    // Get the distribution, exclude impossible outcomes, re-normalize, then sample
    const distribution = this.model.predict(matchup);
    const fcProb = distribution.fieldersChoice || 0;
    const sfProb = distribution.sacrificeFly || 0;
    const sbProb = distribution.sacrificeBunt || 0;
    // ... re-normalization logic
}
```

**Fix:** Add similar logic for when `state.outs === 2` to exclude sacrifice bunts.

---

### 2. Fielder's Choice Description Missing Runner Information

**Examples:**
- Game 18: Play 84: "Enzo Hernandez reaches on fielder's choice"
- Game 26: Play 12: "Chris Speier reaches on fielder's choice"

**Issue:** When a fielder's choice occurs, the play description should specify which runner was out on the play. Currently, some descriptions are missing this information.

**Expected Behavior:** All fielder's choice descriptions should include which runner was put out (e.g., "X reaches on fielder's choice (Y out at Z)").

**Fix Location:** `app/src/lib/game/engine.ts` in the `describePlay()` function or wherever the fielder's choice description logic handles identifying the out runner.

**Current Code:** The logic attempts to find which runner was removed by comparing `runnersBefore` to `newBases`, but in some cases it fails to identify the out runner.

---

## Future Issues

(Add more situational play issues as they are discovered)
