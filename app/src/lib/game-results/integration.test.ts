/**
 * Integration test for full game save workflow
 *
 * Note: Full integration tests require browser environment (sql.js WASM + IndexedDB).
 * These tests verify the module structure, type compatibility, and workflow logic.
 * Manual browser testing is required for full functionality.
 */

import { describe, it, expect, vi } from 'vitest';
import type { GameSaveInput } from './types.js';
import { gameStateToGameSaveInput, calculateInningLines } from './barrels.js';
import type { GameState, PlayEvent } from '../game/types.js';

// Mock the database modules to test the workflow without IndexedDB
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
  getStandings: vi.fn(),
  getBattingStats: vi.fn(),
  getPitchingStats: vi.fn()
}));

describe('Integration: Full Game Save Workflow', () => {
  describe('Module exports and structure', () => {
    it('should export all required functions from index', async () => {
      const indexModule = await import('./index.js');

      // Core database functions
      expect(indexModule.getGameDatabase).toBeInstanceOf(Function);
      expect(indexModule.closeGameDatabase).toBeInstanceOf(Function);
      expect(indexModule.exportGameDatabase).toBeInstanceOf(Function);
      expect(indexModule.importGameDatabaseFromFile).toBeInstanceOf(Function);
      expect(indexModule.clearGameDatabase).toBeInstanceOf(Function);

      // Series functions
      expect(indexModule.createSeries).toBeInstanceOf(Function);
      expect(indexModule.getSeries).toBeInstanceOf(Function);
      expect(indexModule.listSeries).toBeInstanceOf(Function);
      expect(indexModule.updateSeries).toBeInstanceOf(Function);
      expect(indexModule.deleteSeries).toBeInstanceOf(Function);

      // Game functions
      expect(indexModule.saveGame).toBeInstanceOf(Function);
      expect(indexModule.getGame).toBeInstanceOf(Function);
      expect(indexModule.getGamesBySeries).toBeInstanceOf(Function);

      // Stats functions
      expect(indexModule.getSeriesStandings).toBeInstanceOf(Function);
      expect(indexModule.getBattingStats).toBeInstanceOf(Function);
      expect(indexModule.getPitchingStats).toBeInstanceOf(Function);
      // getLeagueLeaders was removed, replaced by getLeagueLeadersByCategory

      // Convenience functions
      expect(indexModule.saveGameFromState).toBeInstanceOf(Function);
      expect(indexModule.createSeriesWithDefaults).toBeInstanceOf(Function);
      expect(indexModule.getSeriesStandingsEnhanced).toBeInstanceOf(Function);
      expect(indexModule.getLeagueLeadersByCategory).toBeInstanceOf(Function);
      expect(indexModule.exportDatabase).toBeInstanceOf(Function);
      expect(indexModule.importDatabaseFromFile).toBeInstanceOf(Function);

      // Converter functions
      expect(indexModule.gameStateToGameSaveInput).toBeInstanceOf(Function);
      expect(indexModule.calculateInningLines).toBeInstanceOf(Function);
      expect(indexModule.extractPitchingDecisions).toBeInstanceOf(Function);
      expect(indexModule.detectDesignatedHitter).toBeInstanceOf(Function);

      // Constants
      expect(indexModule.API_VERSION).toBe('1.0.0');
      expect(indexModule.SCHEMA_VERSION).toBe(1);
    });

    it('should export all types', async () => {
      const indexModule = await import('./index.js');

      // These are type exports, so we just check the module loads without errors
      expect(indexModule).toBeDefined();
    });
  });

  describe('GameState to GameSaveInput conversion', () => {
    it('should convert a complete game state', () => {
      const mockState = createMockGameState('NYA', 'BOS', 1976);

      const input = gameStateToGameSaveInput(mockState, 'series-123', 1, '1976-05-15');

      // Verify all required fields are present
      expect(input.seriesId).toBe('series-123');
      expect(input.gameNumber).toBe(1);
      expect(input.awayTeamId).toBe('NYA');
      expect(input.homeTeamId).toBe('BOS');
      expect(input.awaySeasonYear).toBe(1976);
      expect(input.homeSeasonYear).toBe(1976);
      expect(input.scheduledDate).toBe('1976-05-15');
      expect(input.playedAt).toBeDefined();

      // Verify scores are calculated from plays
      expect(typeof input.awayScore).toBe('number');
      expect(typeof input.homeScore).toBe('number');
      expect(input.awayScore).toBeGreaterThanOrEqual(0);
      expect(input.homeScore).toBeGreaterThanOrEqual(0);

      // Verify pitchers
      expect(input.awayStarterId).toBe('pitcher1');
      expect(input.homeStarterId).toBe('pitcher2');

      // Verify events
      expect(input.events).toBeDefined();
      expect(input.events.length).toBeGreaterThan(0);

      // Verify inning lines
      expect(input.inningLines).toBeDefined();
      expect(input.inningLines.length).toBeGreaterThan(0);

      // Verify useDh
      expect(typeof input.useDh).toBe('boolean');

      // Verify duration
      expect(input.durationMs).toBeGreaterThan(0);
    });

    it('should convert with optional parameters as null', () => {
      const mockState = createMockGameState('NYA', 'BOS', 1976);

      const input = gameStateToGameSaveInput(mockState, 'series-123');

      expect(input.gameNumber).toBeNull();
      expect(input.scheduledDate).toBeNull();
    });

    it('should handle extra innings', () => {
      const mockState = createMockGameState('NYA', 'BOS', 1976, {
        innings: 12
      });

      const input = gameStateToGameSaveInput(mockState, 'series-123');

      expect(input.innings).toBe(12);
      expect(typeof input.awayScore).toBe('number');
      expect(typeof input.homeScore).toBe('number');
    });

    it('should convert play events correctly', () => {
      const mockState = createMockGameState('NYA', 'BOS', 1976, { playCount: 10 });

      const input = gameStateToGameSaveInput(mockState, 'series-123');

      // Verify event structure
      const firstEvent = input.events[0];
      expect(firstEvent).toBeDefined();
      expect(firstEvent.inning).toBeGreaterThanOrEqual(1);
      expect(typeof firstEvent.isTopInning).toBe('boolean');
      expect(firstEvent.batterId).toBeDefined();
      expect(firstEvent.pitcherId).toBeDefined();
      expect(firstEvent.outcome).toBeDefined();
      expect(Array.isArray(firstEvent.scorerIds)).toBe(true);
    });

    it('should calculate inning lines correctly', () => {
      const mockState = createMockGameState('NYA', 'BOS', 1976, {
        awayScore: 5,
        homeScore: 3
      });

      const input = gameStateToGameSaveInput(mockState, 'series-123');

      // Verify inning lines for both teams
      const awayLines = input.inningLines.filter((l) => l.teamId === 'NYA');
      const homeLines = input.inningLines.filter((l) => l.teamId === 'BOS');

      expect(awayLines.length).toBeGreaterThan(0);
      expect(homeLines.length).toBeGreaterThan(0);

      // Verify structure
      awayLines.forEach((line) => {
        expect(line.teamId).toBe('NYA');
        expect(line.inning).toBeGreaterThanOrEqual(1);
        expect(typeof line.runs).toBe('number');
        expect(typeof line.hits).toBe('number');
        expect(typeof line.errors).toBe('number');
      });
    });
  });

  describe('Inning lines calculation', () => {
    it('should aggregate runs by inning', () => {
      const plays: PlayEvent[] = [
        {
          inning: 1,
          isTopInning: true,
          outcome: 'homeRun',
          batterId: 'b1',
          batterName: 'Batter One',
          pitcherId: 'p1',
          pitcherName: 'Pitcher One',
          description: 'Home Run',
          runsScored: 1,
          eventType: 'plateAppearance'
        },
        {
          inning: 1,
          isTopInning: true,
          outcome: 'single',
          batterId: 'b2',
          batterName: 'Batter Two',
          pitcherId: 'p1',
          pitcherName: 'Pitcher One',
          description: 'Single',
          runsScored: 0,
          eventType: 'plateAppearance'
        }
      ];

      const lines = calculateInningLines(plays, 'NYA', 'BOS');
      const firstInningAway = lines.find((l) => l.teamId === 'NYA' && l.inning === 1);

      expect(firstInningAway?.runs).toBe(1);
    });

    it('should count hits correctly', () => {
      const plays: PlayEvent[] = [
        {
          inning: 1,
          isTopInning: true,
          outcome: 'single',
          batterId: 'b1',
          batterName: 'Batter One',
          pitcherId: 'p1',
          pitcherName: 'Pitcher One',
          description: 'Single',
          runsScored: 0,
          eventType: 'plateAppearance'
        },
        {
          inning: 1,
          isTopInning: true,
          outcome: 'double',
          batterId: 'b2',
          batterName: 'Batter Two',
          pitcherId: 'p1',
          pitcherName: 'Pitcher One',
          description: 'Double',
          runsScored: 0,
          eventType: 'plateAppearance'
        }
      ];

      const lines = calculateInningLines(plays, 'NYA', 'BOS');
      const firstInningAway = lines.find((l) => l.teamId === 'NYA' && l.inning === 1);

      expect(firstInningAway?.hits).toBe(2);
    });

    it('should handle errors', () => {
      const plays: PlayEvent[] = [
        {
          inning: 1,
          isTopInning: true,
          outcome: 'reachedOnError',
          batterId: 'b1',
          batterName: 'Batter One',
          pitcherId: 'p1',
          pitcherName: 'Pitcher One',
          description: 'Reached on error',
          runsScored: 0,
          eventType: 'plateAppearance'
        }
      ];

      const lines = calculateInningLines(plays, 'NYA', 'BOS');
      const firstInningHome = lines.find((l) => l.teamId === 'BOS' && l.inning === 1);

      expect(firstInningHome?.errors).toBe(1);
    });
  });

  describe('Type compatibility', () => {
    it('should accept GameSaveInput type', () => {
      const input: GameSaveInput = {
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
        playedAt: new Date().toISOString(),
        durationMs: 900000,
        useDh: true,
        events: [],
        inningLines: []
      };

      // This should compile without errors
      expect(input.seriesId).toBe('series-123');
    });
  });
});

/**
 * Helper: Create a mock GameState for testing
 */
function createMockGameState(
  awayTeam: string,
  homeTeam: string,
  season: number,
  options: {
    awayScore?: number;
    homeScore?: number;
    innings?: number;
    playCount?: number;
  } = {}
): GameState {
  const { awayScore = 5, homeScore = 3, innings = 9, playCount = 30 } = options;

  // Generate mock plays
  const plays: PlayEvent[] = [];

  for (let i = 0; i < playCount; i++) {
    const inning = Math.floor(i / 6) + 1;
    const isTop = i % 2 === 0;
    const outcome = getMockOutcome();
    const runsScored = outcome === 'homeRun' ? 1 : outcome === 'single' && Math.random() > 0.7 ? 1 : 0;

    plays.push({
      inning,
      isTopInning: isTop,
      outcome,
      batterId: `batter${(i % 9) + 1}`,
      batterName: `Batter ${(i % 9) + 1}`,
      pitcherId: isTop ? 'pitcher2' : 'pitcher1',
      pitcherName: isTop ? 'Pitcher Two' : 'Pitcher One',
      description: `${outcome} - ${runsScored} runs`,
      runsScored,
      runnersAfter: [null, null, null],
      runnersBefore: [null, null, null],
      eventType: 'plateAppearance'
    });
  }

  return {
    meta: {
      awayTeam,
      homeTeam,
      season
    },
    inning: innings,
    isTopInning: false,
    outs: 3,
    bases: [null, null, null],
    awayLineup: {
      teamId: awayTeam,
      players: Array.from({ length: 9 }, (_, i) => ({
        playerId: `batter${i + 1}`,
        position: (i % 9) + 1
      })),
      currentBatterIndex: 0,
      pitcher: 'pitcher1'
    },
    homeLineup: {
      teamId: homeTeam,
      players: Array.from({ length: 9 }, (_, i) => ({
        playerId: `batter${i + 10}`,
        position: (i % 9) + 1
      })),
      currentBatterIndex: 0,
      pitcher: 'pitcher2'
    },
    plays,
    homeTeamHasBattedInInning: true
  };
}

/**
 * Helper: Get a mock outcome
 */
function getMockOutcome(): any {
  const outcomes: Array<'single' | 'double' | 'homeRun' | 'strikeout' | 'groundOut' | 'flyOut' | 'walk'> = [
    'single',
    'double',
    'homeRun',
    'strikeout',
    'groundOut',
    'flyOut',
    'walk'
  ];
  return outcomes[Math.floor(Math.random() * outcomes.length)];
}
