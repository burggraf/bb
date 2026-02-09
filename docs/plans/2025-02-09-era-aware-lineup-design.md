# Era-Aware Lineup Selection Design

## Overview

Redesign the lineup generation system to produce historically accurate batting orders across all baseball eras (1910-2024). The system uses gradual era transitions rather than hard cutoffs, applying different lineup construction strategies that evolved from traditional "archetype-based" ordering (pre-1980s) to sabermetric "near-optimal" ordering (modern).

## Motivation

The current `generateLineup()` function in `packages/model/src/managerial/lineup.ts` is a V1 placeholder that:
1. Uses only three methods (obp, sabermetric, traditional)
2. Has a commented-out `optimizeBattingOrder()` function
3. Doesn't consider era or historical context
4. Lacks proper position assignment logic

Historical accuracy requires era-specific strategies because real managers didn't optimize lineups the same way in 1950 as they do in 2024.

## Era Classification

### Era Boundaries (with Gradual Transitions)

| Era | Years | Strategy | Transition Window |
|-----|-------|----------|-------------------|
| Pre-analytics | 1910-1985 | Traditional | 1980-1990 |
| Transition | 1986-1995 | Composite | 1990-2000 |
| Early-analytics | 1996-2010 | Sabermetric emerging | 2005-2015 |
| Modern | 2011-present | Full sabermetric | - |

**Gradual Blending:**
- In transition windows, blend strategies based on year proximity
- Example: 1987 uses 70% traditional + 30% composite
- Formula: `blendFactor = (year - windowStart) / (windowEnd - windowStart)`

## Lineup Construction Strategies

### 1. Traditional Strategy (Pre-1980s)

**Slot Archetypes:**

| Slot | Role | Stat Priority |
|------|------|---------------|
| 1 | "Table-setter" | High OBP, contact |
| 2 | "Bunter/contact" | High BA, low K% |
| 3 | "Best pure hitter" | Highest OPS |
| 4 | "Cleanup" | Highest SLG |
| 5-7 | "Gap/backup" | Descending OPS |
| 8 | "Contact" | Best contact of remaining |
| 9 | Pitcher | N/A |

**Algorithm:**
```typescript
// Rank by OPS descending
const ranked = batters.sort((a, b) => b.ops - a.ops);

// Slot assignment:
// Slot 3: Best overall (ranked[0])
// Slot 4: Best power (highest SLG from top 3)
// Slot 1: High OBP from remaining
// Slot 2: High BA from remaining
// Slots 5-8: Fill by remaining OPS descending
// Slot 9: Pitcher (non-DH games only)
```

**Note:** Speed/steals will be added later when running data is available.

### 2. Composite Strategy (1986-1995)

**Slot Assignment:**

| Slots | Method |
|-------|--------|
| 3, 4, 5 | Top 3 by OPS |
| 1, 2 | Next 2 highest OBP |
| 6, 7, 8, 9 | Remaining by OPS descending |

**Algorithm:**
```typescript
const ranked = batters.sort((a, b) => b.ops - a.ops);
slots[3] = ranked[0];   // Best OPS
slots[4] = ranked[1];   // 2nd best OPS
slots[5] = ranked[2];   // 3rd best OPS

const remaining = ranked.slice(3);
const byOBP = [...remaining].sort((a, b) => b.obp - a.obp);
slots[1] = byOBP[0];    // Best OBP of remaining
slots[2] = byOBP[1];    // 2nd best OBP

// Fill 6, 7, 8, 9 with remaining by OPS
```

### 3. Early-Analytics Strategy (1996-2010)

**Sabermetric "The Book" Pattern:**

Batting order: **1, 2, 4, 3, 5, 6, 7, 8, 9** by descending overall value

**Algorithm:**
```typescript
const ranked = batters.sort((a, b) => b.ops - a.ops);
// Apply permutation [1,2,4,3,5,6,7,8,9]
const order = [1, 2, 4, 3, 5, 6, 7, 8, 9];
slots[order[i]] = ranked[i];
```

### 4. Modern Strategy (2011-present)

Same as early-analytics but with potential for:
- Platoon-based leadoff adjustments (future)
- Optimized pinch-hitter spots (future)

For now: identical to early-analytics.

## Value Metrics

### Primary Metric: OPS

All eras use OPS (On-base Plus Slugging) as the primary value metric:
- `OPS = OBP + SLG`
- Already available in `BatterStats.ops`
- Correlates strongly with run production

### Future: wOBA

When more detailed stats are available:
- `wOBA = (0.69×BB + 0.72×HBP + 0.89×1B + 1.27×2B + 1.62×3B + 2.10×HR) / PA`
- Better correlation with runs than OPS
- Requires hit type breakdown (already in EventRates)

## Era Detection and Blending

### Era Determination

```typescript
function getEraStrategy(year: number): {
  primary: EraStrategy;
  secondary: EraStrategy | null;
  blendFactor: number; // 0-1, weight for primary
} {
  // Hard era boundaries
  if (year < 1980) return { primary: 'traditional', secondary: null, blendFactor: 1 };
  if (year > 2010) return { primary: 'modern', secondary: null, blendFactor: 1 };

  // Transition windows
  if (year >= 1980 && year <= 1990) {
    const blend = (year - 1980) / 10; // 0 to 1
    return {
      primary: 'composite',
      secondary: 'traditional',
      blendFactor: blend
    };
  }

  if (year >= 1990 && year <= 2000) {
    const blend = (year - 1990) / 10;
    return {
      primary: 'early-analytics',
      secondary: 'composite',
      blendFactor: blend
    };
  }

  if (year >= 2000 && year <= 2010) {
    const blend = (year - 2000) / 10;
    return {
      primary: 'modern',
      secondary: 'early-analytics',
      blendFactor: blend
    };
  }

  // Fallback (shouldn't reach)
  return { primary: 'traditional', secondary: null, blendFactor: 1 };
}
```

## Implementation Architecture

### Package Location

**Hybrid Approach:**

1. **App package** (`app/src/lib/game/lineup-builder.ts`):
   - Era detection and blending logic
   - SeasonNorms integration
   - Pitcher/DH handling
   - Main `buildLineup()` entry point

2. **Model package** (`packages/model/src/managerial/lineup.ts`):
   - Era-specific strategy functions (pure, testable)
   - Stat-based slotting algorithms
   - No era context, just "given X, produce Y"

### Rationale

- Model package stays framework-agnostic (testable in Node)
- Era is app-level concern (year + league context)
- SeasonNorms already lives in app package
- Allows testing strategies independently

## Data Flow

```
SeasonPackage
    ↓
filterAvailablePlayers(allBatters) → { available, rested }
    ↓
buildLineup(teamId, availablePlayers, restedPlayers, seasonPackage)
    ↓
getEraStrategy(year) → { primary, secondary, blendFactor }
    ↓
┌─────────────────────────────────────┐
│  For each strategy (primary/secondary): │
│  ├─ generateStrategyLineup(batters)   │
│  │   └─ selectPositionPlayers()       │
│  │   └─ assignBattingOrder(strategy)  │
│  └─ returns LineupSlot[]              │
└─────────────────────────────────────┘
    ↓
blendLineups(primary, secondary, blendFactor)
    ↓
insertPitcher(lineup, useDH)
    ↓
handlePositionScarcity(restedPlayers) // Emergency override
    ↓
validateLineup() → LineupBuildResult
```

## Player Management Integration

### Rested Player Handling

The lineup builder supports player usage tracking and resting:

**Primary Behavior:**
- Rested players (above usage threshold) are filtered out before lineup construction
- Builder receives only "available for starting" players
- Rested players can still pinch hit during games (separate system)

**Emergency Override (Position Scarcity):**
When no eligible players available for a position:
1. Builder checks `restedPlayers` list for position eligibility
2. Pulls rested player with `positionEligibility[position] > 0`
3. Adds warning: `"Emergency start: [Player] at [Position] - roster shortage"`
4. Returns rested player to lineup as emergency starter

**Example:**
```
Available: 8 position players (no catchers)
Rested: C2 (at 130% usage threshold)

Builder detects 0 available catchers
→ Pulls C2 from rested pool
→ Adds emergency warning
→ Returns valid lineup with C2 at catcher
```

**Usage Threshold:**
- Default: 125% of prorated full-season PAs
- Example: In 50-game season, player with 200 PAs (projected 400) = 50% usage
- At 500 PAs (125% of projected), player enters rested pool
- Configurable per team/simulation

## Types

```typescript
/**
 * Era-specific lineup construction strategy
 */
export type EraStrategy =
  | 'traditional'      // Pre-1980s archetype-based
  | 'composite'        // 1986-1995 hybrid
  | 'early-analytics'  // 1996-2010 sabermetric
  | 'modern';          // 2011+ full analytics

/**
 * Era detection result with blending info
 */
export interface EraDetection {
  primary: EraStrategy;
  secondary: EraStrategy | null;
  blendFactor: number; // 0-1, weight for primary strategy
}

/**
 * Extended batter stats available in app package
 */
interface BatterStats {
  id: string;
  name: string;
  bats: 'L' | 'R' | 'S';
  teamId: string;
  primaryPosition: number;
  positionEligibility: Record<number, number>;
  pa: number;
  avg: number;
  obp: number;
  slg: number;
  ops: number;
  rates: SplitRates;
}

/**
 * Lineup construction result
 */
export interface LineupBuildResult {
  lineup: LineupSlot[];
  startingPitcher: PitcherStats;
  warnings: string[];
  era: EraDetection;
}

/**
 * Lineup slot with batting order and position
 */
export interface LineupSlot {
  playerId: string;
  battingOrder: number; // 1-9
  fieldingPosition: number; // 1-9 (10=DH, 11=PH, 12=PR)
}

/**
 * Options for lineup building
 */
export interface LineupOptions {
  /** Force a specific strategy (skip era detection) */
  strategy?: EraStrategy;
  /** Randomness factor (0-1) for variety */
  randomness?: number;
  /** Override DH rule */
  useDH?: boolean;
  /** Allow emergency starts from rested players on position scarcity */
  allowEmergencyStarts?: boolean; // default: true
}

/**
 * Result of player availability filtering
 */
export interface PlayerAvailability {
  /** Players available to start (below usage threshold) */
  available: BatterStats[];
  /** Players being rested (above usage threshold) */
  rested: BatterStats[];
  /** Warnings about usage status */
  warnings: string[];
}

/**
 * Main lineup builder function signature
 */
function buildLineup(
  teamId: string,
  availablePlayers: BatterStats[],
  restedPlayers: BatterStats[],
  seasonPackage: SeasonPackage,
  options?: LineupOptions
): LineupBuildResult;
```

## Position Assignment

**Priority Order (up the middle first):**
1. Catcher (2)
2. Shortstop (6)
3. Second Base (5)
4. Center Field (8)
5. Third Base (4)
6. First Base (3)
7. Left Field (7)
8. Right Field (9)

**Eligibility:**
- Primary: `positionEligibility[position] > 0`
- Fallback: `primaryPosition === position`

**Tiebreaker:** Higher OPS players get more demanding defensive positions.

## DH Rule Handling

```typescript
function usesDH(league: string, year: number): boolean {
  if (league === 'AL') return year >= 1973;
  if (league === 'NL') return year >= 2022;
  // Other leagues: assume modern DH
  return year >= 2022;
}
```

**Pitcher Batting:**
- Non-DH games: Pitcher always bats 9th
- DH games: No pitcher in batting order

## Error Handling

| Scenario | Action |
|----------|--------|
| < 9 position players (including rested) | Throw error |
| No eligible at position | Use primaryPosition, add warning |
| Position scarcity (0 eligible) | Pull from restedPlayers, add emergency warning |
| Still can't fill after rested override | Throw error |
| Empty roster | Throw error |

## Future Enhancements

1. **Speed/Steals Integration**
   - Add stolen base data to export
   - Use speed score for leadoff preference in traditional era
   - Mark TODOs in code where speed would apply

2. **Lefty-Righty Balance**
   - Prefer L/R alternation in slots 5-7
   - Use as tiebreaker when stats are close

3. **Platoon-Based Leadoff**
   - Modern era: optimize leadoff for opposing starter handedness

4. **Pinch Hitter System** (separate from lineup building)
   - Rested players remain available for pinch hitting
   - In-game PH decisions based on matchup, score, inning
   - Not handled during lineup construction

## Testing Strategy

1. **Unit Tests:**
   - Each era strategy independently
   - Era detection and blending
   - Position assignment
   - DH rule handling

2. **Integration Tests:**
   - Full lineup building for various years
   - Validate against historical lineups
   - Cross-era transitions

3. **Validation Tests:**
   - All positions filled
   - No duplicate players
   - Valid batting order (1-9)
   - Pitcher in correct slot

## Migration Path

1. Create new `lineup-strategies.ts` in model package
2. Update `app/src/lib/game/lineup-builder.ts` with era detection
3. Add tests for each era strategy
4. Integration with GameEngine
5. Remove old `@bb/model/managerial/lineup.ts` (or deprecate)
