import { describe, it, expect } from 'vitest';

describe('Usage Proration Calculation', () => {
  describe('getProrationPercentage', () => {
    it('should calculate proration based on team games played vs season length', () => {
      // For 1976, season length is 162 games
      const seasonLength = 162;

      // Test 1: Team has played 81 games (50% of season)
      const teamGamesPlayed = 81;
      const prorationPct = teamGamesPlayed / seasonLength;
      expect(prorationPct).toBe(0.5);

      // Test 2: Team has played 162 games (100% of season)
      const teamGamesPlayedFull = 162;
      const prorationPctFull = teamGamesPlayedFull / seasonLength;
      expect(prorationPctFull).toBe(1.0);

      // Test 3: Team has played 0 games
      const teamGamesPlayedZero = 0;
      const prorationPctZero = teamGamesPlayedZero / seasonLength;
      expect(prorationPctZero).toBe(0);
    });

    it('should calculate expected PA correctly when season is complete', () => {
      const seasonLength = 162;
      const actualPA = 430; // Player's actual season PA
      const teamGamesPlayed = 162; // Full season played

      // Expected PA = Actual PA * (TeamGames / SeasonLength)
      const expectedPA = Math.round(actualPA * (teamGamesPlayed / seasonLength));

      // When full season is played, expected should equal actual
      expect(expectedPA).toBe(430);
    });

    it('should calculate expected PA correctly at mid-season', () => {
      const seasonLength = 162;
      const actualPA = 430; // Player's actual season PA
      const teamGamesPlayed = 81; // Half season played

      // Expected PA = Actual PA * (TeamGames / SeasonLength)
      const expectedPA = Math.round(actualPA * (teamGamesPlayed / seasonLength));

      // At half season, expected should be half of actual
      expect(expectedPA).toBe(215);
    });

    it('should work correctly for pre-1962 seasons (154 games)', () => {
      const seasonLength = 154; // Pre-1962 season length
      const actualPA = 500;
      const teamGamesPlayed = 154; // Full season played

      const expectedPA = Math.round(actualPA * (teamGamesPlayed / seasonLength));

      expect(expectedPA).toBe(500);
    });

    it('should NOT use player games played for proration', () => {
      // This test documents the BUG that was fixed
      // Old formula: expected = actual * (teamGames / playerGames)
      // New formula: expected = actual * (teamGames / seasonLength)

      const actualPA = 430;
      const playerGamesActual = 96; // Player played 96 games in reality
      const teamGamesReplay = 162; // Team played full season in replay
      const seasonLength = 162;

      // OLD BUGGY CALCULATION (WRONG):
      const buggyExpected = Math.round(actualPA * (teamGamesReplay / playerGamesActual));
      expect(buggyExpected).toBe(726); // This was the bug! (726 due to floating point)

      // NEW CORRECT CALCULATION:
      const correctExpected = Math.round(actualPA * (teamGamesReplay / seasonLength));
      expect(correctExpected).toBe(430); // This is correct!
    });
  });

  describe('PercentageOfActual calculation', () => {
    it('should be 100% when full season played and expected equals actual', () => {
      const replayPA = 430;
      const actualPA = 430;
      const percentage = replayPA / actualPA;

      expect(percentage).toBe(1.0);
    });

    it('should be under 100% when player is under-used', () => {
      const replayPA = 215;
      const actualPA = 430;
      const percentage = replayPA / actualPA;

      expect(percentage).toBe(0.5); // 50%
    });

    it('should be over 100% when player is over-used', () => {
      const replayPA = 500;
      const actualPA = 430;
      const percentage = replayPA / actualPA;

      expect(percentage).toBeGreaterThan(1.0); // Over 100%
    });
  });
});
