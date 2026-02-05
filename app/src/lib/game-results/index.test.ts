/**
 * Tests for index.ts - public API entry point
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  // Core
  getGameDatabase,
  closeGameDatabase,
  exportGameDatabase,
  importGameDatabase,
  clearGameDatabase,
  // Types
  API_VERSION,
  SCHEMA_VERSION,
  // Convenience functions
  createSeriesWithDefaults,
  saveGameFromState,
  getSeriesStandingsEnhanced,
  getLeagueLeadersByCategory,
  exportDatabase,
  importDatabaseFromFile
} from './index.js';

// Mock all the modules
vi.mock('./database.js', () => ({
  getGameDatabase: vi.fn(),
  closeGameDatabase: vi.fn(),
  exportGameDatabase: vi.fn(),
  importGameDatabase: vi.fn(),
  clearGameDatabase: vi.fn()
}));

vi.mock('./series.js', () => ({
  createSeries: vi.fn(),
  getSeries: vi.fn(),
  listSeries: vi.fn(),
  updateSeries: vi.fn(),
  deleteSeries: vi.fn(),
  addSeriesTeam: vi.fn(),
  getSeriesTeams: vi.fn(),
  getSeriesByType: vi.fn()
}));

vi.mock('./games.js', () => ({
  saveGame: vi.fn(),
  getGame: vi.fn(),
  getGamesBySeries: vi.fn(),
  calculateEarnedRuns: vi.fn(),
  determinePitchingDecisions: vi.fn()
}));

vi.mock('./stats.js', () => ({
  getSeriesStandings: vi.fn(),
  getBattingStats: vi.fn(),
  getPitchingStats: vi.fn(),
  getLeagueLeaders: vi.fn()
}));

vi.mock('./export.js', () => ({
  downloadGameDatabase: vi.fn(),
  importGameDatabase: vi.fn(),
  getGameDatabaseSize: vi.fn(),
  validateDatabaseFile: vi.fn()
}));

vi.mock('./barrels.js', () => ({
  gameStateToGameSaveInput: vi.fn(),
  calculateInningLines: vi.fn(),
  extractPitchingDecisions: vi.fn(),
  detectDesignatedHitter: vi.fn()
}));

describe('index.ts - Public API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Core Database Exports', () => {
    it('should export getGameDatabase', () => {
      expect(typeof getGameDatabase).toBe('function');
    });

    it('should export closeGameDatabase', () => {
      expect(typeof closeGameDatabase).toBe('function');
    });

    it('should export exportGameDatabase', () => {
      expect(typeof exportGameDatabase).toBe('function');
    });

    it('should export importGameDatabase', () => {
      expect(typeof importGameDatabase).toBe('function');
    });

    it('should export clearGameDatabase', () => {
      expect(typeof clearGameDatabase).toBe('function');
    });
  });

  describe('Type Exports', () => {
    it('should export API_VERSION', () => {
      expect(API_VERSION).toBe('1.0.0');
    });

    it('should export SCHEMA_VERSION', () => {
      expect(SCHEMA_VERSION).toBe(1);
    });
  });

  describe('Convenience: createSeriesWithDefaults', () => {
    it('should call createSeries from series module', async () => {
      const { createSeries: createSeriesRaw } = await import('./series.js');
      vi.mocked(createSeriesRaw).mockResolvedValue({
        id: 'series-123',
        name: 'Test Series',
        description: null,
        seriesType: 'season_replay',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        status: 'active'
      });

      const result = await createSeriesWithDefaults({
        name: 'Test Series',
        seriesType: 'season_replay'
      });

      expect(createSeriesRaw).toHaveBeenCalledWith({
        name: 'Test Series',
        description: null,
        seriesType: 'season_replay'
      });
      expect(result.id).toBe('series-123');
    });

    it('should handle optional description', async () => {
      const { createSeries: createSeriesRaw } = await import('./series.js');
      vi.mocked(createSeriesRaw).mockResolvedValue({
        id: 'series-123',
        name: 'Test Series',
        description: 'A test series',
        seriesType: 'exhibition',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        status: 'active'
      });

      await createSeriesWithDefaults({
        name: 'Test Series',
        description: 'A test series',
        seriesType: 'exhibition'
      });

      expect(createSeriesRaw).toHaveBeenCalledWith({
        name: 'Test Series',
        description: 'A test series',
        seriesType: 'exhibition'
      });
    });

    it('should default description to null', async () => {
      const { createSeries: createSeriesRaw } = await import('./series.js');
      vi.mocked(createSeriesRaw).mockResolvedValue({
        id: 'series-123',
        name: 'Test Series',
        description: null,
        seriesType: 'custom',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        status: 'active'
      });

      await createSeriesWithDefaults({
        name: 'Test Series',
        seriesType: 'custom'
      });

      expect(createSeriesRaw).toHaveBeenCalledWith({
        name: 'Test Series',
        description: null,
        seriesType: 'custom'
      });
    });
  });

  describe('Convenience: saveGameFromState', () => {
    it('should convert state and save game', async () => {
      const { gameStateToGameSaveInput } = await import('./barrels.js');
      const { saveGame } = await import('./games.js');

      const mockInput = {
        seriesId: 'series-123',
        gameNumber: 1,
        awayTeamId: 'NYA',
        awaySeasonYear: 1976,
        homeTeamId: 'BOS',
        homeSeasonYear: 1976,
        awayScore: 5,
        homeScore: 3,
        innings: 9,
        awayStarterId: 'pitcher1',
        homeStarterId: 'pitcher2',
        winningPitcherId: null,
        losingPitcherId: null,
        savePitcherId: null,
        scheduledDate: '1976-05-15',
        playedAt: '2024-01-01T00:00:00Z',
        durationMs: 900000,
        useDh: true,
        events: [],
        inningLines: []
      };

      vi.mocked(gameStateToGameSaveInput).mockReturnValue(mockInput);
      vi.mocked(saveGame).mockResolvedValue('game-123');

      const mockState = {} as any;
      const gameId = await saveGameFromState(mockState, 'series-123', 1, '1976-05-15');

      expect(gameStateToGameSaveInput).toHaveBeenCalledWith(mockState, 'series-123', 1, '1976-05-15');
      expect(saveGame).toHaveBeenCalledWith(mockInput);
      expect(gameId).toBe('game-123');
    });

    it('should handle optional parameters', async () => {
      const { gameStateToGameSaveInput } = await import('./barrels.js');
      const { saveGame } = await import('./games.js');

      const mockInput = {
        seriesId: 'series-123',
        gameNumber: null,
        awayTeamId: 'NYA',
        awaySeasonYear: 1976,
        homeTeamId: 'BOS',
        homeSeasonYear: 1976,
        awayScore: 5,
        homeScore: 3,
        innings: 9,
        awayStarterId: 'pitcher1',
        homeStarterId: 'pitcher2',
        winningPitcherId: null,
        losingPitcherId: null,
        savePitcherId: null,
        scheduledDate: null,
        playedAt: '2024-01-01T00:00:00Z',
        durationMs: 900000,
        useDh: true,
        events: [],
        inningLines: []
      };

      vi.mocked(gameStateToGameSaveInput).mockReturnValue(mockInput);
      vi.mocked(saveGame).mockResolvedValue('game-123');

      const mockState = {} as any;
      await saveGameFromState(mockState, 'series-123');

      expect(gameStateToGameSaveInput).toHaveBeenCalledWith(mockState, 'series-123', null, null);
    });
  });

  describe('Convenience: getSeriesStandingsEnhanced', () => {
    it('should add calculated fields to standings', async () => {
      const { getSeriesStandings } = await import('./stats.js');

      vi.mocked(getSeriesStandings).mockResolvedValue([
        {
          seriesId: 'series-123',
          teamId: 'BOS',
          seasonYear: 1976,
          league: 'AL',
          division: 'East',
          gamesPlayed: 10,
          wins: 7,
          losses: 3,
          runsScored: 50,
          runsAllowed: 30
        },
        {
          seriesId: 'series-123',
          teamId: 'NYA',
          seasonYear: 1976,
          league: 'AL',
          division: 'East',
          gamesPlayed: 10,
          wins: 6,
          losses: 4,
          runsScored: 45,
          runsAllowed: 35
        }
      ]);

      const standings = await getSeriesStandingsEnhanced('series-123');

      expect(standings).toHaveLength(2);
      expect(standings[0].winPercentage).toBe(0.7);
      expect(standings[0].gamesBack).toBe(0);
      expect(standings[1].winPercentage).toBe(0.6);
      expect(standings[1].gamesBack).toBe(1);
    });

    it('should handle zero games played', async () => {
      const { getSeriesStandings } = await import('./stats.js');

      vi.mocked(getSeriesStandings).mockResolvedValue([
        {
          seriesId: 'series-123',
          teamId: 'BOS',
          seasonYear: 1976,
          league: 'AL',
          division: 'East',
          gamesPlayed: 0,
          wins: 0,
          losses: 0,
          runsScored: 0,
          runsAllowed: 0
        }
      ]);

      const standings = await getSeriesStandingsEnhanced('series-123');

      expect(standings[0].winPercentage).toBe(0);
    });
  });

  describe('Convenience: getLeagueLeadersByCategory', () => {
    it('should get batting leaders', async () => {
      const { getBattingStats } = await import('./stats.js');

      vi.mocked(getBattingStats).mockResolvedValue([
        {
          batterId: 'batter1',
          batterName: 'Player One',
          pa: 100,
          ab: 90,
          hits: 30,
          homeRuns: 10,
          avg: 0.333,
          rbi: 25
        }
      ]);

      const leaders = await getLeagueLeadersByCategory('series-123', 'batting', 'homeRuns', 10);

      expect(getBattingStats).toHaveBeenCalledWith({
        seriesId: 'series-123',
        sortBy: 'homeRuns',
        order: 'desc',
        limit: 10
      });
      expect(leaders).toHaveLength(1);
    });

    it('should get pitching leaders with asc order for ERA', async () => {
      const { getPitchingStats } = await import('./stats.js');

      vi.mocked(getPitchingStats).mockResolvedValue([
        {
          pitcherId: 'pitcher1',
          pitcherName: 'Pitcher One',
          games: 10,
          era: 2.50,
          strikeouts: 50
        }
      ]);

      const leaders = await getLeagueLeadersByCategory('series-123', 'pitching', 'era', 5);

      expect(getPitchingStats).toHaveBeenCalledWith({
        seriesId: 'series-123',
        sortBy: 'era',
        order: 'asc',
        limit: 5
      });
    });

    it('should get pitching leaders with desc order for strikeouts', async () => {
      const { getPitchingStats } = await import('./stats.js');

      vi.mocked(getPitchingStats).mockResolvedValue([]);

      await getLeagueLeadersByCategory('series-123', 'pitching', 'strikeouts', 10);

      expect(getPitchingStats).toHaveBeenCalledWith({
        seriesId: 'series-123',
        sortBy: 'strikeouts',
        order: 'desc',
        limit: 10
      });
    });
  });

  describe('Convenience: exportDatabase', () => {
    it('should call downloadGameDatabase', async () => {
      const { downloadGameDatabase } = await import('./export.js');
      vi.mocked(downloadGameDatabase).mockResolvedValue(undefined);

      await exportDatabase('my-db.sqlite');

      expect(downloadGameDatabase).toHaveBeenCalledWith('my-db.sqlite');
    });

    it('should work without filename', async () => {
      const { downloadGameDatabase } = await import('./export.js');
      vi.mocked(downloadGameDatabase).mockResolvedValue(undefined);

      await exportDatabase();

      expect(downloadGameDatabase).toHaveBeenCalledWith(undefined);
    });
  });

  describe('Convenience: importDatabaseFromFile', () => {
    it('should call importGameDatabase', async () => {
      const { importGameDatabase: importDb } = await import('./export.js');
      vi.mocked(importDb).mockResolvedValue(undefined);

      const mockFile = new File(['data'], 'test.sqlite');
      await importDatabaseFromFile(mockFile);

      expect(importDb).toHaveBeenCalledWith(mockFile);
    });
  });
});
