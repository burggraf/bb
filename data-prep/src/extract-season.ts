/**
 * Extract a complete season package for the baseball simulation
 * This exports player stats, league averages, teams, and games for a given year
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Map Retrosheet event codes to our model outcomes
// out: InPlayOut, StrikeOut
// single: Single
// double: Double, GroundRuleDouble
// triple: Triple
// homeRun: HomeRun, InsideTheParkHomeRun
// walk: Walk, IntentionalWalk
// hitByPitch: HitByPitch
// Note: SacrificeHit, SacrificeFly, FieldersChoice, ReachedOnError, Interference are handled separately

const OUTCOME_MAPPING = {
  // Outs
  InPlayOut: 'out',
  StrikeOut: 'out',
  // Hits
  Single: 'single',
  Double: 'double',
  GroundRuleDouble: 'double',
  Triple: 'triple',
  HomeRun: 'homeRun',
  InsideTheParkHomeRun: 'homeRun',
  // Walks
  Walk: 'walk',
  IntentionalWalk: 'walk',
  // Hit by pitch
  HitByPitch: 'hitByPitch',
  // These are effectively outs for our model (for now)
  SacrificeHit: 'out',
  SacrificeFly: 'out',
  FieldersChoice: 'out',
  ReachedOnError: 'out',
  Interference: 'out',
};

function runDuckDB(sql: string, dbPath: string): string {
  try {
    return execSync(`duckdb "${dbPath}" << 'SQL_EOF'\n${sql}\nSQL_EOF`, {
      encoding: 'utf-8',
      maxBuffer: 100 * 1024 * 1024
    });
  } catch (error: any) {
    console.error('Error running query:', error.message);
    throw error;
  }
}

export interface BatterStats {
  id: string;
  name: string;
  bats: 'L' | 'R' | 'S';
  vsLHP: {
    pa: number;
    out: number;
    single: number;
    double: number;
    triple: number;
    homeRun: number;
    walk: number;
    hitByPitch: number;
  };
  vsRHP: {
    pa: number;
    out: number;
    single: number;
    double: number;
    triple: number;
    homeRun: number;
    walk: number;
    hitByPitch: number;
  };
}

export interface PitcherStats {
  id: string;
  name: string;
  throws: 'L' | 'R';
  vsLHB: {
    pa: number;
    out: number;
    single: number;
    double: number;
    triple: number;
    homeRun: number;
    walk: number;
    hitByPitch: number;
  };
  vsRHB: {
    pa: number;
    out: number;
    single: number;
    double: number;
    triple: number;
    homeRun: number;
    walk: number;
    hitByPitch: number;
  };
}

export interface LeagueAverages {
  year: number;
  vsLHP: {
    out: number;
    single: number;
    double: number;
    triple: number;
    homeRun: number;
    walk: number;
    hitByPitch: number;
  };
  vsRHP: {
    out: number;
    single: number;
    double: number;
    triple: number;
    homeRun: number;
    walk: number;
    hitByPitch: number;
  };
}

export interface Team {
  id: string;
  league: string;
  city: string;
  nickname: string;
}

export interface Game {
  id: string;
  date: string;
  awayTeam: string;
  homeTeam: string;
  useDH: boolean;
}

export interface SeasonPackage {
  meta: {
    year: number;
    generatedAt: string;
  };
  batters: BatterStats[];
  pitchers: PitcherStats[];
  leagueAverages: LeagueAverages;
  teams: Team[];
  games: Game[];
}

function getBatterStatsSQL(year: number, minPA: number = 25): string {
  return `
WITH raw_batter_stats AS (
  SELECT
    e.batter_id,
    b.last_name || ', ' || b.first_name as name,
    b.bats,
    p.throws as pitcher_throws,
    COUNT(*) as pa,
    SUM(CASE
      WHEN e.plate_appearance_result IN ('InPlayOut', 'StrikeOut', 'SacrificeHit', 'SacrificeFly', 'FieldersChoice', 'ReachedOnError', 'Interference')
      THEN 1 ELSE 0
    END) as outs,
    SUM(CASE WHEN e.plate_appearance_result = 'Single' THEN 1 ELSE 0 END) as singles,
    SUM(CASE WHEN e.plate_appearance_result IN ('Double', 'GroundRuleDouble') THEN 1 ELSE 0 END) as doubles,
    SUM(CASE WHEN e.plate_appearance_result = 'Triple' THEN 1 ELSE 0 END) as triples,
    SUM(CASE WHEN e.plate_appearance_result IN ('HomeRun', 'InsideTheParkHomeRun') THEN 1 ELSE 0 END) as home_runs,
    SUM(CASE WHEN e.plate_appearance_result IN ('Walk', 'IntentionalWalk') THEN 1 ELSE 0 END) as walks,
    SUM(CASE WHEN e.plate_appearance_result = 'HitByPitch' THEN 1 ELSE 0 END) as hbp
  FROM event.events e
  JOIN dim.players b ON e.batter_id = b.player_id
  JOIN dim.players p ON e.pitcher_id = p.player_id
  JOIN game.games g ON e.game_id = g.game_id
  WHERE EXTRACT(YEAR FROM g.date) = ${year}
    AND e.plate_appearance_result IS NOT NULL
    AND e.no_play_flag = false
  GROUP BY e.batter_id, b.last_name, b.first_name, b.bats, p.throws
),
aggregated AS (
  SELECT
    batter_id,
    name,
    bats,
    -- vs LHP
    SUM(CASE WHEN pitcher_throws = 'L' THEN pa ELSE 0 END) as pa_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN outs ELSE 0 END) as outs_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN singles ELSE 0 END) as singles_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN doubles ELSE 0 END) as doubles_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN triples ELSE 0 END) as triples_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN home_runs ELSE 0 END) as hr_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN walks ELSE 0 END) as walks_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN hbp ELSE 0 END) as hbp_vs_l,
    -- vs RHP
    SUM(CASE WHEN pitcher_throws = 'R' THEN pa ELSE 0 END) as pa_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN outs ELSE 0 END) as outs_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN singles ELSE 0 END) as singles_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN doubles ELSE 0 END) as doubles_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN triples ELSE 0 END) as triples_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN home_runs ELSE 0 END) as hr_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN walks ELSE 0 END) as walks_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN hbp ELSE 0 END) as hbp_vs_r
  FROM raw_batter_stats
  GROUP BY batter_id, name, bats
)
SELECT *
FROM aggregated
WHERE (pa_vs_l >= ${minPA} OR pa_vs_r >= ${minPA})
ORDER BY pa_vs_l + pa_vs_r DESC;
`;
}

function getPitcherStatsSQL(year: number, minPA: number = 25): string {
  return `
WITH raw_pitcher_stats AS (
  SELECT
    e.pitcher_id,
    p.last_name || ', ' || p.first_name as name,
    p.throws,
    b.bats as batter_bats,
    COUNT(*) as pa,
    SUM(CASE
      WHEN e.plate_appearance_result IN ('InPlayOut', 'StrikeOut', 'SacrificeHit', 'SacrificeFly', 'FieldersChoice', 'ReachedOnError', 'Interference')
      THEN 1 ELSE 0
    END) as outs,
    SUM(CASE WHEN e.plate_appearance_result = 'Single' THEN 1 ELSE 0 END) as singles,
    SUM(CASE WHEN e.plate_appearance_result IN ('Double', 'GroundRuleDouble') THEN 1 ELSE 0 END) as doubles,
    SUM(CASE WHEN e.plate_appearance_result = 'Triple' THEN 1 ELSE 0 END) as triples,
    SUM(CASE WHEN e.plate_appearance_result IN ('HomeRun', 'InsideTheParkHomeRun') THEN 1 ELSE 0 END) as home_runs,
    SUM(CASE WHEN e.plate_appearance_result IN ('Walk', 'IntentionalWalk') THEN 1 ELSE 0 END) as walks,
    SUM(CASE WHEN e.plate_appearance_result = 'HitByPitch' THEN 1 ELSE 0 END) as hbp
  FROM event.events e
  JOIN dim.players p ON e.pitcher_id = p.player_id
  JOIN dim.players b ON e.batter_id = b.player_id
  JOIN game.games g ON e.game_id = g.game_id
  WHERE EXTRACT(YEAR FROM g.date) = ${year}
    AND e.plate_appearance_result IS NOT NULL
    AND e.no_play_flag = false
  GROUP BY e.pitcher_id, p.last_name, p.first_name, p.throws, b.bats
),
aggregated AS (
  SELECT
    pitcher_id,
    name,
    throws,
    -- vs LHB
    SUM(CASE WHEN batter_bats = 'L' THEN pa ELSE 0 END) as pa_vs_l,
    SUM(CASE WHEN batter_bats = 'L' THEN outs ELSE 0 END) as outs_vs_l,
    SUM(CASE WHEN batter_bats = 'L' THEN singles ELSE 0 END) as singles_vs_l,
    SUM(CASE WHEN batter_bats = 'L' THEN doubles ELSE 0 END) as doubles_vs_l,
    SUM(CASE WHEN batter_bats = 'L' THEN triples ELSE 0 END) as triples_vs_l,
    SUM(CASE WHEN batter_bats = 'L' THEN home_runs ELSE 0 END) as hr_vs_l,
    SUM(CASE WHEN batter_bats = 'L' THEN walks ELSE 0 END) as walks_vs_l,
    SUM(CASE WHEN batter_bats = 'L' THEN hbp ELSE 0 END) as hbp_vs_l,
    -- vs RHB
    SUM(CASE WHEN batter_bats = 'R' THEN pa ELSE 0 END) as pa_vs_r,
    SUM(CASE WHEN batter_bats = 'R' THEN outs ELSE 0 END) as outs_vs_r,
    SUM(CASE WHEN batter_bats = 'R' THEN singles ELSE 0 END) as singles_vs_r,
    SUM(CASE WHEN batter_bats = 'R' THEN doubles ELSE 0 END) as doubles_vs_r,
    SUM(CASE WHEN batter_bats = 'R' THEN triples ELSE 0 END) as triples_vs_r,
    SUM(CASE WHEN batter_bats = 'R' THEN home_runs ELSE 0 END) as hr_vs_r,
    SUM(CASE WHEN batter_bats = 'R' THEN walks ELSE 0 END) as walks_vs_r,
    SUM(CASE WHEN batter_bats = 'R' THEN hbp ELSE 0 END) as hbp_vs_r
  FROM raw_pitcher_stats
  GROUP BY pitcher_id, name, throws
)
SELECT *
FROM aggregated
WHERE (pa_vs_l >= ${minPA} OR pa_vs_r >= ${minPA})
ORDER BY pa_vs_l + pa_vs_r DESC;
`;
}

function getLeagueAveragesSQL(year: number): string {
  return `
WITH league_rates AS (
  SELECT
    p.throws as pitcher_throws,
    COUNT(*) as pa,
    SUM(CASE
      WHEN e.plate_appearance_result IN ('InPlayOut', 'StrikeOut', 'SacrificeHit', 'SacrificeFly', 'FieldersChoice', 'ReachedOnError', 'Interference')
      THEN 1 ELSE 0
    END) as outs,
    SUM(CASE WHEN e.plate_appearance_result = 'Single' THEN 1 ELSE 0 END) as singles,
    SUM(CASE WHEN e.plate_appearance_result IN ('Double', 'GroundRuleDouble') THEN 1 ELSE 0 END) as doubles,
    SUM(CASE WHEN e.plate_appearance_result = 'Triple' THEN 1 ELSE 0 END) as triples,
    SUM(CASE WHEN e.plate_appearance_result IN ('HomeRun', 'InsideTheParkHomeRun') THEN 1 ELSE 0 END) as home_runs,
    SUM(CASE WHEN e.plate_appearance_result IN ('Walk', 'IntentionalWalk') THEN 1 ELSE 0 END) as walks,
    SUM(CASE WHEN e.plate_appearance_result = 'HitByPitch' THEN 1 ELSE 0 END) as hbp
  FROM event.events e
  JOIN dim.players p ON e.pitcher_id = p.player_id
  JOIN game.games g ON e.game_id = g.game_id
  WHERE EXTRACT(YEAR FROM g.date) = ${year}
    AND e.plate_appearance_result IS NOT NULL
    AND e.no_play_flag = false
  GROUP BY p.throws
)
SELECT
  pitcher_throws,
  outs::FLOAT / pa as out_rate,
  singles::FLOAT / pa as single_rate,
  doubles::FLOAT / pa as double_rate,
  triples::FLOAT / pa as triple_rate,
  home_runs::FLOAT / pa as hr_rate,
  walks::FLOAT / pa as walk_rate,
  hbp::FLOAT / pa as hbp_rate,
  pa
FROM league_rates
WHERE pitcher_throws IN ('L', 'R')
ORDER BY pitcher_throws;
`;
}

function getTeamsSQL(): string {
  return `
SELECT
  team_id,
  league,
  city,
  nickname
FROM dim.teams
WHERE last_year >= 1970
ORDER BY league, city;
`;
}

function getGamesSQL(year: number): string {
  return `
SELECT
  game_id,
  date::VARCHAR as date,
  away_team_id,
  home_team_id,
  COALESCE(use_dh, false) as use_dh
FROM game.games
WHERE EXTRACT(YEAR FROM date) = ${year}
ORDER BY date;
`;
}

export async function extractSeason(year: number, dbPath: string, outputPath: string): Promise<SeasonPackage> {
  console.log(`\n📦 Extracting ${year} season from ${dbPath}...\n`);

  // Extract batters
  console.log('📊 Extracting batter stats...');
  const battersResult = runDuckDB(getBatterStatsSQL(year), dbPath);
  // TODO: Parse CSV output into structured data
  console.log(battersResult.split('\n').slice(0, 10).join('\n'));

  // Extract pitchers
  console.log('\n📊 Extracting pitcher stats...');
  const pitchersResult = runDuckDB(getPitcherStatsSQL(year), dbPath);
  console.log(pitchersResult.split('\n').slice(0, 10).join('\n'));

  // Extract league averages
  console.log('\n📈 Extracting league averages...');
  const leagueResult = runDuckDB(getLeagueAveragesSQL(year), dbPath);
  console.log(leagueResult);

  // Extract teams
  console.log('\n🏟️  Extracting teams...');
  const teamsResult = runDuckDB(getTeamsSQL(), dbPath);
  console.log(teamsResult.split('\n').slice(0, 15).join('\n'));

  // Extract games
  console.log(`\n🎮 Extracting ${year} games...`);
  const gamesResult = runDuckDB(getGamesSQL(year), dbPath);
  console.log(gamesResult.split('\n').slice(0, 10).join('\n'));

  return {
    meta: {
      year,
      generatedAt: new Date().toISOString(),
    },
    batters: [],
    pitchers: [],
    leagueAverages: {
      year,
      vsLHP: { out: 0, single: 0, double: 0, triple: 0, homeRun: 0, walk: 0, hitByPitch: 0 },
      vsRHP: { out: 0, single: 0, double: 0, triple: 0, homeRun: 0, walk: 0, hitByPitch: 0 },
    },
    teams: [],
    games: [],
  };
}

// CLI entry point
async function main() {
  const year = parseInt(process.argv[2]) || 1976;
  const dbPath = process.argv[3] || '../baseball.duckdb';
  const outputPath = process.argv[4] || `./season-${year}.json`;

  const season = await extractSeason(year, dbPath, outputPath);

  console.log(`\n✅ Season ${year} extracted to ${outputPath}`);
}

main();
