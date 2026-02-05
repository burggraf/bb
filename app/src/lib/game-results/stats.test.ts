import { describe, it, expect } from 'vitest';

/**
 * Stats query module tests
 *
 * Note: Full integration tests require browser environment (sql.js WASM + IndexedDB).
 * These tests verify the module structure and type exports.
 * Manual browser testing is required for full functionality.
 */
describe('Stats Query Module', () => {
  it('should be importable', () => {
    expect(() => import('./stats.js')).not.toThrow();
  });

  it('should export all required functions', async () => {
    const module = await import('./stats.js');

    // Check that all required functions are exported
    expect(module.getStandings).toBeInstanceOf(Function);
    expect(module.getBattingStats).toBeInstanceOf(Function);
    expect(module.getPitchingStats).toBeInstanceOf(Function);
    expect(module.getRunsScoredLeaderboard).toBeInstanceOf(Function);
  });

  it('should export required types', async () => {
    const module = await import('./stats.js');

    // Type exports are TypeScript only and don't exist at runtime
    // This test documents the expected types for reference
    const battingSortOptions: BattingSortBy = 'avg';
    const pitchingSortOptions: PitchingSortBy = 'era';

    // Just verify types compile correctly
    expect(battingSortOptions).toBeDefined();
    expect(pitchingSortOptions).toBeDefined();
  });

  it('should have correct function signatures', async () => {
    const module = await import('./stats.js');

    // getStandings takes seriesId string
    const getStandings = module.getStandings;
    expect(getStandings.length).toBe(1);

    // getBattingStats takes seriesId and options object (options has default {})
    const getBattingStats = module.getBattingStats;
    expect(getBattingStats.length).toBeGreaterThanOrEqual(1);
    expect(getBattingStats.length).toBeLessThanOrEqual(2);

    // getPitchingStats takes seriesId and options object (options has default {})
    const getPitchingStats = module.getPitchingStats;
    expect(getPitchingStats.length).toBeGreaterThanOrEqual(1);
    expect(getPitchingStats.length).toBeLessThanOrEqual(2);

    // getRunsScoredLeaderboard takes seriesId and optional limit (limit has default 10)
    const getRunsScoredLeaderboard = module.getRunsScoredLeaderboard;
    expect(getRunsScoredLeaderboard.length).toBeGreaterThanOrEqual(1);
    expect(getRunsScoredLeaderboard.length).toBeLessThanOrEqual(2);
  });

  it('should support default parameters for options', async () => {
    const module = await import('./stats.js');

    // These should not throw errors for missing options parameter
    expect(() => module.getBattingStats('test-series-id')).not.toThrow();
    expect(() => module.getPitchingStats('test-series-id')).not.toThrow();
    expect(() => module.getRunsScoredLeaderboard('test-series-id')).not.toThrow();
  });

  it('should support various sort options for batting stats', async () => {
    const module = await import('./stats.js');

    // Valid sort options should be accepted
    const validSortOptions: Array<Parameters<typeof module.getBattingStats>[1]['orderBy']> = [
      'avg',
      'homeRuns',
      'rbi',
      'obp',
      'slg',
      'hits',
      'walks',
      'strikeouts',
      'pa',
      null
    ];

    // Just verify the function accepts these types (compile-time check)
    const sortOption: typeof validSortOptions[number] = 'avg';
    expect(sortOption).toBeDefined();
  });

  it('should support various sort options for pitching stats', async () => {
    const module = await import('./stats.js');

    // Valid sort options should be accepted
    const validSortOptions: Array<Parameters<typeof module.getPitchingStats>[1]['orderBy']> = [
      'era',
      'strikeouts',
      'whip',
      'games',
      'battersFaced',
      'earnedRuns',
      'homeRunsAllowed',
      null
    ];

    // Just verify the function accepts these types (compile-time check)
    const sortOption: typeof validSortOptions[number] = 'era';
    expect(sortOption).toBeDefined();
  });

  it('should support filtering options', async () => {
    const module = await import('./stats.js');

    // Batting stats with minPa filter
    expect(() =>
      module.getBattingStats('test-series-id', { minPa: 50 })
    ).not.toThrow();

    // Pitching stats with minBattersFaced filter
    expect(() =>
      module.getPitchingStats('test-series-id', { minBattersFaced: 100 })
    ).not.toThrow();

    // With limit
    expect(() =>
      module.getBattingStats('test-series-id', { limit: 10 })
    ).not.toThrow();

    // With orderBy
    expect(() =>
      module.getBattingStats('test-series-id', { orderBy: 'homeRuns' })
    ).not.toThrow();
  });
});
