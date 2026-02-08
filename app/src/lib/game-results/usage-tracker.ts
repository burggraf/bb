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

  constructor(seriesId: string) {
    this.seriesId = seriesId;
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
    db.run('DELETE FROM player_usage WHERE series_id = ?', [this.seriesId]);

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
        insertBatter.run([
          this.seriesId,
          id,
          batter.teamId,
          0,  // is_pitcher = false
          batter.pa,
          batter.games || 162
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
        insertPitcher.run([
          this.seriesId,
          id,
          pitcher.teamId,
          1,  // is_pitcher = true
          ip * 3,  // Convert IP to outs
          pitcher.games || 162
        ]);
      }
    }

    insertBatter.free();
    insertPitcher.free();
  }

  /**
   * Update usage stats after a game
   *
   * Increments replay totals and games played, recalculates percentage,
   * and updates status based on threshold violations.
   *
   * @param gameStats - Usage stats from the game (PA per batter, outs per pitcher)
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
      updateBatter.run([pa, pa, pa, pa, this.seriesId, playerId]);
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
      updatePitcher.run([ip, ip, ip, ip, this.seriesId, playerId]);
    }

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
}
