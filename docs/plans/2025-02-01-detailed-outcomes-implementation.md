# Detailed Plate Appearance Outcomes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand the plate appearance outcome model from 7 to 17 granular outcomes, enabling statistically accurate baseball simulation with proper double play modeling, tag-up scoring, and probabilistic runner advancement.

**Architecture:** The expansion flows through three layers: (1) Model package types defining the 17 outcomes, (2) Data-prep scripts extracting detailed stats from DuckDB, (3) App state machine handling probabilistic transitions. Each outcome gets its own probability in EventRates, and the state machine uses advancement tables with dice rolls for runner movement.

**Tech Stack:** TypeScript, Vitest (testing), DuckDB (data extraction), SvelteKit (app)

---

## Phase 1: Model Package Types

### Task 1.1: Define DetailedOutcome Type

**Files:**
- Modify: `packages/model/src/types.ts:8-16`

**Step 1: Update the Outcome type union**

Replace lines 8-16 with:

```typescript
/**
 * The 17 detailed plate appearance outcomes.
 * Grouped by category for readability.
 */
export type Outcome =
  // Hits
  | 'single'
  | 'double'
  | 'triple'
  | 'homeRun'
  // Walks
  | 'walk'
  | 'hitByPitch'
  // Strikeout
  | 'strikeout'
  // Ball-in-play outs
  | 'groundOut'
  | 'flyOut'
  | 'lineOut'
  | 'popOut'
  // Sacrifices
  | 'sacrificeFly'
  | 'sacrificeBunt'
  // Other
  | 'fieldersChoice'
  | 'reachedOnError'
  | 'catcherInterference';
```

**Step 2: Run type check to verify syntax**

Run: `pnpm -C packages/model build`
Expected: Should fail - EventRates and EVENT_RATE_KEYS still have old outcomes

---

### Task 1.2: Update EventRates Interface

**Files:**
- Modify: `packages/model/src/types.ts:22-30`

**Step 1: Replace EventRates interface**

Replace the current EventRates interface (around lines 22-30) with:

```typescript
/**
 * Probability rates for each of the 17 plate appearance outcomes.
 * Rates should sum to 1.0 within a split (vsLeft or vsRight).
 */
export interface EventRates {
  // Hits
  single: number;
  double: number;
  triple: number;
  homeRun: number;
  // Walks
  walk: number;
  hitByPitch: number;
  // Strikeout
  strikeout: number;
  // Ball-in-play outs
  groundOut: number;
  flyOut: number;
  lineOut: number;
  popOut: number;
  // Sacrifices
  sacrificeFly: number;
  sacrificeBunt: number;
  // Other
  fieldersChoice: number;
  reachedOnError: number;
  catcherInterference: number;
}
```

**Step 2: Run type check**

Run: `pnpm -C packages/model build`
Expected: Should fail - EVENT_RATE_KEYS and tests still use old keys

---

### Task 1.3: Update EVENT_RATE_KEYS Constant

**Files:**
- Modify: `packages/model/src/types.ts` (find EVENT_RATE_KEYS definition)

**Step 1: Update the constant array**

Find and replace EVENT_RATE_KEYS:

```typescript
/**
 * All outcome keys in consistent order for iteration.
 * Order matches historical frequency (descending) for intuitive display.
 */
export const EVENT_RATE_KEYS: (keyof EventRates)[] = [
  'groundOut',      // 12.1%
  'single',         // 16.3%
  'strikeout',      // 14.4%
  'flyOut',         // 7.8%
  'walk',           // 7.9%
  'popOut',         // 3.4%
  'lineOut',        // 3.3%
  'double',         // 4.1%
  'homeRun',        // 2.1%
  'reachedOnError', // 1.3%
  'sacrificeBunt',  // 1.1%
  'triple',         // 0.7%
  'hitByPitch',     // 0.7%
  'sacrificeFly',   // 0.7%
  'fieldersChoice', // 0.5%
  'catcherInterference', // 0.01%
];
```

**Step 2: Run type check**

Run: `pnpm -C packages/model build`
Expected: Should pass - types are now consistent

---

### Task 1.4: Update ProbabilityDistribution Interface

**Files:**
- Modify: `packages/model/src/types.ts` (find ProbabilityDistribution)

**Step 1: Update ProbabilityDistribution to match EventRates**

The ProbabilityDistribution should mirror EventRates structure. Find and update it:

```typescript
/**
 * Probability distribution across all 17 outcomes.
 * Values must sum to 1.0.
 */
export type ProbabilityDistribution = EventRates;
```

**Step 2: Run build**

Run: `pnpm -C packages/model build`
Expected: PASS

---

### Task 1.5: Fix Model Tests

**Files:**
- Modify: `packages/model/src/MatchupModel.test.ts`

**Step 1: Update test fixtures with 17-outcome rates**

Create a helper at the top of the test file:

```typescript
function makeEventRates(overrides: Partial<EventRates> = {}): EventRates {
  const base: EventRates = {
    single: 0.163,
    double: 0.041,
    triple: 0.007,
    homeRun: 0.021,
    walk: 0.079,
    hitByPitch: 0.007,
    strikeout: 0.144,
    groundOut: 0.121,
    flyOut: 0.078,
    lineOut: 0.033,
    popOut: 0.034,
    sacrificeFly: 0.007,
    sacrificeBunt: 0.011,
    fieldersChoice: 0.005,
    reachedOnError: 0.013,
    catcherInterference: 0.0001,
  };
  // Normalize to sum to 1.0
  const merged = { ...base, ...overrides };
  const sum = Object.values(merged).reduce((a, b) => a + b, 0);
  for (const key of Object.keys(merged) as (keyof EventRates)[]) {
    merged[key] = merged[key] / sum;
  }
  return merged;
}
```

**Step 2: Update all test fixtures**

Replace existing hardcoded 7-outcome rates with `makeEventRates()` calls:

```typescript
const batter = {
  rates: {
    vsLeft: makeEventRates({ homeRun: 0.05 }),  // power vs LHP
    vsRight: makeEventRates({ homeRun: 0.02 }), // normal vs RHP
  },
};
```

**Step 3: Run tests**

Run: `pnpm -C packages/model test`
Expected: Tests should pass with updated fixtures

**Step 4: Commit**

```bash
git add packages/model/src/
git commit -m "feat(model): expand Outcome type to 17 detailed outcomes

- Update Outcome union type with 17 outcomes
- Update EventRates interface with all 17 outcome rates
- Update EVENT_RATE_KEYS constant in frequency order
- Update ProbabilityDistribution to mirror EventRates
- Fix tests with makeEventRates() helper"
```

---

## Phase 2: Data Export - Basic 17 Outcomes

### Task 2.1: Update Data-Prep Types

**Files:**
- Modify: `data-prep/src/export-season.ts` (find SeasonPackage type definition)

**Step 1: Import shared types from model package**

At the top of the file, update imports:

```typescript
import type { EventRates } from '@bb/model';
```

**Step 2: Remove local EventRates definition**

Delete any local `EventRates` interface - use the one from `@bb/model`.

**Step 3: Run type check**

Run: `pnpm -C data-prep build` (or `tsc --noEmit`)
Expected: Type errors in SQL queries - old field names

---

### Task 2.2: Update Batter Stats SQL Query

**Files:**
- Modify: `data-prep/src/export-season.ts` (getBatterStatsSQL function)

**Step 1: Replace the outcome counting CASE statements**

Update the SQL query to count all 17 outcomes. Replace the current SUM statements with:

```typescript
function getBatterStatsSQL(year: number): string {
  return `
    WITH batter_events AS (
      SELECT
        e.batter_id,
        e.pitcher_hand,
        e.plate_appearance_result,
        e.batted_trajectory,
        COUNT(*) as cnt
      FROM event.events e
      WHERE e.year = ${year}
        AND e.plate_appearance_result IS NOT NULL
        AND e.plate_appearance_result != 'IntentionalWalk'
      GROUP BY e.batter_id, e.pitcher_hand, e.plate_appearance_result, e.batted_trajectory
    )
    SELECT
      b.batter_id as id,
      p.name_first || ' ' || p.name_last as name,
      p.bats,
      b.team_id as "teamId",
      b.pitcher_hand,
      -- Hits
      SUM(CASE WHEN plate_appearance_result = 'Single' THEN cnt ELSE 0 END) as singles,
      SUM(CASE WHEN plate_appearance_result IN ('Double', 'GroundRuleDouble') THEN cnt ELSE 0 END) as doubles,
      SUM(CASE WHEN plate_appearance_result = 'Triple' THEN cnt ELSE 0 END) as triples,
      SUM(CASE WHEN plate_appearance_result IN ('HomeRun', 'InsideTheParkHomeRun') THEN cnt ELSE 0 END) as "homeRuns",
      -- Walks
      SUM(CASE WHEN plate_appearance_result = 'Walk' THEN cnt ELSE 0 END) as walks,
      SUM(CASE WHEN plate_appearance_result = 'HitByPitch' THEN cnt ELSE 0 END) as "hitByPitches",
      -- Strikeout
      SUM(CASE WHEN plate_appearance_result = 'StrikeOut' THEN cnt ELSE 0 END) as strikeouts,
      -- Ball-in-play outs (by trajectory)
      SUM(CASE WHEN plate_appearance_result = 'InPlayOut' AND batted_trajectory IN ('GroundBall', 'GroundBallBunt') THEN cnt ELSE 0 END) as "groundOuts",
      SUM(CASE WHEN plate_appearance_result = 'InPlayOut' AND batted_trajectory = 'Fly' THEN cnt ELSE 0 END) as "flyOuts",
      SUM(CASE WHEN plate_appearance_result = 'InPlayOut' AND batted_trajectory = 'LineDrive' THEN cnt ELSE 0 END) as "lineOuts",
      SUM(CASE WHEN plate_appearance_result = 'InPlayOut' AND batted_trajectory = 'PopUp' THEN cnt ELSE 0 END) as "popOuts",
      SUM(CASE WHEN plate_appearance_result = 'InPlayOut' AND (batted_trajectory IS NULL OR batted_trajectory = 'Unknown') THEN cnt ELSE 0 END) as "unknownOuts",
      -- Sacrifices
      SUM(CASE WHEN plate_appearance_result = 'SacrificeFly' THEN cnt ELSE 0 END) as "sacrificeFlies",
      SUM(CASE WHEN plate_appearance_result = 'SacrificeHit' THEN cnt ELSE 0 END) as "sacrificeBunts",
      -- Other
      SUM(CASE WHEN plate_appearance_result = 'FieldersChoice' THEN cnt ELSE 0 END) as "fieldersChoices",
      SUM(CASE WHEN plate_appearance_result = 'ReachedOnError' THEN cnt ELSE 0 END) as "reachedOnErrors",
      SUM(CASE WHEN plate_appearance_result = 'Interference' THEN cnt ELSE 0 END) as "catcherInterferences",
      -- Total PA
      SUM(cnt) as pa
    FROM batter_events be
    JOIN dim.players p ON be.batter_id = p.player_id
    JOIN (
      SELECT DISTINCT batter_id, team_id
      FROM event.events
      WHERE year = ${year}
    ) b ON be.batter_id = b.batter_id
    GROUP BY b.batter_id, p.name_first, p.name_last, p.bats, b.team_id, be.pitcher_hand
  `;
}
```

**Step 2: Verify SQL syntax**

Run: `duckdb baseball.duckdb -c "$(head -50 export-sql-test.sql)"` (manual test)

---

### Task 2.3: Add Trajectory Imputation Function

**Files:**
- Modify: `data-prep/src/export-season.ts`

**Step 1: Add imputation constants and function**

Add before the export logic:

```typescript
/**
 * Modern trajectory distribution for imputing unknown outs.
 * Based on 1990+ data where trajectory is reliably recorded.
 */
const TRAJECTORY_DISTRIBUTION = {
  groundOut: 0.44,
  flyOut: 0.30,
  popOut: 0.14,
  lineOut: 0.12,
};

/**
 * Distribute unknown outs across trajectory types using modern distribution.
 */
function imputeUnknownOuts(
  groundOuts: number,
  flyOuts: number,
  lineOuts: number,
  popOuts: number,
  unknownOuts: number
): { groundOut: number; flyOut: number; lineOut: number; popOut: number } {
  return {
    groundOut: groundOuts + unknownOuts * TRAJECTORY_DISTRIBUTION.groundOut,
    flyOut: flyOuts + unknownOuts * TRAJECTORY_DISTRIBUTION.flyOut,
    lineOut: lineOuts + unknownOuts * TRAJECTORY_DISTRIBUTION.lineOut,
    popOut: popOuts + unknownOuts * TRAJECTORY_DISTRIBUTION.popOut,
  };
}
```

---

### Task 2.4: Update Rate Calculation

**Files:**
- Modify: `data-prep/src/export-season.ts` (rate calculation section)

**Step 1: Update calcRates function to handle 17 outcomes**

```typescript
function calcEventRates(row: {
  singles: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  walks: number;
  hitByPitches: number;
  strikeouts: number;
  groundOuts: number;
  flyOuts: number;
  lineOuts: number;
  popOuts: number;
  unknownOuts: number;
  sacrificeFlies: number;
  sacrificeBunts: number;
  fieldersChoices: number;
  reachedOnErrors: number;
  catcherInterferences: number;
  pa: number;
}): EventRates {
  const pa = row.pa;
  if (pa === 0) {
    // Return league average placeholder - will be replaced later
    return getZeroRates();
  }

  // Impute unknown trajectory outs
  const imputed = imputeUnknownOuts(
    row.groundOuts,
    row.flyOuts,
    row.lineOuts,
    row.popOuts,
    row.unknownOuts
  );

  const rates: EventRates = {
    single: row.singles / pa,
    double: row.doubles / pa,
    triple: row.triples / pa,
    homeRun: row.homeRuns / pa,
    walk: row.walks / pa,
    hitByPitch: row.hitByPitches / pa,
    strikeout: row.strikeouts / pa,
    groundOut: imputed.groundOut / pa,
    flyOut: imputed.flyOut / pa,
    lineOut: imputed.lineOut / pa,
    popOut: imputed.popOut / pa,
    sacrificeFly: row.sacrificeFlies / pa,
    sacrificeBunt: row.sacrificeBunts / pa,
    fieldersChoice: row.fieldersChoices / pa,
    reachedOnError: row.reachedOnErrors / pa,
    catcherInterference: row.catcherInterferences / pa,
  };

  // Round to 4 decimal places
  for (const key of Object.keys(rates) as (keyof EventRates)[]) {
    rates[key] = Math.round(rates[key] * 10000) / 10000;
  }

  return rates;
}

function getZeroRates(): EventRates {
  return {
    single: 0,
    double: 0,
    triple: 0,
    homeRun: 0,
    walk: 0,
    hitByPitch: 0,
    strikeout: 0,
    groundOut: 0,
    flyOut: 0,
    lineOut: 0,
    popOut: 0,
    sacrificeFly: 0,
    sacrificeBunt: 0,
    fieldersChoice: 0,
    reachedOnError: 0,
    catcherInterference: 0,
  };
}
```

---

### Task 2.5: Update Pitcher Stats SQL (Similar to Batters)

**Files:**
- Modify: `data-prep/src/export-season.ts` (getPitcherStatsSQL function)

**Step 1: Mirror the batter stats query for pitchers**

Apply the same 17-outcome breakdown, but group by `batter_hand` instead of `pitcher_hand`:

```typescript
function getPitcherStatsSQL(year: number): string {
  return `
    WITH pitcher_events AS (
      SELECT
        e.pitcher_id,
        e.batter_hand,
        e.plate_appearance_result,
        e.batted_trajectory,
        COUNT(*) as cnt
      FROM event.events e
      WHERE e.year = ${year}
        AND e.plate_appearance_result IS NOT NULL
        AND e.plate_appearance_result != 'IntentionalWalk'
      GROUP BY e.pitcher_id, e.batter_hand, e.plate_appearance_result, e.batted_trajectory
    )
    SELECT
      pe.pitcher_id as id,
      p.name_first || ' ' || p.name_last as name,
      p.throws,
      pe.batter_hand,
      -- [Same SUM CASE statements as batter query]
      SUM(CASE WHEN plate_appearance_result = 'Single' THEN cnt ELSE 0 END) as singles,
      SUM(CASE WHEN plate_appearance_result IN ('Double', 'GroundRuleDouble') THEN cnt ELSE 0 END) as doubles,
      SUM(CASE WHEN plate_appearance_result = 'Triple' THEN cnt ELSE 0 END) as triples,
      SUM(CASE WHEN plate_appearance_result IN ('HomeRun', 'InsideTheParkHomeRun') THEN cnt ELSE 0 END) as "homeRuns",
      SUM(CASE WHEN plate_appearance_result = 'Walk' THEN cnt ELSE 0 END) as walks,
      SUM(CASE WHEN plate_appearance_result = 'HitByPitch' THEN cnt ELSE 0 END) as "hitByPitches",
      SUM(CASE WHEN plate_appearance_result = 'StrikeOut' THEN cnt ELSE 0 END) as strikeouts,
      SUM(CASE WHEN plate_appearance_result = 'InPlayOut' AND batted_trajectory IN ('GroundBall', 'GroundBallBunt') THEN cnt ELSE 0 END) as "groundOuts",
      SUM(CASE WHEN plate_appearance_result = 'InPlayOut' AND batted_trajectory = 'Fly' THEN cnt ELSE 0 END) as "flyOuts",
      SUM(CASE WHEN plate_appearance_result = 'InPlayOut' AND batted_trajectory = 'LineDrive' THEN cnt ELSE 0 END) as "lineOuts",
      SUM(CASE WHEN plate_appearance_result = 'InPlayOut' AND batted_trajectory = 'PopUp' THEN cnt ELSE 0 END) as "popOuts",
      SUM(CASE WHEN plate_appearance_result = 'InPlayOut' AND (batted_trajectory IS NULL OR batted_trajectory = 'Unknown') THEN cnt ELSE 0 END) as "unknownOuts",
      SUM(CASE WHEN plate_appearance_result = 'SacrificeFly' THEN cnt ELSE 0 END) as "sacrificeFlies",
      SUM(CASE WHEN plate_appearance_result = 'SacrificeHit' THEN cnt ELSE 0 END) as "sacrificeBunts",
      SUM(CASE WHEN plate_appearance_result = 'FieldersChoice' THEN cnt ELSE 0 END) as "fieldersChoices",
      SUM(CASE WHEN plate_appearance_result = 'ReachedOnError' THEN cnt ELSE 0 END) as "reachedOnErrors",
      SUM(CASE WHEN plate_appearance_result = 'Interference' THEN cnt ELSE 0 END) as "catcherInterferences",
      SUM(cnt) as pa
    FROM pitcher_events pe
    JOIN dim.players p ON pe.pitcher_id = p.player_id
    GROUP BY pe.pitcher_id, p.name_first, p.name_last, p.throws, pe.batter_hand
  `;
}
```

---

### Task 2.6: Update League Averages SQL

**Files:**
- Modify: `data-prep/src/export-season.ts` (getLeagueAveragesSQL function)

**Step 1: Update league averages to calculate 17-outcome rates**

```typescript
function getLeagueAveragesSQL(year: number): string {
  return `
    SELECT
      e.pitcher_hand,
      COUNT(*) as pa,
      SUM(CASE WHEN plate_appearance_result = 'Single' THEN 1 ELSE 0 END) as singles,
      SUM(CASE WHEN plate_appearance_result IN ('Double', 'GroundRuleDouble') THEN 1 ELSE 0 END) as doubles,
      SUM(CASE WHEN plate_appearance_result = 'Triple' THEN 1 ELSE 0 END) as triples,
      SUM(CASE WHEN plate_appearance_result IN ('HomeRun', 'InsideTheParkHomeRun') THEN 1 ELSE 0 END) as "homeRuns",
      SUM(CASE WHEN plate_appearance_result = 'Walk' THEN 1 ELSE 0 END) as walks,
      SUM(CASE WHEN plate_appearance_result = 'HitByPitch' THEN 1 ELSE 0 END) as "hitByPitches",
      SUM(CASE WHEN plate_appearance_result = 'StrikeOut' THEN 1 ELSE 0 END) as strikeouts,
      SUM(CASE WHEN plate_appearance_result = 'InPlayOut' AND batted_trajectory IN ('GroundBall', 'GroundBallBunt') THEN 1 ELSE 0 END) as "groundOuts",
      SUM(CASE WHEN plate_appearance_result = 'InPlayOut' AND batted_trajectory = 'Fly' THEN 1 ELSE 0 END) as "flyOuts",
      SUM(CASE WHEN plate_appearance_result = 'InPlayOut' AND batted_trajectory = 'LineDrive' THEN 1 ELSE 0 END) as "lineOuts",
      SUM(CASE WHEN plate_appearance_result = 'InPlayOut' AND batted_trajectory = 'PopUp' THEN 1 ELSE 0 END) as "popOuts",
      SUM(CASE WHEN plate_appearance_result = 'InPlayOut' AND (batted_trajectory IS NULL OR batted_trajectory = 'Unknown') THEN 1 ELSE 0 END) as "unknownOuts",
      SUM(CASE WHEN plate_appearance_result = 'SacrificeFly' THEN 1 ELSE 0 END) as "sacrificeFlies",
      SUM(CASE WHEN plate_appearance_result = 'SacrificeHit' THEN 1 ELSE 0 END) as "sacrificeBunts",
      SUM(CASE WHEN plate_appearance_result = 'FieldersChoice' THEN 1 ELSE 0 END) as "fieldersChoices",
      SUM(CASE WHEN plate_appearance_result = 'ReachedOnError' THEN 1 ELSE 0 END) as "reachedOnErrors",
      SUM(CASE WHEN plate_appearance_result = 'Interference' THEN 1 ELSE 0 END) as "catcherInterferences"
    FROM event.events e
    WHERE e.year = ${year}
      AND e.plate_appearance_result IS NOT NULL
      AND e.plate_appearance_result != 'IntentionalWalk'
    GROUP BY e.pitcher_hand
  `;
}
```

---

### Task 2.7: Update Season Package Version

**Files:**
- Modify: `data-prep/src/export-season.ts` (meta section)

**Step 1: Bump version to 2.0.0**

In the section that builds the SeasonPackage object:

```typescript
const seasonPackage: SeasonPackage = {
  meta: {
    year,
    generatedAt: new Date().toISOString(),
    version: '2.0.0',
  },
  // ... rest
};
```

**Step 2: Run data export**

Run: `cd data-prep && pnpm exec tsx src/export-season.ts 1976`
Expected: Creates `app/static/seasons/1976.json` with 17-outcome rates

**Step 3: Verify JSON structure**

Run: `cat app/static/seasons/1976.json | jq '.batters["rosep001"].rates.vsRHP' | head -20`
Expected: Shows all 17 outcome keys with values

**Step 4: Commit**

```bash
git add data-prep/src/
git commit -m "feat(data-prep): extract 17 detailed outcomes with trajectory imputation

- Update SQL queries to count all 17 PA outcomes
- Add trajectory imputation for pre-1990 unknown outs
- Update rate calculation to handle all outcome types
- Bump season package version to 2.0.0"
```

---

## Phase 3: App Types

### Task 3.1: Update App Outcome Type

**Files:**
- Modify: `app/src/lib/game/types.ts:5-12`

**Step 1: Update Outcome type to match model**

Replace the Outcome type:

```typescript
/**
 * The 17 detailed plate appearance outcomes.
 */
export type Outcome =
  // Hits
  | 'single'
  | 'double'
  | 'triple'
  | 'homeRun'
  // Walks
  | 'walk'
  | 'hitByPitch'
  // Strikeout
  | 'strikeout'
  // Ball-in-play outs
  | 'groundOut'
  | 'flyOut'
  | 'lineOut'
  | 'popOut'
  // Sacrifices
  | 'sacrificeFly'
  | 'sacrificeBunt'
  // Other
  | 'fieldersChoice'
  | 'reachedOnError'
  | 'catcherInterference';
```

---

### Task 3.2: Update App EventRates Interface

**Files:**
- Modify: `app/src/lib/game/types.ts:14-22`

**Step 1: Replace EventRates interface**

```typescript
/**
 * Probability rates for each of the 17 plate appearance outcomes.
 */
export interface EventRates {
  single: number;
  double: number;
  triple: number;
  homeRun: number;
  walk: number;
  hitByPitch: number;
  strikeout: number;
  groundOut: number;
  flyOut: number;
  lineOut: number;
  popOut: number;
  sacrificeFly: number;
  sacrificeBunt: number;
  fieldersChoice: number;
  reachedOnError: number;
  catcherInterference: number;
}
```

**Step 2: Run type check**

Run: `pnpm -C app check`
Expected: Type errors in engine.ts and state-machine - need to update handlers

**Step 3: Commit**

```bash
git add app/src/lib/game/types.ts
git commit -m "feat(app): update Outcome and EventRates types to 17 outcomes"
```

---

## Phase 4: State Machine Updates

### Task 4.1: Add Outcome Classification Helpers

**Files:**
- Create: `app/src/lib/game/state-machine/outcome-types.ts`

**Step 1: Create outcome classification module**

```typescript
import type { Outcome } from '../types';

/**
 * Outcomes that are hits (batter reaches base safely on a hit).
 */
export const HIT_OUTCOMES: Outcome[] = ['single', 'double', 'triple', 'homeRun'];

/**
 * Outcomes where batter reaches base (not a hit).
 */
export const REACH_BASE_OUTCOMES: Outcome[] = [
  'walk',
  'hitByPitch',
  'fieldersChoice',
  'reachedOnError',
  'catcherInterference',
];

/**
 * Outcomes that are outs (batter is out).
 */
export const OUT_OUTCOMES: Outcome[] = [
  'strikeout',
  'groundOut',
  'flyOut',
  'lineOut',
  'popOut',
  'sacrificeFly',
  'sacrificeBunt',
];

/**
 * Ball-in-play outs where runners can potentially advance.
 */
export const BALL_IN_PLAY_OUTS: Outcome[] = [
  'groundOut',
  'flyOut',
  'lineOut',
  'popOut',
];

export function isHit(outcome: Outcome): boolean {
  return HIT_OUTCOMES.includes(outcome);
}

export function isOut(outcome: Outcome): boolean {
  return OUT_OUTCOMES.includes(outcome);
}

export function isBallInPlayOut(outcome: Outcome): boolean {
  return BALL_IN_PLAY_OUTS.includes(outcome);
}

export function batterReachesBase(outcome: Outcome): boolean {
  return isHit(outcome) || REACH_BASE_OUTCOMES.includes(outcome);
}
```

---

### Task 4.2: Update Transition Function

**Files:**
- Modify: `app/src/lib/game/state-machine/transitions.ts`

**Step 1: Update the switch statement to handle all 17 outcomes**

Replace the existing switch:

```typescript
import { isHit, isOut, isBallInPlayOut } from './outcome-types';
import { handleSacrificeFly } from './rules/sacrifice-fly';
import { handleSacrificeBunt } from './rules/sacrifice-bunt';
import { handleFieldersChoice } from './rules/fielders-choice';
import { handleReachedOnError } from './rules/reached-on-error';
import { handleCatcherInterference } from './rules/interference';

export function transition(
  currentState: BaserunningState,
  outcome: Outcome,
  batterId: string
): TransitionResult {
  const { outs, bases, runners } = currentState;

  switch (outcome) {
    // Hits
    case 'single':
    case 'double':
    case 'triple':
    case 'homeRun':
      return handleHit(currentState, outcome, batterId);

    // Walks
    case 'walk':
    case 'hitByPitch':
      return handleWalkOrHBP(currentState, batterId);

    // Strikeout
    case 'strikeout':
      return handleStrikeout(currentState);

    // Ball-in-play outs
    case 'groundOut':
      return handleGroundOut(currentState, batterId);
    case 'flyOut':
    case 'lineOut':
      return handleFlyOut(currentState, outcome);
    case 'popOut':
      return handlePopOut(currentState);

    // Sacrifices
    case 'sacrificeFly':
      return handleSacrificeFly(currentState);
    case 'sacrificeBunt':
      return handleSacrificeBunt(currentState, batterId);

    // Other
    case 'fieldersChoice':
      return handleFieldersChoice(currentState, batterId);
    case 'reachedOnError':
      return handleReachedOnError(currentState, batterId);
    case 'catcherInterference':
      return handleCatcherInterference(currentState, batterId);

    default:
      // Exhaustive check
      const _exhaustive: never = outcome;
      throw new Error(`Unknown outcome: ${outcome}`);
  }
}
```

---

### Task 4.3: Create Sacrifice Fly Handler

**Files:**
- Create: `app/src/lib/game/state-machine/rules/sacrifice-fly.ts`

**Step 1: Write the test first**

Create: `app/src/lib/game/state-machine/rules/sacrifice-fly.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { handleSacrificeFly } from './sacrifice-fly';
import type { BaserunningState } from '../state';

describe('handleSacrificeFly', () => {
  it('scores runner from 3B with <2 outs', () => {
    const state: BaserunningState = {
      outs: 0,
      bases: 4, // runner on 3B only
      runners: { first: null, second: null, third: 'runner3' },
    };
    const result = handleSacrificeFly(state);

    expect(result.runsScored).toBe(1);
    expect(result.scorerIds).toEqual(['runner3']);
    expect(result.nextState.outs).toBe(1);
    expect(result.nextState.bases).toBe(0); // bases empty
  });

  it('ends inning with 2 outs', () => {
    const state: BaserunningState = {
      outs: 2,
      bases: 4,
      runners: { first: null, second: null, third: 'runner3' },
    };
    const result = handleSacrificeFly(state);

    expect(result.runsScored).toBe(0);
    expect(result.nextState.outs).toBe(3);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C app test -- --run sacrifice-fly`
Expected: FAIL - module not found

**Step 3: Implement the handler**

Create: `app/src/lib/game/state-machine/rules/sacrifice-fly.ts`

```typescript
import type { BaserunningState, TransitionResult } from '../state';
import { getRunnerAtBase, runnersToBaseConfig } from '../state';

/**
 * Handle sacrifice fly - batter is out, runner on 3B may tag and score.
 */
export function handleSacrificeFly(state: BaserunningState): TransitionResult {
  const { outs, runners } = state;
  const newOuts = outs + 1;

  // Inning over - no one scores
  if (newOuts >= 3) {
    return {
      nextState: { outs: 3, bases: state.bases, runners },
      runsScored: 0,
      scorerIds: [],
    };
  }

  // Runner on 3B scores (that's what makes it a sac fly)
  const runnerOn3rd = getRunnerAtBase(state, 3);
  if (runnerOn3rd) {
    const newRunners = {
      first: runners.first,
      second: runners.second,
      third: null,
    };
    return {
      nextState: {
        outs: newOuts,
        bases: runnersToBaseConfig(newRunners),
        runners: newRunners,
      },
      runsScored: 1,
      scorerIds: [runnerOn3rd],
    };
  }

  // No runner on 3B (shouldn't happen for true sac fly, but handle it)
  return {
    nextState: { outs: newOuts, bases: state.bases, runners },
    runsScored: 0,
    scorerIds: [],
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C app test -- --run sacrifice-fly`
Expected: PASS

---

### Task 4.4: Create Sacrifice Bunt Handler

**Files:**
- Create: `app/src/lib/game/state-machine/rules/sacrifice-bunt.ts`

**Step 1: Write the test**

Create: `app/src/lib/game/state-machine/rules/sacrifice-bunt.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { handleSacrificeBunt } from './sacrifice-bunt';
import type { BaserunningState } from '../state';

describe('handleSacrificeBunt', () => {
  it('advances runner from 1B to 2B, batter out', () => {
    const state: BaserunningState = {
      outs: 0,
      bases: 1, // runner on 1B
      runners: { first: 'runner1', second: null, third: null },
    };
    const result = handleSacrificeBunt(state, 'batter');

    expect(result.runsScored).toBe(0);
    expect(result.nextState.outs).toBe(1);
    expect(result.nextState.runners.first).toBeNull();
    expect(result.nextState.runners.second).toBe('runner1');
  });

  it('advances runner from 2B to 3B', () => {
    const state: BaserunningState = {
      outs: 0,
      bases: 2, // runner on 2B
      runners: { first: null, second: 'runner2', third: null },
    };
    const result = handleSacrificeBunt(state, 'batter');

    expect(result.nextState.runners.second).toBeNull();
    expect(result.nextState.runners.third).toBe('runner2');
  });
});
```

**Step 2: Run test, implement, verify**

Follow TDD pattern as in Task 4.3.

```typescript
import type { BaserunningState, TransitionResult } from '../state';
import { runnersToBaseConfig } from '../state';

/**
 * Handle sacrifice bunt - batter is out, runners advance one base.
 */
export function handleSacrificeBunt(
  state: BaserunningState,
  batterId: string
): TransitionResult {
  const { outs, runners } = state;
  const newOuts = outs + 1;

  if (newOuts >= 3) {
    return {
      nextState: { outs: 3, bases: state.bases, runners },
      runsScored: 0,
      scorerIds: [],
    };
  }

  // Advance all runners one base
  const scorerIds: string[] = [];
  let runsScored = 0;

  const newRunners = {
    first: null, // batter is out, not on base
    second: runners.first,
    third: runners.second,
  };

  // Runner on 3rd scores
  if (runners.third) {
    runsScored++;
    scorerIds.push(runners.third);
  }

  return {
    nextState: {
      outs: newOuts,
      bases: runnersToBaseConfig(newRunners),
      runners: newRunners,
    },
    runsScored,
    scorerIds,
  };
}
```

---

### Task 4.5: Create Fielder's Choice Handler

**Files:**
- Create: `app/src/lib/game/state-machine/rules/fielders-choice.ts`

**Step 1: Write test**

```typescript
import { describe, it, expect } from 'vitest';
import { handleFieldersChoice } from './fielders-choice';
import type { BaserunningState } from '../state';

describe('handleFieldersChoice', () => {
  it('puts batter on 1B, lead runner out', () => {
    const state: BaserunningState = {
      outs: 0,
      bases: 1, // runner on 1B
      runners: { first: 'runner1', second: null, third: null },
    };
    const result = handleFieldersChoice(state, 'batter');

    expect(result.nextState.outs).toBe(1);
    expect(result.nextState.runners.first).toBe('batter');
    expect(result.nextState.runners.second).toBeNull(); // runner1 is out
  });

  it('with bases empty, just puts batter on 1B', () => {
    const state: BaserunningState = {
      outs: 0,
      bases: 0,
      runners: { first: null, second: null, third: null },
    };
    const result = handleFieldersChoice(state, 'batter');

    expect(result.nextState.outs).toBe(1);
    expect(result.nextState.runners.first).toBe('batter');
  });
});
```

**Step 2: Implement**

```typescript
import type { BaserunningState, TransitionResult } from '../state';
import { runnersToBaseConfig } from '../state';

/**
 * Handle fielder's choice - batter reaches 1B, a runner is out.
 * Typically the lead runner is retired.
 */
export function handleFieldersChoice(
  state: BaserunningState,
  batterId: string
): TransitionResult {
  const { outs, runners } = state;
  const newOuts = outs + 1;

  if (newOuts >= 3) {
    return {
      nextState: { outs: 3, bases: state.bases, runners },
      runsScored: 0,
      scorerIds: [],
    };
  }

  // Batter reaches 1B, lead runner is out
  // Simplified: just remove lead runner, others stay
  const newRunners = {
    first: batterId,
    second: runners.first ? null : runners.second, // if 1B occupied, that runner out
    third: runners.second && !runners.first ? null : runners.third,
  };

  return {
    nextState: {
      outs: newOuts,
      bases: runnersToBaseConfig(newRunners),
      runners: newRunners,
    },
    runsScored: 0,
    scorerIds: [],
  };
}
```

---

### Task 4.6: Create Reached On Error Handler

**Files:**
- Create: `app/src/lib/game/state-machine/rules/reached-on-error.ts`

**Step 1: Write test**

```typescript
import { describe, it, expect } from 'vitest';
import { handleReachedOnError } from './reached-on-error';
import type { BaserunningState } from '../state';

describe('handleReachedOnError', () => {
  it('batter reaches 1B, runners advance', () => {
    const state: BaserunningState = {
      outs: 0,
      bases: 1, // runner on 1B
      runners: { first: 'runner1', second: null, third: null },
    };
    const result = handleReachedOnError(state, 'batter');

    expect(result.nextState.outs).toBe(0); // no out recorded
    expect(result.nextState.runners.first).toBe('batter');
    expect(result.nextState.runners.second).toBe('runner1');
  });
});
```

**Step 2: Implement**

```typescript
import type { BaserunningState, TransitionResult } from '../state';
import { runnersToBaseConfig } from '../state';

/**
 * Handle reached on error - batter reaches 1B safely, runners advance.
 * Similar to a single but no out is recorded.
 */
export function handleReachedOnError(
  state: BaserunningState,
  batterId: string
): TransitionResult {
  const { outs, runners } = state;
  const scorerIds: string[] = [];
  let runsScored = 0;

  // Runners advance like a single
  const newRunners = {
    first: batterId,
    second: runners.first,
    third: runners.second,
  };

  // Runner on 3B scores
  if (runners.third) {
    runsScored++;
    scorerIds.push(runners.third);
  }

  return {
    nextState: {
      outs,
      bases: runnersToBaseConfig(newRunners),
      runners: newRunners,
    },
    runsScored,
    scorerIds,
  };
}
```

---

### Task 4.7: Create Catcher Interference Handler

**Files:**
- Create: `app/src/lib/game/state-machine/rules/interference.ts`

**Step 1: Write test**

```typescript
import { describe, it, expect } from 'vitest';
import { handleCatcherInterference } from './interference';
import type { BaserunningState } from '../state';

describe('handleCatcherInterference', () => {
  it('batter awarded 1B, runners advance if forced', () => {
    const state: BaserunningState = {
      outs: 0,
      bases: 1, // runner on 1B
      runners: { first: 'runner1', second: null, third: null },
    };
    const result = handleCatcherInterference(state, 'batter');

    expect(result.nextState.outs).toBe(0);
    expect(result.nextState.runners.first).toBe('batter');
    expect(result.nextState.runners.second).toBe('runner1');
  });
});
```

**Step 2: Implement (same as walk mechanics)**

```typescript
import type { BaserunningState, TransitionResult } from '../state';
import { handleWalkOrHBP } from './walk';

/**
 * Handle catcher interference - batter awarded 1B, same as walk.
 */
export function handleCatcherInterference(
  state: BaserunningState,
  batterId: string
): TransitionResult {
  // Same advancement rules as walk
  return handleWalkOrHBP(state, batterId);
}
```

---

### Task 4.8: Create Pop Out Handler

**Files:**
- Create: `app/src/lib/game/state-machine/rules/pop-out.ts`

**Step 1: Write test**

```typescript
import { describe, it, expect } from 'vitest';
import { handlePopOut } from './pop-out';
import type { BaserunningState } from '../state';

describe('handlePopOut', () => {
  it('records an out, no advancement', () => {
    const state: BaserunningState = {
      outs: 0,
      bases: 4, // runner on 3B
      runners: { first: null, second: null, third: 'runner3' },
    };
    const result = handlePopOut(state);

    expect(result.nextState.outs).toBe(1);
    expect(result.runsScored).toBe(0);
    expect(result.nextState.runners.third).toBe('runner3'); // no tag-up on pop
  });
});
```

**Step 2: Implement**

```typescript
import type { BaserunningState, TransitionResult } from '../state';

/**
 * Handle pop out - batter is out, no runner advancement.
 * Pop outs don't allow tag-ups (too short).
 */
export function handlePopOut(state: BaserunningState): TransitionResult {
  const newOuts = state.outs + 1;

  return {
    nextState: {
      outs: Math.min(newOuts, 3),
      bases: state.bases,
      runners: state.runners,
    },
    runsScored: 0,
    scorerIds: [],
  };
}
```

---

### Task 4.9: Update State Machine Index Exports

**Files:**
- Modify: `app/src/lib/game/state-machine/index.ts`

**Step 1: Export all new handlers**

```typescript
export { handleSacrificeFly } from './rules/sacrifice-fly';
export { handleSacrificeBunt } from './rules/sacrifice-bunt';
export { handleFieldersChoice } from './rules/fielders-choice';
export { handleReachedOnError } from './rules/reached-on-error';
export { handleCatcherInterference } from './rules/interference';
export { handlePopOut } from './rules/pop-out';
export { isHit, isOut, isBallInPlayOut, batterReachesBase } from './outcome-types';
```

**Step 2: Run all state machine tests**

Run: `pnpm -C app test -- --run state-machine`
Expected: All tests pass

**Step 3: Commit**

```bash
git add app/src/lib/game/state-machine/
git commit -m "feat(state-machine): add handlers for all 17 outcomes

- Add sacrifice-fly handler with tag-up scoring
- Add sacrifice-bunt handler with runner advancement
- Add fielders-choice handler
- Add reached-on-error handler
- Add catcher-interference handler (delegates to walk)
- Add pop-out handler (no advancement)
- Add outcome-types module for outcome classification
- Update transition() to route all 17 outcomes"
```

---

## Phase 5: Engine Updates

### Task 5.1: Update describePlay Function

**Files:**
- Modify: `app/src/lib/game/engine.ts` (describePlay function)

**Step 1: Expand the switch statement for all 17 outcomes**

```typescript
function describePlay(
  outcome: Outcome,
  batterName: string,
  pitcherName: string,
  runsScored: number
): string {
  const runsText = runsScored > 0 ? ` (${runsScored} run${runsScored > 1 ? 's' : ''} scored)` : '';

  switch (outcome) {
    // Hits
    case 'single':
      return `${batterName} singles off ${pitcherName}${runsText}`;
    case 'double':
      return `${batterName} doubles off ${pitcherName}${runsText}`;
    case 'triple':
      return `${batterName} triples off ${pitcherName}${runsText}`;
    case 'homeRun':
      return `${batterName} homers off ${pitcherName}${runsText}`;

    // Walks
    case 'walk':
      return `${batterName} walks${runsText}`;
    case 'hitByPitch':
      return `${batterName} hit by pitch from ${pitcherName}${runsText}`;

    // Strikeout
    case 'strikeout':
      return `${batterName} strikes out against ${pitcherName}`;

    // Ball-in-play outs
    case 'groundOut':
      return `${batterName} grounds out${runsText}`;
    case 'flyOut':
      return `${batterName} flies out${runsText}`;
    case 'lineOut':
      return `${batterName} lines out`;
    case 'popOut':
      return `${batterName} pops out`;

    // Sacrifices
    case 'sacrificeFly':
      return `${batterName} hits a sacrifice fly${runsText}`;
    case 'sacrificeBunt':
      return `${batterName} lays down a sacrifice bunt${runsText}`;

    // Other
    case 'fieldersChoice':
      return `${batterName} reaches on fielder's choice${runsText}`;
    case 'reachedOnError':
      return `${batterName} reaches on an error${runsText}`;
    case 'catcherInterference':
      return `${batterName} reaches on catcher's interference`;

    default:
      const _exhaustive: never = outcome;
      return `${batterName} - ${outcome}`;
  }
}
```

---

### Task 5.2: Update Hit Detection

**Files:**
- Modify: `app/src/lib/game/engine.ts` (addHalfInningSummary function)

**Step 1: Import isHit helper**

```typescript
import { isHit } from './state-machine/outcome-types';
```

**Step 2: Replace hardcoded hit check**

Find line ~117 where it checks for hits:

```typescript
// Old:
const hits = plays.filter(p => ['single', 'double', 'triple', 'homeRun'].includes(p.outcome));

// New:
const hits = plays.filter(p => isHit(p.outcome));
```

---

### Task 5.3: Add Intentional Walk Method

**Files:**
- Modify: `app/src/lib/game/engine.ts`

**Step 1: Add method for intentional walks**

```typescript
/**
 * Execute an intentional walk (manager decision, not simulated).
 */
intentionalWalk(): PlayEvent {
  const batter = this.getCurrentBatter();
  const pitcher = this.getCurrentPitcher();

  // Use walk mechanics for baserunning
  const transitionResult = transition(this.baserunningState, 'walk', batter.id);
  this.baserunningState = transitionResult.nextState;

  const play: PlayEvent = {
    inning: this.inning,
    halfInning: this.halfInning,
    outs: this.baserunningState.outs,
    batterId: batter.id,
    pitcherId: pitcher.id,
    outcome: 'walk', // Recorded as walk for stats
    description: `${batter.name} intentionally walked`,
    runsScored: transitionResult.runsScored,
    scorerIds: transitionResult.scorerIds,
  };

  this.plays.push(play);
  this.advanceBatter();

  return play;
}
```

**Step 2: Run app type check**

Run: `pnpm -C app check`
Expected: PASS

**Step 3: Commit**

```bash
git add app/src/lib/game/engine.ts
git commit -m "feat(engine): update for 17 outcomes and add intentionalWalk()

- Expand describePlay() with descriptions for all 17 outcomes
- Use isHit() helper for hit detection
- Add intentionalWalk() method for manager decisions"
```

---

## Phase 6: Re-export Season Data

### Task 6.1: Export 1976 Season with New Format

**Step 1: Run export**

Run: `cd data-prep && pnpm exec tsx src/export-season.ts 1976`

**Step 2: Verify output**

Run: `cat app/static/seasons/1976.json | jq '.meta'`
Expected: `{ "year": 1976, "version": "2.0.0", ... }`

Run: `cat app/static/seasons/1976.json | jq '.league.vsRHP | keys'`
Expected: 16 keys (all outcomes)

**Step 3: Commit**

```bash
git add app/static/seasons/1976.json
git commit -m "data: re-export 1976 season with 17-outcome format v2.0.0"
```

---

## Phase 7: Integration Testing

### Task 7.1: Run Full App Test Suite

**Step 1: Run all tests**

Run: `pnpm -C app test`
Expected: All tests pass

**Step 2: Run dev server and test manually**

Run: `pnpm -C app dev`

Test:
1. Load the app at http://localhost:5173
2. Start a new game with 1976 season
3. Simulate several plate appearances
4. Verify outcomes show detailed types (groundOut, flyOut, strikeout, etc.)
5. Verify runs score correctly on sacrifice flies
6. Verify double plays work on ground outs

---

### Task 7.2: Final Commit

```bash
git add -A
git commit -m "feat: complete 17 detailed outcome implementation

Summary:
- Model: 17-outcome types with EVENT_RATE_KEYS
- Data-prep: SQL queries for all outcome types with trajectory imputation
- App types: Updated Outcome and EventRates
- State machine: Handlers for all 17 outcomes
- Engine: Updated play descriptions and hit detection

Closes detailed-outcomes-design.md implementation"
```

---

## Appendix: Outcome-to-Handler Mapping

| Outcome | Handler | Key Behavior |
|---------|---------|--------------|
| single | handleHit | Runners advance 1-2 bases |
| double | handleHit | Runners usually score |
| triple | handleHit | All runners score |
| homeRun | handleHit | All runners + batter score |
| walk | handleWalkOrHBP | Force advancement |
| hitByPitch | handleWalkOrHBP | Force advancement |
| strikeout | handleStrikeout | Out, no advancement |
| groundOut | handleGroundOut | DP possible, force outs |
| flyOut | handleFlyOut | Tag-up possible |
| lineOut | handleFlyOut | Tag-up possible |
| popOut | handlePopOut | No advancement |
| sacrificeFly | handleSacrificeFly | Runner scores, out |
| sacrificeBunt | handleSacrificeBunt | Runners advance, out |
| fieldersChoice | handleFieldersChoice | Batter safe, runner out |
| reachedOnError | handleReachedOnError | Like single, no out |
| catcherInterference | handleCatcherInterference | Like walk |
