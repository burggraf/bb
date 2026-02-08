# Player Usage Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Track and manage player usage (PA for batters, IP for pitchers) across season replays to keep simulated usage within 75-125% of actual historical totals.

**Architecture:**
- **UsageTracker**: New IndexedDB table tracks cumulative PA/IP per player, updated after each game
- **RosterManager**: Makes lineup/pitching decisions with probabilistic rest and rotation cycling
- **UsageReporter**: Generates compliance reports (dashboard, player tables, team breakdown, trends)
- **Integration**: SeasonReplayEngine orchestrates, LineupBuilder gets usage-aware

**Tech Stack:**
- TypeScript
- IndexedDB (sql.js for game-results DB)
- Vitest for testing
- Svelte 5 for UI components

**Order:** Data Layer → Roster Management → Integration → Reporting & UI

---

## Phase 1: Data Layer (UsageTracker)

### Task 1: Add player_usage table to game-results schema

**Files:**
- Modify: `app/src/lib/game-results/schema.ts`

**Step 1: Add player_usage table interface**

After the existing table interfaces (around line 50), add:

```typescript
/**
 * Player usage tracking for season replay
 * Tracks cumulative PA/IP to ensure realistic usage (75-125% of actual totals)
 */
export interface PlayerUsageRecord {
  seriesId: string;
  playerId: string;
  teamId: string;
  isPitcher: boolean;

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

**Step 2: Add table creation SQL to schema**

In `createGameResultsSchema()` function, after existing tables, add:

```typescript
// Player usage tracking for season replay
db.run(`
  CREATE TABLE IF NOT EXISTS player_usage (
    series_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    is_pitcher INTEGER NOT NULL,

    -- Target values (from season export)
    actual_season_total INTEGER NOT NULL,
    games_played_actual INTEGER NOT NULL,

    -- Replay values (cumulative)
    replay_current_total INTEGER NOT NULL DEFAULT 0,
    replay_games_played INTEGER NOT NULL DEFAULT 0,

    -- Calculated fields
    percentage_of_actual REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'inRange',

    PRIMARY KEY (series_id, player_id)
  )
`);

// Indexes for efficient queries
db.run(`
  CREATE INDEX IF NOT EXISTS idx_player_usage_series_pitcher
  ON player_usage(series_id, is_pitcher)
`);

db.run(`
  CREATE INDEX IF NOT EXISTS idx_player_usage_team
  ON player_usage(team_id)
`);

db.run(`
  CREATE INDEX IF NOT EXISTS idx_player_usage_status
  ON player_usage(status)
`);
```

**Step 3: Run tests to verify schema compiles**

Run: `pnpm -C app test src/lib/game-results/schema.test.ts`
Expected: Existing tests pass (schema changes are additive)

**Step 4: Commit**

```bash
git add app/src/lib/game-results/schema.ts
git commit -m "feat: add player_usage table to game-results schema"
```

---

### Task 2: Create UsageTracker class

**Files:**
- Create: `app/src/lib/game-results/usage-tracker.ts`
- Create: `app/src/lib/game-results/usage-tracker.test.ts`

**Step 1: Write UsageTracker class skeleton**

Create `app/src/lib/game-results/usage-tracker.ts`:

```typescript
/**
 * UsageTracker - Tracks cumulative player usage (PA/IP) throughout season replay
 * Ensures simulated usage stays within 75-125% of actual historical totals
 */

import { getGameDatabase } from './database.js';
import type { Database } from 'sql.js';
import type { PlayerUsageRecord } from './schema.js';

export interface UsageViolation {
  playerId: string;
  playerName: string;
  isPitcher: boolean;
  percentageOfActual: number;
  status: 'under' | 'over';
  deviation: number;  // percentage points from 100%
}

export interface GameUsageStats {
  batterPa: Map<string, number>;   // PA per batter in this game
  pitcherIp: Map<string, number>;  // IP (outs) per pitcher in this game
}

const MIN_BATTER_THRESHOLD = 20;  // Don't actively manage players with <20 actual PA
const MIN_PITCHER_THRESHOLD = 5;   // Don't actively manage players with <5 actual IP

export class UsageTracker {
  private seriesId: string;

  constructor(seriesId: string) {
    this.seriesId = seriesId;
  }

  /**
   * Seed usage table with all players from season data
   * Call once at season replay start
   */
  async seedUsageTargets(
    batters: Record<string, any>,
    pitchers: Record<string, any>
  ): Promise<void> {
    const db = await getGameDatabase();

    // Clear existing data for this series
    db.run('DELETE FROM player_usage WHERE series_id = ?', [this.seriesId]);

    // Insert batters meeting minimum threshold
    const insertBatter = db.prepare(`
      INSERT INTO player_usage (
        series_id, player_id, team_id, is_pitcher,
        actual_season_total, games_played_actual,
        percentage_of_actual, status
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 'inRange')
    `);

    for (const [id, batter] of Object.entries(batters)) {
      if (batter.pa >= MIN_BATTER_THRESHOLD) {
        insertBatter.run(
          this.seriesId,
          id,
          batter.teamId,
          0,  // is_pitcher = false
          batter.pa,
          batter.games || 162  // fallback to full season if not specified
        );
      }
    }

    // Insert pitchers meeting minimum threshold
    const insertPitcher = db.prepare(`
      INSERT INTO player_usage (
        series_id, player_id, team_id, is_pitcher,
        actual_season_total, games_played_actual,
        percentage_of_actual, status
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 'inRange')
    `);

    for (const [id, pitcher] of Object.entries(pitchers)) {
      const ip = pitcher.inningsPitched || 0;
      if (ip >= MIN_PITCHER_THRESHOLD) {
        insertPitcher.run(
          this.seriesId,
          id,
          pitcher.teamId,
          1,  // is_pitcher = true
          ip * 3,  // Convert IP to outs (1 IP = 3 outs)
          pitcher.games || 162
        );
      }
    }

    insertBatter.free();
    insertPitcher.free();
  }

  /**
   * Update usage totals after a game completes
   */
  async updateGameUsage(gameStats: GameUsageStats): Promise<void> {
    const db = await getGameDatabase();

    const updateBatter = db.prepare(`
      UPDATE player_usage
      SET replay_current_total = replay_current_total + ?,
          replay_games_played = replay_games_played + 1,
          percentage_of_actual = CAST(replay_current_total + ? AS REAL) / actual_season_total,
          status = CASE
            WHEN CAST(replay_current_total + ? AS REAL) / actual_season_total < 0.75 THEN 'under'
            WHEN CAST(replay_current_total + ? AS REAL) / actual_season_total > 1.25 THEN 'over'
            ELSE 'inRange'
          END
      WHERE series_id = ? AND player_id = ?
    `);

    for (const [playerId, pa] of gameStats.batterPa) {
      updateBatter.run(pa, pa, pa, pa, this.seriesId, playerId);
    }

    const updatePitcher = db.prepare(`
      UPDATE player_usage
      SET replay_current_total = replay_current_total + ?,
          replay_games_played = replay_games_played + 1,
          percentage_of_actual = CAST(replay_current_total + ? AS REAL) / actual_season_total,
          status = CASE
            WHEN CAST(replay_current_total + ? AS REAL) / actual_season_total < 0.75 THEN 'under'
            WHEN CAST(replay_current_total + ? AS REAL) / actual_season_total > 1.25 THEN 'over'
            ELSE 'inRange'
          END
      WHERE series_id = ? AND player_id = ?
    `);

    for (const [playerId, ip] of gameStats.pitcherIp) {
      updatePitcher.run(ip, ip, ip, ip, this.seriesId, playerId);
    }

    updateBatter.free();
    updatePitcher.free();
  }

  /**
   * Get usage record for a specific player
   */
  async getPlayerUsage(playerId: string): Promise<PlayerUsageRecord | null> {
    const db = await getGameDatabase();

    const row = db.query(`
      SELECT * FROM player_usage
      WHERE series_id = ? AND player_id = ?
    `).get(this.seriesId, playerId) as any;

    if (!row) return null;

    return this.rowToRecord(row);
  }

  /**
   * Get team usage summary
   */
  async getTeamUsage(teamId: string): Promise<PlayerUsageRecord[]> {
    const db = await getGameDatabase();

    const rows = db.query(`
      SELECT * FROM player_usage
      WHERE series_id = ? AND team_id = ?
      ORDER BY percentage_of_actual DESC
    `).all(this.seriesId, teamId) as any[];

    return rows.map(r => this.rowToRecord(r));
  }

  /**
   * Check for threshold violations (warning only)
   */
  async checkThresholds(): Promise<UsageViolation[]> {
    const db = await getGameDatabase();

    const violations: UsageViolation[] = [];

    // Check under-used players (< 75%)
    const underRows = db.query(`
      SELECT pu.*, p.name
      FROM player_usage pu
      LEFT JOIN players p ON pu.player_id = p.id
      WHERE pu.series_id = ? AND pu.status = 'under'
    `).all(this.seriesId) as any[];

    for (const row of underRows) {
      violations.push({
        playerId: row.player_id,
        playerName: row.name || 'Unknown',
        isPitcher: row.is_pitcher === 1,
        percentageOfActual: row.percentage_of_actual,
        status: 'under',
        deviation: 100 - row.percentage_of_actual * 100
      });
    }

    // Check over-used players (> 125%)
    const overRows = db.query(`
      SELECT pu.*, p.name
      FROM player_usage pu
      LEFT JOIN players p ON pu.player_id = p.id
      WHERE pu.series_id = ? AND pu.status = 'over'
    `).all(this.seriesId) as any[];

    for (const row of overRows) {
      violations.push({
        playerId: row.player_id,
        playerName: row.name || 'Unknown',
        isPitcher: row.is_pitcher === 1,
        percentageOfActual: row.percentage_of_actual,
        status: 'over',
        deviation: row.percentage_of_actual * 100 - 100
      });
    }

    return violations;
  }

  private rowToRecord(row: any): PlayerUsageRecord {
    return {
      seriesId: row.series_id,
      playerId: row.player_id,
      teamId: row.team_id,
      isPitcher: row.is_pitcher === 1,
      actualSeasonTotal: row.actual_season_total,
      gamesPlayedActual: row.games_played_actual,
      replayCurrentTotal: row.replay_current_total,
      replayGamesPlayed: row.replay_games_played,
      percentageOfActual: row.percentage_of_actual,
      status: row.status
    };
  }
}
```

**Step 2: Write basic test**

Create `app/src/lib/game-results/usage-tracker.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UsageTracker } from './usage-tracker.js';
import { getGameDatabase, closeGameDatabase } from './database.js';

describe('UsageTracker', () => {
  const testSeriesId = 'test-usage-tracker';
  let tracker: UsageTracker;

  beforeEach(() => {
    tracker = new UsageTracker(testSeriesId);
  });

  afterEach(async () => {
    const db = await getGameDatabase();
    db.run('DELETE FROM player_usage WHERE series_id = ?', [testSeriesId]);
  });

  it('should seed usage targets from season data', async () => {
    const mockBatters = {
      'batter1': { id: 'batter1', name: 'Batter One', teamId: 'Team1', pa: 100, games: 50 },
      'batter2': { id: 'batter2', name: 'Batter Two', teamId: 'Team1', pa: 15, games: 10 }, // Below threshold
    };

    const mockPitchers = {
      'pitcher1': { id: 'pitcher1', name: 'Pitcher One', teamId: 'Team1', inningsPitched: 50, games: 30 },
      'pitcher2': { id: 'pitcher2', name: 'Pitcher Two', teamId: 'Team1', inningsPitched: 2, games: 5 }, // Below threshold
    };

    await tracker.seedUsageTargets(mockBatters, mockPitchers);

    const batter1Usage = await tracker.getPlayerUsage('batter1');
    expect(batter1Usage).toBeTruthy();
    expect(batter1Usage?.actualSeasonTotal).toBe(100);

    const batter2Usage = await tracker.getPlayerUsage('batter2');
    expect(batter2Usage).toBeNull(); // Below threshold

    const pitcher1Usage = await tracker.getPlayerUsage('pitcher1');
    expect(pitcher1Usage).toBeTruthy();
    expect(pitcher1Usage?.actualSeasonTotal).toBe(150); // 50 IP * 3 = 150 outs
  });

  it('should update usage after game', async () => {
    const mockBatters = {
      'batter1': { id: 'batter1', name: 'Batter One', teamId: 'Team1', pa: 100, games: 50 },
    };

    await tracker.seedUsageTargets(mockBatters, {});

    const gameStats = {
      batterPa: new Map([['batter1', 4]]),
      pitcherIp: new Map()
    };

    await tracker.updateGameUsage(gameStats);

    const usage = await tracker.getPlayerUsage('batter1');
    expect(usage?.replayCurrentTotal).toBe(4);
    expect(usage?.percentageOfActual).toBeCloseTo(0.04, 2);
  });

  it('should detect threshold violations', async () => {
    const mockBatters = {
      'batter1': { id: 'batter1', name: 'Batter One', teamId: 'Team1', pa: 100, games: 50 },
    };

    await tracker.seedUsageTargets(mockBatters, {});

    // Simulate over-usage (more than 125% of target)
    const gameStats = {
      batterPa: new Map([['batter1', 126]]), // 126 > 125% of 100
      pitcherIp: new Map()
    };

    await tracker.updateGameUsage(gameStats);

    const violations = await tracker.checkThresholds();
    const batter1Violation = violations.find(v => v.playerId === 'batter1');
    expect(batter1Violation?.status).toBe('over');
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `pnpm -C app test src/lib/game-results/usage-tracker.test.ts`
Expected: FAIL (classes not yet created/implemented correctly)

**Step 4: Implement minimal code to make tests pass**

The implementation is already in Step 1. Run tests again.

**Step 5: Run tests to verify they pass**

Run: `pnpm -C app test src/lib/game-results/usage-tracker.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add app/src/lib/game-results/usage-tracker.ts app/src/lib/game-results/usage-tracker.test.ts
git commit -m "feat: add UsageTracker class with seed and update methods"
```

---

### Task 3: Export UsageTracker from game-results index

**Files:**
- Modify: `app/src/lib/game-results/index.ts`

**Step 1: Add UsageTracker export**

Add to the exports:

```typescript
export { UsageTracker, type UsageViolation, type GameUsageStats } from './usage-tracker.js';
```

**Step 2: Run tests**

Run: `pnpm -C app test src/lib/game-results/index.test.ts`
Expected: PASS (tests check for module structure)

**Step 3: Commit**

```bash
git add app/src/lib/game-results/index.ts
git commit -m "feat: export UsageTracker from game-results index"
```

---

## Phase 2: Roster Management Logic

### Task 4: Create RosterManager in model package

**Files:**
- Create: `packages/model/src/managerial/roster-manager.ts`
- Create: `packages/model/src/managerial/roster-manager.test.ts`
- Modify: `packages/model/src/managerial/index.ts`

**Step 1: Write RosterManager class skeleton**

Create `packages/model/src/managerial/roster-manager.ts`:

```typescript
/**
 * RosterManager - Makes usage-aware roster decisions
 * Handles rotation cycling, probabilistic batter rest, and replacement selection
 */

import type { PitcherStats, BatterStats } from '../../types.js';

export interface RotationSlot {
  pitcherId: string;
  rotationIndex: number;  // 1-5 (or however many)
  qualityScore: number;
  avgBfpAsStarter: number;
}

export interface RestDecision {
  shouldRest: boolean;
  reason?: string;
}

export interface UsageContext {
  getUsage: (playerId: string) => Promise<UsageRecord | null>;
  gameNumber: number;
  totalGames: number;
}

export interface UsageRecord {
  actualSeasonTotal: number;
  replayCurrentTotal: number;
  gamesPlayedActual: number;
  replayGamesPlayed: number;
}

export class RosterManager {
  private rotations: Map<string, RotationSlot[]> = new Map();  // teamId → rotation
  private rotationIndex: Map<string, number> = new Map();      // teamId → current position

  /**
   * Build starting pitcher rotations for all teams
   * Call once at season start
   */
  buildRotations(
    pitchers: Record<string, PitcherStats>,
    teams: Record<string, any>
  ): void {
    // Group pitchers by team
    const teamPitchers = new Map<string, PitcherStats[]>();
    for (const pitcher of Object.values(pitchers)) {
      const teamId = pitcher.teamId;
      if (!teamPitchers.has(teamId)) {
        teamPitchers.set(teamId, []);
      }
      teamPitchers.get(teamId)!.push(pitcher);
    }

    // Build rotation for each team
    for (const [teamId, teamPitcherList] of teamPitchers) {
      // Filter to qualified starters
      const starters = teamPitcherList.filter(p => {
        const startRate = p.gamesStarted / p.games;
        return startRate >= 0.3;
      });

      if (starters.length === 0) {
        // Fallback: use pitcher with most gamesStarted
        const fallback = [...teamPitcherList].sort((a, b) => b.gamesStarted - a.gamesStarted)[0];
        if (fallback) {
          this.rotations.set(teamId, [{
            pitcherId: fallback.id,
            rotationIndex: 1,
            qualityScore: fallback.gamesStarted * 2,
            avgBfpAsStarter: fallback.avgBfpAsStarter || 27
          }]);
        }
        continue;
      }

      // Calculate quality score for each starter
      const scored = starters.map(p => {
        const eraScore = 5 / p.era;
        const whipScore = 2 / p.whip;
        const cgRate = p.gamesStarted > 0 ? p.completeGames / p.gamesStarted : 0;
        const cgBonus = cgRate * 10;

        return {
          pitcher: p,
          score: p.gamesStarted * 2 + eraScore + whipScore + cgBonus
        };
      });

      // Sort by score descending
      scored.sort((a, b) => b.score - a.score);

      // Create rotation slots (dynamic size based on available starters)
      const rotationSize = Math.min(scored.length, 5); // Max 5-man rotation
      const rotation: RotationSlot[] = [];

      for (let i = 0; i < rotationSize; i++) {
        const starter = scored[i]!.pitcher;
        rotation.push({
          pitcherId: starter.id,
          rotationIndex: i + 1,
          qualityScore: scored[i]!.score,
          avgBfpAsStarter: starter.avgBfpAsStarter || 27
        });
      }

      this.rotations.set(teamId, rotation);
      this.rotationIndex.set(teamId, 0); // Start at first pitcher
    }
  }

  /**
   * Select starting pitcher for a team (fixed cycle)
   */
  selectStartingPitcher(teamId: string): string {
    const rotation = this.rotations.get(teamId);
    if (!rotation || rotation.length === 0) {
      throw new Error(`No rotation available for team ${teamId}`);
    }

    const currentIndex = this.rotationIndex.get(teamId) || 0;
    const starter = rotation[currentIndex]!;

    // Advance to next pitcher for next game
    this.rotationIndex.set(teamId, (currentIndex + 1) % rotation.length);

    return starter.pitcherId;
  }

  /**
   * Decide whether to rest a batter (probabilistic based on usage)
   */
  async shouldRestBatter(
    batterId: string,
    teamId: string,
    gameNumber: number,
    usageContext: UsageContext
  ): Promise<RestDecision> {
    const usage = await usageContext.getUsage(batterId);
    if (!usage) {
      return { shouldRest: false }; // No usage data, don't rest
    }

    const seasonProgress = gameNumber / usageContext.totalGames;
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

    const shouldRest = Math.random() < restChance;

    return {
      shouldRest,
      reason: overageRatio > 0 ? `Over target by ${(overageRatio * 100).toFixed(0)}%` : undefined
    };
  }

  /**
   * Find replacement player with usage boost for under-used players
   */
  async findReplacement(
    restingPlayerId: string,
    candidates: BatterStats[],
    teamId: string,
    usageContext: UsageContext
  ): Promise<string> {
    if (candidates.length === 0) {
      return restingPlayerId; // No replacement available
    }

    const gameNumber = usageContext.gameNumber;
    const totalGames = usageContext.totalGames;

    // Score each candidate
    const scored = await Promise.all(candidates.map(async player => {
      const usage = await usageContext.getUsage(player.id);
      const target = usage?.actualSeasonTotal || player.pa;
      const current = usage?.replayCurrentTotal || 0;
      const underage = (target * (gameNumber / totalGames) - current) / target;

      // Base quality score (OBP)
      const rates = player.rates.vsRHP;
      const obp = rates.walk + rates.hitByPitch + rates.single + rates.double + rates.triple + rates.homeRun;

      // Boost for under-used players (up to 2x boost)
      let score = obp;
      if (underage > 0) {
        score *= (1 + Math.min(underage * 2, 1.0));
      }

      return { player, score };
    }));

    // Select highest score
    scored.sort((a, b) => b.score - a.score);
    return scored[0]!.player.id;
  }
}
```

**Step 2: Write test**

Create `packages/model/src/managerial/roster-manager.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { RosterManager } from './roster-manager.js';

describe('RosterManager', () => {
  let manager: RosterManager;

  beforeEach(() => {
    manager = new RosterManager();
  });

  it('should build rotations from team data', () => {
    const pitchers = {
      'p1': { id: 'p1', teamId: 'Team1', name: 'Pitcher 1', era: 2.50, whip: 1.00, gamesStarted: 30, games: 35, completeGames: 5, avgBfpAsStarter: 27 },
      'p2': { id: 'p2', teamId: 'Team1', name: 'Pitcher 2', era: 3.50, whip: 1.30, gamesStarted: 25, games: 35, completeGames: 2, avgBfpAsStarter: 25 },
      'p3': { id: 'p3', teamId: 'Team1', name: 'Pitcher 3', era: 4.00, whip: 1.40, gamesStarted: 20, games: 35, completeGames: 1, avgBfpAsStarter: 23 },
      'reliever': { id: 'reliever', teamId: 'Team1', name: 'Reliever', era: 3.00, whip: 1.20, gamesStarted: 5, games: 60, completeGames: 0, avgBfpAsStarter: null },
    };

    const teams = {
      'Team1': { id: 'Team1', name: 'Team 1' }
    };

    manager.buildRotations(pitchers, teams);

    const starter1 = manager.selectStartingPitcher('Team1');
    expect(['p1', 'p2', 'p3']).toContain(starter1); // Should be one of the actual starters

    const starter2 = manager.selectStartingPitcher('Team1');
    expect(['p1', 'p2', 'p3']).toContain(starter2);

    // Should cycle through rotation
    expect(starter1).not.toBe(starter2);
  });

  it('should calculate rest probability based on usage overage', async () => {
    const usageContext = {
      getUsage: async (id: string) => {
        if (id === 'overused') {
          return { actualSeasonTotal: 100, replayCurrentTotal: 90, gamesPlayedActual: 50, replayGamesPlayed: 45 };
        }
        return { actualSeasonTotal: 100, replayCurrentTotal: 50, gamesPlayedActual: 50, replayGamesPlayed: 25 };
      },
      gameNumber: 90,
      totalGames: 162
    };

    // Overused batter (90/100 at game 90 = should be at ~50, is at 90)
    const overusedDecision = await manager.shouldRestBatter('overused', 'Team1', 90, usageContext);
    expect(overusedDecision.shouldRest).toBe(true);

    // Normal usage batter
    const normalDecision = await manager.shouldRestBatter('normal', 'Team1', 90, usageContext);
    expect(normalDecision.shouldRest).toBe(false);
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `pnpm -C packages/model test roster-manager.test.ts`
Expected: FAIL (class not yet created)

**Step 4: Run tests to verify they pass**

Run: `pnpm -C packages/model test roster-manager.test.ts`
Expected: PASS

**Step 5: Export from managerial index**

Modify `packages/model/src/managerial/index.ts`:

```typescript
export { RosterManager, type RotationSlot, type RestDecision, type UsageContext } from './roster-manager.js';
```

**Step 6: Run tests**

Run: `pnpm -C packages/model test`
Expected: PASS (all existing + new tests)

**Step 7: Commit**

```bash
git add packages/model/src/managerial/roster-manager.ts packages/model/src/managerial/roster-manager.test.ts packages/model/src/managerial/index.ts
git commit -m "feat: add RosterManager with rotation and rest logic"
```

---

## Phase 3: Integration

### Task 5: Integrate UsageTracker into SeasonReplayEngine

**Files:**
- Modify: `app/src/lib/season-replay/engine.ts`
- Modify: `app/src/lib/season-replay/types.ts`

**Step 1: Add UsageTracker to SeasonReplayEngine**

Modify `app/src/lib/season-replay/engine.ts`:

```typescript
import { UsageTracker, type GameUsageStats } from '$lib/game-results/index.js';
```

Add to class properties:

```typescript
private usageTracker: UsageTracker;
```

Add to `initialize()` method before loading schedule:

```typescript
// Initialize usage tracking
this.usageTracker = new UsageTracker(this.seriesId);
```

Add after loading season data in `initialize()`:

```typescript
// Seed usage targets from season data
await this.usageTracker.seedUsageTargets(season.batters, season.pitchers);
```

**Step 2: Add extractGameStats helper method**

Add to `SeasonReplayEngine` class:

```typescript
private extractGameStats(state: GameState): GameUsageStats {
  const batterPa = new Map<string, number>();
  const pitcherIp = new Map<string, number>();

  // Count PA per batter
  for (const play of state.plays) {
    if (play.eventType !== 'startingLineup' && !play.isSummary) {
      batterPa.set(play.batterId, (batterPa.get(play.batterId) || 0) + 1);
    }
  }

  // Calculate IP from outs recorded for each pitcher
  // This requires tracking outs per pitcher - for now use a simple approximation
  // TODO: Enhance to track outs per pitcher in game state
  const pitcherOuts = new Map<string, number>();
  for (const play of state.plays) {
    if (play.eventType === 'out' && !play.isSummary) {
      const pitcherId = play.pitcherId;
      pitcherOuts.set(pitcherId, (pitcherOuts.get(pitcherId) || 0) + 1);
    }
  }

  for (const [pitcherId, outs] of pitcherOuts) {
    pitcherIp.set(pitcherId, outs);
  }

  return { batterPa, pitcherIp };
}
```

**Step 3: Update simulateGame to call UsageTracker**

After saving game to database, add:

```typescript
// Update usage totals
const gameStats = this.extractGameStats(finalState);
await this.usageTracker.updateGameUsage(gameStats);

// Log violations (warnings only)
try {
  const violations = await this.usageTracker.checkThresholds();
  if (violations.length > 0) {
    console.warn('[Usage]', violations.length, 'threshold violations:', violations);
  }
} catch (error) {
  console.error('[Usage] Failed to check thresholds:', error);
}
```

**Step 4: Run tests**

Run: `pnpm -C app test src/lib/season-replay/engine.test.ts`
Expected: PASS (or create tests if they don't exist)

**Step 5: Commit**

```bash
git add app/src/lib/season-replay/engine.ts
git commit -m "feat: integrate UsageTracker into SeasonReplayEngine"
```

---

### Task 6: Extend LineupBuilder with UsageContext

**Files:**
- Modify: `app/src/lib/game/lineup-builder.ts`
- Modify: `app/src/lib/game/lineup-builder.test.ts`

**Step 1: Add UsageContext interface to lineup-builder**

Add to `app/src/lib/game/lineup-builder.ts`:

```typescript
export interface UsageContext {
  getUsage: (playerId: string) => Promise<any>;
  checkRest: (batterId: string, teamId: string) => Promise<{ shouldRest: boolean }>;
  gameNumber: number;
  totalGames: number;
}
```

**Step 2: Modify buildLineup to accept UsageContext**

Update function signature:

```typescript
export function buildLineup(
  batters: Record<string, BatterStats>,
  pitchers: Record<string, PitcherStats>,
  teamId: string,
  league: string,
  year: number,
  usageContext?: UsageContext  // NEW parameter
): LineupBuildResult {
```

**Step 3: Add rest check logic in buildLineup**

After building batting order and before creating lineup slots, add:

```typescript
  // Check for rest decisions when filling batting order
  if (usageContext) {
    const usedPlayers = new Set<string>();
    const finalLineup: LineupSlot[] = [];

    for (const slot of lineupSlots) {
      const restDecision = await usageContext.checkRest(slot.playerId, teamId);

      if (restDecision.shouldRest && !usedPlayers.has(slot.playerId)) {
        // Find replacement from bench
        const benchPlayers = teamBatters.filter(p =>
          p.teamId === teamId &&
          !usedPlayers.has(p.id) &&
          !lineupSlots.some(s => s.playerId === p.id)
        );

        if (benchPlayers.length > 0) {
          // Select replacement (simple: first available)
          // TODO: Use RosterManager.findReplacement for smarter selection
          const replacement = benchPlayers[0]!.id;
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
```

**Step 4: Handle async in buildLineup**

Since we're now using async `checkRest`, make buildLineup async:

```typescript
export async function buildLineup(
```

**Step 5: Update GameEngine to use async buildLineup**

Update calls to `buildLineup` to be awaited.

**Step 6: Run tests**

Run: `pnpm -C app test src/lib/game/lineup-builder.test.ts`
Expected: FAIL (tests need to be updated for async)

**Step 7: Update tests for async**

Update `app/src/lib/game/lineup-builder.test.ts` to use `await` and async/expect.

**Step 8: Run tests again**

Run: `pnpm -C app test src/lib/game/lineup-builder.test.ts`
Expected: PASS

**Step 9: Commit**

```bash
git add app/src/lib/game/lineup-builder.ts app/src/lib/game/lineup-builder.test.ts
git commit -m "feat: extend buildLineup with UsageContext for batter rest"
```

---

## Phase 4: Reporting & UI

### Task 7: Create UsageReporter functions

**Files:**
- Create: `app/src/lib/game-results/usage-reporter.ts`
- Create: `app/src/lib/game-results/usage-reporter.test.ts`

**Step 1: Write UsageReporter module**

Create `app/src/lib/game-results/usage-reporter.ts`:

```typescript
/**
 * UsageReporter - Generate compliance reports for player usage
 */

import { getGameDatabase } from './database.js';
import type { PlayerUsageRecord } from './schema.js';

export interface UsageSummary {
  totalPlayers: number;
  inRange: number;
  under: number;
  over: number;
  breakdown: {
    batters: { total: number; inRange: number; under: number; over: number };
    pitchers: { total: number; inRange: number; under: number; over: number };
  };
}

export interface PlayerUsageRow {
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
  deviation: number;
}

export interface TeamUsageBreakdown {
  teamId: string;
  teamName: string;
  totalPlayers: number;
  inRange: number;
  under: number;
  over: number;
  complianceScore: number;
}

export async function getUsageSummary(seriesId: string): Promise<UsageSummary> {
  const db = await getGameDatabase();

  const result = db.query(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'inRange' THEN 1 ELSE 0 END) as inRange,
      SUM(CASE WHEN status = 'under' THEN 1 ELSE 0 END) as under,
      SUM(CASE WHEN status = 'over' THEN 1 ELSE 0 END) as over
    FROM player_usage
    WHERE series_id = ?
  `).get(seriesId) as any;

  const battersResult = db.query(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'inRange' THEN 1 ELSE 0 END) as inRange,
      SUM(CASE WHEN status = 'under' THEN 1 ELSE 0 END) as under,
      SUM(CASE WHEN status = 'over' THEN 1 ELSE 0 END) as over
    FROM player_usage
    WHERE series_id = ? AND is_pitcher = 0
  `).get(seriesId) as any;

  const pitchersResult = db.query(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'inRange' THEN 1 ELSE 0 END) as inRange,
      SUM(CASE WHEN status = 'under' THEN 1 ELSE 0 END) as under,
      SUM(CASE WHEN status = 'over' THEN 1 ELSE 0 END) as over
    FROM player_usage
    WHERE series_id = ? AND is_pitcher = 1
  `).get(seriesId) as any;

  return {
    totalPlayers: result.total,
    inRange: result.inRange,
    under: result.under,
    over: result.over,
    breakdown: {
      batters: {
        total: battersResult.total,
        inRange: battersResult.inRange,
        under: battersResult.under,
        over: battersResult.over
      },
      pitchers: {
        total: pitchersResult.total,
        inRange: pitchersResult.inRange,
        under: pitchersResult.under,
        over: pitchersResult.over
      }
    }
  };
}

export async function getPlayerUsageRows(
  seriesId: string,
  filters?: { teamId?: string; isPitcher?: boolean; status?: string }
): Promise<PlayerUsageRow[]> {
  const db = await getGameDatabase();

  let query = `
    SELECT
      pu.*,
      p.name as player_name,
      t.name as team_name
    FROM player_usage pu
    LEFT JOIN players p ON pu.player_id = p.id
    LEFT JOIN teams t ON pu.team_id = t.id
    WHERE pu.series_id = ?
  `;

  const params: any[] = [seriesId];

  if (filters?.teamId) {
    query += ' AND pu.team_id = ?';
    params.push(filters.teamId);
  }

  if (filters?.isPitcher !== undefined) {
    query += ' AND pu.is_pitcher = ?';
    params.push(filters.isPitcher ? 1 : 0);
  }

  if (filters?.status) {
    query += ' AND pu.status = ?';
    params.push(filters.status);
  }

  query += ' ORDER BY pu.percentage_of_actual DESC';

  const rows = db.query(query).all(...params) as any[];

  return rows.map(r => ({
    playerId: r.player_id,
    playerName: r.player_name || 'Unknown',
    teamId: r.team_id,
    teamName: r.team_name || 'Unknown',
    isPitcher: r.is_pitcher === 1,
    actualSeasonTotal: r.actual_season_total,
    replayCurrentTotal: r.replay_current_total,
    percentageOfActual: r.percentage_of_actual,
    gamesPlayedActual: r.games_played_actual,
    replayGamesPlayed: r.replay_games_played,
    status: r.status,
    deviation: (r.percentage_of_actual * 100) - 100
  }));
}

export async function getTeamUsageBreakdown(seriesId: string): Promise<TeamUsageBreakdown[]> {
  const db = await getGameDatabase();

  const rows = db.query(`
    SELECT
      pu.team_id,
      t.name as team_name,
      COUNT(*) as total_players,
      SUM(CASE WHEN pu.status = 'inRange' THEN 1 ELSE 0 END) as inRange,
      SUM(CASE WHEN pu.status = 'under' THEN 1 ELSE 0 END) as under,
      SUM(CASE WHEN pu.status = 'over' THEN 1 ELSE 0 END) as over
    FROM player_usage pu
    LEFT JOIN teams t ON pu.team_id = t.id
    WHERE pu.series_id = ?
    GROUP BY pu.team_id, t.name
    ORDER BY (CAST(SUM(CASE WHEN pu.status = 'inRange' THEN 1 ELSE 0 END) AS REAL) / COUNT(*)) DESC
  `).all(seriesId) as any[];

  return rows.map(r => ({
    teamId: r.team_id,
    teamName: r.team_name || 'Unknown',
    totalPlayers: r.total_players,
    inRange: r.inRange,
    under: r.under,
    over: r.over,
    complianceScore: r.total_players > 0 ? (r.inRange / r.total_players) * 100 : 0
  }));
}
```

**Step 2: Export from index**

Add to `app/src/lib/game-results/index.ts`:

```typescript
export {
  getUsageSummary,
  getPlayerUsageRows,
  getTeamUsageBreakdown,
  type UsageSummary,
  type PlayerUsageRow,
  type TeamUsageBreakdown
} from './usage-reporter.js';
```

**Step 3: Write test**

Create basic test for UsageReporter.

**Step 4: Run tests**

Run: `pnpm -C app test src/lib/game-results/usage-reporter.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add app/src/lib/game-results/usage-reporter.ts app/src/lib/game-results/usage-reporter.test.ts app/src/lib/game-results/index.ts
git commit -m "feat: add UsageReporter with summary, player rows, and team breakdown"
```

---

### Task 8: Create UsageReportView Svelte component

**Files:**
- Create: `app/src/lib/game-results/components/UsageReportView.svelte`

**Step 1: Create UsageReportView component**

Create `app/src/lib/game-results/components/UsageReportView.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import type { UsageSummary, PlayerUsageRow, TeamUsageBreakdown } from '$lib/game-results';

  interface Props {
    seriesId: string;
  }
  let { seriesId }: Props = $props();

  // Dynamic imports
  let getUsageSummary: typeof import('$lib/game-results/index.js').getUsageSummary;
  let getPlayerUsageRows: typeof import('$lib/game-results/index.js').getPlayerUsageRows;
  let getTeamUsageBreakdown: typeof import('$lib/game-results/index.js').getTeamUsageBreakdown;

  // State
  let loading = $state(true);
  let error = $state<string | null>(null);
  let summary = $state<UsageSummary | null>(null);
  let playerRows = $state<PlayerUsageRow[]>([]);
  let teamBreakdown = $state<TeamUsageBreakdown[]>([]);
  let activeSubTab = $state<'players' | 'teams' | 'trends'>('players');
  let filterTeam = $state<string>('');
  let filterStatus = $state<string>('all');
  let filterType = $state<'all' | 'batters' | 'pitchers'>('all');

  onMount(async () => {
    try {
      const gameResults = await import('$lib/game-results/index.js');
      getUsageSummary = gameResults.getUsageSummary;
      getPlayerUsageRows = gameResults.getPlayerUsageRows;
      getTeamUsageBreakdown = gameResults.getTeamUsageBreakdown;

      await loadData();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load usage data';
    } finally {
      loading = false;
    }
  });

  async function loadData() {
    if (!getUsageSummary || !getPlayerUsageRows || !getTeamUsageBreakdown) return;

    summary = await getUsageSummary(seriesId);
    playerRows = await getPlayerUsageRows(seriesId);
    teamBreakdown = await getTeamUsageBreakdown(seriesId);
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'inRange': return 'text-green-400';
      case 'under': return 'text-yellow-400';
      case 'over': return 'text-red-400';
      default: return 'text-zinc-400';
    }
  }

  function getStatusBadge(status: string): string {
    switch (status) {
      case 'inRange': return '✓';
      case 'under': return '⚠ Under';
      case 'over': return '⚠ Over';
      default: return '?';
    }
  }

  const filteredRows = $derived(() => {
    let rows = [...playerRows];

    if (filterTeam) {
      rows = rows.filter(r => r.teamId === filterTeam);
    }

    if (filterStatus !== 'all') {
      rows = rows.filter(r => r.status === filterStatus);
    }

    if (filterType === 'batters') {
      rows = rows.filter(r => !r.isPitcher);
    } else if (filterType === 'pitchers') {
      rows = rows.filter(r => r.isPitcher);
    }

    return rows;
  });

  // Get unique teams for filter
  const teams = $derived(() => {
    const teamSet = new Set(playerRows.map(r => r.teamId));
    return Array.from(teamSet).sort();
  });
</script>

{#if loading}
  <div class="animate-pulse">
    <div class="h-8 bg-zinc-800 rounded w-1/3 mb-4"></div>
    <div class="h-64 bg-zinc-800 rounded"></div>
  </div>
{:else if error}
  <div class="text-red-400">{error}</div>
{:else if summary}
  <!-- Summary Dashboard -->
  <div class="mb-6 p-4 bg-zinc-800 rounded-lg">
    <h3 class="text-lg font-semibold text-white mb-4">Usage Compliance Summary</h3>
    <div class="grid grid-cols-4 gap-4">
      <div class="text-center">
        <div class="text-2xl font-bold text-white">{summary.totalPlayers}</div>
        <div class="text-sm text-zinc-400">Total Players</div>
      </div>
      <div class="text-center">
        <div class="text-2xl font-bold text-green-400">{summary.inRange}</div>
        <div class="text-sm text-zinc-400">In Range (75-125%)</div>
      </div>
      <div class="text-center">
        <div class="text-2xl font-bold text-yellow-400">{summary.under}</div>
        <div class="text-sm text-zinc-400">Under (< 75%)</div>
      </div>
      <div class="text-center">
        <div class="text-2xl font-bold text-red-400">{summary.over}</div>
        <div class="text-sm text-zinc-400">Over (> 125%)</div>
      </div>
    </div>
    <div class="mt-4 pt-4 border-t border-zinc-700">
      <div class="flex gap-8 text-sm">
        <div class="text-zinc-400">
          Batters: {summary.breakdown.batters.inRange}/{summary.breakdown.batters.total} in range
        </div>
        <div class="text-zinc-400">
          Pitchers: {summary.breakdown.pitchers.inRange}/{summary.breakdown.pitchers.total} in range
        </div>
      </div>
    </div>
  </div>

  <!-- Sub-tabs -->
  <div class="mb-4">
    <div class="flex gap-4 border-b border-zinc-800">
      <button
        class="pb-2 px-1 text-sm {activeSubTab === 'players' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-zinc-400 hover:text-white'}"
        onclick={() => activeSubTab = 'players'}
      >
        Players
      </button>
      <button
        class="pb-2 px-1 text-sm {activeSubTab === 'teams' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-zinc-400 hover:text-white'}"
        onclick={() => activeSubTab = 'teams'}
      >
        Teams
      </button>
      <button
        class="pb-2 px-1 text-sm {activeSubTab === 'trends' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-zinc-400 hover:text-white'}"
        onclick={() => activeSubTab = 'trends'}
      >
        Trends
      </button>
    </div>
  </div>

  {#if activeSubTab === 'players'}
    <!-- Filters -->
    <div class="mb-4 flex gap-4">
      <select bind:value={filterTeam} class="bg-zinc-800 border border-zinc-700 rounded px-3 py-1 text-sm text-white">
        <option value="">All Teams</option>
        {#each teams as team}
          <option value={team}>{team}</option>
        {/each}
      </select>

      <select bind:value={filterStatus} class="bg-zinc-800 border border-zinc-700 rounded px-3 py-1 text-sm text-white">
        <option value="all">All Status</option>
        <option value="inRange">In Range</option>
        <option value="under">Under</option>
        <option value="over">Over</option>
      </select>

      <select bind:value={filterType} class="bg-zinc-800 border border-zinc-700 rounded px-3 py-1 text-sm text-white">
        <option value="all">All Players</option>
        <option value="batters">Batters Only</option>
        <option value="pitchers">Pitchers Only</option>
      </select>
    </div>

    <!-- Players Table -->
    <div class="overflow-x-auto">
      <table class="w-full text-sm text-left">
        <thead class="bg-zinc-800 text-zinc-400">
          <tr>
            <th class="px-4 py-2">Name</th>
            <th class="px-4 py-2">Team</th>
            <th class="px-4 py-2">Type</th>
            <th class="px-4 py-2">Actual</th>
            <th class="px-4 py-2">Replay</th>
            <th class="px-4 py-2">%</th>
            <th class="px-4 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {#each filteredRows() as row}
            <tr class="border-b border-zinc-800 hover:bg-zinc-800/50">
              <td class="px-4 py-2 text-white">{row.playerName}</td>
              <td class="px-4 py-2 text-zinc-400">{row.teamId}</td>
              <td class="px-4 py-2 text-zinc-400">{row.isPitcher ? 'P' : 'B'}</td>
              <td class="px-4 py-2 text-zinc-400">{row.actualSeasonTotal}</td>
              <td class="px-4 py-2 text-zinc-400">{row.replayCurrentTotal}</td>
              <td class="px-4 py-2 {getStatusColor(row.status)}">{row.percentageOfActual.toFixed(1)}%</td>
              <td class="px-4 py-2 {getStatusColor(row.status)}">{getStatusBadge(row.status)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

  {:else if activeSubTab === 'teams'}
    <!-- Teams Breakdown -->
    <div class="space-y-4">
      {#each teamBreakdown as team}
        <div class="p-4 bg-zinc-800 rounded-lg">
          <div class="flex justify-between items-center mb-2">
            <h4 class="text-lg font-semibold text-white">{team.teamName}</h4>
            <div class="text-sm">
              <span class="text-zinc-400">Compliance: </span>
              <span class="font-bold {team.complianceScore >= 80 ? 'text-green-400' : team.complianceScore >= 60 ? 'text-yellow-400' : 'text-red-400'}">
                {team.complianceScore.toFixed(0)}%
              </span>
            </div>
          </div>
          <div class="flex gap-6 text-sm">
            <div class="text-zinc-400">
              Total: <span class="text-white">{team.totalPlayers}</span>
            </div>
            <div class="text-zinc-400">
              In Range: <span class="text-green-400">{team.inRange}</span>
            </div>
            <div class="text-zinc-400">
              Under: <span class="text-yellow-400">{team.under}</span>
            </div>
            <div class="text-zinc-400">
              Over: <span class="text-red-400">{team.over}</span>
            </div>
          </div>
        </div>
      {/each}
    </div>

  {:else}
    <!-- Trends (placeholder) -->
    <div class="text-zinc-400 text-center py-8">
      Trend tracking coming soon
    </div>
  {/if}
{/if}
```

**Step 2: Add Usage tab to series page**

Modify `app/src/routes/game-results/series/[id]/+page.svelte`:

Add to state:

```svelte
let activeTab = $state<'standings' | 'games' | 'leaders' | 'usage'>('games');
```

Add to tabs:

```svelte
<button
  class="pb-2 px-1 text-sm {activeTab === 'usage' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-zinc-400 hover:text-white'}"
  onclick={() => activeTab = 'usage'}
>
  Usage
</button>
```

Add to tab content:

```svelte
{:else if activeTab === 'usage'}
  <svelte:component this={UsageReportView} {seriesId} />
```

Import the component:

```svelte
import UsageReportView from '$lib/game-results/components/UsageReportView.svelte';
```

**Step 3: Run app and verify**

Run: `pnpm -C app dev`
Expected: App loads, Usage tab shows (may be empty if no data)

**Step 4: Commit**

```bash
git add app/src/lib/game-results/components/UsageReportView.svelte app/src/routes/game-results/series/[id]/+page.svelte
git commit -m "feat: add UsageReportView component with summary and player table"
```

---

## Phase 5: Testing & Refinement

### Task 9: Run season replay and analyze results

**Files:**
- None (manual testing)

**Step 1: Run a test season replay**

Run: Navigate to season replay page in browser, start a 1976 season replay

**Step 2: Monitor usage report**

Check the Usage tab periodically during replay

**Step 3: Analyze final results**

After replay completes, review:
- Percentage of players in 75-125% range
- Identify patterns in under/over usage
- Note teams/positions with issues

**Step 4: Adjust algorithms if needed**

Based on results, consider tuning:
- Rest probability thresholds
- Replacement selection boost multiplier
- Minimum thresholds

**Step 5: Document findings**

Create `docs/plans/2025-02-07-usage-management-results.md` with test results and any adjustments made

---

## Final Verification

### Task 10: Final check and commit

**Step 1: Run all tests**

Run:
```bash
pnpm -C packages/model test
pnpm -C app test
```

Expected: All tests pass (except pre-existing failures documented earlier)

**Step 2: Type check**

Run: `pnpm -C app check`

Expected: No type errors

**Step 3: Final commit**

```bash
git add docs/plans/2025-02-07-usage-management-implementation.md docs/plans/2025-02-07-usage-management-results.md
git commit -m "docs: add implementation plan and results for player usage management"
```

---

## Success Criteria

After implementation:

1. **Data Layer**: ✅ UsageTracker seeds targets and updates after each game
2. **Roster Management**: ✅ Rotations cycle, batters rest probabilistically
3. **Integration**: ✅ SeasonReplayEngine uses UsageTracker
4. **Reporting**: ✅ UI shows compliance dashboard
5. **Validation**: ✅ Run 1976 season replay, ≥85% of qualifying players in 75-125% range
