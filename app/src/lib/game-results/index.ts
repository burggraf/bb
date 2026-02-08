/**
 * Game Results Database - Public API Entry Point
 *
 * Provides a unified interface for managing game results, series, and statistics.
 * All database operations are client-side only using IndexedDB and sql.js.
 *
 * @example
 * ```ts
 * import { createSeries, saveGameFromState, getSeriesStandings } from '@/lib/game-results';
 *
 * // Create a new series
 * const series = await createSeries({
 *   name: '1976 AL East',
 *   description: 'Season replay',
 *   seriesType: 'season_replay'
 * });
 *
 * // Save a completed game
 * await saveGameFromState(gameState, series.id, 1, '1976-05-15');
 *
 * // Get standings
 * const standings = await getSeriesStandings(series.id);
 * ```
 */

// ====================================================================
// Core Database
// ====================================================================
export {
  getGameDatabase,
  closeGameDatabase,
  saveGameDatabase,
  exportGameDatabase,
  importGameDatabase,
  clearGameDatabase
} from './database.js';

// ====================================================================
// Types
// ====================================================================
export type {
  // Core types
  Series,
  SeriesMetadata,
  SeriesTeam,
  SeriesType,
  SeriesStatus,
  SavedGame,
  GameEvent,
  InningLine,
  RunScored,
  Standing,
  BattingStat,
  PitchingStat,
  GameEventType,
  // Input types
  GameSaveInput,
  GameEventInput,
  InningLineInput,
  // Player usage tracking
  PlayerUsageRecord
} from './types.js';

// Re-export Outcome from game engine for convenience
export type { Outcome } from '../game/types.js';

// ====================================================================
// Series Management
// ====================================================================
export {
  createSeries,
  getSeries,
  listSeries,
  updateSeries,
  deleteSeries,
  addTeamToSeries,
  getSeriesTeams,
  getSeriesMetadata,
  updateSeriesMetadata,
  findSeasonReplays,
  createSeasonReplay
} from './series.js';

// ====================================================================
// Game Management
// ====================================================================
export {
  saveGame,
  getGame,
  getGamesBySeries,
  getGameEvents,
  getInningLines,
  calculateEarnedRuns,
  determinePitchingDecisions
} from './games.js';

// ====================================================================
// Statistics & Standings
// ====================================================================
export {
  getStandings as getSeriesStandings,
  getBattingStats,
  getPitchingStats,
  type BattingSortBy,
  type PitchingSortBy,
  type BattingStatsOptions,
  type PitchingStatsOptions
} from './stats.js';

// ====================================================================
// Export/Import
// ====================================================================
export {
  downloadGameDatabase,
  importGameDatabase as importGameDatabaseFromFile,
  getGameDatabaseSize,
  validateDatabaseFile
} from './export.js';

// ====================================================================
// GameState Converter (Barrels)
// ====================================================================
export {
  gameStateToGameSaveInput,
  calculateInningLines,
  extractPitchingDecisions,
  detectDesignatedHitter
} from './barrels.js';

// ====================================================================
// Convenience Functions
// ====================================================================

import { createSeries as createSeriesRaw } from './series.js';
import { saveGame } from './games.js';
import { gameStateToGameSaveInput } from './barrels.js';
import { getStandings } from './stats.js';
import { downloadGameDatabase, importGameDatabase as importDb } from './export.js';
import type { GameState } from '../game/types.js';

/**
 * Create a new series with auto-generated metadata
 *
 * Convenience wrapper around createSeries() that handles undefined description
 *
 * @param data - Series data
 * @returns Promise with created series
 *
 * @example
 * ```ts
 * const series = await createSeriesWithDefaults({
 *   name: '1976 Season',
 *   description: 'Full season replay',
 *   seriesType: 'season_replay'
 * });
 * ```
 */
export async function createSeriesWithDefaults(data: {
  name: string;
  description?: string | null;
  seriesType: 'season_replay' | 'tournament' | 'exhibition' | 'custom';
}): Promise<{
  id: string;
  name: string;
  description: string | null;
  seriesType: string;
  createdAt: string;
  updatedAt: string;
  status: string;
}> {
  return createSeriesRaw({
    name: data.name,
    description: data.description ?? null,
    seriesType: data.seriesType
  });
}

/**
 * Save a game from GameState directly
 *
 * Combines gameStateToGameSaveInput() and saveGame() into one call
 *
 * @param state - Final game state from engine
 * @param seriesId - Series UUID
 * @param gameNumber - Optional game number
 * @param scheduledDate - Optional scheduled date (ISO 8601)
 * @returns Promise with game ID
 *
 * @example
 * ```ts
 * const gameId = await saveGameFromState(
 *   gameState,
 *   seriesId,
 *   1,
 *   '1976-05-15'
 * );
 * ```
 */
export async function saveGameFromState(
  state: GameState,
  seriesId: string,
  gameNumber?: number | null,
  scheduledDate?: string | null
): Promise<string> {
  const input = gameStateToGameSaveInput(state, seriesId, gameNumber ?? null, scheduledDate ?? null);
  return saveGame(input);
}

/**
 * Get series standings with team names
 *
 * Enhanced version of getSeriesStandings() that includes team metadata
 *
 * @param seriesId - Series UUID
 * @returns Promise with standings array
 *
 * @example
 * ```ts
 * const standings = await getSeriesStandingsEnhanced(seriesId);
 * console.log(`${standings[0].teamId}: ${standings[0].wins}-${standings[0].losses}`);
 * ```
 */
export async function getSeriesStandingsEnhanced(seriesId: string): Promise<
  Array<{
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
    winPercentage: number;
    gamesBack: number;
    streak: string;
  }>
> {
  const standings = await getStandings(seriesId);

  // Sort by league, then division, then wins
  const sortedStandings = [...standings].sort((a, b) => {
    // First sort by league
    const aLeague = a.league || '';
    const bLeague = b.league || '';
    if (aLeague !== bLeague) return aLeague.localeCompare(bLeague);

    // Then sort by division
    const aDiv = a.division || '';
    const bDiv = b.division || '';
    if (aDiv !== bDiv) return aDiv.localeCompare(bDiv);

    // Finally sort by wins (descending), then run differential
    const aWinDiff = a.wins - a.losses;
    const bWinDiff = b.wins - b.losses;
    if (aWinDiff !== bWinDiff) return bWinDiff - aWinDiff;
    return (b.runsScored - b.runsAllowed) - (a.runsScored - a.runsAllowed);
  });

  // Calculate games back relative to division/league leader
  return sortedStandings.map((s) => {
    const winPercentage = s.gamesPlayed > 0 ? s.wins / s.gamesPlayed : 0;

    // Find the leader for this team's league/division
    const sameLeagueAndDivision = sortedStandings.filter(
      t => t.league === s.league && t.division === s.division
    );
    const leader = sameLeagueAndDivision[0];

    // Calculate games back from division/league leader
    let gamesBack = 0;
    if (leader && s !== leader) {
      const leaderDiff = leader.wins - leader.losses;
      const teamDiff = s.wins - s.losses;
      gamesBack = (leaderDiff - teamDiff) / 2;
    }

    return {
      ...s,
      winPercentage,
      gamesBack,
      streak: '-' // TODO: Calculate streak from game history
    };
  });
}

/**
 * Get league leaders for a category
 *
 * Convenience wrapper around getLeagueLeaders() with common presets
 *
 * @param seriesId - Series UUID
 * @param category - Stat category ('batting' or 'pitching')
 * @param sortBy - Sort field
 * @param limit - Number of leaders to return (default 10)
 * @returns Promise with leaders array
 *
 * @example
 * ```ts
 * // Top 10 home runs
 * const hrLeaders = await getLeagueLeadersByCategory(seriesId, 'batting', 'homeRuns', 10);
 *
 * // Top 5 ERA (pitching)
 * const eraLeaders = await getLeagueLeadersByCategory(seriesId, 'pitching', 'era', 5);
 * ```
 */
export async function getLeagueLeadersByCategory(
  seriesId: string,
  category: 'batting' | 'pitching',
  sortBy: string,
  limit: number = 10
): Promise<any[]> {
  const { getBattingStats, getPitchingStats } = await import('./stats.js');

  if (category === 'batting') {
    return getBattingStats({
      seriesId,
      sortBy: sortBy as any,
      order: 'desc',
      limit
    });
  } else {
    return getPitchingStats({
      seriesId,
      sortBy: sortBy as any,
      order: sortBy === 'era' ? 'asc' : 'desc',
      limit
    });
  }
}

/**
 * Export database to browser download
 *
 * Triggers a file download with the current database
 *
 * @param filename - Optional filename
 * @returns Promise that resolves when download is triggered
 *
 * @example
 * ```ts
 * await exportDatabase('my-season.sqlite');
 * ```
 */
export async function exportDatabase(filename?: string): Promise<void> {
  return downloadGameDatabase(filename);
}

/**
 * Import database from file
 *
 * Replaces current database with imported file
 *
 * @param file - File object
 * @returns Promise that resolves when import is complete
 *
 * @example
 * ```ts
 * const file = fileInput.files[0];
 * await importDatabaseFromFile(file);
 * ```
 */
export async function importDatabaseFromFile(file: File): Promise<void> {
  return importDb(file);
}

// ====================================================================
// Utility Types
// ====================================================================

/**
 * Game results database API version
 */
export const API_VERSION = '1.0.0';

/**
 * Database schema version
 */
export const SCHEMA_VERSION = 1;
