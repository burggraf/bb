/**
 * Test helper for accessing season SQLite databases
 * Opens the same SQLite files used in production for 100% parity
 */

import Database from 'better-sqlite3';

// Local type definitions matching SQLite schema (app-level data structure)
interface EventRates {
  single: number;
  double: number;
  triple: number;
  homeRun: number;
  walk: number;
  hitByPitch: number;
  strikeout: number;
  groundOut: number;
  flyOut: number;
  lineOut: number;
  popOut: number;
  sacrificeFly: number;
  sacrificeBunt: number;
  fieldersChoice: number;
  reachedOnError: number;
  catcherInterference: number;
}

interface SplitRates {
  vsLHP: EventRates;
  vsRHP: EventRates;
}

export interface BatterStats {
  id: string;
  name: string;
  bats: 'L' | 'R' | 'S';
  teamId: string;
  primaryPosition: number;
  positionEligibility: Record<number, number>;
  pa: number;
  avg: number;
  obp: number;
  slg: number;
  ops: number;
  rates: SplitRates;
}

export interface PitcherStats {
  id: string;
  name: string;
  throws: 'L' | 'R';
  teamId: string;
  avgBfpAsStarter: number | null;
  avgBfpAsReliever: number | null;
  games: number;
  gamesStarted: number;
  completeGames: number;
  saves: number;
  inningsPitched: number;
  whip: number;
  era: number;
  rates: {
    vsLHB: EventRates;
    vsRHB: EventRates;
  };
}

export class TestSeasonDB {
  private db: Database.Database;

  constructor(sqlitePath: string) {
    this.db = new Database(sqlitePath, { readonly: true });
  }

  /**
   * Get a single batter by ID
   */
  getBatter(id: string): BatterStats | null {
    const batterRow = this.db.prepare(`
      SELECT * FROM batters WHERE id = ?
    `).get(id) as any;

    if (!batterRow) return null;

    const ratesRows = this.db.prepare(`
      SELECT * FROM batter_rates WHERE batter_id = ?
    `).all(id) as any[];

    const rates: SplitRates = { vsLHP: {} as EventRates, vsRHP: {} as EventRates };
    for (const row of ratesRows) {
      const key = row.split === 'vsLHP' ? 'vsLHP' : 'vsRHP';
      rates[key] = {
        single: row.single,
        double: row.double,
        triple: row.triple,
        homeRun: row.home_run,
        walk: row.walk,
        hitByPitch: row.hit_by_pitch,
        strikeout: row.strikeout,
        groundOut: row.ground_out,
        flyOut: row.fly_out,
        lineOut: row.line_out,
        popOut: row.pop_out,
        sacrificeFly: row.sacrifice_fly,
        sacrificeBunt: row.sacrifice_bunt,
        fieldersChoice: row.fielders_choice,
        reachedOnError: row.reached_on_error,
        catcherInterference: row.catcher_interference,
      };
    }

    return {
      id: batterRow.id,
      name: batterRow.name,
      bats: batterRow.bats,
      teamId: batterRow.team_id,
      primaryPosition: batterRow.primary_position,
      positionEligibility: JSON.parse(batterRow.position_eligibility),
      pa: batterRow.pa,
      avg: batterRow.avg,
      obp: batterRow.obp,
      slg: batterRow.slg,
      ops: batterRow.ops,
      rates,
    };
  }

  /**
   * Get all batters for a team
   */
  getBattersByTeam(teamId: string): Record<string, BatterStats> {
    const rows = this.db.prepare(`
      SELECT id FROM batters WHERE team_id = ?
    `).all(teamId) as any[];

    const batters: Record<string, BatterStats> = {};
    for (const row of rows) {
      const batter = this.getBatter(row.id);
      if (batter) batters[row.id] = batter;
    }

    return batters;
  }

  /**
   * Get all batters
   */
  getAllBatters(): Record<string, BatterStats> {
    const rows = this.db.prepare(`SELECT id FROM batters`).all() as any[];

    const batters: Record<string, BatterStats> = {};
    for (const row of rows) {
      const batter = this.getBatter(row.id);
      if (batter) batters[row.id] = batter;
    }

    return batters;
  }

  /**
   * Get a single pitcher by ID
   */
  getPitcher(id: string): PitcherStats | null {
    const pitcherRow = this.db.prepare(`
      SELECT * FROM pitchers WHERE id = ?
    `).get(id) as any;

    if (!pitcherRow) return null;

    const ratesRows = this.db.prepare(`
      SELECT * FROM pitcher_rates WHERE pitcher_id = ?
    `).all(id) as any[];

    const rates: any = { vsLHB: {} as EventRates, vsRHB: {} as EventRates };
    for (const row of ratesRows) {
      const key = row.split === 'vsLHB' ? 'vsLHB' : 'vsRHB';
      rates[key] = {
        single: row.single,
        double: row.double,
        triple: row.triple,
        homeRun: row.home_run,
        walk: row.walk,
        hitByPitch: row.hit_by_pitch,
        strikeout: row.strikeout,
        groundOut: row.ground_out,
        flyOut: row.fly_out,
        lineOut: row.line_out,
        popOut: row.pop_out,
        sacrificeFly: row.sacrifice_fly,
        sacrificeBunt: row.sacrifice_bunt,
        fieldersChoice: row.fielders_choice,
        reachedOnError: row.reached_on_error,
        catcherInterference: row.catcher_interference,
      };
    }

    return {
      id: pitcherRow.id,
      name: pitcherRow.name,
      throws: pitcherRow.throws,
      teamId: pitcherRow.team_id,
      avgBfpAsStarter: pitcherRow.avg_bfp_as_starter,
      avgBfpAsReliever: pitcherRow.avg_bfp_as_reliever,
      games: pitcherRow.games,
      gamesStarted: pitcherRow.games_started,
      completeGames: pitcherRow.complete_games,
      saves: pitcherRow.saves,
      inningsPitched: pitcherRow.innings_pitched,
      whip: pitcherRow.whip,
      era: pitcherRow.era,
      rates,
    };
  }

  /**
   * Get all pitchers for a team
   */
  getPitchersByTeam(teamId: string): Record<string, PitcherStats> {
    const rows = this.db.prepare(`
      SELECT id FROM pitchers WHERE team_id = ?
    `).all(teamId) as any[];

    const pitchers: Record<string, PitcherStats> = {};
    for (const row of rows) {
      const pitcher = this.getPitcher(row.id);
      if (pitcher) pitchers[row.id] = pitcher;
    }

    return pitchers;
  }

  /**
   * Get all pitchers
   */
  getAllPitchers(): Record<string, PitcherStats> {
    const rows = this.db.prepare(`SELECT id FROM pitchers`).all() as any[];

    const pitchers: Record<string, PitcherStats> = {};
    for (const row of rows) {
      const pitcher = this.getPitcher(row.id);
      if (pitcher) pitchers[row.id] = pitcher;
    }

    return pitchers;
  }

  /**
   * Get league averages
   */
  getLeagueAverages(): { vsLHP: EventRates; vsRHP: EventRates } {
    const rows = this.db.prepare('SELECT * FROM league_averages').all() as any[];

    const result: any = { vsLHP: {} as EventRates, vsRHP: {} as EventRates };

    for (const row of rows) {
      const key = row.split === 'vsLHP' ? 'vsLHP' : 'vsRHP';
      result[key] = {
        single: row.single,
        double: row.double,
        triple: row.triple,
        homeRun: row.home_run,
        walk: row.walk,
        hitByPitch: row.hit_by_pitch,
        strikeout: row.strikeout,
        groundOut: row.ground_out,
        flyOut: row.fly_out,
        lineOut: row.line_out,
        popOut: row.pop_out,
        sacrificeFly: row.sacrifice_fly,
        sacrificeBunt: row.sacrifice_bunt,
        fieldersChoice: row.fielders_choice,
        reachedOnError: row.reached_on_error,
        catcherInterference: row.catcher_interference,
      };
    }

    return result;
  }

  /**
   * Get season metadata
   */
  getMeta(): { year: number; generatedAt: string; version: string } {
    const row = this.db.prepare('SELECT * FROM meta LIMIT 1').get() as any;
    return {
      year: row.year,
      generatedAt: row.generated_at,
      version: row.version,
    };
  }

  /**
   * Get teams
   */
  getTeams(): Record<string, { id: string; league: string; city: string; nickname: string }> {
    const rows = this.db.prepare('SELECT * FROM teams').all() as any[];

    const teams: Record<string, any> = {};
    for (const row of rows) {
      teams[row.id] = {
        id: row.id,
        league: row.league,
        city: row.city,
        nickname: row.nickname,
      };
    }

    return teams;
  }

  /**
   * Get games
   */
  getGames(): Array<{ id: string; date: string; awayTeam: string; homeTeam: string; useDH: boolean }> {
    const rows = this.db.prepare('SELECT * FROM games').all() as any[];

    return rows.map((row: any) => ({
      id: row.id,
      date: row.date,
      awayTeam: row.away_team,
      homeTeam: row.home_team,
      useDH: row.use_dh === 1,
    }));
  }

  close(): void {
    this.db.close();
  }
}
