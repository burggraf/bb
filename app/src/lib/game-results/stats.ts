/**
 * Stats query functions for game results database
 * Provides standings, batting stats, pitching stats, and leaderboards
 */

import { getGameDatabase } from './database.js';
import type { Standing, BattingStat, PitchingStat } from './types.js';

/**
 * Convert snake_case to camelCase for object keys
 */
function snakeToCamel<T>(obj: Record<string, any>): T {
  const result: Record<string, any> = {};
  for (const key in obj) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camelKey] = obj[key];
  }
  return result as T;
}

/**
 * Batting stats sort options
 */
export type BattingSortBy =
  | 'avg'
  | 'homeRuns'
  | 'rbi'
  | 'obp'
  | 'slg'
  | 'hits'
  | 'walks'
  | 'strikeouts'
  | 'pa';

/**
 * Pitching stats sort options
 */
export type PitchingSortBy =
  | 'era'
  | 'strikeouts'
  | 'whip'
  | 'games'
  | 'battersFaced'
  | 'earnedRuns'
  | 'homeRunsAllowed';

/**
 * Options for querying batting stats
 */
export interface BattingStatsOptions {
  /** Minimum plate appearances to qualify (default: 0) */
  minPa?: number;
  /** Sort by field (default: null) */
  orderBy?: BattingSortBy | null;
  /** Sort direction (default: 'DESC' for most stats, 'ASC' for ERA) */
  orderDirection?: 'ASC' | 'DESC';
  /** Limit results (default: null = no limit) */
  limit?: number | null;
}

/**
 * Options for querying pitching stats
 */
export interface PitchingStatsOptions {
  /** Minimum batters faced to qualify (default: 0) */
  minBattersFaced?: number;
  /** Sort by field (default: null) */
  orderBy?: PitchingSortBy | null;
  /** Sort direction (default: 'ASC' for ERA, 'DESC' for others) */
  orderDirection?: 'ASC' | 'DESC';
  /** Limit results (default: null = no limit) */
  limit?: number | null;
}

/**
 * Get standings for a series
 *
 * Queries the series_standings view which calculates wins, losses,
 * runs scored, and runs allowed for each team in the series.
 *
 * @param seriesId - Series ID to get standings for
 * @returns Promise<Standing[]> Array of standings records
 *
 * @throws Error if series not found or database query fails
 */
export async function getStandings(seriesId: string): Promise<Standing[]> {
  try {
    const db = await getGameDatabase();

    const stmt = db.prepare(`
      SELECT * FROM series_standings
      WHERE series_id = ?
      ORDER BY wins DESC, runs_scored - runs_allowed DESC
    `);
    stmt.bind([seriesId]);

    const standings: Standing[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, any>;
      standings.push(snakeToCamel<Standing>(row));
    }

    stmt.free();
    return standings;
  } catch (error) {
    console.error('[Stats] Failed to get standings:', error);
    throw new Error(`Failed to get standings: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get batting stats for a series
 *
 * Queries the batting_stats view with optional filtering and sorting.
 *
 * @param seriesId - Series ID to get batting stats for
 * @param options - Query options (minPa, orderBy, orderDirection, limit)
 * @returns Promise<BattingStat[]> Array of batting stat records
 *
 * @throws Error if series not found or database query fails
 *
 * @example
 * ```ts
 * // Get top 10 hitters by batting average (min 50 PA)
 * const stats = await getBattingStats(seriesId, {
 *   minPa: 50,
 *   orderBy: 'avg',
 *   orderDirection: 'DESC',
 *   limit: 10
 * });
 *
 * // Get all hitters sorted by home runs
 * const hrLeaders = await getBattingStats(seriesId, {
 *   orderBy: 'homeRuns',
 *   orderDirection: 'DESC'
 * });
 * ```
 */
export async function getBattingStats(
  seriesId: string,
  options: BattingStatsOptions = {}
): Promise<BattingStat[]> {
  try {
    const db = await getGameDatabase();

    const { minPa = 0, orderBy = null, orderDirection = 'DESC', limit = null } = options;

    // Build query with optional filters and sorting
    let sql = 'SELECT * FROM batting_stats WHERE series_id = ?';
    const params: any[] = [seriesId];

    if (minPa > 0) {
      sql += ' AND pa >= ?';
      params.push(minPa);
    }

    if (orderBy) {
      // Map camelCase sort fields to snake_case column names
      const columnMap: Record<BattingSortBy, string> = {
        avg: 'avg',
        homeRuns: 'home_runs',
        rbi: 'rbi',
        obp: 'obp',
        slg: 'slg',
        hits: 'hits',
        walks: 'walks',
        strikeouts: 'strikeouts',
        pa: 'pa'
      };
      sql += ` ORDER BY ${columnMap[orderBy]} ${orderDirection}`;
    }

    if (limit) {
      sql += ` LIMIT ${limit}`;
    }

    const stmt = db.prepare(sql);
    stmt.bind(params);

    const stats: BattingStat[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, any>;
      stats.push(snakeToCamel<BattingStat>(row));
    }

    stmt.free();
    return stats;
  } catch (error) {
    console.error('[Stats] Failed to get batting stats:', error);
    throw new Error(`Failed to get batting stats: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get pitching stats for a series
 *
 * Queries the pitching_stats view with optional filtering and sorting.
 *
 * @param seriesId - Series ID to get pitching stats for
 * @param options - Query options (minBattersFaced, orderBy, orderDirection, limit)
 * @returns Promise<PitchingStat[]> Array of pitching stat records
 *
 * @throws Error if series not found or database query fails
 *
 * @example
 * ```ts
 * // Get top 10 pitchers by ERA (min 50 batters faced)
 * const stats = await getPitchingStats(seriesId, {
 *   minBattersFaced: 50,
 *   orderBy: 'era',
 *   orderDirection: 'ASC',
 *   limit: 10
 * });
 *
 * // Get all pitchers sorted by strikeouts
 * const kLeaders = await getPitchingStats(seriesId, {
 *   orderBy: 'strikeouts',
 *   orderDirection: 'DESC'
 * });
 * ```
 */
export async function getPitchingStats(
  seriesId: string,
  options: PitchingStatsOptions = {}
): Promise<PitchingStat[]> {
  try {
    const db = await getGameDatabase();

    const { minBattersFaced = 0, orderBy = null, orderDirection = 'ASC', limit = null } = options;

    // Build query with optional filters and sorting
    let sql = 'SELECT * FROM pitching_stats WHERE series_id = ?';
    const params: any[] = [seriesId];

    if (minBattersFaced > 0) {
      sql += ' AND batters_faced >= ?';
      params.push(minBattersFaced);
    }

    if (orderBy) {
      // Map camelCase sort fields to snake_case column names
      const columnMap: Record<PitchingSortBy, string> = {
        era: 'era',
        strikeouts: 'strikeouts',
        whip: 'whip',
        games: 'games',
        battersFaced: 'batters_faced',
        earnedRuns: 'earned_runs',
        homeRunsAllowed: 'home_runs_allowed'
      };
      sql += ` ORDER BY ${columnMap[orderBy]} ${orderDirection}`;
    }

    if (limit) {
      sql += ` LIMIT ${limit}`;
    }

    const stmt = db.prepare(sql);
    stmt.bind(params);

    const stats: PitchingStat[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, any>;
      stats.push(snakeToCamel<PitchingStat>(row));
    }

    stmt.free();
    return stats;
  } catch (error) {
    console.error('[Stats] Failed to get pitching stats:', error);
    throw new Error(`Failed to get pitching stats: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Runs scored leaderboard entry
 */
export interface RunsScoredEntry {
  playerId: string;
  playerName: string | null;
  runs: number;
}

/**
 * Get runs scored leaderboard for a series
 *
 * Counts runs scored by each player from the runs_scored table
 * joined with game_events to get player names.
 *
 * @param seriesId - Series ID to get leaderboard for
 * @param limit - Maximum number of entries to return (default: 10)
 * @returns Promise<RunsScoredEntry[]> Array of runs scored leaderboard entries
 *
 * @throws Error if series not found or database query fails
 *
 * @example
 * ```ts
 * // Get top 10 run scorers
 * const leaders = await getRunsScoredLeaderboard(seriesId, 10);
 *
 * // Get top 25 run scorers
 * const leaders = await getRunsScoredLeaderboard(seriesId, 25);
 * ```
 */
export async function getRunsScoredLeaderboard(
  seriesId: string,
  limit: number = 10
): Promise<RunsScoredEntry[]> {
  try {
    const db = await getGameDatabase();

    const stmt = db.prepare(`
      SELECT
        rs.player_id as playerId,
        MAX(e.batter_name) as playerName,
        COUNT(*) as runs
      FROM runs_scored rs
      JOIN game_events e ON rs.event_id = e.id
      JOIN games g ON e.game_id = g.id
      WHERE g.series_id = ?
      GROUP BY rs.player_id
      ORDER BY runs DESC
      LIMIT ?
    `);
    stmt.bind([seriesId, limit]);

    const leaders: RunsScoredEntry[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, any>;
      leaders.push({
        playerId: row.playerId,
        playerName: row.playerName,
        runs: row.runs
      });
    }

    stmt.free();
    return leaders;
  } catch (error) {
    console.error('[Stats] Failed to get runs scored leaderboard:', error);
    throw new Error(
      `Failed to get runs scored leaderboard: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
