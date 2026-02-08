/**
 * UsageReporter - Reporting functions for player usage compliance dashboard
 *
 * Provides aggregated views of player usage data for monitoring
 * compliance with realistic usage targets during season replays.
 */

import { getGameDatabase } from './database.js';
import type { Database } from 'sql.js';
import type { PlayerUsageRecord } from './types.js';

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
 * Usage summary statistics for a series
 *
 * Aggregates usage compliance across all players in a series.
 */
export interface UsageSummary {
  seriesId: string;
  totalPlayers: number;
  totalBatters: number;
  totalPitchers: number;
  inRangeCount: number;
  underCount: number;
  overCount: number;
  avgPercentage: number;
  violations: UsageViolationSummary;
}

/**
 * Summary of usage violations by category
 */
export interface UsageViolationSummary {
  battersUnder: number;
  battersOver: number;
  pitchersUnder: number;
  pitchersOver: number;
  mostUnderused: PlayerUsageRow | null;
  mostOverused: PlayerUsageRow | null;
}

/**
 * Player usage row for dashboard display
 *
 * Enhanced version of PlayerUsageRecord with team name and player name.
 */
export interface PlayerUsageRow {
  seriesId: string;
  playerId: string;
  playerName: string | null;
  teamId: string;
  teamName: string | null;
  isPitcher: boolean;
  actualSeasonTotal: number;
  gamesPlayedActual: number;
  replayCurrentTotal: number;
  replayGamesPlayed: number;
  percentageOfActual: number;
  status: 'under' | 'inRange' | 'over';
  deviation: number; // Absolute deviation from 100% (e.g., 15 for 85% or 115%)
}

/**
 * Options for querying player usage rows
 */
export interface PlayerUsageOptions {
  /** Filter by team ID */
  teamId?: string;
  /** Filter by player type */
  isPitcher?: boolean;
  /** Filter by status */
  status?: 'under' | 'inRange' | 'over';
  /** Sort by field (default: 'percentageOfActual') */
  sortBy?: 'percentageOfActual' | 'deviation' | 'replayCurrentTotal' | 'actualSeasonTotal' | 'playerName';
  /** Sort direction (default: 'ASC' for under, 'DESC' for over) */
  orderDirection?: 'ASC' | 'DESC';
  /** Limit results (default: null = no limit) */
  limit?: number | null;
}

/**
 * Team usage breakdown for compliance monitoring
 *
 * Aggregates usage stats by team with violation counts.
 */
export interface TeamUsageBreakdown {
  teamId: string;
  teamName: string | null;
  seasonYear: number;
  league: string | null;
  division: string | null;
  totalPlayers: number;
  battersCount: number;
  pitchersCount: number;
  inRangeCount: number;
  underCount: number;
  overCount: number;
  avgBatterPercentage: number;
  avgPitcherPercentage: number;
  violations: Array<PlayerUsageRow>;
}

/**
 * Get usage summary for a series
 *
 * Calculates aggregated statistics for player usage compliance
 * across all players in the series.
 *
 * @param seriesId - Series ID to get usage summary for
 * @returns Promise<UsageSummary> Usage summary statistics
 *
 * @throws Error if series not found or database query fails
 *
 * @example
 * ```ts
 * const summary = await getUsageSummary(seriesId);
 * console.log(`Players in range: ${summary.inRangeCount}/${summary.totalPlayers}`);
 * console.log(`Average usage: ${summary.avgPercentage.toFixed(1)}%`);
 * ```
 */
export async function getUsageSummary(seriesId: string): Promise<UsageSummary> {
  try {
    const db = await getGameDatabase();

    // Get overall counts
    const countStmt = db.prepare(`
      SELECT
        COUNT(*) as total_players,
        SUM(CASE WHEN is_pitcher = 0 THEN 1 ELSE 0 END) as total_batters,
        SUM(CASE WHEN is_pitcher = 1 THEN 1 ELSE 0 END) as total_pitchers,
        SUM(CASE WHEN status = 'inRange' THEN 1 ELSE 0 END) as in_range_count,
        SUM(CASE WHEN status = 'under' THEN 1 ELSE 0 END) as under_count,
        SUM(CASE WHEN status = 'over' THEN 1 ELSE 0 END) as over_count,
        AVG(percentage_of_actual) as avg_percentage
      FROM player_usage
      WHERE series_id = ?
    `);
    countStmt.bind([seriesId]);

    if (!countStmt.step()) {
      countStmt.free();
      return createEmptySummary(seriesId);
    }

    const row = countStmt.getAsObject() as Record<string, any>;
    countStmt.free();

    // Get violation details
    const violations = await getViolationSummary(seriesId, db);

    return {
      seriesId,
      totalPlayers: row.total_players || 0,
      totalBatters: row.total_batters || 0,
      totalPitchers: row.total_pitchers || 0,
      inRangeCount: row.in_range_count || 0,
      underCount: row.under_count || 0,
      overCount: row.over_count || 0,
      avgPercentage: row.avg_percentage || 0,
      violations
    };
  } catch (error) {
    console.error('[UsageReporter] Failed to get usage summary:', error);
    throw new Error(`Failed to get usage summary: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get player usage rows for dashboard display
 *
 * Returns enhanced player usage records with player and team names,
 * suitable for display in a data table or grid.
 *
 * @param seriesId - Series ID to get player usage for
 * @param options - Query options (teamId, isPitcher, status, sortBy, orderDirection, limit)
 * @returns Promise<PlayerUsageRow[]> Array of player usage rows
 *
 * @throws Error if series not found or database query fails
 *
 * @example
 * ```ts
 * // Get all underused batters sorted by deviation
 * const rows = await getPlayerUsageRows(seriesId, {
 *   isPitcher: false,
 *   status: 'under',
 *   sortBy: 'deviation',
 *   orderDirection: 'DESC',
 *   limit: 20
 * });
 *
 * // Get all pitchers for a specific team
 * const pitchers = await getPlayerUsageRows(seriesId, {
 *   teamId: 'BAL',
 *   isPitcher: true
 * });
 * ```
 */
export async function getPlayerUsageRows(
  seriesId: string,
  options: PlayerUsageOptions = {}
): Promise<PlayerUsageRow[]> {
  try {
    const db = await getGameDatabase();

    const {
      teamId,
      isPitcher,
      status,
      sortBy = 'percentageOfActual',
      orderDirection = 'DESC',
      limit = null
    } = options;

    // Build query with optional filters
    let sql = `
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

    if (teamId !== undefined) {
      sql += ' AND pu.team_id = ?';
      params.push(teamId);
    }

    if (isPitcher !== undefined) {
      sql += ' AND pu.is_pitcher = ?';
      params.push(isPitcher ? 1 : 0);
    }

    if (status !== undefined) {
      sql += ' AND pu.status = ?';
      params.push(status);
    }

    // Map sort options to columns
    const columnMap: Record<string, string> = {
      percentageOfActual: 'pu.percentage_of_actual',
      deviation: 'ABS(pu.percentage_of_actual - 1.0)',
      replayCurrentTotal: 'pu.replay_current_total',
      actualSeasonTotal: 'pu.actual_season_total',
      playerName: 'p.name'
    };

    sql += ` ORDER BY ${columnMap[sortBy]} ${orderDirection}`;

    if (limit) {
      sql += ` LIMIT ${limit}`;
    }

    const stmt = db.prepare(sql);
    stmt.bind(params);

    const rows: PlayerUsageRow[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, any>;
      rows.push(mapToPlayerUsageRow(row));
    }

    stmt.free();
    return rows;
  } catch (error) {
    console.error('[UsageReporter] Failed to get player usage rows:', error);
    throw new Error(`Failed to get player usage rows: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get team usage breakdown for compliance monitoring
 *
 * Aggregates usage statistics by team, including counts of
 * players in each compliance category and average usage percentages.
 *
 * @param seriesId - Series ID to get team breakdown for
 * @returns Promise<TeamUsageBreakdown[]> Array of team usage breakdowns
 *
 * @throws Error if series not found or database query fails
 *
 * @example
 * ```ts
 * const teams = await getTeamUsageBreakdown(seriesId);
 * for (const team of teams) {
 *   console.log(`${team.teamName}: ${team.inRangeCount}/${team.totalPlayers} in range`);
 *   if (team.violations.length > 0) {
 *     console.log(`  Violations: ${team.violations.length} players outside 75-125% range`);
 *   }
 * }
 * ```
 */
export async function getTeamUsageBreakdown(seriesId: string): Promise<TeamUsageBreakdown[]> {
  try {
    const db = await getGameDatabase();

    // Get team-level aggregates
    const teamStmt = db.prepare(`
      SELECT
        pu.team_id,
        t.name as team_name,
        st.season_year,
        st.league,
        st.division,
        COUNT(*) as total_players,
        SUM(CASE WHEN pu.is_pitcher = 0 THEN 1 ELSE 0 END) as batters_count,
        SUM(CASE WHEN pu.is_pitcher = 1 THEN 1 ELSE 0 END) as pitchers_count,
        SUM(CASE WHEN pu.status = 'inRange' THEN 1 ELSE 0 END) as in_range_count,
        SUM(CASE WHEN pu.status = 'under' THEN 1 ELSE 0 END) as under_count,
        SUM(CASE WHEN pu.status = 'over' THEN 1 ELSE 0 END) as over_count,
        AVG(CASE WHEN pu.is_pitcher = 0 THEN pu.percentage_of_actual ELSE NULL END) as avg_batter_percentage,
        AVG(CASE WHEN pu.is_pitcher = 1 THEN pu.percentage_of_actual ELSE NULL END) as avg_pitcher_percentage
      FROM player_usage pu
      LEFT JOIN teams t ON pu.team_id = t.id
      LEFT JOIN series_teams st ON pu.series_id = st.series_id AND pu.team_id = st.team_id
      WHERE pu.series_id = ?
      GROUP BY pu.team_id, t.name, st.season_year, st.league, st.division
      ORDER BY t.name
    `);
    teamStmt.bind([seriesId]);

    const teams: TeamUsageBreakdown[] = [];
    while (teamStmt.step()) {
      const row = teamStmt.getAsObject() as Record<string, any>;

      // Get violations for this team (players outside 75-125% range)
      const violations = await getPlayerUsageRows(seriesId, {
        teamId: row.team_id,
        status: 'under'
      });
      const overViolations = await getPlayerUsageRows(seriesId, {
        teamId: row.team_id,
        status: 'over'
      });

      teams.push({
        teamId: row.team_id,
        teamName: row.team_name,
        seasonYear: row.season_year,
        league: row.league,
        division: row.division,
        totalPlayers: row.total_players,
        battersCount: row.batters_count,
        pitchersCount: row.pitchers_count,
        inRangeCount: row.in_range_count,
        underCount: row.under_count,
        overCount: row.over_count,
        avgBatterPercentage: row.avg_batter_percentage || 0,
        avgPitcherPercentage: row.avg_pitcher_percentage || 0,
        violations: [...violations, ...overViolations]
      });
    }

    teamStmt.free();
    return teams;
  } catch (error) {
    console.error('[UsageReporter] Failed to get team usage breakdown:', error);
    throw new Error(`Failed to get team usage breakdown: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Create an empty usage summary for series with no usage data
 */
function createEmptySummary(seriesId: string): UsageSummary {
  return {
    seriesId,
    totalPlayers: 0,
    totalBatters: 0,
    totalPitchers: 0,
    inRangeCount: 0,
    underCount: 0,
    overCount: 0,
    avgPercentage: 0,
    violations: {
      battersUnder: 0,
      battersOver: 0,
      pitchersUnder: 0,
      pitchersOver: 0,
      mostUnderused: null,
      mostOverused: null
    }
  };
}

/**
 * Get violation summary for a series
 */
async function getViolationSummary(
  seriesId: string,
  db: Database
): Promise<UsageViolationSummary> {
  // Count violations by category
  const countStmt = db.prepare(`
    SELECT
      SUM(CASE WHEN is_pitcher = 0 AND status = 'under' THEN 1 ELSE 0 END) as batters_under,
      SUM(CASE WHEN is_pitcher = 0 AND status = 'over' THEN 1 ELSE 0 END) as batters_over,
      SUM(CASE WHEN is_pitcher = 1 AND status = 'under' THEN 1 ELSE 0 END) as pitchers_under,
      SUM(CASE WHEN is_pitcher = 1 AND status = 'over' THEN 1 ELSE 0 END) as pitchers_over
    FROM player_usage
    WHERE series_id = ?
  `);
  countStmt.bind([seriesId]);

  let battersUnder = 0;
  let battersOver = 0;
  let pitchersUnder = 0;
  let pitchersOver = 0;

  if (countStmt.step()) {
    const row = countStmt.getAsObject() as Record<string, any>;
    battersUnder = row.batters_under || 0;
    battersOver = row.batters_over || 0;
    pitchersUnder = row.pitchers_under || 0;
    pitchersOver = row.pitchers_over || 0;
  }
  countStmt.free();

  // Get most underused player
  const underStmt = db.prepare(`
    SELECT
      pu.*,
      p.name as player_name,
      t.name as team_name
    FROM player_usage pu
    LEFT JOIN players p ON pu.player_id = p.id
    LEFT JOIN teams t ON pu.team_id = t.id
    WHERE pu.series_id = ? AND pu.status = 'under'
    ORDER BY pu.percentage_of_actual ASC
    LIMIT 1
  `);
  underStmt.bind([seriesId]);

  let mostUnderused: PlayerUsageRow | null = null;
  if (underStmt.step()) {
    const row = underStmt.getAsObject() as Record<string, any>;
    mostUnderused = mapToPlayerUsageRow(row);
  }
  underStmt.free();

  // Get most overused player
  const overStmt = db.prepare(`
    SELECT
      pu.*,
      p.name as player_name,
      t.name as team_name
    FROM player_usage pu
    LEFT JOIN players p ON pu.player_id = p.id
    LEFT JOIN teams t ON pu.team_id = t.id
    WHERE pu.series_id = ? AND pu.status = 'over'
    ORDER BY pu.percentage_of_actual DESC
    LIMIT 1
  `);
  overStmt.bind([seriesId]);

  let mostOverused: PlayerUsageRow | null = null;
  if (overStmt.step()) {
    const row = overStmt.getAsObject() as Record<string, any>;
    mostOverused = mapToPlayerUsageRow(row);
  }
  overStmt.free();

  return {
    battersUnder,
    battersOver,
    pitchersUnder,
    pitchersOver,
    mostUnderused,
    mostOverused
  };
}

/**
 * Map a database row to a PlayerUsageRow
 */
function mapToPlayerUsageRow(row: Record<string, any>): PlayerUsageRow {
  const percentage = row.percentage_of_actual || 0;
  const deviation = Math.abs(percentage - 1.0);

  return {
    seriesId: row.series_id,
    playerId: row.player_id,
    playerName: row.player_name || null,
    teamId: row.team_id,
    teamName: row.team_name || null,
    isPitcher: row.is_pitcher === 1,
    actualSeasonTotal: row.actual_season_total,
    gamesPlayedActual: row.games_played_actual,
    replayCurrentTotal: row.replay_current_total,
    replayGamesPlayed: row.replay_games_played,
    percentageOfActual: percentage,
    status: row.status,
    deviation
  };
}
