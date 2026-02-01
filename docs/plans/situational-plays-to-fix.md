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

### 2. Fielder's Choice Description Missing Runner Information ✅ FIXED

**Examples:**
- Game 18: Play 84: "Enzo Hernandez reaches on fielder's choice"
- Game 26: Play 12: "Chris Speier reaches on fielder's choice"

**Issue:** When a fielder's choice occurs, the play description should specify which runner was out on the play. The engine was trying to infer which runner was out by comparing bases before/after, which was unreliable and missed edge cases.

**Fix Applied:**
1. Added `outRunnerId` to the state machine's `TransitionResult` type
2. Modified `handleFieldersChoice` in `app/src/lib/game/state-machine/rules/fielders-choice.ts` to explicitly track and return the ID of the runner who was put out
3. Updated `app/src/lib/game/engine.ts` to use the state machine's `outRunnerId` instead of inferring it

**Status:** ✅ Fixed - All 50 games pass with no fielder's choice warnings. The state machine now explicitly tracks which runner was out, eliminating edge cases.

---

## Future Issues

(Add more situational play issues as they are discovered)
