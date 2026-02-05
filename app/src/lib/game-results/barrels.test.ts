/**
 * Tests for barrels.ts - GameState to GameSaveInput converter
 */

import { describe, it, expect } from 'vitest';
import {
  gameStateToGameSaveInput,
  calculateInningLines,
  extractPitchingDecisions,
  detectDesignatedHitter
} from './barrels.js';
import type { GameState, PlayEvent } from '../game/types.js';

describe('barrels.ts', () => {
  describe('gameStateToGameSaveInput', () => {
    const mockGameState: GameState = {
      meta: {
        awayTeam: 'NYA',
        homeTeam: 'BOS',
        season: 1976
      },
      inning: 9,
      isTopInning: false,
      outs: 3,
      bases: [null, null, null],
      awayLineup: {
        teamId: 'NYA',
        players: [
          { playerId: 'batter1', position: 1 },
          { playerId: 'batter2', position: 4 },
          { playerId: 'batter3', position: 7 },
          { playerId: 'batter4', position: 3 },
          { playerId: 'batter5', position: 5 },
          { playerId: 'batter6', position: 6 },
          { playerId: 'batter7', position: 8 },
          { playerId: 'batter8', position: 9 },
          { playerId: 'batter9', position: 2 }
        ],
        currentBatterIndex: 0,
        pitcher: 'pitcher1'
      },
      homeLineup: {
        teamId: 'BOS',
        players: [
          { playerId: 'batter10', position: 1 },
          { playerId: 'batter11', position: 4 },
          { playerId: 'batter12', position: 7 },
          { playerId: 'batter13', position: 3 },
          { playerId: 'batter14', position: 5 },
          { playerId: 'batter15', position: 6 },
          { playerId: 'batter16', position: 8 },
          { playerId: 'batter17', position: 9 },
          { playerId: 'batter18', position: 2 }
        ],
        currentBatterIndex: 0,
        pitcher: 'pitcher2'
      },
      plays: [],
      homeTeamHasBattedInInning: true
    };

    it('should convert basic game state to save input', () => {
      const result = gameStateToGameSaveInput(mockGameState, 'series-123', 1, '1976-05-15');

      expect(result.seriesId).toBe('series-123');
      expect(result.gameNumber).toBe(1);
      expect(result.awayTeamId).toBe('NYA');
      expect(result.homeTeamId).toBe('BOS');
      expect(result.awaySeasonYear).toBe(1976);
      expect(result.homeSeasonYear).toBe(1976);
    });

    it('should extract starting pitchers', () => {
      const result = gameStateToGameSaveInput(mockGameState, 'series-123');

      expect(result.awayStarterId).toBe('pitcher1');
      expect(result.homeStarterId).toBe('pitcher2');
    });

    it('should calculate score from plays', () => {
      const stateWithPlays = {
        ...mockGameState,
        plays: [
          {
            inning: 1,
            isTopInning: true,
            outcome: 'single' as const,
            batterId: 'b1',
            batterName: 'Batter One',
            pitcherId: 'p1',
            pitcherName: 'Pitcher One',
            description: 'Single',
            runsScored: 1
          },
          {
            inning: 1,
            isTopInning: false,
            outcome: 'strikeout' as const,
            batterId: 'b2',
            batterName: 'Batter Two',
            pitcherId: 'p2',
            pitcherName: 'Pitcher Two',
            description: 'Strikeout',
            runsScored: 0
          }
        ]
      };

      const result = gameStateToGameSaveInput(stateWithPlays, 'series-123');

      expect(result.awayScore).toBe(1);
      expect(result.homeScore).toBe(0);
    });

    it('should include scheduled date', () => {
      const result = gameStateToGameSaveInput(mockGameState, 'series-123', null, '1976-05-15');

      expect(result.scheduledDate).toBe('1976-05-15');
    });

    it('should default game number to null', () => {
      const result = gameStateToGameSaveInput(mockGameState, 'series-123');

      expect(result.gameNumber).toBeNull();
    });

    it('should estimate duration based on plays', () => {
      const stateWithPlays = {
        ...mockGameState,
        plays: Array(50)
          .fill(null)
          .map(
            (_, i) =>
              ({
                inning: Math.floor(i / 6) + 1,
                isTopInning: i % 2 === 0,
                outcome: 'out' as const,
                batterId: `b${i}`,
                batterName: `Batter ${i}`,
                pitcherId: 'p1',
                pitcherName: 'Pitcher One',
                description: 'Out',
                runsScored: 0
              } as PlayEvent)
          )
      };

      const result = gameStateToGameSaveInput(stateWithPlays, 'series-123');

      // 50 plays * 30 seconds = 1500000ms
      expect(result.durationMs).toBe(1500000);
    });

    it('should handle extra innings', () => {
      const extraInningState = {
        ...mockGameState,
        inning: 12,
        isTopInning: false,
        homeTeamHasBattedInInning: true
      };

      const result = gameStateToGameSaveInput(extraInningState, 'series-123');

      expect(result.innings).toBe(12);
    });

    it('should not count incomplete bottom of inning', () => {
      const incompleteState = {
        ...mockGameState,
        inning: 9,
        isTopInning: false,
        homeTeamHasBattedInInning: false
      };

      const result = gameStateToGameSaveInput(incompleteState, 'series-123');

      expect(result.innings).toBe(8);
    });
  });

  describe('calculateInningLines', () => {
    it('should create inning lines for both teams', () => {
      const plays: PlayEvent[] = [
        {
          inning: 1,
          isTopInning: true,
          outcome: 'single' as const,
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
          isTopInning: false,
          outcome: 'homeRun' as const,
          batterId: 'b2',
          batterName: 'Batter Two',
          pitcherId: 'p2',
          pitcherName: 'Pitcher Two',
          description: 'Home Run',
          runsScored: 1,
          eventType: 'plateAppearance'
        }
      ];

      const lines = calculateInningLines(plays, 'NYA', 'BOS');

      expect(lines).toHaveLength(18); // 9 innings * 2 teams
      expect(lines.some((l) => l.teamId === 'NYA' && l.inning === 1)).toBe(true);
      expect(lines.some((l) => l.teamId === 'BOS' && l.inning === 1)).toBe(true);
    });

    it('should count runs per inning', () => {
      const plays: PlayEvent[] = [
        {
          inning: 1,
          isTopInning: true,
          outcome: 'homeRun' as const,
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
          outcome: 'homeRun' as const,
          batterId: 'b2',
          batterName: 'Batter Two',
          pitcherId: 'p1',
          pitcherName: 'Pitcher One',
          description: 'Home Run',
          runsScored: 1,
          eventType: 'plateAppearance'
        }
      ];

      const lines = calculateInningLines(plays, 'NYA', 'BOS');
      const firstInningAway = lines.find((l) => l.teamId === 'NYA' && l.inning === 1);

      expect(firstInningAway?.runs).toBe(2);
    });

    it('should count hits per inning', () => {
      const plays: PlayEvent[] = [
        {
          inning: 1,
          isTopInning: true,
          outcome: 'single' as const,
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
          outcome: 'double' as const,
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

    it('should count errors per inning', () => {
      const plays: PlayEvent[] = [
        {
          inning: 1,
          isTopInning: true,
          outcome: 'reachedOnError' as const,
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

    it('should skip summary events', () => {
      const plays: PlayEvent[] = [
        {
          inning: 1,
          isTopInning: true,
          outcome: 'single' as const,
          batterId: 'b1',
          batterName: 'Batter One',
          pitcherId: 'p1',
          pitcherName: 'Pitcher One',
          description: 'Single',
          runsScored: 1,
          isSummary: true,
          eventType: 'plateAppearance'
        }
      ];

      const lines = calculateInningLines(plays, 'NYA', 'BOS');
      const firstInningAway = lines.find((l) => l.teamId === 'NYA' && l.inning === 1);

      expect(firstInningAway?.runs).toBe(0);
    });

    it('should expand for extra innings', () => {
      const plays: PlayEvent[] = [
        {
          inning: 10,
          isTopInning: true,
          outcome: 'single' as const,
          batterId: 'b1',
          batterName: 'Batter One',
          pitcherId: 'p1',
          pitcherName: 'Pitcher One',
          description: 'Single',
          runsScored: 0,
          eventType: 'plateAppearance'
        }
      ];

      const lines = calculateInningLines(plays, 'NYA', 'BOS');

      expect(lines.some((l) => l.teamId === 'NYA' && l.inning === 10)).toBe(true);
    });
  });

  describe('extractPitchingDecisions', () => {
    it('should extract away starter', () => {
      const state: GameState = {
        meta: { awayTeam: 'NYA', homeTeam: 'BOS', season: 1976 },
        inning: 1,
        isTopInning: true,
        outs: 0,
        bases: [null, null, null],
        awayLineup: { teamId: 'NYA', players: [], currentBatterIndex: 0, pitcher: 'away-sp' },
        homeLineup: { teamId: 'BOS', players: [], currentBatterIndex: 0, pitcher: 'home-sp' },
        plays: [],
        homeTeamHasBattedInInning: false
      };

      const result = extractPitchingDecisions(state);

      expect(result.awayStarterId).toBe('away-sp');
    });

    it('should extract home starter', () => {
      const state: GameState = {
        meta: { awayTeam: 'NYA', homeTeam: 'BOS', season: 1976 },
        inning: 1,
        isTopInning: true,
        outs: 0,
        bases: [null, null, null],
        awayLineup: { teamId: 'NYA', players: [], currentBatterIndex: 0, pitcher: 'away-sp' },
        homeLineup: { teamId: 'BOS', players: [], currentBatterIndex: 0, pitcher: 'home-sp' },
        plays: [],
        homeTeamHasBattedInInning: false
      };

      const result = extractPitchingDecisions(state);

      expect(result.homeStarterId).toBe('home-sp');
    });

    it('should return null for missing pitcher', () => {
      const state: GameState = {
        meta: { awayTeam: 'NYA', homeTeam: 'BOS', season: 1976 },
        inning: 1,
        isTopInning: true,
        outs: 0,
        bases: [null, null, null],
        awayLineup: { teamId: 'NYA', players: [], currentBatterIndex: 0, pitcher: null },
        homeLineup: { teamId: 'BOS', players: [], currentBatterIndex: 0, pitcher: null },
        plays: [],
        homeTeamHasBattedInInning: false
      };

      const result = extractPitchingDecisions(state);

      expect(result.awayStarterId).toBeNull();
      expect(result.homeStarterId).toBeNull();
    });
  });

  describe('detectDesignatedHitter', () => {
    it('should detect DH when pitcher not in lineup', () => {
      const state: GameState = {
        meta: { awayTeam: 'NYA', homeTeam: 'BOS', season: 1976 },
        inning: 1,
        isTopInning: true,
        outs: 0,
        bases: [null, null, null],
        awayLineup: {
          teamId: 'NYA',
          players: [{ playerId: 'dh', position: 10 }],
          currentBatterIndex: 0,
          pitcher: 'pitcher1'
        },
        homeLineup: {
          teamId: 'BOS',
          players: [{ playerId: 'dh', position: 10 }],
          currentBatterIndex: 0,
          pitcher: 'pitcher2'
        },
        plays: [],
        homeTeamHasBattedInInning: false
      };

      expect(detectDesignatedHitter(state)).toBe(true);
    });

    it('should detect no DH when pitcher in lineup', () => {
      const state: GameState = {
        meta: { awayTeam: 'NYA', homeTeam: 'BOS', season: 1976 },
        inning: 1,
        isTopInning: true,
        outs: 0,
        bases: [null, null, null],
        awayLineup: {
          teamId: 'NYA',
          players: [{ playerId: 'pitcher1', position: 1 }],
          currentBatterIndex: 0,
          pitcher: 'pitcher1'
        },
        homeLineup: {
          teamId: 'BOS',
          players: [{ playerId: 'pitcher2', position: 1 }],
          currentBatterIndex: 0,
          pitcher: 'pitcher2'
        },
        plays: [],
        homeTeamHasBattedInInning: false
      };

      expect(detectDesignatedHitter(state)).toBe(false);
    });

    it('should return true when only one pitcher bats', () => {
      const state: GameState = {
        meta: { awayTeam: 'NYA', homeTeam: 'BOS', season: 1976 },
        inning: 1,
        isTopInning: true,
        outs: 0,
        bases: [null, null, null],
        awayLineup: {
          teamId: 'NYA',
          players: [{ playerId: 'pitcher1', position: 1 }],
          currentBatterIndex: 0,
          pitcher: 'pitcher1'
        },
        homeLineup: {
          teamId: 'BOS',
          players: [{ playerId: 'dh', position: 10 }],
          currentBatterIndex: 0,
          pitcher: 'pitcher2'
        },
        plays: [],
        homeTeamHasBattedInInning: false
      };

      // Home team uses DH even though away doesn't
      expect(detectDesignatedHitter(state)).toBe(true);
    });
  });
});
