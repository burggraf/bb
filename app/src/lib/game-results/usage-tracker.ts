/**
 * UsageTracker class for tracking player usage during season replays
 *
 * Manages the player_usage table to track how much players are being used
 * compared to their actual season statistics. Helps maintain realistic
 * player usage during automated season replays.
 */

import { getGameDatabase } from './database.js';
import type { Database } from 'sql.js';
import type { PlayerUsageRecord } from './types.js';

export interface UsageViolation {
  playerId: string;
  playerName: string;
  isPitcher: boolean;
  percentageOfActual: number;
  status: 'under' | 'over';
  deviation: number;
}

export interface GameUsageStats {
  batterPa: Map<string, number>;
  pitcherIp: Map<string, number>;
}

const MIN_BATTER_THRESHOLD = 20;
const MIN_PITCHER_THRESHOLD = 5;

export class UsageTracker {
  private seriesId: string;
  private seasonYear: number;

  constructor(seriesId: string, seasonYear: number) {
    this.seriesId = seriesId;
    this.seasonYear = seasonYear;
  }

  /**
   * Seed usage targets from season data
   *
   * Initializes the player_usage table with target values based on actual
   * season statistics. Only includes players meeting minimum thresholds.
   *
   * @param batters - Record of batter id to stats (pa, teamId, games)
   * @param pitchers - Record of pitcher id to stats (inningsPitched, teamId, games)
   */
  async seedUsageTargets(
    batters: Record<string, any>,
    pitchers: Record<string, any>
  ): Promise<void> {
    const db = await getGameDatabase();

    // Clear existing data for this series
    const deleteResult = db.run('DELETE FROM player_usage WHERE series_id = ?', [this.seriesId]);

    // Get the season length for this year
    const seasonLength = this.getSeasonLength();

    // Insert batters meeting minimum threshold
    // Use INSERT OR REPLACE to handle players who are both batters and pitchers
    const insertBatter = db.prepare(`
      INSERT OR REPLACE INTO player_usage (
        series_id, player_id, team_id, is_pitcher,
        actual_season_total, games_played_actual,
        percentage_of_actual, status
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 'inRange')
    `);

    for (const [id, batter] of Object.entries(batters)) {
      if (batter.pa >= MIN_BATTER_THRESHOLD) {
        // games_played_actual stores player's actual games for display purposes
        // Proration uses team season length, not player games
        insertBatter.run([
          this.seriesId,
          id,
          batter.teamId,
          0,  // is_pitcher = false
          batter.pa,
          Math.max(1, batter.games || 1)  // Player's actual games played (for display)
        ]);
      }
    }

    // Insert pitchers meeting minimum threshold
    // Use INSERT OR REPLACE to handle players who are both batters and pitchers
    const insertPitcher = db.prepare(`
      INSERT OR REPLACE INTO player_usage (
        series_id, player_id, team_id, is_pitcher,
        actual_season_total, games_played_actual,
        percentage_of_actual, status
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 'inRange')
    `);

    for (const [id, pitcher] of Object.entries(pitchers)) {
      const ip = pitcher.inningsPitched || 0;
      if (ip >= MIN_PITCHER_THRESHOLD) {
        // The `games` field from Lahman IS the actual games pitched
        // No calculation needed - use it directly
        const actualGamesPlayed = pitcher.games || 0;

        insertPitcher.run([
          this.seriesId,
          id,
          pitcher.teamId,
          1,  // is_pitcher = true
          ip * 3,  // Convert IP to outs
          Math.max(1, actualGamesPlayed)  // Use actual games played from database
        ]);
      }
    }

    insertBatter.free();
    insertPitcher.free();
  }

  /**
   * Get the season length for a given year
   * Returns 154 for pre-1961, 162 for 1962+
   */
  private getSeasonLength(): number {
    if (this.seasonYear < 1962) {
      return 154;
    }
    return 162;
  }

  /**
   * Update usage stats after a game
   *
   * Increments replay totals and games played, recalculates percentage
   * based on team season progress, and updates status based on threshold violations.
   *
   * Expected = actual * (teamGamesPlayed / seasonLength)
   * All players are compared against the same timeline (team season progress)
   * regardless of how many games they actually appeared in.
   *
   * Example: A backup with 100 PA in 50 actual games, after 50 replay games with 80 PA:
   * - Expected = 100 * (50 / 162) = 31 PA
   * - Percentage = 80 / 31 = 258% (overused)
   *
   * This correctly identifies that the backup is being used as a full-time player.
   *
   * @param gameStats - Usage stats from the game (PA per batter, outs per pitcher)
   */
  async updateGameUsage(gameStats: GameUsageStats): Promise<void> {
    const db = await getGameDatabase();
    const seasonLength = this.getSeasonLength();

    // Get all player IDs that need updates
    const allPlayerIds = [
      ...Array.from(gameStats.batterPa.keys()),
      ...Array.from(gameStats.pitcherIp.keys())
    ];

    if (allPlayerIds.length === 0) {
      return; // Nothing to update
    }

    // Build a map of team_id -> games played by querying the games table
    const teamGamesStmt = db.prepare(`
      SELECT
        st.team_id,
        COUNT(*) as games_played
      FROM series_teams st
      JOIN games g ON g.series_id = st.series_id
        AND ((g.away_team_id = st.team_id AND g.away_season_year = st.season_year)
             OR (g.home_team_id = st.team_id AND g.home_season_year = st.season_year))
      WHERE st.series_id = ?
      GROUP BY st.team_id
    `);
    teamGamesStmt.bind([this.seriesId]);

    const teamGamesMap = new Map<string, number>();
    while (teamGamesStmt.step()) {
      const row = teamGamesStmt.getAsObject() as Record<string, any>;
      teamGamesMap.set(row.team_id, row.games_played);
    }
    teamGamesStmt.free();

    // Build a map of player_id -> team_id for all affected players in one query
    const playerTeamMap = new Map<string, string>();
    const placeholders = allPlayerIds.map(() => '?').join(',');
    const playerTeamsStmt = db.prepare(`
      SELECT player_id, team_id
      FROM player_usage
      WHERE series_id = ? AND player_id IN (${placeholders})
    `);
    playerTeamsStmt.bind([this.seriesId, ...allPlayerIds]);

    while (playerTeamsStmt.step()) {
      const row = playerTeamsStmt.getAsObject() as Record<string, any>;
      playerTeamMap.set(row.player_id, row.team_id);
    }
    playerTeamsStmt.free();

    // Helper to get team games played for a player
    const getTeamGamesPlayed = (playerId: string): number => {
      const teamId = playerTeamMap.get(playerId);
      // Use at least 1 game to avoid division by zero
      // This means early-season games will show higher percentages, which is fine
      // as it stabilizes quickly after a few games
      return Math.max(1, teamId ? (teamGamesMap.get(teamId) || 0) : 0);
    };

    // For batters, expected = actual * (teamGamesPlayed / seasonLength)
    // This tracks whether players are on pace based on TEAM season progress, not player games
    // All players are compared against the same timeline regardless of their actual games played
    const updateBatter = db.prepare(`
      UPDATE player_usage
      SET replay_current_total = replay_current_total + ?,
          replay_games_played = replay_games_played + 1,
          percentage_of_actual =
            CAST(replay_current_total + ? AS REAL) /
            NULLIF(actual_season_total * CAST(? AS REAL) / ?, 0),
          status = CASE
            WHEN CAST(replay_current_total + ? AS REAL) / NULLIF(actual_season_total * CAST(? AS REAL) / ?, 0) < 0.75 THEN 'under'
            WHEN CAST(replay_current_total + ? AS REAL) / NULLIF(actual_season_total * CAST(? AS REAL) / ?, 0) > 1.25 THEN 'over'
            ELSE 'inRange'
          END
      WHERE series_id = ? AND player_id = ?
    `);

    gameStats.batterPa.forEach((pa, playerId) => {
      const teamGames = getTeamGamesPlayed(playerId);
      // Parameters: pa, pa, teamGames, seasonLength (for formula: actual * teamGames / seasonLength)
      updateBatter.run([pa, pa, teamGames, seasonLength, pa, teamGames, seasonLength, pa, teamGames, seasonLength, this.seriesId, playerId]);

      // Debug: log first few players to verify calculation
      const stmt = db.prepare('SELECT actual_season_total, replay_current_total FROM player_usage WHERE series_id = ? AND player_id = ?');
      stmt.bind([this.seriesId, playerId]);
      if (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, any>;
        const actual = row.actual_season_total;
        const replay = row.replay_current_total;
        const expected = actual * teamGames / seasonLength;
        const pct = expected > 0 ? replay / expected : 0;

        // Log all for now to debug
        console.log(`[UsageTracker] ${playerId.slice(0, 15)}: PA=${pa}, actual=${actual}, replay=${replay}, teamGames=${teamGames}, expected=${expected.toFixed(1)}, pct=${(pct * 100).toFixed(0)}%`);
      }
      stmt.free();
    });

    const updatePitcher = db.prepare(`
      UPDATE player_usage
      SET replay_current_total = replay_current_total + ?,
          replay_games_played = replay_games_played + 1,
          percentage_of_actual =
            CAST(replay_current_total + ? AS REAL) /
            NULLIF(?, 0),
          status = CASE
            WHEN CAST(replay_current_total + ? AS REAL) / NULLIF(?, 0) < 0.75 THEN 'under'
            WHEN CAST(replay_current_total + ? AS REAL) / NULLIF(?, 0) > 1.25 THEN 'over'
            ELSE 'inRange'
          END
      WHERE series_id = ? AND player_id = ?
    `);

    gameStats.pitcherIp.forEach((ip, playerId) => {
      const teamGames = getTeamGamesPlayed(playerId);

      // CRITICAL FIX: For pitchers, expected is capped at actual season total
      // A pitcher with 47 IP actual appeared in ~5 games, not all 162 games
      // We should NOT extrapolate their usage over the full season
      const stmt = db.prepare('SELECT actual_season_total FROM player_usage WHERE series_id = ? AND player_id = ?');
      stmt.bind([this.seriesId, playerId]);
      let actualTotal = 0;
      if (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, any>;
        actualTotal = row.actual_season_total;
      }
      stmt.free();

      // Expected is the MINIMUM of:
      // 1. actual * (teamGames / seasonLength) - extrapolated value
      // 2. actualTotal - the actual season total (hard cap)
      const expectedExtrapolated = actualTotal * teamGames / seasonLength;
      const expected = Math.min(expectedExtrapolated, actualTotal);

      const replay = gameStats.pitcherIp.get(playerId) || 0;
      const newReplay = replay + ip;
      const pct = expected > 0 ? newReplay / expected : 0;

      // Debug log for extreme cases
      if (pct > 2.0 || pct < 0.1) {
        console.log(`[UsageTracker] ${playerId.slice(0, 15)}: IP=${ip}, actual=${actualTotal}, newReplay=${newReplay}, teamGames=${teamGames}, expected=${expected.toFixed(1)}, pct=${(pct * 100).toFixed(0)}%`);
      }

      // Parameters: ip (SET), ip (percentage num), expected (percentage den), ip (status1 num), expected (status1 den), ip (status2 num), expected (status2 den), seriesId, playerId
      updatePitcher.run([ip, ip, expected, ip, expected, ip, expected, this.seriesId, playerId]);
    });

    updateBatter.free();
    updatePitcher.free();
  }

  /**
   * Get usage record for a specific player
   *
   * @param playerId - Player ID to look up
   * @returns Player usage record or null if not found
   */
  async getPlayerUsage(playerId: string): Promise<PlayerUsageRecord | null> {
    const db = await getGameDatabase();

    const stmt = db.prepare(`
      SELECT * FROM player_usage
      WHERE series_id = ? AND player_id = ?
    `);
    stmt.bind([this.seriesId, playerId]);
    let row: any = null;
    if (stmt.step()) {
      row = stmt.getAsObject();
    }
    stmt.free();

    if (!row) return null;
    return this.rowToRecord(row);
  }

  /**
   * Get all usage records for a team
   *
   * @param teamId - Team ID to filter by
   * @returns Array of player usage records ordered by percentage of actual
   */
  async getTeamUsage(teamId: string): Promise<PlayerUsageRecord[]> {
    const db = await getGameDatabase();

    const stmt = db.prepare(`
      SELECT * FROM player_usage
      WHERE series_id = ? AND team_id = ?
      ORDER BY percentage_of_actual DESC
    `);
    stmt.bind([this.seriesId, teamId]);
    const rows: any[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();

    return rows.map(r => this.rowToRecord(r));
  }

  /**
   * Check for threshold violations
   *
   * Returns all players who are significantly under-used (< 75%) or
   * over-used (> 125%) compared to their actual season totals.
   *
   * @returns Array of usage violations
   */
  async checkThresholds(): Promise<UsageViolation[]> {
    const db = await getGameDatabase();

    const violations: UsageViolation[] = [];

    // Check under-used players (< 75%)
    const underStmt = db.prepare(`
      SELECT pu.*
      FROM player_usage pu
      WHERE pu.series_id = ? AND pu.status = 'under'
    `);
    underStmt.bind([this.seriesId]);
    const underRows: any[] = [];
    while (underStmt.step()) {
      underRows.push(underStmt.getAsObject());
    }
    underStmt.free();

    for (const row of underRows) {
      violations.push({
        playerId: row.player_id,
        playerName: `Player ${row.player_id}`, // Player name not available in game-results DB
        isPitcher: row.is_pitcher === 1,
        percentageOfActual: row.percentage_of_actual,
        status: 'under',
        deviation: 100 - row.percentage_of_actual * 100
      });
    }

    // Check over-used players (> 125%)
    const overStmt = db.prepare(`
      SELECT pu.*
      FROM player_usage pu
      WHERE pu.series_id = ? AND pu.status = 'over'
    `);
    overStmt.bind([this.seriesId]);
    const overRows: any[] = [];
    while (overStmt.step()) {
      overRows.push(overStmt.getAsObject());
    }
    overStmt.free();

    for (const row of overRows) {
      violations.push({
        playerId: row.player_id,
        playerName: `Player ${row.player_id}`, // Player name not available in game-results DB
        isPitcher: row.is_pitcher === 1,
        percentageOfActual: row.percentage_of_actual,
        status: 'over',
        deviation: row.percentage_of_actual * 100 - 100
      });
    }

    return violations;
  }

  /**
   * Convert a database row to a PlayerUsageRecord
   */
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

  /**
   * Get usage data for a team in the format needed by UsageContext
   * Returns a Map of player ID to usage percentage (0.0-1.0)
   *
   * IMPORTANT: Returns percentage as replay PA / actual PA.
   * This is needed by the lineup builder to correctly filter overused players.
   * Calculation: replay / actual (direct ratio, not season-adjusted)
   *
   * @param teamId - Team ID to get usage data for
   * @returns Map of player ID to usage percentage (1.0 = exactly actual usage)
   */
  async getTeamUsageForContext(teamId: string): Promise<Map<string, number>> {
    const db = await getGameDatabase();

    // Get player usage data
    const stmt = db.prepare(`
      SELECT player_id, actual_season_total, replay_current_total
      FROM player_usage
      WHERE series_id = ? AND team_id = ?
    `);
    stmt.bind([this.seriesId, teamId]);

    const usageMap = new Map<string, number>();
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, any>;
      const actualTotal = row.actual_season_total;
      const replayTotal = row.replay_current_total;

      // Calculate percentage as replay PA / actual PA
      // This allows the 105% threshold to work correctly
      const percentage = actualTotal > 0 ? replayTotal / actualTotal : 0;

      usageMap.set(row.player_id, percentage);

      // Debug: log overused players (>125%)
      if (percentage > 1.25) {
        console.log(`[getTeamUsageForContext] ${teamId}: player ${row.player_id.slice(0, 12)}... has ${(percentage * 100).toFixed(0)}% usage (replay=${replayTotal}, actual=${actualTotal})`);
      }
    }
    stmt.free();

    console.log(`[getTeamUsageForContext] ${teamId}: returning ${usageMap.size} players`);
    return usageMap;
  }

  /**
   * Get usage data for all teams in a series
   * Useful for season replay engine to build usage contexts
   *
   * IMPORTANT: Returns percentage as replay PA / actual PA.
   * This is needed by the lineup builder to correctly filter overused players.
   * Calculation: replay / actual (direct ratio, not season-adjusted)
   *
   * @returns Map of team ID to player usage map (1.0 = exactly actual usage)
   */
  async getAllTeamsUsageForContext(): Promise<Map<string, Map<string, number>>> {
    const db = await getGameDatabase();

    // Get all player usage data and calculate percentages
    const stmt = db.prepare(`
      SELECT team_id, player_id, actual_season_total, replay_current_total
      FROM player_usage
      WHERE series_id = ?
    `);
    stmt.bind([this.seriesId]);

    const teamUsageMap = new Map<string, Map<string, number>>();

    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, any>;
      const teamId = row.team_id;
      const actualTotal = row.actual_season_total;
      const replayTotal = row.replay_current_total;

      if (!teamUsageMap.has(teamId)) {
        teamUsageMap.set(teamId, new Map<string, number>());
      }

      const playerMap = teamUsageMap.get(teamId)!;

      // Calculate percentage as replay PA / actual PA
      // This allows the 105% threshold to work correctly
      const percentage = actualTotal > 0 ? replayTotal / actualTotal : 0;

      playerMap.set(row.player_id, percentage);
    }
    stmt.free();

    return teamUsageMap;
  }
}
