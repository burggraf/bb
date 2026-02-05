import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestSeasonDB } from './helpers/season-db.js';

describe('TestSeasonDB', () => {
  let db: TestSeasonDB;

  beforeEach(() => {
    db = new TestSeasonDB('../../app/static/seasons/1976.sqlite');
  });

  afterEach(() => {
    db.close();
  });

  it('should load season metadata', () => {
    const meta = db.getMeta();
    expect(meta.year).toBe(1976);
    expect(meta.generatedAt).toBeTruthy();
    expect(meta.version).toBeTruthy();
  });

  it('should get a batter by ID', () => {
    const batter = db.getBatter('carer001'); // Rod Carew

    expect(batter).not.toBeNull();
    expect(batter!.name).toBeTruthy();
    expect(batter!.bats).toMatch(/^[LRS]$/);
    expect(batter!.rates.vsLHP).toBeDefined();
    expect(batter!.rates.vsRHP).toBeDefined();
  });

  it('should get all batters for a team', () => {
    const batters = db.getBattersByTeam('MIN'); // Minnesota Twins

    expect(Object.keys(batters).length).toBeGreaterThan(0);

    // Verify structure
    const firstBatter = Object.values(batters)[0];
    expect(firstBatter.id).toBeTruthy();
    expect(firstBatter.rates.vsLHP).toBeDefined();
    expect(firstBatter.rates.vsRHP).toBeDefined();
  });

  it('should get a pitcher by ID', () => {
    const pitcher = db.getPitcher('palmj001'); // Jim Palmer

    expect(pitcher).not.toBeNull();
    expect(pitcher!.name).toBeTruthy();
    expect(pitcher!.throws).toMatch(/^[LR]$/);
    expect(pitcher!.rates.vsLHB).toBeDefined();
    expect(pitcher!.rates.vsRHB).toBeDefined();
  });

  it('should get league averages', () => {
    const league = db.getLeagueAverages();

    expect(league.vsLHP).toBeDefined();
    expect(league.vsRHP).toBeDefined();

    // Verify rates sum to approximately 1.0 (probabilities)
    const vsLHPSum = Object.values(league.vsLHP).reduce((sum, val) => sum + val, 0);
    expect(vsLHPSum).toBeCloseTo(1.0, 3);
  });
});
