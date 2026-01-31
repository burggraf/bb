import { describe, it, expect } from 'vitest';
import { MatchupModel } from './MatchupModel.js';
import type { Matchup } from './types.js';

describe('MatchupModel', () => {
  const model = new MatchupModel();

  // Create a simple test matchup
  const createTestMatchup = (): Matchup => ({
    batter: {
      id: 'batter-1',
      name: 'Test Batter',
      handedness: 'R',
      rates: {
        vsLeft: {
          out: 0.65,
          single: 0.18,
          double: 0.05,
          triple: 0.005,
          homeRun: 0.04,
          walk: 0.07,
          hitByPitch: 0.005,
        },
        vsRight: {
          out: 0.68,
          single: 0.16,
          double: 0.045,
          triple: 0.004,
          homeRun: 0.035,
          walk: 0.07,
          hitByPitch: 0.006,
        },
      },
    },
    pitcher: {
      id: 'pitcher-1',
      name: 'Test Pitcher',
      handedness: 'R',
      rates: {
        vsLeft: {
          out: 0.70,
          single: 0.14,
          double: 0.04,
          triple: 0.004,
          homeRun: 0.025,
          walk: 0.085,
          hitByPitch: 0.006,
        },
        vsRight: {
          out: 0.72,
          single: 0.13,
          double: 0.035,
          triple: 0.003,
          homeRun: 0.022,
          walk: 0.085,
          hitByPitch: 0.005,
        },
      },
    },
    league: {
      year: 2023,
      rates: {
        vsLeft: {
          out: 0.68,
          single: 0.155,
          double: 0.045,
          triple: 0.005,
          homeRun: 0.03,
          walk: 0.08,
          hitByPitch: 0.005,
        },
        vsRight: {
          out: 0.68,
          single: 0.155,
          double: 0.045,
          triple: 0.005,
          homeRun: 0.03,
          walk: 0.08,
          hitByPitch: 0.005,
        },
      },
    },
  });

  describe('predict', () => {
    it('should return a probability distribution', () => {
      const matchup = createTestMatchup();
      const distribution = model.predict(matchup);

      expect(distribution).toBeDefined();
      expect(distribution.out).toBeGreaterThan(0);
      expect(distribution.single).toBeGreaterThan(0);
      expect(distribution.double).toBeGreaterThan(0);
      expect(distribution.triple).toBeGreaterThan(0);
      expect(distribution.homeRun).toBeGreaterThan(0);
      expect(distribution.walk).toBeGreaterThan(0);
      expect(distribution.hitByPitch).toBeGreaterThan(0);
    });

    it('should have probabilities that sum to 1', () => {
      const matchup = createTestMatchup();
      const distribution = model.predict(matchup);

      const sum =
        distribution.out +
        distribution.single +
        distribution.double +
        distribution.triple +
        distribution.homeRun +
        distribution.walk +
        distribution.hitByPitch;

      expect(sum).toBeCloseTo(1.0, 5);
    });

    it('should handle switch hitters correctly', () => {
      const matchup = createTestMatchup();
      matchup.batter.handedness = 'S';

      // Should use vsLeft rates when facing LHP
      const vsLeft = model.predict(matchup);
      expect(vsLeft).toBeDefined();

      matchup.pitcher.handedness = 'L';

      const vsRight = model.predict(matchup);
      expect(vsRight).toBeDefined();
    });

    it('should throw error for invalid rates', () => {
      const invalidMatchup = createTestMatchup();
      invalidMatchup.batter.rates.vsRight.out = 2.0; // Invalid rate

      expect(() => model.predict(invalidMatchup)).toThrow();
    });
  });

  describe('sample', () => {
    it('should return a valid outcome', () => {
      const matchup = createTestMatchup();
      const distribution = model.predict(matchup);

      const outcome = model.sample(distribution);

      expect(['out', 'single', 'double', 'triple', 'homeRun', 'walk', 'hitByPitch']).toContain(
        outcome
      );
    });

    it('should sample according to distribution', () => {
      const matchup = createTestMatchup();
      const distribution = model.predict(matchup);

      const samples = 1000;
      const counts: Record<string, number> = {
        out: 0,
        single: 0,
        double: 0,
        triple: 0,
        homeRun: 0,
        walk: 0,
        hitByPitch: 0,
      };

      for (let i = 0; i < samples; i++) {
        const outcome = model.sample(distribution);
        counts[outcome]++;
      }

      // Check that observed frequencies are close to expected (within 10%)
      for (const [outcome, expected] of Object.entries(distribution)) {
        const observed = counts[outcome] / samples;
        expect(Math.abs(observed - expected)).toBeLessThan(0.1);
      }
    });
  });

  describe('simulate', () => {
    it('should return a valid outcome for a matchup', () => {
      const matchup = createTestMatchup();
      const outcome = model.simulate(matchup);

      expect(['out', 'single', 'double', 'triple', 'homeRun', 'walk', 'hitByPitch']).toContain(
        outcome
      );
    });
  });

  describe('config', () => {
    it('should have default coefficients', () => {
      const config = model.getConfig();

      expect(config.coefficients.batter).toBe(1);
      expect(config.coefficients.pitcher).toBe(1);
      expect(config.coefficients.league).toBe(-1);
    });

    it('should allow coefficient updates', () => {
      model.updateCoefficients({ batter: 1.2, pitcher: 0.9, league: -1.1 });

      const config = model.getConfig();
      expect(config.coefficients.batter).toBe(1.2);
      expect(config.coefficients.pitcher).toBe(0.9);
      expect(config.coefficients.league).toBe(-1.1);
    });
  });
});
