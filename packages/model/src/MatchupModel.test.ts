import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MatchupModel } from './MatchupModel.js';
import type { Matchup, EventRates } from './types.js';
import { TestSeasonDB, type BatterStats, type PitcherStats } from '../test/helpers/season-db.js';

/**
 * Helper function to create valid 17-outcome EventRates
 * Normalizes the rates to sum to 1.0
 */
function makeEventRates(overrides: Partial<EventRates> = {}): EventRates {
  const base: EventRates = {
    single: 0.163,
    double: 0.041,
    triple: 0.007,
    homeRun: 0.021,
    walk: 0.079,
    hitByPitch: 0.007,
    strikeout: 0.144,
    groundOut: 0.121,
    flyOut: 0.078,
    lineOut: 0.033,
    popOut: 0.034,
    sacrificeFly: 0.007,
    sacrificeBunt: 0.011,
    fieldersChoice: 0.005,
    reachedOnError: 0.013,
    catcherInterference: 0.0001,
  };
  // Normalize to sum to 1.0
  const merged = { ...base, ...overrides };
  const sum = Object.values(merged).reduce((a, b) => a + b, 0);
  for (const key of Object.keys(merged) as (keyof EventRates)[]) {
    merged[key] = merged[key] / sum;
  }
  return merged;
}

describe('MatchupModel', () => {
  const model = new MatchupModel();

  // Create a simple test matchup
  const createTestMatchup = (): Matchup => ({
    batter: {
      id: 'batter-1',
      name: 'Test Batter',
      handedness: 'R',
      rates: {
        vsLeft: makeEventRates({ homeRun: 0.05 }), // power vs LHP
        vsRight: makeEventRates({ homeRun: 0.02 }), // normal vs RHP
      },
    },
    pitcher: {
      id: 'pitcher-1',
      name: 'Test Pitcher',
      handedness: 'R',
      rates: {
        vsLeft: makeEventRates({ strikeout: 0.18, groundOut: 0.15 }), // high K vs LHB
        vsRight: makeEventRates({ strikeout: 0.16, flyOut: 0.10 }), // moderate vs RHB
      },
    },
    league: {
      year: 2023,
      rates: {
        vsLeft: makeEventRates(),
        vsRight: makeEventRates(),
      },
    },
  });

  describe('predict', () => {
    it('should return a probability distribution', () => {
      const matchup = createTestMatchup();
      const distribution = model.predict(matchup);

      expect(distribution).toBeDefined();
      // Check a representative sample of the 17 outcomes
      expect(distribution.single).toBeGreaterThan(0);
      expect(distribution.double).toBeGreaterThan(0);
      expect(distribution.triple).toBeGreaterThan(0);
      expect(distribution.homeRun).toBeGreaterThan(0);
      expect(distribution.walk).toBeGreaterThan(0);
      expect(distribution.hitByPitch).toBeGreaterThan(0);
      expect(distribution.strikeout).toBeGreaterThan(0);
      expect(distribution.groundOut).toBeGreaterThan(0);
      expect(distribution.flyOut).toBeGreaterThan(0);
      expect(distribution.lineOut).toBeGreaterThan(0);
      expect(distribution.popOut).toBeGreaterThan(0);
      expect(distribution.sacrificeFly).toBeGreaterThan(0);
      expect(distribution.sacrificeBunt).toBeGreaterThan(0);
      expect(distribution.fieldersChoice).toBeGreaterThan(0);
      expect(distribution.reachedOnError).toBeGreaterThan(0);
      expect(distribution.catcherInterference).toBeGreaterThan(0);
    });

    it('should have probabilities that sum to 1', () => {
      const matchup = createTestMatchup();
      const distribution = model.predict(matchup);

      // Sum all 17 outcomes
      const sum = Object.values(distribution).reduce((a, b) => a + b, 0);

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
      // Use strikeout instead of the old 'out' outcome
      invalidMatchup.batter.rates.vsRight.strikeout = 2.0; // Invalid rate

      expect(() => model.predict(invalidMatchup)).toThrow();
    });
  });

  describe('sample', () => {
    it('should return a valid outcome', () => {
      const matchup = createTestMatchup();
      const distribution = model.predict(matchup);

      const outcome = model.sample(distribution);

      // All 17 valid outcomes
      const validOutcomes = [
        'single',
        'double',
        'triple',
        'homeRun',
        'walk',
        'hitByPitch',
        'strikeout',
        'groundOut',
        'flyOut',
        'lineOut',
        'popOut',
        'sacrificeFly',
        'sacrificeBunt',
        'fieldersChoice',
        'reachedOnError',
        'catcherInterference',
      ] as const;

      expect(validOutcomes).toContain(outcome as any);
    });

    it('should sample according to distribution', () => {
      const matchup = createTestMatchup();
      const distribution = model.predict(matchup);

      const samples = 1000;
      const counts: Record<string, number> = {
        single: 0,
        double: 0,
        triple: 0,
        homeRun: 0,
        walk: 0,
        hitByPitch: 0,
        strikeout: 0,
        groundOut: 0,
        flyOut: 0,
        lineOut: 0,
        popOut: 0,
        sacrificeFly: 0,
        sacrificeBunt: 0,
        fieldersChoice: 0,
        reachedOnError: 0,
        catcherInterference: 0,
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

      // All 17 valid outcomes
      const validOutcomes = [
        'single',
        'double',
        'triple',
        'homeRun',
        'walk',
        'hitByPitch',
        'strikeout',
        'groundOut',
        'flyOut',
        'lineOut',
        'popOut',
        'sacrificeFly',
        'sacrificeBunt',
        'fieldersChoice',
        'reachedOnError',
        'catcherInterference',
      ] as const;

      expect(validOutcomes).toContain(outcome as any);
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

describe('MatchupModel - with real season data', () => {
  let db: TestSeasonDB;

  beforeAll(() => {
    db = new TestSeasonDB('../../app/static/seasons/1976.sqlite');
  });

  afterAll(() => {
    db.close();
  });

  it('should predict outcomes for actual players', () => {
    const batter = db.getBatter('carer001'); // Rod Carew
    const pitcher = db.getPitcher('palmj001'); // Jim Palmer
    const league = db.getLeagueAverages();

    if (!batter || !pitcher) {
      throw new Error('Test data not found - ensure SQLite file exists');
    }

    const model = new MatchupModel();
    const distribution = model.predict({
      batter: {
        id: batter.id,
        name: batter.name,
        handedness: batter.bats,
        rates: {
          vsLeft: batter.rates.vsLHP,
          vsRight: batter.rates.vsRHP,
        },
      },
      pitcher: {
        id: pitcher.id,
        name: pitcher.name,
        handedness: pitcher.throws,
        rates: {
          vsLeft: pitcher.rates.vsLHB,
          vsRight: pitcher.rates.vsRHB,
        },
      },
      league: {
        year: 1976,
        rates: {
          vsLeft: league.vsLHP,
          vsRight: league.vsRHP,
        },
      },
    });

    // Validate distribution
    const sum = Object.values(distribution).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1, 4);
    expect(distribution.homeRun).toBeGreaterThan(0);
    expect(distribution.strikeout).toBeGreaterThan(0);
    expect(distribution.walk).toBeGreaterThan(0);
  });
});
