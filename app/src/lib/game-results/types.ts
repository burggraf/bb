/**
 * Series types - grouping of games (season replay, tournament, exhibition, etc.)
 */
export type SeriesType = 'season_replay' | 'tournament' | 'exhibition' | 'custom';

/**
 * Series status
 */
export type SeriesStatus = 'active' | 'completed' | 'archived';

/**
 * Series metadata - additional data for tracking series state
 */
export interface SeriesMetadata {
  seasonReplay?: {
    seasonYear: number;
    currentGameIndex: number;
    totalGames: number;
    playbackSpeed: 'instant' | 'animated';
    gamesPerBatch: number;
    saveInterval: number; // Save database every N games (1-9999)
    status: 'idle' | 'playing' | 'paused' | 'completed';
    lastPlayedDate?: string;
  };
}

/**
 * Event types in game_events table
 */
export type GameEventType =
  | 'plateAppearance'
  | 'startingLineup'
  | 'pitchingChange'
  | 'pinchHit'
  | 'defensiveSub'
  | 'lineupAdjustment';

/**
 * Re-export Outcome from game engine types for convenience
 */
export type { Outcome } from '../game/types.js';

/**
 * Series record
 */
export interface Series {
  id: string; // UUID
  name: string;
  description: string | null;
  seriesType: SeriesType;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  status: SeriesStatus;
}

/**
 * Series team record
 */
export interface SeriesTeam {
  seriesId: string;
  teamId: string;
  seasonYear: number;
  league: string | null;
  division: string | null;
}

/**
 * Saved game record
 */
export interface SavedGame {
  id: string;
  seriesId: string;
  gameNumber: number | null;
  awayTeamId: string;
  awaySeasonYear: number;
  homeTeamId: string;
  homeSeasonYear: number;
  awayScore: number;
  homeScore: number;
  innings: number;
  awayStarterId: string | null;
  homeStarterId: string | null;
  winningPitcherId: string | null;
  losingPitcherId: string | null;
  savePitcherId: string | null;
  scheduledDate: string | null;
  playedAt: string;
  durationMs: number | null;
  useDh: boolean;
}

/**
 * Game event record (play-by-play)
 */
export interface GameEvent {
  id: number;
  gameId: string;
  sequence: number;
  inning: number;
  isTopInning: boolean;
  outs: number;
  eventType: GameEventType;
  outcome: Outcome | null;
  batterId: string | null;
  batterName: string | null;
  pitcherId: string | null;
  pitcherName: string | null;
  runsScored: number;
  earnedRuns: number;
  unearnedRuns: number;
  runner1bBefore: string | null;
  runner2bBefore: string | null;
  runner3bBefore: string | null;
  runner1bAfter: string | null;
  runner2bAfter: string | null;
  runner3bAfter: string | null;
  description: string | null;
  lineupJson: string | null;
  substitutedPlayer: string | null;
  position: number | null;
  isSummary: boolean;
}

/**
 * Inning line record (box score data)
 */
export interface InningLine {
  gameId: string;
  teamId: string;
  inning: number;
  runs: number;
  hits: number;
  errors: number;
}

/**
 * Run scored record
 */
export interface RunScored {
  eventId: number;
  playerId: string;
  isEarned: boolean;
}

/**
 * Standing record (from series_standings view)
 */
export interface Standing {
  seriesId: string;
  teamId: string;
  seasonYear: number;
  league: string | null;
  division: string | null;
  gamesPlayed: number;
  wins: number;
  losses: number;
  runsScored: number;
  runsAllowed: number;
}

/**
 * Batting stat record (from batting_stats view)
 */
export interface BattingStat {
  seriesId: string;
  batterId: string;
  batterName: string;
  pa: number;
  ab: number;
  hits: number;
  singles: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  walks: number;
  hbp: number;
  strikeouts: number;
  rbi: number;
  avg: number;
  obp: number;
  slg: number;
}

/**
 * Pitching stat record (from pitching_stats view)
 */
export interface PitchingStat {
  seriesId: string;
  pitcherId: string;
  pitcherName: string;
  games: number;
  battersFaced: number;
  outsRecorded: number;
  hitsAllowed: number;
  walksAllowed: number;
  strikeouts: number;
  homeRunsAllowed: number;
  runsAllowed: number;
  earnedRuns: number;
  era: number;
  whip: number;
}

/**
 * Game save input - data needed to save a completed game
 */
export interface GameSaveInput {
  seriesId: string;
  gameNumber: number | null;
  awayTeamId: string;
  awaySeasonYear: number;
  homeTeamId: string;
  homeSeasonYear: number;
  awayScore: number;
  homeScore: number;
  innings: number;
  awayStarterId: string | null;
  homeStarterId: string | null;
  winningPitcherId: string | null;
  losingPitcherId: string | null;
  savePitcherId: string | null;
  scheduledDate: string | null;
  playedAt: string;
  durationMs: number | null;
  useDh: boolean;
  events: GameEventInput[];
  inningLines: InningLineInput[];
}

/**
 * Game event input - for saving games
 */
export interface GameEventInput {
  sequence: number;
  inning: number;
  isTopInning: boolean;
  outs: number;
  eventType: GameEventType;
  outcome: Outcome | null;
  batterId: string | null;
  batterName: string | null;
  pitcherId: string | null;
  pitcherName: string | null;
  runsScored: number;
  earnedRuns: number;
  unearnedRuns: number;
  runner1bBefore: string | null;
  runner2bBefore: string | null;
  runner3bBefore: string | null;
  runner1bAfter: string | null;
  runner2bAfter: string | null;
  runner3bAfter: string | null;
  description: string | null;
  lineupJson: string | null;
  substitutedPlayer: string | null;
  position: number | null;
  isSummary: boolean;
  scorerIds: string[];
}

/**
 * Inning line input - for saving games
 */
export interface InningLineInput {
  teamId: string;
  inning: number;
  runs: number;
  hits: number;
  errors: number;
}

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
  actualSeasonTotal: number; // PA for batters, IP (outs) for pitchers
  gamesPlayedActual: number; // How many games they actually played

  // Replay values (updated after each game)
  replayCurrentTotal: number; // Cumulative PA/IP in replay
  replayGamesPlayed: number; // Games played in replay

  // Calculated fields (for queries)
  percentageOfActual: number; // replayCurrentTotal / actualSeasonTotal
  status: 'under' | 'inRange' | 'over'; // Based on 75-125% thresholds
}
