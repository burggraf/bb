# Player Usage Management for Season Replay

**Date:** 2025-02-07
**Status:** Design Approved
**Scope:** Realistic player usage tracking and management across season replays

## Overview

A comprehensive system for tracking and managing player usage (PA for batters, IP for pitchers) during season replays to ensure simulated usage stays within 75-125% of actual historical totals. The system probabilistically rests players, manages starting rotations, and provides detailed reporting to monitor compliance.

## Goals

1. **Batters**: 75-125% of actual PA across full season replay
2. **Pitchers**: 75-125% of actual IP across full season replay
3. **Minimum tracking threshold**: 20 PA / 5 IP (below this, track but don't actively manage)
4. **Natural variation**: Use probabilistic decisions rather than hard caps for realistic-looking lineups

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   SeasonReplayEngine                        │
│  (orchestrates game simulation, calls managers)             │
└────────────┬────────────────────────────────┬───────────────┘
             │                                │
             ▼                                ▼
┌──────────────────────────┐    ┌────────────────────────────┐
│     UsageTracker         │    │     RosterManager          │
│  - Tracks cumulative PA/IP│    │  - Rotation management    │
│  - Persists to DB        │    │  - Probabilistic rest      │
│  - Checks thresholds     │    │  - Lineup decisions        │
└──────────────────────────┘    └────────────────────────────┘
             │                                │
             ▼                                ▼
┌──────────────────────────┐    ┌────────────────────────────┐
│   IndexedDB: player_usage │    │   GameEngine + LineupBuilder│
│   seriesId, playerId,     │    │   (receives usage-aware     │
│   actual, replay totals   │    │    decisions)               │
└──────────────────────────┘    └────────────────────────────┘
                                                              │
                                                              ▼
                                              ┌────────────────────────────┐
                                              │    UsageReporter           │
                                              │  - Summary dashboard       │
                                              │  - Player/team tables      │
                                              │  - Trend tracking          │
                                              └────────────────────────────┘
```

## Data Model

### New IndexedDB Table: `player_usage`

```typescript
interface PlayerUsageRecord {
  seriesId: string;           // Links to the season replay
  playerId: string;           // Player ID from season data
  teamId: string;             // Team the player belongs to
  isPitcher: boolean;         // Distinguishes batters from pitchers

  // Target values (from season export - immutable)
  actualSeasonTotal: number;  // PA for batters, IP (outs) for pitchers
  gamesPlayedActual: number;  // How many games they actually played

  // Replay values (updated after each game)
  replayCurrentTotal: number; // Cumulative PA/IP in replay
  replayGamesPlayed: number;  // Games played in replay

  // Calculated fields (for queries)
  percentageOfActual: number; // replayCurrentTotal / actualSeasonTotal
  status: 'under' | 'inRange' | 'over'; // Based on 75-125% thresholds
}
```

**Indexes:**
- Primary: `seriesId + playerId`
- Query: `seriesId`, `seriesId + isPitcher`, `teamId`, `status`

**Initialization:** When season replay starts, populate with all players from season data who meet minimum threshold (20 PA / 5 IP actual).

## RosterManager

### File: `packages/model/src/managerial/roster-manager.ts`

```typescript
interface RotationSlot {
  pitcherId: string;
  rotationIndex: number;  // 1-5 (or however many)
  qualityScore: number;
  avgBfpAsStarter: number;
}

interface RestDecision {
  shouldRest: boolean;
  reason?: string;
  suggestedReplacement?: string;
}

class RosterManager {
  private rotations: Map<string, RotationSlot[]>;  // teamId → rotation
  private rotationIndex: Map<string, number>;      // teamId → current position
  private usageTracker: UsageTracker;

  // Rotation building
  buildRotations(pitchers: Record<string, PitcherStats>, teams: Record<string, TeamInfo>): void;

  // Starting pitcher selection (fixed cycle)
  selectStartingPitcher(teamId: string, gameDate: string): string;

  // Batter rest decision (probabilistic)
  shouldRestBatter(batterId: string, teamId: string, gameNumber: number): RestDecision;

  // Find replacement with usage boost for under-used players
  findReplacement(batterId: string, candidates: BatterStats[], teamId: string): string;
}
```

### Starting Pitcher Rotation

**Building the Rotation (season start):**
1. Filter pitchers with `gamesStarted / games >= 0.3`
2. Sort by quality score (ERA, WHIP, complete game rate - existing logic)
3. Determine rotation size dynamically:
   - 5+ qualified starters → 5-man rotation
   - 4 qualified → 4-man
   - 3 qualified → 3-man (deadball era)
4. Store in rotation order

**Selection (each game):**
- Fixed cycle: `rotationIndex = (lastIndex + 1) % rotationSize`
- Skip pitcher if they pitched within era-appropriate rest days:
  - Pre-1950: 1-2 days rest
  - 1950-1980: 2-3 days rest
  - 1981+: 4-5 days rest
- Move to next in rotation if needed

### Probabilistic Batter Rest

```typescript
function shouldRestBatter(
  batterId: string,
  teamId: string,
  gameNumber: number,
  scheduleDate: string
): RestDecision {
  const usage = getUsage(batterId);
  const seasonProgress = gameNumber / totalGamesInSchedule;
  const targetPa = usage.actualSeasonTotal * seasonProgress;
  const currentPa = usage.replayCurrentTotal;

  // Calculate overage (positive = over target, negative = under)
  const overageRatio = (currentPa - targetPa) / usage.actualSeasonTotal;

  // Base rest chance based on overage
  let restChance = 0;
  if (overageRatio > 0.25) restChance = 0.90;  // Way over - very likely rest
  else if (overageRatio > 0.15) restChance = 0.70;
  else if (overageRatio > 0.10) restChance = 0.50;
  else if (overageRatio > 0.05) restChance = 0.30;
  else if (overageRatio > 0) restChance = 0.10;
  else restChance = 0;  // Under target - no rest

  // Adjust for game context
  // - Late season close race: reduce rest chance 20%
  // - Blowout game: increase rest chance 30%
  // - Divisional rival: reduce rest chance 10%

  return {
    shouldRest: Math.random() < restChance,
    reason: overageRatio > 0 ? `Over target by ${(overageRatio * 100).toFixed(0)}%` : undefined
  };
}
```

### Under-Usage Priority Boost

When selecting a replacement player:

```typescript
function findReplacement(
  restingPlayerId: string,
  candidates: BatterStats[],
  teamId: string
): string {
  const seasonProgress = getCurrentGameNumber() / totalGames;

  // Score each candidate
  const scored = candidates.map(player => {
    const usage = getUsage(player.id);
    const target = usage.actualSeasonTotal * seasonProgress;
    const underage = (target - usage.replayCurrentTotal) / usage.actualSeasonTotal;

    // Base quality score
    let score = calculateHitterScore(player);

    // Boost for under-used players (up to 2x boost for severely under-used)
    if (underage > 0) {
      score *= (1 + Math.min(underage * 2, 1.0));
    }

    return { player, score };
  });

  // Select highest score
  scored.sort((a, b) => b.score - a.score);
  return scored[0].player.id;
}
```

## UsageTracker

### File: `app/src/lib/game-results/usage-tracker.ts`

```typescript
class UsageTracker {
  private db: GameDatabase;

  // Initialize at season start - populate all targets
  async initialize(seriesId: string, seasonYear: number): Promise<void>;

  // Seed usage table with all players meeting threshold
  async seedUsageTargets(
    seriesId: string,
    batters: Record<string, BatterStats>,
    pitchers: Record<string, PitcherStats>
  ): Promise<void>;

  // Update after each game completes
  async updateGameUsage(
    seriesId: string,
    gameStats: {
      batterPa: Map<string, number>;      // PA per batter in this game
      pitcherIp: Map<string, number>;     // IP (outs) per pitcher in this game
    }
  ): Promise<void>;

  // Check for threshold violations (warning only)
  async checkThresholds(seriesId: string): Promise<UsageViolation[]>;

  // Get usage for a specific player
  async getPlayerUsage(seriesId: string, playerId: string): Promise<PlayerUsageRecord | null>;

  // Get team usage summary
  async getTeamUsage(seriesId: string, teamId: string): Promise<PlayerUsageRecord[]>;
}

interface UsageViolation {
  playerId: string;
  playerName: string;
  isPitcher: boolean;
  percentageOfActual: number;
  status: 'under' | 'over';
  deviation: number;  // percentage points from 100%
}
```

## Game Engine Integration

### SeasonReplayEngine Changes

```typescript
class SeasonReplayEngine {
  private usageTracker: UsageTracker;
  private rosterManager: RosterManager;

  async initialize(): Promise<void> {
    // ... existing code ...

    // Initialize usage tracking
    this.usageTracker = new UsageTracker(this.seriesId);
    await this.usageTracker.initialize(this.seriesId, this.seasonYear);
    await this.usageTracker.seedUsageTargets(season.batters, season.pitchers);

    // Initialize roster manager
    this.rosterManager = new RosterManager(this.usageTracker);
    this.rosterManager.buildRotations(season.pitchers, season.teams);
  }

  private async simulateGame(game: ScheduledGame): Promise<GameResult | null> {
    // ... load season data ...

    // Select starting pitchers using rotation
    const awayStarter = this.rosterManager.selectStartingPitcher(game.awayTeam, game.date);
    const homeStarter = this.rosterManager.selectStartingPitcher(game.homeTeam, game.date);

    // Create game engine with usage context
    const usageContext = {
      getUsage: (id: string) => this.usageTracker.getPlayerUsage(this.seriesId, id),
      checkRest: (id: string, team: string) =>
        this.rosterManager.shouldRestBatter(id, team, this.currentGameIndex + 1, game.date),
      gameNumber: this.currentGameIndex + 1,
      totalGames: this.schedule.length
    };

    this.gameEngine = new GameEngine(season, game.awayTeam, game.homeTeam, {
      forcedAwayStarter: awayStarter,
      forcedHomeStarter: homeStarter,
      usageContext
    });

    // ... simulate game ...

    // After game completes, update usage totals
    const gameStats = this.extractGameStats(finalState);
    await this.usageTracker.updateGameUsage(this.seriesId, gameStats);

    // Log violations (warnings only)
    const violations = await this.usageTracker.checkThresholds(this.seriesId);
    if (violations.length > 0) {
      console.warn('[Usage]', violations.length, 'threshold violations:', violations);
    }

    return result;
  }

  private extractGameStats(state: GameState): {
    batterPa: Map<string, number>;
    pitcherIp: Map<string, number>;
  } {
    const batterPa = new Map<string, number>();
    const pitcherIp = new Map<string, number>();

    for (const play of state.plays) {
      if (play.eventType !== 'startingLineup' && !play.isSummary) {
        batterPa.set(play.batterId, (batterPa.get(play.batterId) || 0) + 1);
      }
    }

    // Calculate IP from outs recorded
    for (const [pitcherId, outs] of this.calculatePitcherOuts(state)) {
      pitcherIp.set(pitcherId, outs);
    }

    return { batterPa, pitcherIp };
  }
}
```

### LineupBuilder Extension

```typescript
// In app/src/lib/game/lineup-builder.ts

export interface UsageContext {
  getUsage: (playerId: string) => PlayerUsageRecord | null;
  checkRest: (batterId: string, teamId: string) => RestDecision;
  gameNumber: number;
  totalGames: number;
}

export function buildLineup(
  batters: Record<string, BatterStats>,
  pitchers: Record<string, PitcherStats>,
  teamId: string,
  league: string,
  year: number,
  usageContext?: UsageContext  // NEW parameter
): LineupBuildResult {
  // ... existing position assignment and batting order logic ...

  // NEW: Check for rest decisions when filling batting order
  if (usageContext) {
    const usedPlayers = new Set<string>();
    const finalLineup: LineupSlot[] = [];

    for (const slot of lineupSlots) {
      const restDecision = usageContext.checkRest(slot.playerId, teamId);

      if (restDecision.shouldRest && !usedPlayers.has(slot.playerId)) {
        // Find replacement from bench
        const benchPlayers = teamBatters.filter(p =>
          p.teamId === teamId &&
          !usedPlayers.has(p.id) &&
          !lineupSlots.some(s => s.playerId === p.id)
        );

        if (benchPlayers.length > 0) {
          // Use roster manager to find best replacement (with usage boost)
          const replacement = findBestReplacement(
            slot.playerId,
            benchPlayers,
            teamId,
            usageContext
          );
          finalLineup.push({
            playerId: replacement,
            position: slot.position
          });
          usedPlayers.add(replacement);
          continue;
        }
      }

      finalLineup.push(slot);
      usedPlayers.add(slot.playerId);
    }

    lineupSlots = finalLineup;
  }

  return { lineup, startingPitcher, warnings };
}
```

## Usage Reporter & UI

### File: `app/src/lib/game-results/usage-reporter.ts`

```typescript
interface UsageSummary {
  totalPlayers: number;
  inRange: number;      // 75-125%
  under: number;        // < 75%
  over: number;         // > 125%
  breakdown: {
    batters: { total: number; inRange: number; under: number; over: number };
    pitchers: { total: number; inRange: number; under: number; over: number };
  };
}

interface PlayerUsageRow {
  playerId: string;
  playerName: string;
  teamId: string;
  teamName: string;
  isPitcher: boolean;
  actualSeasonTotal: number;
  replayCurrentTotal: number;
  percentageOfActual: number;
  gamesPlayedActual: number;
  replayGamesPlayed: number;
  status: 'under' | 'inRange' | 'over';
  deviation: number;  // percentage points from 100%
}

interface TeamUsageBreakdown {
  teamId: string;
  teamName: string;
  totalPlayers: number;
  inRange: number;
  under: number;
  over: number;
  complianceScore: number; // % of players in range
}

interface UsageTrendPoint {
  gameNumber: number;
  date: string;
  inRange: number;
  under: number;
  over: number;
  avgPercentage: number;
}

// API Functions
export async function getUsageSummary(seriesId: string): Promise<UsageSummary>;
export async function getPlayerUsageRows(
  seriesId: string,
  filters?: { teamId?: string; isPitcher?: boolean; status?: string }
): Promise<PlayerUsageRow[]>;
export async function getTeamUsageBreakdown(seriesId: string): Promise<TeamUsageBreakdown[]>;
export async function getUsageTrends(seriesId: string): Promise<UsageTrendPoint[]>;
```

### UI Component: UsageReportView.svelte

New tab on `/game-results/series/[id]/` page alongside "Standings", "Games", "Leaders".

**Sub-tabs:**
- **Dashboard**: Overall summary with compliance metrics
- **Players**: Sortable/filterable table of all players
- **Teams**: Team-by-team breakdown with compliance scores
- **Trends**: Historical tracking over season progress

**Dashboard:**
```
┌─────────────────────────────────────────────────────────┐
│ Usage Report: 1976 Season Replay                        │
├─────────────────────────────────────────────────────────┤
│ Overall Compliance                                       │
│ ┌──────────┬──────────┬──────────┬──────────┐          │
│ │ In Range │ Under    │ Over     │ Total    │          │
│ │ 73%      │ 18%      │ 9%       │ 1,247    │          │
│ │ 910      │ 224      │ 113      │          │          │
│ └──────────┴──────────┴──────────┴──────────┘          │
│                                                         │
│ By Type:                                                │
│ Batters:  76% in range (526/692)                        │
│ Pitchers: 69% in range (384/555)                        │
└─────────────────────────────────────────────────────────┘
```

**Players Table:**
```
┌───────────────────────────────────────────────────────────┐
│ Search: [________] Filter: [All Teams ▼] [All ▼] [All ▼]│
├───────────────────────────────────────────────────────────┤
│ Name            │ Team │ Actual │ Replay │ %   │ Status  │
├───────────────────────────────────────────────────────────┤
│ Schmidt, Mike   │ PHI  │ 612 PA │ 587 PA │ 96% │ ✓       │
│ Morgan, Joe     │ PHI  │ 598 PA │ 631 PA │ 106%│ ✓       │
│ Bowa, Larry     │ PHI  │ 534 PA │ 412 PA │ 77% │ ⚠ Under │
│ Carlton, Steve  │ PHI  │ 966 IP │ 923 IP │ 96% │ ✓       │
│ ...                                                        │
└───────────────────────────────────────────────────────────┘
```

## Edge Cases

1. **Very Low Usage Players** (< 20 PA / 5 IP): Track in database but don't manage; exclude from "in range" compliance calculations

2. **September Call-ups**: Players who joined mid-season have targets pro-rated based on `actualGamesPlayed / teamGames`, not full 162

3. **Doubleheaders**: Rotation selection checks if pitcher started yesterday - if yes, skip to next in rotation

4. **Extra Innings**: Reliever IP tracked correctly; long outings count against their usage total

5. **Real-life Injuries**: If a player's actual totals are very low due to injury, don't push them beyond that - their "target" is their actual (low) total

6. **Overages**: Warning only - no hard blocking. The rest decisions should prevent most overages proactively

## Implementation Order

### Phase 1: Data Layer
- [ ] Create `player_usage` table schema in `game-results/schema.ts`
- [ ] Implement `UsageTracker` class with seed/update/check methods
- [ ] Add database migration for existing series

### Phase 2: Roster Management Logic
- [ ] Implement `RosterManager` class in packages/model
- [ ] Add rotation building logic
- [ ] Add probabilistic rest logic
- [ ] Add replacement selection with usage boost

### Phase 3: Integration
- [ ] Extend `lineup-builder.ts` with `UsageContext` parameter
- [ ] Integrate into `SeasonReplayEngine`
- [ ] Add forced starter selection

### Phase 4: Reporting & UI
- [ ] Implement `UsageReporter` functions
- [ ] Create `UsageReportView.svelte` component
- [ ] Add "Usage" tab to series page

### Phase 5: Testing & Refinement
- [ ] Run full season replay (1976 test season)
- [ ] Analyze usage report, identify outliers
- [ ] Tune algorithms (rest probability, boost multipliers)
- [ ] Re-run and iterate

## Success Metrics

- **Primary**: ≥85% of qualifying players (20+ PA / 5+ IP) within 75-125% of actual totals
- **Secondary**: Mean Absolute Percentage Error (MAPE) across all players <15%
- **Distribution**: Bell-shaped curve around 100%, with most players clustered in 90-110% range

## Testing Strategy

```typescript
// Unit tests
describe('RosterManager', () => {
  it('builds correct rotation size based on available starters');
  it('cycles through rotation in fixed order');
  it('skips pitchers who need rest');
  it('calculates rest probability based on usage overage');
});

describe('UsageTracker', () => {
  it('seeds targets from season data correctly');
  it('updates PA/IP after each game');
  it('identifies threshold violations accurately');
});

// Integration test
describe('Season Replay Usage', () => {
  it('completes season with 85%+ players in range', async () => {
    const engine = new SeasonReplayEngine(...);
    await engine.initialize();
    await engine.playAllGames();

    const report = await getUsageSummary(seriesId);
    const complianceRate = report.inRange / report.totalPlayers;
    expect(complianceRate).toBeGreaterThanOrEqual(0.85);
  });
});
```

## Open Questions / Future Enhancements

Out of scope for this implementation but worth considering:

1. **Actual historical lineups**: Query baseball.duckdb for real starting lineups when available
2. **Injury simulation**: Model injuries that would reduce playing time
3. **Trade deadlines**: Handle mid-season roster changes
4. **Advanced platoon**: More nuanced batter-pitcher matchup considerations
5. **User overrides**: Allow users to manually adjust usage targets or force specific lineups
