/**
 * Extract batter statistics with platoon splits from the database
 */

import { execSync } from 'child_process';

const BATTER_STATS_SQL = `
WITH batter_stats AS (
  SELECT
    e.batter_id,
    b.last_name,
    b.first_name,
    b.bats,
    -- Get pitcher handedness and count outcomes
    p.throws as pitcher_throws,
    COUNT(*) as plate_appearances,
    SUM(CASE WHEN e.plate_appearance_result = 'Out' THEN 1 ELSE 0 END) as outs,
    SUM(CASE WHEN e.plate_appearance_result = 'Single' THEN 1 ELSE 0 END) as singles,
    SUM(CASE WHEN e.plate_appearance_result = 'Double' THEN 1 ELSE 0 END) as doubles,
    SUM(CASE WHEN e.plate_appearance_result = 'Triple' THEN 1 ELSE 0 END) as triples,
    SUM(CASE WHEN e.plate_appearance_result = 'HomeRun' THEN 1 ELSE 0 END) as home_runs,
    SUM(CASE WHEN e.plate_appearance_result = 'Walk' THEN 1 ELSE 0 END) as walks,
    SUM(CASE WHEN e.plate_appearance_result = 'HitByPitch' THEN 1 ELSE 0 END) as hbp
  FROM event.events e
  JOIN dim.players b ON e.batter_id = b.player_id
  JOIN dim.players p ON e.pitcher_id = p.player_id
  WHERE e.plate_appearance_result IS NOT NULL
    AND e.no_play_flag = false
  GROUP BY e.batter_id, b.last_name, b.first_name, b.bats, p.throws
)
SELECT
  batter_id,
  last_name,
  first_name,
  bats,
  -- vs LHP
  SUM(CASE WHEN pitcher_throws = 'L' THEN plate_appearances ELSE 0 END) as pa_vs_l,
  SUM(CASE WHEN pitcher_throws = 'L' THEN outs ELSE 0 END) as outs_vs_l,
  SUM(CASE WHEN pitcher_throws = 'L' THEN singles ELSE 0 END) as singles_vs_l,
  SUM(CASE WHEN pitcher_throws = 'L' THEN doubles ELSE 0 END) as doubles_vs_l,
  SUM(CASE WHEN pitcher_throws = 'L' THEN triples ELSE 0 END) as triples_vs_l,
  SUM(CASE WHEN pitcher_throws = 'L' THEN home_runs ELSE 0 END) as hr_vs_l,
  SUM(CASE WHEN pitcher_throws = 'L' THEN walks ELSE 0 END) as walks_vs_l,
  SUM(CASE WHEN pitcher_throws = 'L' THEN hbp ELSE 0 END) as hbp_vs_l,
  -- vs RHP
  SUM(CASE WHEN pitcher_throws = 'R' THEN plate_appearances ELSE 0 END) as pa_vs_r,
  SUM(CASE WHEN pitcher_throws = 'R' THEN outs ELSE 0 END) as outs_vs_r,
  SUM(CASE WHEN pitcher_throws = 'R' THEN singles ELSE 0 END) as singles_vs_r,
  SUM(CASE WHEN pitcher_throws = 'R' THEN doubles ELSE 0 END) as doubles_vs_r,
  SUM(CASE WHEN pitcher_throws = 'R' THEN triples ELSE 0 END) as triples_vs_r,
  SUM(CASE WHEN pitcher_throws = 'R' THEN home_runs ELSE 0 END) as hr_vs_r,
  SUM(CASE WHEN pitcher_throws = 'R' THEN walks ELSE 0 END) as walks_vs_r,
  SUM(CASE WHEN pitcher_throws = 'R' THEN hbp ELSE 0 END) as hbp_vs_r
FROM batter_stats
GROUP BY batter_id, last_name, first_name, bats
HAVING SUM(CASE WHEN pitcher_throws = 'L' THEN plate_appearances ELSE 0 END) >= 25
   OR SUM(CASE WHEN pitcher_throws = 'R' THEN plate_appearances ELSE 0 END) >= 25
ORDER BY SUM(plate_appearances) DESC
LIMIT 50;
`;

const LEAGUE_AVG_SQL = `
WITH league_rates AS (
  SELECT
    pitcher_throws,
    COUNT(*) as total_pa,
    SUM(CASE WHEN plate_appearance_result = 'Out' THEN 1 ELSE 0 END) as outs,
    SUM(CASE WHEN plate_appearance_result = 'Single' THEN 1 ELSE 0 END) as singles,
    SUM(CASE WHEN plate_appearance_result = 'Double' THEN 1 ELSE 0 END) as doubles,
    SUM(CASE WHEN plate_appearance_result = 'Triple' THEN 1 ELSE 0 END) as triples,
    SUM(CASE WHEN plate_appearance_result = 'HomeRun' THEN 1 ELSE 0 END) as home_runs,
    SUM(CASE WHEN plate_appearance_result = 'Walk' THEN 1 ELSE 0 END) as walks,
    SUM(CASE WHEN plate_appearance_result = 'HitByPitch' THEN 1 ELSE 0 END) as hbp
  FROM event.events e
  JOIN dim.players p ON e.pitcher_id = p.player_id
  WHERE e.plate_appearance_result IS NOT NULL
    AND e.no_play_flag = false
  GROUP BY pitcher_throws
)
SELECT
  pitcher_throws,
  -- Calculate rates
  outs::FLOAT / total_pa as out_rate,
  singles::FLOAT / total_pa as single_rate,
  doubles::FLOAT / total_pa as double_rate,
  triples::FLOAT / total_pa as triple_rate,
  home_runs::FLOAT / total_pa as hr_rate,
  walks::FLOAT / total_pa as walk_rate,
  hbp::FLOAT / total_pa as hbp_rate,
  total_pa
FROM league_rates;
`;

const TEAMS_SQL = `
SELECT
  team_id,
  league,
  city,
  nickname,
  first_year,
  last_year
FROM dim.teams
WHERE last_year >= 1970
ORDER BY league, city
LIMIT 50;
`;

function runQuery(sql: string, dbPath: string): string {
  try {
    return execSync(`echo "${sql.replace(/"/g, '\\"')}" | duckdb "${dbPath}"`, {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024
    });
  } catch (error) {
    console.error('Error running query:', error);
    return '';
  }
}

async function main() {
  const dbPath = '../baseball.duckdb';

  console.log('=== Extracting Baseball Data ===\n');

  console.log('📊 Top 50 Batters (Career, with platoon splits):\n');
  console.log(runQuery(BATTER_STATS_SQL, dbPath));

  console.log('\n📈 League Average Rates:\n');
  console.log(runQuery(LEAGUE_AVG_SQL, dbPath));

  console.log('\n🏟️  Teams (since 1970):\n');
  console.log(runQuery(TEAMS_SQL, dbPath));
}

main();
