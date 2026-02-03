# Pinch Hitting Strategy Design

**Date**: 2026-02-03
**Status**: Design
**Related Issues**: Improving realistic pinch hitter usage across baseball eras

## Problem Statement

The current pinch hitting implementation is not era-appropriate:

1. **Non-DH games**: Relief pitchers sometimes bat when they should always be pinch-hit for
2. **DH games**: Pinch hitting occurs too frequently without proper situational context
3. **No era validation**: PH usage hasn't been tested against historical norms across different baseball eras

## Goals

1. Ensure relief pitchers never bat in non-DH games
2. Implement highly situational pinch hitting for DH games (high leverage + platoon advantage)
3. Validate PH usage against historical norms across 5 representative eras

## Design Overview

### Part 1: Reliever Tracking for Non-DH Games

**Core Principle**: Relief pitchers (who enter mid-game) should never bat in non-DH games.

**Implementation**:

1. **Track original starters**: Store starting pitcher IDs during game initialization
   - Already done in `GameEngine.initializeBullpen()`

2. **Mark relievers**: Add a `relievers: Set<string>` field to track pitchers who entered mid-game
   - When a pitching change occurs, add the new pitcher to this Set
   - These pitchers should never bat

3. **Always PH for relievers**: Before calling `shouldPinchHit()`:
   - Check if current batter is a pitcher (position 1)
   - Check if pitcher is in the `relievers` Set
   - If yes, bypass frequency throttle and always pinch hit (100% probability)

4. **Double switch integration**: Already implemented at lines 840-900 of engine.ts
   - When PH for a reliever, bring in a new pitcher
   - New pitcher is also marked as a reliever

**Edge Cases**:
- What if no relievers are available? Already handled (lines 854-857) - logs warning and skips PH
- What if bullpen is exhausted? Skip PH and let current player bat

### Part 2: DH Game Pinch Hitting Strategy

**Core Principle**: Pinch hitting in DH games should be rare and highly situational.

**Implementation**:

1. **Add `useDH` parameter** to `shouldPinchHit()` function
   - Pass from engine based on game configuration
   - Triggers DH-specific decision logic

2. **DH-specific logic** (stricter than non-DH):

   **Primary Requirements** (both must be true):
   - Leverage index >= 2.0 (high leverage situations only)
   - Platoon advantage exists:
     - Current batter at platoon disadvantage vs pitcher
     - Better platoon match available on bench

   **Secondary Boosters** (increase probability when primary requirements met):
   - 8th inning or later: +30%
   - Trailing by 1-2 runs: +20%
   - Bases loaded: +15%
   - Winning run at bat/on base: +20%

3. **Eliminate frequency throttle** for DH games:
   - Current `phConsiderationRate` calculation (line 788) doesn't apply to DH games
   - Let leverage/platoon criteria naturally control PH frequency

4. **Stricter bench requirements**:
   - Pinch hitter must provide either:
     - Better platoon match (LHB vs RHP when current is RHB vs RHP)
     - Significantly higher OPS (>= 15% improvement vs current batter)

**Probability Matrix**:
```
Leverage >= 2.0 + Platoon advantage:
  Base chance: 60%
  + 8th+ inning: 90%
  + Trailing 1-2: 80%
  + Bases loaded: 75%
  (Cumulative, capped at 95%)
```

### Part 3: Era Testing Strategy

**Goal**: Validate PH usage against historical norms.

**Representative Eras** (5 eras spanning different rules/strategies):

| Era | Year | Characteristics | Expected PH/Game |
|-----|------|-----------------|------------------|
| Deadball | 1910 | Low offense, limited substitutions | 2.5-3.5 |
| Golden Age | 1930 | High offense, no DH | 2.8-3.8 |
| Traditional NL | 1976 | Pre-analytics, no DH | 2.5-3.5 |
| Modern Split | 1996 | NL (no DH) vs AL (DH) | NL: 2.0-3.0, AL: 0.5-1.2 |
| Contemporary | 2019 | Analytics-driven, NL no DH | 1.8-2.8 |

**Testing Framework** (extend `test-game-sim.ts`):

1. **New metrics collection**:
   - Total pinch hits per game (both teams)
   - Pinch hits for pitchers vs position players
   - Pinch hits by inning (early/mid/late)
   - Pinch hit success rate (did PH team win/win more?)
   - Pitchers batting after relief appearance (should be ~0)

2. **Sample size**: 100 games per era

3. **Output format**:
```
Era       | PH/Game | Pitcher PH | Position PH | Late Inning PH | Success %
----------|---------|------------|-------------|----------------|----------
1910      | 2.8     | 1.2        | 1.6         | 1.9            | 52%
1930      | 3.1     | 1.4        | 1.7         | 2.2            | 48%
1976 NL   | 2.9     | 1.5        | 1.4         | 2.0            | 51%
1996 AL   | 0.9     | 0.0        | 0.9         | 0.7            | 45%
1996 NL   | 2.7     | 1.3        | 1.4         | 2.1            | 50%
2019 NL   | 2.3     | 1.1        | 1.2         | 1.8            | 53%

Target range comparison:
✓ 1910: 2.8 (target: 2.5-3.5)
✓ 1930: 3.1 (target: 2.8-3.8)
✓ 1976: 2.9 (target: 2.5-3.5)
✓ 1996 AL: 0.9 (target: 0.5-1.2)
✓ 1996 NL: 2.7 (target: 2.0-3.0)
✓ 2019: 2.3 (target: 1.8-2.8)
```

4. **Validation check**: Highlight any era outside ±20% of target range

## Implementation Structure

### Files to Modify

| File | Changes |
|------|---------|
| `app/src/lib/game/engine.ts` | Add reliever tracking, always PH for relievers, pass useDH flag |
| `packages/model/src/managerial/substitutions.ts` | Add useDH parameter, implement DH-specific logic |
| `app/test-game-sim.ts` | Add PH metrics tracking and era comparison output |

### Detailed Changes

#### 1. `app/src/lib/game/engine.ts`

**Add field**:
```typescript
private relievers: Set<string>;  // Pitchers who entered mid-game
```

**Initialize in constructor**:
```typescript
this.relivers = new Set();
```

**Modify `checkForManagerialDecisions()`**:

Before the current PH check (around line 780):
```typescript
// Check if current batter is a reliever who should never bat (non-DH games)
const currentBatterId = getNextBatter(battingTeam, this.season.batters);
const currentBatterSlot = battingTeam.players.find(p => p.playerId === currentBatterId);

// Determine if this game uses DH
const battingTeamLeague = season.teams[battingTeam.teamId]?.league ?? 'NL';
const usesDH = usesDH(battingTeamLeague, season.meta.year);

// Non-DH: Relievers should never bat
if (!usesDH && currentBatterSlot?.position === 1 && this.relivers.has(currentBatterId)) {
  // Always pinch hit for relievers in non-DH games
  // Skip the frequency throttle - this is mandatory
  const phDecision = attemptPinchHitForReliever(...);
  if (phDecision.success) return true;
}
```

When making pitching change (around line 700):
```typescript
// Mark the new pitcher as a reliever
this.relievers.add(pitchingDecision.newPitcher);
```

#### 2. `packages/model/src/managerial/substitutions.ts`

**Update interface**:
```typescript
export interface PinchHitOptions {
  randomness?: number;
  relaxedThresholds?: boolean;
  useDH?: boolean;  // NEW: DH game flag for stricter logic
}
```

**Update function signature**:
```typescript
export function shouldPinchHit(
  gameState: GameState,
  currentBatter: BatterStats,
  bench: BatterStats[],
  opposingPitcher: PitcherStats,
  options: number | PinchHitOptions = 0.15
): PinchHitDecision
```

**Add DH-specific logic** (after existing logic):
```typescript
// DH games have stricter requirements
const isDHGame = typeof options === 'object' ? options.useDH ?? false : false;

if (isDHGame) {
  // DH: Require high leverage AND platoon advantage
  const leverage = calculateLeverageIndex(gameState);
  if (leverage < 2.0) {
    return { shouldPinchHit: false };
  }

  // Must have platoon disadvantage AND better option
  const hasDisadvantage = isPlatoonDisadvantage(currentBatter.handedness, opposingPitcher.handedness);
  if (!hasDisadvantage) {
    return { shouldPinchHit: false };
  }

  // Find better option with strict requirements
  const betterOption = findBestPinchHitter(bench, opposingPitcher, currentBatter, false);
  if (!betterOption) {
    return { shouldPinchHit: false };
  }

  // Verify significant improvement
  const currentOPS = getOPS(currentBatter, opposingPitcher.handedness);
  const betterOPS = getOPS(betterOption, opposingPitcher.handedness);
  if (betterOPS < currentOPS * 1.15) {
    return { shouldPinchHit: false };
  }

  // Calculate probability with boosters
  let phChance = 0.60;  // Base chance

  if (gameState.inning >= 8) phChance += 0.30;
  if (gameState.scoreDiff < 0 && gameState.scoreDiff >= -2) phChance += 0.20;
  if (gameState.bases.some(b => b !== null)) {
    if (gameState.bases.every(b => b !== null)) phChance += 0.15;  // Bases loaded
  }
  if (gameState.bases[2] !== null || (gameState.bases[1] !== null && gameState.outs < 2)) {
    phChance += 0.20;  // Winning run at bat/on base
  }

  phChance = Math.min(phChance, 0.95);

  if (Math.random() < phChance) {
    return {
      shouldPinchHit: true,
      pinchHitterId: betterOption.id,
      reason: `Pinch hit for ${currentBatter.name} (${betterOption.name})`
    };
  }

  return { shouldPinchHit: false };
}

// Non-DH games: use existing logic (already implemented)
```

#### 3. `app/test-game-sim.ts`

**Add metrics interface**:
```typescript
interface PHMetrics {
  totalPinchHits: number;
  pitcherPinchHits: number;  // PH for pitchers
  positionPinchHits: number;  // PH for position players
  byInning: Map<number, number>;  // PH by inning
  gamesWithPH: number;
  phTeamWins: number;
  relieversBatting: number;  // Should be 0!
}
```

**Add `PinchHitAnalyzer` class**:
```typescript
class PinchHitAnalyzer {
  private metrics = new Map<string, PHMetrics>();

  analyzeGame(engine: GameEngine, winner: 'away' | 'home'): void {
    // Count PH events from play-by-play
    // Track whether relievers ever batted
    // Accumulate metrics per game
  }

  getSummary(): EraSummary {
    // Calculate averages across all games
  }
}
```

**Add CLI flag**:
```typescript
// --pinch-hit-test flag runs era analysis
// Outputs comparison table vs target ranges
```

## Success Criteria

- ✓ Zero relief pitchers batting in non-DH games
- ✓ PH/game falls within historical ranges for each era (±20%)
- ✓ DH games show significantly fewer PH than non-DH games
- ✓ PH decisions cluster in high-leverage situations for DH games
- ✓ Pitcher PH occurs at appropriate rates for non-DH eras

## Implementation Order

1. Add reliever tracking to `engine.ts`
2. Modify `shouldPinchHit()` for DH-specific logic
3. Add PH metrics to `test-game-sim.ts`
4. Run era validation tests (100 games x 5 eras)
5. Iterate based on results

## Related Documentation

- [Managerial System Design](./2025-02-01-managerial-system-design.md)
- [Detailed Outcomes Design](./2025-02-01-detailed-outcomes-design.md)
- [Position Eligibility Design](./2025-02-02-position-eligibility-design.md)
