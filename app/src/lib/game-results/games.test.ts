import { describe, it, expect } from 'vitest';
import type { GameEventInput } from './types.js';

/**
 * Games save module tests
 *
 * Note: Full integration tests require browser environment (sql.js WASM + IndexedDB).
 * These tests verify the module structure, type exports, and pure functions.
 * Manual browser testing is required for full database functionality.
 */
describe('Games Save Module', () => {
  it('should be importable', () => {
    expect(() => import('./games.js')).not.toThrow();
  });

  it('should export all required functions', async () => {
    const module = await import('./games.js');

    // Check that all required functions are exported
    expect(module.saveGame).toBeInstanceOf(Function);
    expect(module.getGame).toBeInstanceOf(Function);
    expect(module.getGamesBySeries).toBeInstanceOf(Function);
    expect(module.calculateEarnedRuns).toBeInstanceOf(Function);
    expect(module.determinePitchingDecisions).toBeInstanceOf(Function);
  });

  it('should have correct function signatures', async () => {
    const module = await import('./games.js');

    // saveGame takes GameSaveInput
    const save = module.saveGame;
    expect(save.length).toBe(1); // One parameter (input object)

    // getGame takes gameId string
    const get = module.getGame;
    expect(get.length).toBe(1); // One parameter (gameId: string)

    // getGamesBySeries takes seriesId string
    const getBySeries = module.getGamesBySeries;
    expect(getBySeries.length).toBe(1); // One parameter (seriesId: string)

    // calculateEarnedRuns takes events array
    const calc = module.calculateEarnedRuns;
    expect(calc.length).toBe(1); // One parameter (events: GameEventInput[])

    // determinePitchingDecisions takes game data object
    const decisions = module.determinePitchingDecisions;
    expect(decisions.length).toBe(1); // One parameter (gameData: object)
  });

  describe('calculateEarnedRuns (pure function)', () => {
    it('should calculate earned vs unearned runs', async () => {
      const { calculateEarnedRuns } = await import('./games.js');

      // Mock scenario: runner reaches on error, then scores
      const events: GameEventInput[] = [
        {
          sequence: 1,
          inning: 1,
          isTopInning: true,
          outs: 0,
          eventType: 'plateAppearance',
          outcome: 'reachedOnError',
          batterId: 'batter-1',
          batterName: 'Player 1',
          pitcherId: 'pitcher-1',
          pitcherName: 'Pitcher 1',
          runsScored: 0,
          earnedRuns: 0,
          unearnedRuns: 0,
          runner1bBefore: null,
          runner2bBefore: null,
          runner3bBefore: null,
          runner1bAfter: 'batter-1',
          runner2bAfter: null,
          runner3bAfter: null,
          description: null,
          lineupJson: null,
          substitutedPlayer: null,
          position: null,
          isSummary: false,
          scorerIds: []
        },
        {
          sequence: 2,
          inning: 1,
          isTopInning: true,
          outs: 0,
          eventType: 'plateAppearance',
          outcome: 'single',
          batterId: 'batter-2',
          batterName: 'Player 2',
          pitcherId: 'pitcher-1',
          pitcherName: 'Pitcher 1',
          runsScored: 1,
          earnedRuns: 0,
          unearnedRuns: 1,
          runner1bBefore: 'batter-1',
          runner2bBefore: null,
          runner3bBefore: null,
          runner1bAfter: 'batter-2',
          runner2bAfter: null,
          runner3bAfter: null,
          description: null,
          lineupJson: null,
          substitutedPlayer: null,
          position: null,
          isSummary: false,
          scorerIds: ['batter-1'] // Runner who reached on error scores
        }
      ];

      const result = calculateEarnedRuns(events);

      // First event: no runs
      expect(result[0].earnedRuns).toBe(0);
      expect(result[0].unearnedRuns).toBe(0);

      // Second event: batter-1 reached on error, so his run is unearned
      expect(result[1].earnedRuns).toBe(0);
      expect(result[1].unearnedRuns).toBe(1);
    });

    it('should correctly mark runs - runner who reached on error is always unearned', async () => {
      const { calculateEarnedRuns } = await import('./games.js');

      // Runner who reaches on error - their run is unearned regardless of outs
      const events: GameEventInput[] = [
        {
          sequence: 1,
          inning: 1,
          isTopInning: true,
          outs: 1,
          eventType: 'plateAppearance',
          outcome: 'reachedOnError',
          batterId: 'batter-1',
          batterName: 'Player 1',
          pitcherId: 'pitcher-1',
          pitcherName: 'Pitcher 1',
          runsScored: 0,
          earnedRuns: 0,
          unearnedRuns: 0,
          runner1bBefore: null,
          runner2bBefore: null,
          runner3bBefore: null,
          runner1bAfter: 'batter-1',
          runner2bAfter: null,
          runner3bAfter: null,
          description: null,
          lineupJson: null,
          substitutedPlayer: null,
          position: null,
          isSummary: false,
          scorerIds: []
        },
        {
          sequence: 2,
          inning: 1,
          isTopInning: true,
          outs: 1,
          eventType: 'plateAppearance',
          outcome: 'single',
          batterId: 'batter-2',
          batterName: 'Player 2',
          pitcherId: 'pitcher-1',
          pitcherName: 'Pitcher 1',
          runsScored: 1,
          earnedRuns: 0,
          unearnedRuns: 1,
          runner1bBefore: 'batter-1',
          runner2bBefore: null,
          runner3bBefore: null,
          runner1bAfter: 'batter-2',
          runner2bAfter: null,
          runner3bAfter: null,
          description: null,
          lineupJson: null,
          substitutedPlayer: null,
          position: null,
          isSummary: false,
          scorerIds: ['batter-1']
        }
      ];

      const result = calculateEarnedRuns(events);

      // batter-1 reached on error, so when he scores it's unearned
      expect(result[1].earnedRuns).toBe(0);
      expect(result[1].unearnedRuns).toBe(1);
    });

    it('should handle empty events array', async () => {
      const { calculateEarnedRuns } = await import('./games.js');
      const result = calculateEarnedRuns([]);
      expect(result).toEqual([]);
    });

    it('should handle events with no scorers', async () => {
      const { calculateEarnedRuns } = await import('./games.js');

      const events: GameEventInput[] = [
        {
          sequence: 1,
          inning: 1,
          isTopInning: true,
          outs: 0,
          eventType: 'plateAppearance',
          outcome: 'strikeout',
          batterId: 'batter-1',
          batterName: 'Player 1',
          pitcherId: 'pitcher-1',
          pitcherName: 'Pitcher 1',
          runsScored: 0,
          earnedRuns: 0,
          unearnedRuns: 0,
          runner1bBefore: null,
          runner2bBefore: null,
          runner3bBefore: null,
          runner1bAfter: null,
          runner2bAfter: null,
          runner3bAfter: null,
          description: null,
          lineupJson: null,
          substitutedPlayer: null,
          position: null,
          isSummary: false,
          scorerIds: []
        }
      ];

      const result = calculateEarnedRuns(events);
      expect(result[0].earnedRuns).toBe(0);
      expect(result[0].unearnedRuns).toBe(0);
    });

    it('should track multiple unearned runners correctly', async () => {
      const { calculateEarnedRuns } = await import('./games.js');

      // Two runners reach on error, then both score
      const events: GameEventInput[] = [
        {
          sequence: 1,
          inning: 1,
          isTopInning: true,
          outs: 0,
          eventType: 'plateAppearance',
          outcome: 'reachedOnError',
          batterId: 'batter-1',
          batterName: 'Player 1',
          pitcherId: 'pitcher-1',
          pitcherName: 'Pitcher 1',
          runsScored: 0,
          earnedRuns: 0,
          unearnedRuns: 0,
          runner1bBefore: null,
          runner2bBefore: null,
          runner3bBefore: null,
          runner1bAfter: 'batter-1',
          runner2bAfter: null,
          runner3bAfter: null,
          description: null,
          lineupJson: null,
          substitutedPlayer: null,
          position: null,
          isSummary: false,
          scorerIds: []
        },
        {
          sequence: 2,
          inning: 1,
          isTopInning: true,
          outs: 0,
          eventType: 'plateAppearance',
          outcome: 'reachedOnError',
          batterId: 'batter-2',
          batterName: 'Player 2',
          pitcherId: 'pitcher-1',
          pitcherName: 'Pitcher 1',
          runsScored: 0,
          earnedRuns: 0,
          unearnedRuns: 0,
          runner1bBefore: 'batter-1',
          runner2bBefore: null,
          runner3bBefore: null,
          runner1bAfter: 'batter-2',
          runner2bAfter: null,
          runner3bAfter: null,
          description: null,
          lineupJson: null,
          substitutedPlayer: null,
          position: null,
          isSummary: false,
          scorerIds: []
        },
        {
          sequence: 3,
          inning: 1,
          isTopInning: true,
          outs: 0,
          eventType: 'plateAppearance',
          outcome: 'homeRun',
          batterId: 'batter-3',
          batterName: 'Player 3',
          pitcherId: 'pitcher-1',
          pitcherName: 'Pitcher 1',
          runsScored: 3,
          earnedRuns: 1,
          unearnedRuns: 2,
          runner1bBefore: 'batter-1',
          runner2bBefore: 'batter-2',
          runner3bBefore: null,
          runner1bAfter: null,
          runner2bAfter: null,
          runner3bAfter: null,
          description: null,
          lineupJson: null,
          substitutedPlayer: null,
          position: null,
          isSummary: false,
          scorerIds: ['batter-1', 'batter-2', 'batter-3']
        }
      ];

      const result = calculateEarnedRuns(events);

      // Both runners who reached on error are unearned
      // The batter who hit HR is earned
      expect(result[2].earnedRuns).toBe(1);
      expect(result[2].unearnedRuns).toBe(2);
    });
  });

  describe('determinePitchingDecisions (pure function)', () => {
    it('should determine pitching decisions when away team wins', async () => {
      const { determinePitchingDecisions } = await import('./games.js');

      const decisions = determinePitchingDecisions({
        awayScore: 5,
        homeScore: 3,
        awayStarterId: 'pitcher-away',
        homeStarterId: 'pitcher-home'
      });

      expect(decisions.winningPitcherId).toBe('pitcher-away');
      expect(decisions.losingPitcherId).toBe('pitcher-home');
      expect(decisions.savePitcherId).toBeNull();
    });

    it('should determine pitching decisions when home team wins', async () => {
      const { determinePitchingDecisions } = await import('./games.js');

      const decisions = determinePitchingDecisions({
        awayScore: 2,
        homeScore: 4,
        awayStarterId: 'pitcher-away',
        homeStarterId: 'pitcher-home'
      });

      expect(decisions.winningPitcherId).toBe('pitcher-home');
      expect(decisions.losingPitcherId).toBe('pitcher-away');
      expect(decisions.savePitcherId).toBeNull();
    });

    it('should handle tie game (treats as home wins)', async () => {
      const { determinePitchingDecisions } = await import('./games.js');

      const decisions = determinePitchingDecisions({
        awayScore: 3,
        homeScore: 3,
        awayStarterId: 'pitcher-away',
        homeStarterId: 'pitcher-home'
      });

      // Tie game treated as home wins
      expect(decisions.winningPitcherId).toBe('pitcher-home');
      expect(decisions.losingPitcherId).toBe('pitcher-away');
      expect(decisions.savePitcherId).toBeNull();
    });

    it('should handle null starter IDs', async () => {
      const { determinePitchingDecisions } = await import('./games.js');

      const decisions = determinePitchingDecisions({
        awayScore: 5,
        homeScore: 3,
        awayStarterId: null,
        homeStarterId: null
      });

      expect(decisions.winningPitcherId).toBeNull();
      expect(decisions.losingPitcherId).toBeNull();
      expect(decisions.savePitcherId).toBeNull();
    });
  });
});
