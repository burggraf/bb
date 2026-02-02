# Managerial System Design

**Date:** 2025-02-01
**Status:** Design Approved
**Scope:** Algorithmic managerial decisions with randomness

## Overview

A new `ManagerialSystem` class that makes strategic decisions during games with built-in randomness for realism. This system will be integrated into `GameEngine` to handle:

1. Lineup generation (optimal with randomness)
2. Pitcher management (starters, relievers, situational)
3. Pinch-hitter selection (situational)
4. Platoon advantage (with randomness)

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   GameEngine                        │
│  (simulates plate appearances, tracks game state)   │
└──────────────────┬──────────────────────────────────┘
                   │ uses
                   ▼
┌─────────────────────────────────────────────────────┐
│              ManagerialSystem                       │
│  ┌──────────────┬──────────────┬──────────────┐    │
│  │ LineupEngine │ BullpenEngine│ SubEngine    │    │
│  └──────────────┴──────────────┴──────────────┘    │
└─────────────────────────────────────────────────────┘
```

## Components

### 1. Lineup Engine

**File:** `packages/model/src/managerial/lineup.ts`

Generates optimal lineups with configurable randomness.

```typescript
export interface LineupOptions {
  method?: 'obp' | 'sabermetric' | 'traditional';
  randomness?: number;  // 0-1, default 0.1 (10% randomness)
}

export interface LineupSlot {
  playerId: string;
  battingOrder: number;  // 1-9
  fieldingPosition: number;  // 1-9
}

export function generateLineup(
  batters: BatterStats[],
  options: LineupOptions = {}
): LineupSlot[]
```

**Algorithm:**
1. Calculate lineup score for each batter (OBP, SLG, or weighted)
2. Sort by score, take top 9
3. Apply randomness: swap adjacent players (1-3 swaps)
4. Arrange in optimal batting order

**Methods:**
- `obp`: Pure on-base percentage
- `sabermetric`: wOBA-like weights (OBP × 1.8 + SLG × 0.9)
- `traditional`: Power-first approach

### 2. Pitching Management

**File:** `packages/model/src/managerial/pitching.ts`

Manages pitcher substitutions and bullpen usage.

```typescript
export interface PitcherRole {
  pitcherId: string;
  role: 'starter' | 'reliever' | 'closer';
  stamina: number;      // 0-100
  pitchesThrown: number;
}

export interface BullpenState {
  starter: PitcherRole;
  relievers: PitcherRole[];
  closer?: PitcherRole;
}

export function shouldPullPitcher(
  gameState: GameState,
  pitcher: PitcherRole,
  bullpen: BullpenState,
  randomness?: number
): PitchingDecision

export function selectReliever(
  gameState: GameState,
  bullpen: BullpenState
): PitcherRole
```

**Pull Triggers:**
- Hard: 110 pitches, stamina ≤ 20
- Through 6th: 85 pitches (30% chance + randomness)
- 7th inning: 90 pitches (50% chance + randomness)
- 8th+: 95 pitches (70% chance + randomness)
- High leverage (LI > 2.5) + 75+ pitches (70% chance)

**Leverage Index Calculation:**
- Base by inning (1.0 → 1.2 → 1.5 → 2.0)
- Score modifier (close game = higher)
- Base state modifier (runners on, outs)
- Returns value used throughout system

### 3. Substitution Engine

**File:** `packages/model/src/managerial/substitutions.ts`

Handles pinch-hitting decisions.

```typescript
export interface PinchHitDecision {
  shouldPinchHit: boolean;
  pinchHitterId?: string;
  reason?: string;
}

export function shouldPinchHit(
  gameState: GameState,
  currentBatter: BatterStats,
  bench: BatterStats[],
  opposingPitcher: PitcherStats,
  randomness?: number
): PinchHitDecision
```

**PH Decision Matrix:**
- Early game (< 6th): Never
- Low leverage (LI < 1.0): Never
- High leverage (LI ≥ 2.0) + platoon disadvantage: 80% + randomness
- High leverage only: 50% + randomness
- Platoon disadvantage + medium leverage: 60% + randomness
- Late + close (≥8th, ±2 runs): 40% + randomness

**Selection:**
- Find bench players with better OBP vs current pitcher
- Sort by improvement
- Apply randomness: 70% best, 20% 2nd best, 10% worst of candidates

### 4. Platoon Advantage

**File:** `packages/model/src/managerial/platoon.ts`

Applies platoon splits with randomness.

```typescript
export function applyPlatoonAdvantage(
  batter: BatterStats,
  pitcher: PitcherStats,
  baseRates: EventRates,
  randomness?: number
): EventRates
```

**Rules:**
- Switch hitters: always use favorable split
- Normal: match batter handedness to pitcher
- Add ±noise randomness to rates

## Integration with GameEngine

### Constructor Changes

```typescript
constructor(
  season: SeasonPackage,
  awayTeam: string,
  homeTeam: string,
  managerial?: ManagerialOptions  // Optional
)
```

### Game Loop Changes

Before each plate appearance:
```typescript
// 1. Check for pitching change
const pitchingDecision = this.manager.shouldPullPitcher(...);

// 2. Check for pinch-hitter
const phDecision = this.manager.shouldPinchHit(...);

// 3. Continue with normal PA simulation
```

### Type Extensions

```typescript
interface LineupState {
  teamId: string;
  players: LineupSlot[];
  currentBatterIndex: number;
  pitcher: string | null;
  // NEW:
  bench?: string[];  // Available players
  bullpen?: PitcherRole[];  // Available pitchers
}
```

## File Structure

```
packages/model/src/
├── managerial/
│   ├── index.ts        # Exports
│   ├── lineup.ts       # Lineup generation
│   ├── pitching.ts     # Bullpen management
│   ├── substitutions.ts # Pinch-hitting
│   └── platoon.ts      # Platoon advantage
└── types.ts            # May need extensions

app/src/lib/game/
├── engine.ts           # Integrate ManagerialSystem
└── types.ts            # Extend types if needed
```

## Implementation Order

1. **Lineup Engine** - Foundation, testable independently
2. **Platoon Advantage** - Utility, used by other modules
3. **Pitching Management** - Core gameplay integration
4. **Substitution Engine** - Completes the system
5. **GameEngine Integration** - Wire everything together

## Testing Strategy

- Unit tests for each module
- Integration tests for full game flow
- Regression tests to ensure existing behavior unchanged
- Randomness seeded for reproducible tests

## Future Enhancements (Out of Scope)

- Historical lineups from baseball.duckdb
- Full season rotation management
- Defensive replacements
- Pinch-runners
- Double switches (NL strategy)
- User-controlled strategy mode UI
