# Detailed Plate Appearance Outcomes - Design Document

**Date:** 2025-02-01
**Status:** Design Approved

## Overview

Expand the plate appearance outcome model from 7 categories to 17 granular outcomes, enabling statistically accurate simulation of baseball games. The goal is that simulating 10,000 games produces outcome distributions nearly identical to historical data.

## Current State

**Current 7 outcomes:**
```typescript
{ out, single, double, triple, homeRun, walk, hitByPitch }
```

**Limitations:**
- "Out" is a single bucket (no distinction between strikeouts, ground outs, fly outs)
- No double play modeling
- No sacrifice fly/bunt distinction
- Deterministic runner advancement (doesn't match real probabilities)

## Proposed 17 Outcomes

### Outcome Taxonomy

| Category | Outcomes | Notes |
|----------|----------|-------|
| Hits | `single`, `double`, `triple`, `homeRun` | Includes ground-rule doubles, inside-the-park HRs |
| Walks | `walk`, `hitByPitch` | Intentional walks excluded (manager decision) |
| Strikeout | `strikeout` | All K's (looking/swinging merged) |
| Ball-in-play Outs | `groundOut`, `flyOut`, `lineOut`, `popOut` | Split by batted ball trajectory |
| Sacrifices | `sacrificeFly`, `sacrificeBunt` | Distinct outcome types |
| Other | `fieldersChoice`, `reachedOnError`, `catcherInterference` | Batter reaches base |

### Historical Frequency (from database analysis)

| Outcome | Frequency |
|---------|-----------|
| groundOut | 12.1% |
| single | 16.3% |
| strikeout | 14.4% |
| flyOut | 7.8% |
| walk | 7.9% |
| popOut | 3.4% |
| lineOut | 3.3% |
| double | 4.1% |
| homeRun | 2.1% |
| reachedOnError | 1.3% |
| sacrificeBunt | 1.1% |
| triple | 0.7% |
| hitByPitch | 0.7% |
| sacrificeFly | 0.7% |
| fieldersChoice | 0.5% |
| catcherInterference | 0.01% |

*Note: ~23% of historical outs have "Unknown" trajectory (pre-1990 data quality). These will be imputed from modern trajectory distribution.*

---

## Conditional Probability Model

Some outcomes have sub-outcomes that depend on game state.

### Double Play Rate

**When:** `groundOut` + runner on 1B + <2 outs

**Data (1990+ only):**
- League average DP conversion: **48.4%**
- Range by batter: 13% (fast runners) to 79% (slow runners)
- Std dev: 11 percentage points

**Implementation:**
- Store per-batter `dpRate` (players with <30 eligible ground outs use league default)
- State machine rolls against `dpRate` when conditions allow

### Tag-Up Scoring (Fly Outs)

**When:** `flyOut` or `lineOut` + runner on 3B + <2 outs

**Data:**
- Scoring rate: ~25-30% (varies by outs, other runners)

**Implementation:**
- Stored in advancement probability tables
- State machine rolls dice to determine if runner tags and scores

### Intentional Walks

- **Excluded from model** — this is a manager decision, not a batter-pitcher outcome
- Handled as separate `engine.intentionalWalk()` action
- Filtered from stat calculations

---

## Runner Advancement Probabilities

Based on analysis of historical play-by-play data.

### Single with Runner on 3B Only

| Outcome | Probability |
|---------|-------------|
| Runner scores | 97.3% |
| Runner held at 3B | 1.5% |
| Runner thrown out at home | 0.1% |
| Other | 1.1% |

### Single with Runner on 2B Only

| Outcome | Probability |
|---------|-------------|
| Runner scores | 62.6% |
| Runner to 3B (doesn't score) | 37.4% |

### Double with Runner on 1B Only

| Outcome | Probability |
|---------|-------------|
| Runner scores | 40.3% |
| Runner to 3B | 59.5% |

### Ground Out DP Eligible (Runner on 1B, <2 outs)

| Outcome | Probability |
|---------|-------------|
| Double play (2 outs) | 48.4% |
| Single out (1 out) | 51.6% |

*Full advancement tables for all 8 base states will be extracted and stored in season data.*

---

## Data Schema

### DetailedEventRates (17 outcomes)

```typescript
interface DetailedEventRates {
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

### BatterStats

```typescript
interface BatterStats {
  id: string;
  name: string;
  bats: 'L' | 'R' | 'S';
  teamId: string;
  rates: {
    vsLHP: DetailedEventRates;
    vsRHP: DetailedEventRates;
  };
  dpRate: number;  // P(DP | groundOut, eligible), default 0.48
}
```

### Advancement Tables

```typescript
interface AdvancementTable {
  single: Record<BaseState, RunnerOutcome[]>;
  double: Record<BaseState, RunnerOutcome[]>;
  triple: Record<BaseState, RunnerOutcome[]>;
  groundOut: Record<BaseState, Record<OutsBefore, GroundOutcome[]>>;
  flyOut: Record<BaseState, Record<OutsBefore, FlyOutcome[]>>;
  lineOut: Record<BaseState, Record<OutsBefore, FlyOutcome[]>>;
}

interface RunnerOutcome {
  runsScored: number;
  runnersOut?: number;
  probability: number;
}

interface GroundOutcome {
  outsOnPlay: number;  // 1, 2, or 3
  runsScored: number;
  probability: number;
}

interface FlyOutcome {
  runsScored: number;  // 0 or 1 for tag-up
  probability: number;
}

type BaseState = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
type OutsBefore = 0 | 1 | 2;
```

### Season Package (v2.0.0)

```typescript
interface SeasonPackage {
  meta: {
    year: number;
    generatedAt: string;
    version: '2.0.0';
  };
  batters: Record<string, BatterStats>;
  pitchers: Record<string, PitcherStats>;
  league: {
    vsLHP: DetailedEventRates;
    vsRHP: DetailedEventRates;
    defaultDpRate: number;
    advancement: AdvancementTable;
  };
  teams: Record<string, Team>;
  games: Game[];
}
```

---

## State Machine Updates

### TransitionContext

```typescript
interface TransitionContext {
  state: BaserunningState;
  outcome: DetailedOutcome;
  batterId: string;
  advancementTable: AdvancementTable;
  batterDpRate?: number;
  random?: () => number;  // For testability
}
```

### TransitionResult

```typescript
interface TransitionResult {
  nextState: BaserunningState;
  runsScored: number;
  outsOnPlay: number;
  scorerIds: string[];
  playDetails: {
    type: 'single_out' | 'double_play' | 'triple_play' | 'tag_up' | 'held' | 'thrown_out' | 'normal';
    runnersAdvanced: Array<{ from: Base; to: Base | 'home' | 'out' }>;
  };
}
```

### Rule Handlers

| File | Outcomes Handled |
|------|------------------|
| `ground-out.ts` | `groundOut` + DP probability |
| `fly-out.ts` | `flyOut`, `lineOut`, `popOut` + tag-up probability |
| `hits.ts` | `single`, `double`, `triple`, `homeRun` + advancement probability |
| `walks.ts` | `walk`, `hitByPitch` (forced advancement only) |
| `strikeout.ts` | `strikeout` (no advancement) |
| `sacrifice.ts` | `sacrificeFly`, `sacrificeBunt` |
| `fielders-choice.ts` | `fieldersChoice` |
| `reached-on-error.ts` | `reachedOnError` |
| `interference.ts` | `catcherInterference` |

---

## Data Export Updates

### Trajectory Imputation

Pre-1990 data has ~47% "Unknown" trajectory. Impute using modern (1990+) distribution:

| Trajectory | Proportion |
|------------|------------|
| GroundBall | 44% |
| Fly | 30% |
| PopUp | 14% |
| LineDrive | 12% |

### DP Rate Calculation

```sql
-- Use 1990+ data only for reliable trajectory
SELECT
  batter_id,
  CASE
    WHEN eligible_ground_outs >= 30
    THEN double_plays::FLOAT / eligible_ground_outs
    ELSE 0.48
  END as dp_rate
FROM (
  SELECT
    batter_id,
    COUNT(*) as eligible_ground_outs,
    SUM(CASE WHEN outs_on_play >= 2 THEN 1 ELSE 0 END) as double_plays
  FROM events
  WHERE plate_appearance_result = 'InPlayOut'
    AND batted_trajectory IN ('GroundBall', 'GroundBallBunt')
    AND base_state IN (1, 3, 5, 7)
    AND outs < 2
    AND year >= 1990
  GROUP BY batter_id
)
```

---

## Implementation Plan

### Phase 1: Model Package (`packages/model/`)
1. Update `types.ts` with 17-outcome interfaces
2. Update `MatchupModel.ts` to use new outcome keys
3. Update tests

### Phase 2: Data Export (`data-prep/`)
1. Create SQL query builders for 17 outcomes
2. Add DP rate extraction
3. Add advancement table extraction
4. Add trajectory imputation
5. Update export script to v2.0.0 format

### Phase 3: App Types (`app/src/lib/game/types.ts`)
1. Add new interfaces
2. Update existing types

### Phase 4: State Machine (`app/src/lib/game/state-machine/`)
1. Update transition function signature
2. Add probability-based logic
3. Create new rule handlers
4. Update tests

### Phase 5: Engine (`app/src/lib/game/engine.ts`)
1. Update baserunning calls
2. Update play descriptions
3. Add `intentionalWalk()` method

### Phase 6: Data Migration
1. Re-export 1976 season
2. Verify app functionality

### Phase 7: Validation
1. Simulate 10,000 games
2. Compare outcome distribution to historical data
3. Verify statistical accuracy

---

## Future Enhancements (Not in Scope)

- Batted ball location/direction (fielder position, spray charts)
- Runner speed affecting advancement probabilities
- Outfielder arm strength affecting tag-up rates
- Park factors for batted ball outcomes
- Pitch-level simulation

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Pre-1990 trajectory data quality | Impute from modern distribution |
| Insufficient PA for player DP rate | Default to league average (0.48) |
| Edge cases in advancement tables | Use "Other" bucket with league averages |
| Breaking saved games | Version check in loader, require reset |
