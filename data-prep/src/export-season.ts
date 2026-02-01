/**
 * Parse DuckDB table output (CSV-like with box-drawing characters)
 */

function parseDuckDBOutput(output: string): any[] {
  const lines = output.split('\n').filter(l => l.trim());

  // Find data rows (between the header rows and footer)
  const dataStart = lines.findIndex(l => l.includes('├')) + 1;
  const dataEnd = lines.findIndex(l => l.includes('├'), dataStart);
  if (dataEnd === -1) return [];

  const headerLine = lines[dataStart - 2];
  const typeLine = lines[dataStart - 1];

  // Extract column names from header
  const headers: string[] = [];
  const headerParts = headerLine.split('│').map(s => s.trim()).filter(s => s);
  for (const h of headerParts) {
    headers.push(h);
  }

  // Parse data rows
  const results: any[] = [];
  for (let i = dataStart; i < dataEnd; i++) {
    const line = lines[i];
    if (line.includes('═') || line.trim() === '') continue;

    const values: string[] = [];
    const parts = line.split('│').map(s => s.trim()).filter(s => s !== '');
    // Skip the first empty element from split
    for (let j = 1; j < parts.length; j++) {
      values.push(parts[j]);
    }

    const row: any = {};
    for (let j = 0; j < Math.min(headers.length, values.length); j++) {
      row[headers[j]] = values[j];
    }
    results.push(row);
  }

  return results;
}

function parseNumber(value: string): number {
  if (!value || value === 'NULL' || value === '') return 0;
  const parsed = parseFloat(value.replace(/,/g, ''));
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Create a complete season package for a given year
 */

import { execSync } from 'child_process';
import * as fs from 'fs';

function runDuckDB(sql: string, dbPath: string): string {
  try {
    // Use .mode csv to get CSV output instead of table
    return execSync(`echo ".mode csv\n.headers on\n${sql}" | duckdb "${dbPath}"`, {
      encoding: 'utf-8',
      maxBuffer: 100 * 1024 * 1024
    });
  } catch (error: any) {
    console.error('Error running query:', error.message);
    throw error;
  }
}

function parseCSV(csv: string): any[] {
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length === 0) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const results: any[] = [];

  for (let i = 1; i < lines.length; i++) {
    // Parse CSV properly handling quoted strings
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (const char of lines[i]) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim().replace(/^"|"$/g, ''));
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim().replace(/^"|"$/g, ''));

    if (values.length !== headers.length || values[0] === '') continue;

    const row: any = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j];
    }
    results.push(row);
  }

  return results;
}

function getBatterStatsSQL(year: number, minPA: number = 25): string {
  return `
WITH raw_batter_stats AS (
  SELECT
    e.batter_id,
    b.last_name || ', ' || b.first_name as name,
    b.bats,
    p.throws as pitcher_throws,
    e.batting_team_id,
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
  GROUP BY e.batter_id, b.last_name, b.first_name, b.bats, p.throws, e.batting_team_id
),
-- Find primary team for each batter (most PAs)
batter_primary_team AS (
  SELECT
    batter_id,
    batting_team_id,
    SUM(pa) as team_pa
  FROM raw_batter_stats
  GROUP BY batter_id, batting_team_id
),
batter_best_team AS (
  SELECT
    batter_id,
    batting_team_id as primary_team_id,
    ROW_NUMBER() OVER (PARTITION BY batter_id ORDER BY team_pa DESC) as rn
  FROM batter_primary_team
),
aggregated AS (
  SELECT
    r.batter_id,
    r.name,
    r.bats,
    bt.primary_team_id,
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
  FROM raw_batter_stats r
  JOIN batter_best_team bt ON r.batter_id = bt.batter_id AND bt.rn = 1
  GROUP BY r.batter_id, r.name, r.bats, bt.primary_team_id
)
SELECT * FROM aggregated
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
    e.fielding_team_id,
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
  GROUP BY e.pitcher_id, p.last_name, p.first_name, p.throws, b.bats, e.fielding_team_id
),
-- Find primary team for each pitcher (most PAs)
pitcher_primary_team AS (
  SELECT
    pitcher_id,
    fielding_team_id,
    SUM(pa) as team_pa
  FROM raw_pitcher_stats
  GROUP BY pitcher_id, fielding_team_id
),
pitcher_best_team AS (
  SELECT
    pitcher_id,
    fielding_team_id as primary_team_id,
    ROW_NUMBER() OVER (PARTITION BY pitcher_id ORDER BY team_pa DESC) as rn
  FROM pitcher_primary_team
),
aggregated AS (
  SELECT
    r.pitcher_id,
    r.name,
    r.throws,
    pt.primary_team_id,
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
  FROM raw_pitcher_stats r
  JOIN pitcher_best_team pt ON r.pitcher_id = pt.pitcher_id AND pt.rn = 1
  GROUP BY r.pitcher_id, r.name, r.throws, pt.primary_team_id
)
SELECT * FROM aggregated
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
  hbp::FLOAT / pa as hbp_rate
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

export interface SeasonPackage {
  meta: {
    year: number;
    generatedAt: string;
    version: string;
  };
  batters: Record<string, {
    id: string;
    name: string;
    bats: 'L' | 'R' | 'S';
    teamId: string;
    rates: {
      vsLHP: { out: number; single: number; double: number; triple: number; homeRun: number; walk: number; hitByPitch: number };
      vsRHP: { out: number; single: number; double: number; triple: number; homeRun: number; walk: number; hitByPitch: number };
    };
  }>;
  pitchers: Record<string, {
    id: string;
    name: string;
    throws: 'L' | 'R';
    teamId: string;
    rates: {
      vsLHB: { out: number; single: number; double: number; triple: number; homeRun: number; walk: number; hitByPitch: number };
      vsRHB: { out: number; single: number; double: number; triple: number; homeRun: number; walk: number; hitByPitch: number };
    };
  }>;
  league: {
    vsLHP: { out: number; single: number; double: number; triple: number; homeRun: number; walk: number; hitByPitch: number };
    vsRHP: { out: number; single: number; double: number; triple: number; homeRun: number; walk: number; hitByPitch: number };
  };
  teams: Record<string, { id: string; league: string; city: string; nickname: string }>;
  games: Array<{ id: string; date: string; awayTeam: string; homeTeam: string; useDH: boolean }>;
}

function calcRate(count: number, pa: number): number {
  if (pa === 0) return 0;
  return Math.round((count / pa) * 10000) / 10000;
}

export async function exportSeason(year: number, dbPath: string, outputPath: string): Promise<SeasonPackage> {
  console.log(`📦 Exporting ${year} season to ${outputPath}...\n`);

  // Extract batters
  console.log('  📊 Batters...');
  const battersResult = runDuckDB(getBatterStatsSQL(year), dbPath);
  const battersRaw = parseCSV(battersResult);
  const batters: SeasonPackage['batters'] = {};

  for (const row of battersRaw) {
    const paL = parseNumber(row.pa_vs_l);
    const paR = parseNumber(row.pa_vs_r);

    batters[row.batter_id] = {
      id: row.batter_id,
      name: row.name,
      bats: row.bats === 'B' ? 'S' : row.bats, // Convert 'B' (both) to 'S' (switch)
      teamId: row.primary_team_id,
      rates: {
        vsLHP: {
          out: calcRate(parseNumber(row.outs_vs_l), paL),
          single: calcRate(parseNumber(row.singles_vs_l), paL),
          double: calcRate(parseNumber(row.doubles_vs_l), paL),
          triple: calcRate(parseNumber(row.triples_vs_l), paL),
          homeRun: calcRate(parseNumber(row.hr_vs_l), paL),
          walk: calcRate(parseNumber(row.walks_vs_l), paL),
          hitByPitch: calcRate(parseNumber(row.hbp_vs_l), paL),
        },
        vsRHP: {
          out: calcRate(parseNumber(row.outs_vs_r), paR),
          single: calcRate(parseNumber(row.singles_vs_r), paR),
          double: calcRate(parseNumber(row.doubles_vs_r), paR),
          triple: calcRate(parseNumber(row.triples_vs_r), paR),
          homeRun: calcRate(parseNumber(row.hr_vs_r), paR),
          walk: calcRate(parseNumber(row.walks_vs_r), paR),
          hitByPitch: calcRate(parseNumber(row.hbp_vs_r), paR),
        },
      },
    };
  }
  console.log(`    ✓ ${Object.keys(batters).length} batters`);

  // Extract pitchers
  console.log('  📊 Pitchers...');
  const pitchersResult = runDuckDB(getPitcherStatsSQL(year), dbPath);
  const pitchersRaw = parseCSV(pitchersResult);
  const pitchers: SeasonPackage['pitchers'] = {};

  for (const row of pitchersRaw) {
    const paL = parseNumber(row.pa_vs_l);
    const paR = parseNumber(row.pa_vs_r);

    pitchers[row.pitcher_id] = {
      id: row.pitcher_id,
      name: row.name,
      throws: row.throws,
      teamId: row.primary_team_id,
      rates: {
        vsLHB: {
          out: calcRate(parseNumber(row.outs_vs_l), paL),
          single: calcRate(parseNumber(row.singles_vs_l), paL),
          double: calcRate(parseNumber(row.doubles_vs_l), paL),
          triple: calcRate(parseNumber(row.triples_vs_l), paL),
          homeRun: calcRate(parseNumber(row.hr_vs_l), paL),
          walk: calcRate(parseNumber(row.walks_vs_l), paL),
          hitByPitch: calcRate(parseNumber(row.hbp_vs_l), paL),
        },
        vsRHB: {
          out: calcRate(parseNumber(row.outs_vs_r), paR),
          single: calcRate(parseNumber(row.singles_vs_r), paR),
          double: calcRate(parseNumber(row.doubles_vs_r), paR),
          triple: calcRate(parseNumber(row.triples_vs_r), paR),
          homeRun: calcRate(parseNumber(row.hr_vs_r), paR),
          walk: calcRate(parseNumber(row.walks_vs_r), paR),
          hitByPitch: calcRate(parseNumber(row.hbp_vs_r), paR),
        },
      },
    };
  }
  console.log(`    ✓ ${Object.keys(pitchers).length} pitchers`);

  // Extract league averages
  console.log('  📈 League averages...');
  const leagueResult = runDuckDB(getLeagueAveragesSQL(year), dbPath);
  const leagueRaw = parseCSV(leagueResult);
  const league: SeasonPackage['league'] = {
    vsLHP: { out: 0, single: 0, double: 0, triple: 0, homeRun: 0, walk: 0, hitByPitch: 0 },
    vsRHP: { out: 0, single: 0, double: 0, triple: 0, homeRun: 0, walk: 0, hitByPitch: 0 },
  };

  for (const row of leagueRaw) {
    if (row.pitcher_throws === 'L') {
      league.vsLHP = {
        out: Math.round(parseNumber(row.out_rate) * 10000) / 10000,
        single: Math.round(parseNumber(row.single_rate) * 10000) / 10000,
        double: Math.round(parseNumber(row.double_rate) * 10000) / 10000,
        triple: Math.round(parseNumber(row.triple_rate) * 10000) / 10000,
        homeRun: Math.round(parseNumber(row.hr_rate) * 10000) / 10000,
        walk: Math.round(parseNumber(row.walk_rate) * 10000) / 10000,
        hitByPitch: Math.round(parseNumber(row.hbp_rate) * 10000) / 10000,
      };
    } else if (row.pitcher_throws === 'R') {
      league.vsRHP = {
        out: Math.round(parseNumber(row.out_rate) * 10000) / 10000,
        single: Math.round(parseNumber(row.single_rate) * 10000) / 10000,
        double: Math.round(parseNumber(row.double_rate) * 10000) / 10000,
        triple: Math.round(parseNumber(row.triple_rate) * 10000) / 10000,
        homeRun: Math.round(parseNumber(row.hr_rate) * 10000) / 10000,
        walk: Math.round(parseNumber(row.walk_rate) * 10000) / 10000,
        hitByPitch: Math.round(parseNumber(row.hbp_rate) * 10000) / 10000,
      };
    }
  }
  console.log('    ✓ League averages calculated');

  // Extract teams
  console.log('  🏟️  Teams...');
  const teamsResult = runDuckDB(getTeamsSQL(), dbPath);
  const teamsRaw = parseCSV(teamsResult);
  const teams: SeasonPackage['teams'] = {};

  for (const row of teamsRaw) {
    teams[row.team_id] = {
      id: row.team_id,
      league: row.league,
      city: row.city,
      nickname: row.nickname,
    };
  }
  console.log(`    ✓ ${Object.keys(teams).length} teams`);

  // Extract games
  console.log(`  🎮 ${year} games...`);
  const gamesResult = runDuckDB(getGamesSQL(year), dbPath);
  const gamesRaw = parseCSV(gamesResult);
  const games: SeasonPackage['games'] = [];

  for (const row of gamesRaw) {
    games.push({
      id: row.game_id,
      date: row.date,
      awayTeam: row.away_team_id,
      homeTeam: row.home_team_id,
      useDH: row.use_dh === 'true' || row.use_dh === 't',
    });
  }
  console.log(`    ✓ ${games.length} games`);

  // Create season package
  const season: SeasonPackage = {
    meta: {
      year,
      generatedAt: new Date().toISOString(),
      version: '1.0.0',
    },
    batters,
    pitchers,
    league,
    teams,
    games,
  };

  // Write to file
  fs.writeFileSync(outputPath, JSON.stringify(season, null, 2));
  console.log(`\n✅ Season exported to ${outputPath}`);

  return season;
}

// CLI
async function main() {
  const year = parseInt(process.argv[2]) || 1976;
  const dbPath = process.argv[3] || '../baseball.duckdb';
  const outputPath = process.argv[4] || `../app/static/seasons/${year}.json`;

  // Ensure output directory exists
  const outputDir = outputPath.substring(0, outputPath.lastIndexOf('/'));
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  await exportSeason(year, dbPath, outputPath);
}

main();
