# Lineup Builder Design

## Overview

Create a valid MLB lineup builder algorithm that generates realistic batting orders and position assignments from a team roster, with historically accurate DH rule handling.

## Requirements

- Create valid 9-player lineups from available roster
- Pick starting pitcher (most BFP as starter)
- Assign positions using "up the middle first" priority
- Use traditional batting order construction
- Strict historical DH rules (AL 1973+, NL 2022+)
- Handle edge cases (minimal rosters, missing position eligibility)

## DH Rules

**Historical Accuracy:**
- AL: Uses DH from 1973–present
- NL: Uses DH from 2022–present
- Before DH: Pitcher bats 9th

```typescript
function usesDH(league: 'AL' | 'NL', year: number): boolean {
  if (league === 'AL') return year >= 1973;
  return year >= 2022;
}
```

## Position Assignment Algorithm

**Priority Order (up the middle first):**
1. Catcher (2) - Most demanding defensive position
2. Shortstop (6) - Key infield pivot
3. Second Base (5) - Double play pivot
4. Center Field (8) - Range for gaps
5. Third Base (4) - Hot corner
6. First Base (3) - Least demanding infield
7. Corner Outfield (7/9) - LF/RF filled last

**Eligibility:**
- Primary: `positionEligibility[position] > 0` (appeared there)
- Fallback: `primaryPosition == position`

**Algorithm:**
```typescript
const POSITION_PRIORITY = [2, 6, 5, 8, 4, 3, 7, 9]; // C, SS, 2B, CF, 3B, 1B, LF, RF

for (const position of POSITION_PRIORITY) {
  const eligible = players.filter(p => p.positionEligibility[position] > 0);
  if (eligible.length === 0) {
    // Fallback to primary position
    const fallback = players.find(p => p.primaryPosition === position);
    if (fallback) assign(fallback, position);
  } else {
    // Sort by OBP descending (better hitters in tougher positions)
    const best = eligible.sort((a, b) => b.rates.vsRHP.onBase - a.rates.vsRHP.onBase)[0];
    assign(best, position);
  }
}
```

## Traditional Batting Order

| Slot | Role | Stat Priority | Position Preference |
|------|------|---------------|---------------------|
| 1 | Leadoff, high OBP | OBP first, speed second | CF, 2B, SS |
| 2 | Contact, advance runners | BA, low K% | 2B, SS, 3B |
| 3 | Best overall | High OPS | 1B, RF, CF |
| 4 | Cleanup, power | Highest SLG | 1B, LF, RF |
| 5 | Protect cleanup | High SLG | LF, 3B, 1B |
| 6 | Secondary power | Good SLG | RF, 3B, LF |
| 7 | Defense/contact | Lower OPS | C, 2B, SS |
| 8 | Weakest position player | Lowest OPS | C, SS |
| 9 | Pitcher (no DH) or DH | Lowest OPS | P or DH |

**Scoring Formula:** `OBP * 1.8 + SLG * 0.9` (sabermetric weighted)

## Data Structures

```typescript
interface LineupBuildResult {
  lineup: LineupSlot[];  // 9 slots
  startingPitcher: PitcherStats;
  warnings: string[];
}

interface LineupSlot {
  playerId: number;
  battingOrder: number;  // 1-9
  fieldingPosition: number;  // 1-9 position numbers
}
```

## Starting Pitcher Selection

Simple: Pick pitcher with highest `avgBfpAsStarter` (most games started).

## Implementation

**File:** `app/src/lib/game/lineup-builder.ts`

**Main function:**
```typescript
export function buildLineup(
  batters: BatterStats[],
  pitchers: PitcherStats[],
  league: 'AL' | 'NL',
  year: number
): LineupBuildResult
```

**Integration:**
- Replace `GameEngine.generateLineup()` with `buildLineup()`
- Display warnings in game UI
- Remove `@bb/model` managerial mode (simplified approach)

## Error Handling

| Scenario | Action |
|----------|--------|
| < 9 position players | Throw error |
| No pitchers | Throw error |
| 0 eligible at position | Use primaryPosition, add warning |
| Still can't fill | Throw error |
