import { getGameDatabase } from './database.js';
import type {
  SavedGame,
  GameSaveInput,
  GameEventInput,
  InningLineInput,
  Outcome
} from './types.js';

/**
 * Generate a UUID v4
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Calculate earned vs unearned runs for each event
 *
 * Rules:
 * - A runner who reaches on error -> any run they score is unearned
 * - Runs that score after an error with 0 outs are unearned (wouldn't have happened without error)
 *   After the first non-error play following an error with 0 outs, runs become earned again
 * - All other runs are earned
 *
 * @param events - Game events with scorerIds
 * @returns Events with earnedRuns/unearnedRuns populated and earnedScorerIds/unearnedScorerIds arrays
 */
export function calculateEarnedRuns(
  events: GameEventInput[]
): Array<GameEventInput & { earnedScorerIds: string[]; unearnedScorerIds: string[] }> {
  // Track runners who reached on error
  const unearnedRunners = new Set<string>();
  // Track if an error occurred with 0 outs in the inning (makes subsequent runs unearned)
  const errorWithZeroOuts = new Map<string, boolean>(); // inning_key -> boolean
  let lastErrorWithZeroOutsKey: string | null = null;

  const result: Array<GameEventInput & { earnedScorerIds: string[]; unearnedScorerIds: string[] }> = [];

  for (const event of events) {
    const inningKey = `${event.inning}-${event.isTopInning}`;

    // Check for error on this play
    if (event.outcome === 'reachedOnError') {
      // Mark the batter as an unearned runner
      if (event.batterId) {
        unearnedRunners.add(event.batterId);
      }
      // If error with 0 outs, mark this inning
      if (event.outs === 0) {
        errorWithZeroOuts.set(inningKey, true);
        lastErrorWithZeroOutsKey = inningKey;
      }
    }

    // Calculate earned/unearned for this event and track which specific scorers are earned/unearned
    let earnedRuns = 0;
    let unearnedRuns = 0;
    const earnedScorerIds: string[] = [];
    const unearnedScorerIds: string[] = [];

    for (const scorerId of event.scorerIds) {
      if (unearnedRunners.has(scorerId)) {
        // Runner reached on error - their run is unearned
        unearnedRuns++;
        unearnedScorerIds.push(scorerId);
      } else if (
        // If this event itself is not an error, but there was an error with 0 outs
        // in this half-inning before this play, runs are unearned (unless it's the current batter)
        lastErrorWithZeroOutsKey === inningKey &&
        event.outcome !== 'reachedOnError' &&
        scorerId !== event.batterId
      ) {
        // First non-error play after error with 0 outs - other runners' runs are unearned
        unearnedRuns++;
        unearnedScorerIds.push(scorerId);
      } else {
        earnedRuns++;
        earnedScorerIds.push(scorerId);
      }
    }

    result.push({
      ...event,
      earnedRuns,
      unearnedRuns,
      earnedScorerIds,
      unearnedScorerIds
    });

    // Clear the zero-outs error flag after first non-error play
    if (lastErrorWithZeroOutsKey === inningKey && event.outcome !== 'reachedOnError') {
      lastErrorWithZeroOutsKey = null;
    }
  }

  return result;
}

/**
 * Determine pitching decisions from game outcome
 *
 * @param gameData - Game data with scores and starters
 * @returns Pitching decisions (winner, loser, save)
 */
export function determinePitchingDecisions(gameData: {
  awayScore: number;
  homeScore: number;
  awayStarterId: string | null;
  homeStarterId: string | null;
}): {
  winningPitcherId: string | null;
  losingPitcherId: string | null;
  savePitcherId: string | null;
} {
  const { awayScore, homeScore, awayStarterId, homeStarterId } = gameData;

  if (awayScore > homeScore) {
    // Away team wins
    return {
      winningPitcherId: awayStarterId,
      losingPitcherId: homeStarterId,
      savePitcherId: null // TODO: Track last pitcher for winning team
    };
  } else {
    // Home team wins (or tie - treat as home wins for now)
    return {
      winningPitcherId: homeStarterId,
      losingPitcherId: awayStarterId,
      savePitcherId: null
    };
  }
}

/**
 * Save a completed game to the database
 *
 * @param input - Game data to save
 * @returns Promise<string> Game ID
 */
export async function saveGame(input: GameSaveInput): Promise<string> {
  const db = await getGameDatabase();

  try {
    // Calculate earned runs
    const eventsWithEarned = calculateEarnedRuns(input.events);

    // Determine pitching decisions if not provided
    const decisions = input.winningPitcherId
      ? {
          winningPitcherId: input.winningPitcherId,
          losingPitcherId: input.losingPitcherId,
          savePitcherId: input.savePitcherId
        }
      : determinePitchingDecisions(input);

    const gameId = generateUUID();

    // Begin transaction
    db.run('BEGIN TRANSACTION');

    // Insert game record
    db.run(
      `INSERT INTO games (
        id, series_id, game_number,
        away_team_id, away_season_year, home_team_id, home_season_year,
        away_score, home_score, innings,
        away_starter_id, home_starter_id,
        winning_pitcher_id, losing_pitcher_id, save_pitcher_id,
        scheduled_date, played_at, duration_ms, use_dh
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        gameId,
        input.seriesId,
        input.gameNumber,
        input.awayTeamId,
        input.awaySeasonYear,
        input.homeTeamId,
        input.homeSeasonYear,
        input.awayScore,
        input.homeScore,
        input.innings,
        input.awayStarterId,
        input.homeStarterId,
        decisions.winningPitcherId,
        decisions.losingPitcherId,
        decisions.savePitcherId,
        input.scheduledDate,
        input.playedAt,
        input.durationMs,
        input.useDh ? 1 : 0
      ]
    );

    // Insert game events
    for (const event of eventsWithEarned) {
      db.run(
        `INSERT INTO game_events (
          game_id, sequence, inning, is_top_inning, outs, event_type,
          outcome, batter_id, batter_name, pitcher_id, pitcher_name,
          runs_scored, earned_runs, unearned_runs,
          runner_1b_before, runner_2b_before, runner_3b_before,
          runner_1b_after, runner_2b_after, runner_3b_after,
          description, lineup_json, substituted_player, position, is_summary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          gameId,
          event.sequence,
          event.inning,
          event.isTopInning ? 1 : 0,
          event.outs,
          event.eventType,
          event.outcome,
          event.batterId,
          event.batterName,
          event.pitcherId,
          event.pitcherName,
          event.runsScored,
          event.earnedRuns,
          event.unearnedRuns,
          event.runner1bBefore,
          event.runner2bBefore,
          event.runner3bBefore,
          event.runner1bAfter,
          event.runner2bAfter,
          event.runner3bAfter,
          event.description,
          event.lineupJson,
          event.substitutedPlayer,
          event.position,
          event.isSummary ? 1 : 0
        ]
      );

      // Get the inserted event ID
      const eventId = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0] as number;

      // Insert runs_scored records using the tracked earnedScorerIds/unearnedScorerIds
      for (const earnedScorerId of event.earnedScorerIds) {
        db.run('INSERT INTO runs_scored (event_id, player_id, is_earned) VALUES (?, ?, ?)', [
          eventId,
          earnedScorerId,
          1 // earned
        ]);
      }
      for (const unearnedScorerId of event.unearnedScorerIds) {
        db.run('INSERT INTO runs_scored (event_id, player_id, is_earned) VALUES (?, ?, ?)', [
          eventId,
          unearnedScorerId,
          0 // unearned
        ]);
      }
    }

    // Insert inning lines
    for (const line of input.inningLines) {
      db.run(
        `INSERT INTO inning_lines (game_id, team_id, inning, runs, hits, errors)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [gameId, line.teamId, line.inning, line.runs, line.hits, line.errors]
      );
    }

    // Commit transaction
    db.run('COMMIT');

    return gameId;
  } catch (error) {
    // Rollback transaction on error
    try {
      db.run('ROLLBACK');
    } catch (rollbackError) {
      console.error('[Games] Failed to rollback transaction:', rollbackError);
    }
    console.error('[Games] Failed to save game:', error);
    throw new Error(`Failed to save game: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get a game by id
 *
 * @param gameId - Game UUID
 * @returns Promise<SavedGame | null> Game or null if not found
 */
export async function getGame(gameId: string): Promise<SavedGame | null> {
  const db = await getGameDatabase();
  const stmt = db.prepare('SELECT * FROM games WHERE id = ?');

  try {
    stmt.bind([gameId]);

    if (!stmt.step()) {
      return null;
    }

    const row = stmt.getAsObject() as any;

    return {
      id: row.id,
      seriesId: row.series_id,
      gameNumber: row.game_number,
      awayTeamId: row.away_team_id,
      awaySeasonYear: row.away_season_year,
      homeTeamId: row.home_team_id,
      homeSeasonYear: row.home_season_year,
      awayScore: row.away_score,
      homeScore: row.home_score,
      innings: row.innings,
      awayStarterId: row.away_starter_id,
      homeStarterId: row.home_starter_id,
      winningPitcherId: row.winning_pitcher_id,
      losingPitcherId: row.losing_pitcher_id,
      savePitcherId: row.save_pitcher_id,
      scheduledDate: row.scheduled_date,
      playedAt: row.played_at,
      durationMs: row.duration_ms,
      useDh: row.use_dh === 1
    };
  } catch (error) {
    console.error('[Games] Failed to get game:', error);
    throw new Error(`Failed to get game: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    stmt.free();
  }
}

/**
 * Get all games in a series
 *
 * @param seriesId - Series UUID
 * @returns Promise<SavedGame[]> Array of games ordered by game_number
 */
export async function getGamesBySeries(seriesId: string): Promise<SavedGame[]> {
  const db = await getGameDatabase();
  const stmt = db.prepare('SELECT * FROM games WHERE series_id = ? ORDER BY game_number');

  try {
    stmt.bind([seriesId]);

    const games: SavedGame[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as any;
      games.push({
        id: row.id,
        seriesId: row.series_id,
        gameNumber: row.game_number,
        awayTeamId: row.away_team_id,
        awaySeasonYear: row.away_season_year,
        homeTeamId: row.home_team_id,
        homeSeasonYear: row.home_season_year,
        awayScore: row.away_score,
        homeScore: row.home_score,
        innings: row.innings,
        awayStarterId: row.away_starter_id,
        homeStarterId: row.home_starter_id,
        winningPitcherId: row.winning_pitcher_id,
        losingPitcherId: row.losing_pitcher_id,
        savePitcherId: row.save_pitcher_id,
        scheduledDate: row.scheduled_date,
        playedAt: row.played_at,
        durationMs: row.duration_ms,
        useDh: row.use_dh === 1
      });
    }

    return games;
  } catch (error) {
    console.error('[Games] Failed to get games by series:', error);
    throw new Error(
      `Failed to get games by series: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    stmt.free();
  }
}
