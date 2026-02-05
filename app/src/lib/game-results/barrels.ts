/**
 * Barrels: Convert game engine output to database save format
 * Transforms GameState and PlayEvent[] into GameSaveInput for database storage
 */

import type {
  GameSaveInput,
  GameEventInput,
  InningLineInput,
  GameEventType
} from './types.js';
import type { GameState, PlayEvent, Outcome } from '../game/types.js';

/**
 * Convert game engine Outcome to database-compatible Outcome
 *
 * Note: Currently both use the same type, but this function provides
 * a layer of abstraction in case they diverge in the future
 *
 * @param outcome - Game engine outcome
 * @returns Database outcome
 */
function outcomeToDbOutcome(outcome: Outcome): Outcome {
  return outcome;
}

/**
 * Convert game engine eventType to database GameEventType
 *
 * @param eventType - Game engine event type
 * @returns Database event type
 */
function eventTypeToDbEventType(eventType?: string): GameEventType {
  if (!eventType) return 'plateAppearance';

  switch (eventType) {
    case 'startingLineup':
      return 'startingLineup';
    case 'pitchingChange':
      return 'pitchingChange';
    case 'pinchHit':
      return 'pinchHit';
    case 'defensiveSub':
      return 'defensiveSub';
    case 'lineupAdjustment':
      return 'lineupAdjustment';
    default:
      return 'plateAppearance';
  }
}

/**
 * Calculate inning lines from play events
 *
 * Aggregates runs, hits, and errors by inning and team for box score display
 *
 * @param plays - Play events from the game
 * @param awayTeamId - Away team ID
 * @param homeTeamId - Home team ID
 * @returns Array of inning line records
 *
 * @example
 * ```ts
 * const lines = calculateInningLines(gameState.plays, 'NYA', 'BOS');
 * // Returns: [
 * //   { gameId: 'uuid', teamId: 'NYA', inning: 1, runs: 2, hits: 3, errors: 0 },
 * //   { gameId: 'uuid', teamId: 'BOS', inning: 1, runs: 0, hits: 1, errors: 0 },
 * //   ...
 * // ]
 * ```
 */
export function calculateInningLines(
  plays: PlayEvent[],
  awayTeamId: string,
  homeTeamId: string
): Omit<InningLineInput, 'gameId'>[] {
  const linesMap = new Map<string, { runs: number; hits: number; errors: number }>();

  // Initialize first 9 innings for both teams (expand if needed)
  for (let inning = 1; inning <= 9; inning++) {
    linesMap.set(`${awayTeamId}-${inning}`, { runs: 0, hits: 0, errors: 0 });
    linesMap.set(`${homeTeamId}-${inning}`, { runs: 0, hits: 0, errors: 0 });
  }

  for (const play of plays) {
    // Skip summary events and non-plate-appearance events
    if (play.isSummary || play.eventType !== 'plateAppearance') {
      continue;
    }

    const teamId = play.isTopInning ? awayTeamId : homeTeamId;
    const key = `${teamId}-${play.inning}`;
    const line = linesMap.get(key);

    if (!line) {
      // Create new line if inning > 9
      linesMap.set(key, { runs: play.runsScored, hits: 0, errors: 0 });
    } else {
      line.runs += play.runsScored;
    }

    // Count hits
    if (isHitOutcome(play.outcome)) {
      const currentLine = linesMap.get(key)!;
      currentLine.hits += 1;
    }

    // Count errors (reachedOnError counts as an error for the fielding team)
    // Note: This is a simplified count - in a full implementation, you'd track
    // errors separately per play
    if (play.outcome === 'reachedOnError') {
      const opponentKey = `${play.isTopInning ? homeTeamId : awayTeamId}-${play.inning}`;
      const opponentLine = linesMap.get(opponentKey);
      if (opponentLine) {
        opponentLine.errors += 1;
      }
    }
  }

  // Convert map to array
  const lines: Omit<InningLineInput, 'gameId'>[] = [];
  for (const [key, value] of linesMap.entries()) {
    const [teamId, inning] = key.split('-');
    lines.push({
      teamId,
      inning: parseInt(inning, 10),
      runs: value.runs,
      hits: value.hits,
      errors: value.errors
    });
  }

  // Sort by team then inning
  return lines.sort((a, b) => {
    if (a.teamId !== b.teamId) {
      return a.teamId.localeCompare(b.teamId);
    }
    return a.inning - b.inning;
  });
}

/**
 * Check if an outcome is a hit
 *
 * @param outcome - Play outcome
 * @returns True if outcome is a hit
 */
function isHitOutcome(outcome: Outcome): boolean {
  return ['single', 'double', 'triple', 'homeRun'].includes(outcome);
}

/**
 * Extract starting pitchers from game state
 *
 * @param state - Game state from engine
 * @returns Tuple of [awayStarterId, homeStarterId]
 *
 * @example
 * ```ts
 * const [awayStarter, homeStarter] = extractPitchingDecisions(gameState);
 * ```
 */
export function extractPitchingDecisions(
  state: GameState
): { awayStarterId: string | null; homeStarterId: string | null } {
  return {
    awayStarterId: state.awayLineup.pitcher || null,
    homeStarterId: state.homeLineup.pitcher || null
  };
}

/**
 * Calculate final score from play events
 *
 * @param plays - Play events from the game
 * @param awayTeamId - Away team ID (for identification)
 * @param homeTeamId - Home team ID (for identification)
 * @returns Tuple of [awayScore, homeScore]
 *
 * @example
 * ```ts
 * const [awayScore, homeScore] = calculateFinalScore(gameState.plays, 'NYA', 'BOS');
 * ```
 */
function calculateFinalScore(
  plays: PlayEvent[],
  awayTeamId: string,
  homeTeamId: string
): [number, number] {
  let awayScore = 0;
  let homeScore = 0;

  for (const play of plays) {
    if (play.isSummary) continue;

    if (play.isTopInning) {
      awayScore += play.runsScored;
    } else {
      homeScore += play.runsScored;
    }
  }

  return [awayScore, homeScore];
}

/**
 * Calculate number of innings played
 *
 * @param state - Game state from engine
 * @returns Number of innings (default 9, can be more for extra innings)
 *
 * @example
 * ```ts
 * const innings = calculateInnings(gameState);
 * // Returns: 9 for regulation, 10+ for extra innings
 * ```
 */
function calculateInnings(state: GameState): number {
  // If bottom of inning hasn't started yet (still top or just finished top),
  // don't count the current inning
  if (state.isTopInning) {
    // We're in the top of an inning, so previous inning is complete
    // But if it's the 1st inning, return 1 (game started)
    return state.inning;
  } else {
    // We're in the bottom of an inning
    // If home team hasn't batted yet, don't count this inning
    if (!state.homeTeamHasBattedInInning) {
      // Top of this inning just finished, so count previous innings
      return Math.max(1, state.inning - 1);
    }
    // Home team has batted, count this inning
    return state.inning;
  }
}

/**
 * Calculate game duration in milliseconds
 *
 * This is an estimate based on the number of plays.
 * In a real implementation, you'd track actual start/end time.
 *
 * @param plays - Play events from the game
 * @returns Estimated duration in milliseconds
 */
function estimateDuration(plays: PlayEvent[]): number {
  // Estimate: ~30 seconds per plate appearance
  const plateAppearances = plays.filter((p) => !p.isSummary).length;
  return plateAppearances * 30000;
}

/**
 * Convert a single play event to database format
 *
 * @param play - Play event from game engine
 * @param sequence - Sequence number for ordering
 * @returns Game event input for database
 */
function convertPlayEvent(
  play: PlayEvent,
  sequence: number
): Omit<GameEventInput, 'scorerIds'> & { scorerIds: string[] } {
  return {
    sequence,
    inning: play.inning,
    isTopInning: play.isTopInning,
    outs: 0, // Will be calculated from game state context
    eventType: eventTypeToDbEventType(play.eventType),
    outcome: outcomeToDbOutcome(play.outcome),
    batterId: play.batterId,
    batterName: play.batterName,
    pitcherId: play.pitcherId,
    pitcherName: play.pitcherName,
    runsScored: play.runsScored,
    earnedRuns: 0, // Will be calculated by saveGame
    unearnedRuns: 0, // Will be calculated by saveGame
    runner1bBefore: play.runnersBefore?.[0] || null,
    runner2bBefore: play.runnersBefore?.[1] || null,
    runner3bBefore: play.runnersBefore?.[2] || null,
    runner1bAfter: play.runnersAfter?.[0] || null,
    runner2bAfter: play.runnersAfter?.[1] || null,
    runner3bAfter: play.runnersAfter?.[2] || null,
    description: play.description,
    lineupJson: play.lineup ? JSON.stringify(play.lineup) : null,
    substitutedPlayer: play.substitutedPlayer,
    position: play.position,
    isSummary: play.isSummary || false,
    scorerIds: play.scorerIds || []
  };
}

/**
 * Convert game engine GameState to database GameSaveInput
 *
 * This is the main entry point for saving game results. It transforms
 * the game engine's output into the format expected by the database.
 *
 * @param state - Final game state from engine
 * @param seriesId - Series UUID to associate game with
 * @param gameNumber - Optional game number within series
 * @param scheduledDate - Optional scheduled date (ISO 8601)
 * @returns GameSaveInput ready for saveGame()
 *
 * @example
 * ```ts
 * // After simulating a game
 * const finalState = engine.simulateToCompletion();
 * const saveInput = gameStateToGameSaveInput(
 *   finalState,
 *   seriesId,
 *   1,
 *   '1976-05-15'
 * );
 * await saveGame(saveInput);
 * ```
 */
export function gameStateToGameSaveInput(
  state: GameState,
  seriesId: string,
  gameNumber: number | null = null,
  scheduledDate: string | null = null
): GameSaveInput {
  const awayTeamId = state.meta.awayTeam;
  const homeTeamId = state.meta.homeTeam;
  const seasonYear = state.meta.season;

  // Extract starting pitchers
  const { awayStarterId, homeStarterId } = extractPitchingDecisions(state);

  // Calculate final score
  const [awayScore, homeScore] = calculateFinalScore(state.plays, awayTeamId, homeTeamId);

  // Calculate innings
  const innings = calculateInnings(state);

  // Estimate duration
  const durationMs = estimateDuration(state.plays);

  // Convert play events
  const events: Omit<GameEventInput, 'scorerIds'> & { scorerIds: string[] }[] = [];
  let sequence = 0;

  for (const play of state.plays) {
    events.push(convertPlayEvent(play, sequence++));
  }

  // Calculate inning lines
  const inningLines = calculateInningLines(state.plays, awayTeamId, homeTeamId);

  // Determine if DH was used (can be inferred from lineups)
  // For now, we'll default to true and let the caller override
  const useDh = true; // TODO: Detect from lineups

  return {
    seriesId,
    gameNumber,
    awayTeamId,
    awaySeasonYear: seasonYear,
    homeTeamId,
    homeSeasonYear: seasonYear,
    awayScore,
    homeScore,
    innings,
    awayStarterId,
    homeStarterId,
    winningPitcherId: null, // Will be calculated by saveGame
    losingPitcherId: null, // Will be calculated by saveGame
    savePitcherId: null, // Will be calculated by saveGame
    scheduledDate,
    playedAt: new Date().toISOString(),
    durationMs,
    useDh,
    events: events as GameEventInput[],
    inningLines
  };
}

/**
 * Detect if DH was used from lineups
 *
 * Checks if the pitcher is in the batting lineup.
 *
 * @param state - Game state from engine
 * @returns True if DH appears to be used
 *
 * @example
 * ```ts
 * const usesDH = detectDesignatedHitter(gameState);
 * ```
 */
export function detectDesignatedHitter(state: GameState): boolean {
  // Check if pitcher is in the batting lineup
  const awayPitcherInLineup = state.awayLineup.players.some(
    (slot) => slot.playerId === state.awayLineup.pitcher
  );
  const homePitcherInLineup = state.homeLineup.players.some(
    (slot) => slot.playerId === state.homeLineup.pitcher
  );

  // If pitchers aren't batting, DH is likely in use
  return !awayPitcherInLineup || !homePitcherInLineup;
}
