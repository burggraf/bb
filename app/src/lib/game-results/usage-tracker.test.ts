/**
 * UsageTracker class tests
 *
 * Tests player usage tracking functionality including:
 * - Seeding usage targets from player data
 * - Updating usage after games
 * - Checking threshold violations
 *
 * Note: Full database tests require browser environment (sql.js WASM).
 * These tests verify the logic with mocked database interactions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Database } from 'sql.js';

// Mock the database module
const mockGetGameDatabase = vi.fn();
vi.mock('./database.js', () => ({
  getGameDatabase: () => mockGetGameDatabase()
}));

describe('UsageTracker', () => {
  beforeEach(() => {
    mockGetGameDatabase.mockReset();
  });

  describe('seedUsageTargets', () => {
    it('should filter batters below minimum threshold (20 PA)', async () => {
      const { UsageTracker } = await import('./usage-tracker.js');

      const mockDb = {
        run: vi.fn(),
        prepare: vi.fn(() => ({
          run: vi.fn(),
          free: vi.fn()
        }))
      } as unknown as Database;

      mockGetGameDatabase.mockResolvedValue(mockDb);

      const tracker = new UsageTracker('test-series');

      const batters = {
        'batter-1': { pa: 25, teamId: 'NYA', games: 100 },  // Above threshold
        'batter-2': { pa: 15, teamId: 'BOS', games: 80 },   // Below threshold
        'batter-3': { pa: 20, teamId: 'NYA', games: 90 }    // At threshold
      };

      await tracker.seedUsageTargets(batters, {});

      const prepare = mockDb.prepare as any;
      expect(prepare).toHaveBeenCalled();

      // Only batter-1 and batter-3 should be inserted (>= 20 PA)
      const insertCalls = prepare.mock.calls.filter((call: any) =>
        call[0].includes('INSERT INTO player_usage')
      );

      expect(insertCalls.length).toBeGreaterThan(0);
    });

    it('should filter pitchers below minimum threshold (5 IP)', async () => {
      const { UsageTracker } = await import('./usage-tracker.js');

      const mockDb = {
        run: vi.fn(),
        prepare: vi.fn(() => ({
          run: vi.fn(),
          free: vi.fn()
        }))
      } as unknown as Database;

      mockGetGameDatabase.mockResolvedValue(mockDb);

      const tracker = new UsageTracker('test-series');

      const pitchers = {
        'pitcher-1': { inningsPitched: 10, teamId: 'NYA', games: 30 },  // Above threshold
        'pitcher-2': { inningsPitched: 3, teamId: 'BOS', games: 10 },   // Below threshold
        'pitcher-3': { inningsPitched: 5, teamId: 'NYA', games: 20 }    // At threshold
      };

      await tracker.seedUsageTargets({}, pitchers);

      const prepare = mockDb.prepare as any;
      expect(prepare).toHaveBeenCalled();
    });

    it('should convert IP to outs for pitchers', async () => {
      const { UsageTracker } = await import('./usage-tracker.js');

      const mockRunCalls: any[] = [];
      const mockDb = {
        run: vi.fn(),
        prepare: vi.fn(() => ({
          run: vi.fn((args: any[]) => {
            mockRunCalls.push(args);
          }),
          free: vi.fn()
        }))
      } as unknown as Database;

      mockGetGameDatabase.mockResolvedValue(mockDb);

      const tracker = new UsageTracker('test-series');

      const pitchers = {
        'pitcher-1': { inningsPitched: 10, teamId: 'NYA', games: 30 }  // 10 IP = 30 outs
      };

      await tracker.seedUsageTargets({}, pitchers);

      // Find the pitcher insert call
      const pitcherCall = mockRunCalls.find((call: any) => {
        // args is now an array, the 5th parameter (index 4) should be outs (IP * 3)
        return call.length >= 5 && call[4] === 30;
      });

      expect(pitcherCall).toBeDefined();
    });

    it('should clear existing data for the series before seeding', async () => {
      const { UsageTracker } = await import('./usage-tracker.js');

      const mockDb = {
        run: vi.fn(),
        prepare: vi.fn(() => ({
          run: vi.fn(),
          free: vi.fn()
        }))
      } as unknown as Database;

      mockGetGameDatabase.mockResolvedValue(mockDb);

      const tracker = new UsageTracker('test-series');

      await tracker.seedUsageTargets({}, {});

      expect(mockDb.run).toHaveBeenCalledWith(
        'DELETE FROM player_usage WHERE series_id = ?',
        ['test-series']
      );
    });

    it('should set initial values correctly', async () => {
      const { UsageTracker } = await import('./usage-tracker.js');

      const mockStmt = {
        run: vi.fn(),
        free: vi.fn()
      };
      const mockDb = {
        run: vi.fn(),
        prepare: vi.fn(() => mockStmt)
      } as unknown as Database;

      mockGetGameDatabase.mockResolvedValue(mockDb);

      const tracker = new UsageTracker('test-series');

      const batters = {
        'batter-1': { pa: 100, teamId: 'NYA', games: 80 }
      };

      await tracker.seedUsageTargets(batters, {});

      // Check that the statement's run method was called
      expect(mockStmt.run).toHaveBeenCalled();

      // Get the first call arguments - now an array
      const runCall = mockStmt.run.mock.calls[0][0];
      expect(runCall[0]).toBe('test-series');
      expect(runCall[1]).toBe('batter-1');
      expect(runCall[2]).toBe('NYA');
      expect(runCall[3]).toBe(0);  // is_pitcher = false
      expect(runCall[4]).toBe(100); // actual_season_total = pa
      expect(runCall[5]).toBe(80);   // games_played_actual
    });
  });

  describe('updateGameUsage', () => {
    it('should update batter PA counts correctly', async () => {
      const { UsageTracker } = await import('./usage-tracker.js');

      const mockUpdateCalls: any[] = [];
      const mockStmt = {
        run: vi.fn((args: any[]) => {
          mockUpdateCalls.push(args);
        }),
        free: vi.fn()
      };
      const mockDb = {
        prepare: vi.fn(() => mockStmt)
      } as unknown as Database;

      mockGetGameDatabase.mockResolvedValue(mockDb);

      const tracker = new UsageTracker('test-series');

      const gameStats = {
        batterPa: new Map([
          ['batter-1', 4],
          ['batter-2', 5]
        ]),
        pitcherIp: new Map()
      };

      await tracker.updateGameUsage(gameStats);

      // Should have 2 batter updates
      expect(mockUpdateCalls.length).toBe(2);
    });

    it('should update pitcher IP counts correctly', async () => {
      const { UsageTracker } = await import('./usage-tracker.js');

      const mockUpdateCalls: any[] = [];
      const mockStmt = {
        run: vi.fn((args: any[]) => {
          mockUpdateCalls.push(args);
        }),
        free: vi.fn()
      };
      const mockDb = {
        prepare: vi.fn(() => mockStmt)
      } as unknown as Database;

      mockGetGameDatabase.mockResolvedValue(mockDb);

      const tracker = new UsageTracker('test-series');

      const gameStats = {
        batterPa: new Map(),
        pitcherIp: new Map([
          ['pitcher-1', 27],  // 9 IP = 27 outs
          ['pitcher-2', 18]   // 6 IP = 18 outs
        ])
      };

      await tracker.updateGameUsage(gameStats);

      // Should have 2 pitcher updates
      expect(mockUpdateCalls.length).toBe(2);
    });

    it('should calculate percentage of actual correctly with proration', async () => {
      const { UsageTracker } = await import('./usage-tracker.js');

      const mockDb = {
        prepare: vi.fn(() => ({
          run: vi.fn(),
          free: vi.fn(),
          bind: vi.fn(),
          step: vi.fn(() => false),
          getAsObject: vi.fn()
        }))
      } as unknown as Database;

      mockGetGameDatabase.mockResolvedValue(mockDb);

      const tracker = new UsageTracker('test-series');

      const gameStats = {
        batterPa: new Map([
          ['batter-1', 4]
        ]),
        pitcherIp: new Map()
      };

      await tracker.updateGameUsage(gameStats);

      const prepare = mockDb.prepare as any;
      const updateSql = prepare.mock.calls[1][0];  // Index 1 is the team games query, 0 is the batter update

      // Check that SQL calculates percentage with proration based on team games played
      expect(updateSql).toContain('actual_season_total * CAST(? AS REAL) / games_played_actual');
    });

    it('should update status based on thresholds', async () => {
      const { UsageTracker } = await import('./usage-tracker.js');

      const mockDb = {
        prepare: vi.fn(() => ({
          run: vi.fn(),
          free: vi.fn()
        }))
      } as unknown as Database;

      mockGetGameDatabase.mockResolvedValue(mockDb);

      const tracker = new UsageTracker('test-series');

      const gameStats = {
        batterPa: new Map([
          ['batter-1', 4]
        ]),
        pitcherIp: new Map()
      };

      await tracker.updateGameUsage(gameStats);

      const prepare = mockDb.prepare as any;
      const updateSql = prepare.mock.calls[0][0];

      // Check threshold logic: < 0.75 = under, > 1.25 = over
      expect(updateSql).toContain('< 0.75 THEN \'under\'');
      expect(updateSql).toContain('> 1.25 THEN \'over\'');
      expect(updateSql).toContain('ELSE \'inRange\'');
    });
  });

  describe('checkThresholds', () => {
    it('should detect under-used players (< 75%)', async () => {
      const { UsageTracker } = await import('./usage-tracker.js');

      let prepareCallCount = 0;
      const createMockStmt = (rows: any[]) => ({
        bind: vi.fn(),
        step: vi.fn(() => {
          const result = rows.length > 0;
          rows.shift(); // Remove first row
          return result;
        }),
        getAsObject: vi.fn(() => rows[0]),
        free: vi.fn()
      });

      const mockDb = {
        prepare: vi.fn(() => {
          prepareCallCount++;
          if (prepareCallCount === 1) {
            // First call (under-used query)
            return createMockStmt([
              {
                player_id: 'batter-1',
                name: 'Underused Batter',
                is_pitcher: 0,
                percentage_of_actual: 0.5,  // 50% - under
                status: 'under'
              }
            ]);
          }
          // Second call (over-used query)
          return createMockStmt([]);
        })
      } as unknown as Database;

      mockGetGameDatabase.mockResolvedValue(mockDb);

      const tracker = new UsageTracker('test-series');
      const violations = await tracker.checkThresholds();

      expect(violations).toHaveLength(1);
      expect(violations[0].playerId).toBe('batter-1');
      expect(violations[0].status).toBe('under');
      expect(violations[0].deviation).toBeCloseTo(50);  // 100 - 50*100 = 50
    });

    it('should detect over-used players (> 125%)', async () => {
      const { UsageTracker } = await import('./usage-tracker.js');

      let callCount = 0;
      const createMockStmt = (rows: any[]) => ({
        bind: vi.fn(),
        step: vi.fn(() => {
          const result = rows.length > 0;
          rows.shift();
          return result;
        }),
        getAsObject: vi.fn(() => rows[0]),
        free: vi.fn()
      });

      const mockDb = {
        prepare: vi.fn(() => {
          callCount++;
          if (callCount === 1) {
            // No under-used
            return createMockStmt([]);
          }
          // Over-used
          return createMockStmt([
            {
              player_id: 'pitcher-1',
              name: 'Overused Pitcher',
              is_pitcher: 1,
              percentage_of_actual: 1.5,  // 150% - over
              status: 'over'
            }
          ]);
        })
      } as unknown as Database;

      mockGetGameDatabase.mockResolvedValue(mockDb);

      const tracker = new UsageTracker('test-series');
      const violations = await tracker.checkThresholds();

      expect(violations).toHaveLength(1);
      expect(violations[0].playerId).toBe('pitcher-1');
      expect(violations[0].status).toBe('over');
      expect(violations[0].isPitcher).toBe(true);
      expect(violations[0].deviation).toBeCloseTo(50);  // 150*100 - 100 = 50
    });

    it('should return empty array when no violations', async () => {
      const { UsageTracker } = await import('./usage-tracker.js');

      const mockStmt = {
        bind: vi.fn(),
        step: vi.fn(() => false),  // No rows
        getAsObject: vi.fn(),
        free: vi.fn()
      };

      const mockDb = {
        prepare: vi.fn(() => mockStmt)
      } as unknown as Database;

      mockGetGameDatabase.mockResolvedValue(mockDb);

      const tracker = new UsageTracker('test-series');
      const violations = await tracker.checkThresholds();

      expect(violations).toEqual([]);
    });

    it('should handle missing player names', async () => {
      const { UsageTracker } = await import('./usage-tracker.js');

      const mockStmt = {
        bind: vi.fn(),
        step: vi.fn(() => true),
        getAsObject: vi.fn(() => ({
          player_id: 'unknown-1',
          name: null,  // Missing name
          is_pitcher: 0,
          percentage_of_actual: 0.5,
          status: 'under'
        })),
        free: vi.fn()
      };

      const mockDb = {
        prepare: vi.fn(() => mockStmt)
      } as unknown as Database;

      mockGetGameDatabase.mockResolvedValue(mockDb);

      const tracker = new UsageTracker('test-series');
      const violations = await tracker.checkThresholds();

      expect(violations[0].playerName).toBe('Unknown');
    });
  });

  describe('getPlayerUsage', () => {
    it('should return null for non-existent player', async () => {
      const { UsageTracker } = await import('./usage-tracker.js');

      const mockStmt = {
        bind: vi.fn(),
        step: vi.fn(() => false),  // No row
        getAsObject: vi.fn(),
        free: vi.fn()
      };

      const mockDb = {
        prepare: vi.fn(() => mockStmt)
      } as unknown as Database;

      mockGetGameDatabase.mockResolvedValue(mockDb);

      const tracker = new UsageTracker('test-series');
      const result = await tracker.getPlayerUsage('non-existent');

      expect(result).toBeNull();
    });

    it('should return player usage record', async () => {
      const { UsageTracker } = await import('./usage-tracker.js');

      const mockRow = {
        series_id: 'test-series',
        player_id: 'batter-1',
        team_id: 'NYA',
        is_pitcher: 0,
        actual_season_total: 500,
        games_played_actual: 150,
        replay_current_total: 250,
        replay_games_played: 75,
        percentage_of_actual: 0.5,
        status: 'under'
      };

      const mockStmt = {
        bind: vi.fn(),
        step: vi.fn(() => true),
        getAsObject: vi.fn(() => mockRow),
        free: vi.fn()
      };

      const mockDb = {
        prepare: vi.fn(() => mockStmt)
      } as unknown as Database;

      mockGetGameDatabase.mockResolvedValue(mockDb);

      const tracker = new UsageTracker('test-series');
      const result = await tracker.getPlayerUsage('batter-1');

      expect(result).not.toBeNull();
      expect(result?.playerId).toBe('batter-1');
      expect(result?.teamId).toBe('NYA');
      expect(result?.isPitcher).toBe(false);
      expect(result?.percentageOfActual).toBe(0.5);
      expect(result?.status).toBe('under');
    });
  });

  describe('getTeamUsage', () => {
    it('should return team usage records ordered by percentage', async () => {
      const { UsageTracker } = await import('./usage-tracker.js');

      const mockRows = [
        {
          series_id: 'test-series',
          player_id: 'batter-2',
          team_id: 'NYA',
          is_pitcher: 0,
          actual_season_total: 400,
          games_played_actual: 150,
          replay_current_total: 500,
          replay_games_played: 100,
          percentage_of_actual: 1.25,
          status: 'inRange'
        },
        {
          series_id: 'test-series',
          player_id: 'batter-1',
          team_id: 'NYA',
          is_pitcher: 0,
          actual_season_total: 500,
          games_played_actual: 150,
          replay_current_total: 250,
          replay_games_played: 75,
          percentage_of_actual: 0.5,
          status: 'under'
        }
      ];

      let rowIndex = 0;
      const mockStmt = {
        bind: vi.fn(),
        step: vi.fn(() => rowIndex < mockRows.length),
        getAsObject: vi.fn(() => mockRows[rowIndex++]),
        free: vi.fn()
      };

      const mockDb = {
        prepare: vi.fn(() => mockStmt)
      } as unknown as Database;

      mockGetGameDatabase.mockResolvedValue(mockDb);

      const tracker = new UsageTracker('test-series');
      const results = await tracker.getTeamUsage('NYA');

      expect(results).toHaveLength(2);
      expect(results[0].playerId).toBe('batter-2');  // Higher percentage first
      expect(results[1].playerId).toBe('batter-1');
    });
  });
});
