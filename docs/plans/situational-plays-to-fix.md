# Situational Plays to Fix

This document tracks game situations where the simulation generates unrealistic plays due to lack of contextual constraints.

## Priority Issues

### 1. Sacrifice Bunt with 2 Outs ✅ FIXED

**Example:**
```
Top 9th: 0 R, 2 H, 0 E, 2 LOB — Houston Astros 3, Kansas City Royals 0
70. John Mayberry flies out
71. Bob Stinson lines out
72. Amos Otis singles off J.R. Richard
73. Freddie Patek lays down a sacrifice bunt
```

**Issue:** Sacrifice bunts are impossible/unrealistic with 2 outs. With 2 outs, a bunt cannot advance a runner to create a scoring opportunity - the batter needs to reach base safely.

**Fix Applied:** Modified `simulatePlateAppearance()` in `app/src/lib/game/engine.ts` to exclude sacrifice bunts when `outs === 2`. The probability of sacrifice bunt is redistributed to other outcomes when there are 2 outs.

**Status:** ✅ Fixed - Sacrifice bunts with 2 outs are now excluded from possible outcomes.

---

### 2. Fielder's Choice Description Missing Runner Information ✅ MOSTLY FIXED

**Examples:**
- Game 18: Play 84: "Enzo Hernandez reaches on fielder's choice"
- Game 26: Play 12: "Chris Speier reaches on fielder's choice"

**Issue:** When a fielder's choice occurs, the play description should specify which runner was out on the play. The logic was checking from nearest to furthest base (1B -> 2B -> 3B) instead of furthest to nearest (3B -> 2B -> 1B), causing incorrect runner identification when multiple runners were on base.

**Fix Applied:**
1. Reversed the loop to check from 3B -> 2B -> 1B (furthest to nearest)
2. Added logic to exclude runners who scored (they're "gone" but not out)
3. Updated the comparison logic in `app/src/lib/game/engine.ts`

**Status:** ✅ Mostly Fixed - Warnings reduced from ~16% to ~4% of fielder's choice plays. Remaining edge cases occur when:
- All runners reached safely (no actual out recorded)
- State machine handles the play as a single/error situation
- Other rare edge cases in baserunning logic

The fallback description "X reaches on fielder's choice" is still accurate for these edge cases.

---

## Future Issues

(Add more situational play issues as they are discovered)
