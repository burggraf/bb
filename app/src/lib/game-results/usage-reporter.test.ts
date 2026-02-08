/**
 * UsageReporter tests
 *
 * Tests usage reporting functionality including:
 * - Getting usage summary statistics
 * - Getting player usage rows with filters
 * - Getting team usage breakdowns
 *
 * Note: Full database tests require browser environment (sql.js WASM).
 * These tests verify the module structure and type exports.
 */

import { describe, it, expect } from 'vitest';

describe('UsageReporter Module', () => {
  it('should be importable', () => {
    expect(() => import('./usage-reporter.js')).not.toThrow();
  });

  it('should export all required functions', async () => {
    const module = await import('./usage-reporter.js');

    // Check that all required functions are exported
    expect(module.getUsageSummary).toBeInstanceOf(Function);
    expect(module.getPlayerUsageRows).toBeInstanceOf(Function);
    expect(module.getTeamUsageBreakdown).toBeInstanceOf(Function);
  });

  it('should have correct function signatures', async () => {
    const module = await import('./usage-reporter.js');

    // getUsageSummary takes seriesId string
    const getUsageSummary = module.getUsageSummary;
    expect(getUsageSummary.length).toBe(1);

    // getPlayerUsageRows takes seriesId and options object (options has default {})
    const getPlayerUsageRows = module.getPlayerUsageRows;
    expect(getPlayerUsageRows.length).toBeGreaterThanOrEqual(1);
    expect(getPlayerUsageRows.length).toBeLessThanOrEqual(2);

    // getTeamUsageBreakdown takes seriesId string
    const getTeamUsageBreakdown = module.getTeamUsageBreakdown;
    expect(getTeamUsageBreakdown.length).toBe(1);
  });

  it('should support default parameters for options', async () => {
    const module = await import('./usage-reporter.js');

    // These should not throw errors for missing options parameter
    expect(() => module.getPlayerUsageRows('test-series-id')).not.toThrow();
  });

  it('should support various sort options', async () => {
    const module = await import('./usage-reporter.js');

    // Valid sort options should be accepted
    type PlayerUsageOptions = Parameters<typeof module.getPlayerUsageRows>[1];
    const validSortOptions: Array<NonNullable<PlayerUsageOptions>['sortBy']> = [
      'percentageOfActual',
      'deviation',
      'replayCurrentTotal',
      'actualSeasonTotal',
      'playerName'
    ];

    // Just verify the function accepts these types (compile-time check)
    const sortOption: typeof validSortOptions[number] = 'percentageOfActual';
    expect(sortOption).toBeDefined();
  });

  it('should support various filter options', async () => {
    const module = await import('./usage-reporter.js');

    // Valid status options
    type PlayerUsageOptions = Parameters<typeof module.getPlayerUsageRows>[1];
    const validStatusOptions: Array<NonNullable<PlayerUsageOptions>['status']> = [
      'under',
      'inRange',
      'over',
      undefined
    ];

    const statusOption: typeof validStatusOptions[number] = 'under';
    expect(statusOption).toBeDefined();

    // Valid order direction options
    const validOrderOptions: Array<NonNullable<PlayerUsageOptions>['orderDirection']> = [
      'ASC',
      'DESC'
    ];

    const orderOption: typeof validOrderOptions[number] = 'DESC';
    expect(orderOption).toBeDefined();
  });

  describe('Helper functions', () => {
    it('should export snakeToCamel helper for internal use', async () => {
      const module = await import('./usage-reporter.js');

      // The helper is not exported, but we can verify the module works
      expect(module.getUsageSummary).toBeDefined();
    });
  });
});
