/**
 * Calculate player statistics from event data
 * Extracts batter and pitcher rates with platoon splits (vs LHP/RHP)
 */

import * as fs from 'fs';

// SQL queries for player stats

const BATTER_STATS_QUERY = `
WITH batter_totals AS (
  SELECT
    e.batter_id,
    p.bats,
    p.last_name,
    p.first_name,
    p.teams_played[1] as primary_team,
    -- Count outcomes vs LHP
    SUM(CASE WHEN p.throws = 'L' THEN 1 ELSE 0 END) as pa_vs_l,
    SUM(CASE WHEN p.throws = 'L' AND e.plate_appearance_result = 'Out' THEN 1 ELSE 0 END) as outs_vs_l,
    SUM(CASE WHEN p.throws = 'L' AND e.plate_appearance_result = 'Single' THEN 1 ELSE 0 END) as singles_vs_l,
    SUM(CASE WHEN p.throws = 'L' AND e.plate_appearance_result = 'Double' THEN 1 ELSE 0 END) as doubles_vs_l,
    SUM(CASE WHEN p.throws = 'L' AND e.plate_appearance_result = 'Triple' THEN 1 ELSE 0 END) as triples_vs_l,
    SUM(CASE WHEN p.throws = 'L' AND e.plate_appearance_result = 'HomeRun' THEN 1 ELSE 0 END) as hr_vs_l,
    SUM(CASE WHEN p.throws = 'L' AND e.plate_appearance_result = 'Walk' THEN 1 ELSE 0 END) as walks_vs_l,
    SUM(CASE WHEN p.throws = 'L' AND e.plate_appearance_result = 'HitByPitch' THEN 1 ELSE 0 END) as hbp_vs_l,
    -- Count outcomes vs RHP
    SUM(CASE WHEN p.throws = 'R' THEN 1 ELSE 0 END) as pa_vs_r,
    SUM(CASE WHEN p.throws = 'R' AND e.plate_appearance_result = 'Out' THEN 1 ELSE 0 END) as outs_vs_r,
    SUM(CASE WHEN p.throws = 'R' AND e.plate_appearance_result = 'Single' THEN 1 ELSE 0 END) as singles_vs_r,
    SUM(CASE WHEN p.throws = 'R' AND e.plate_appearance_result = 'Double' THEN 1 ELSE 0 END) as doubles_vs_r,
    SUM(CASE WHEN p.throws = 'R' AND e.plate_appearance_result = 'Triple' THEN 1 ELSE 0 END) as triples_vs_r,
    SUM(CASE WHEN p.throws = 'R' AND e.plate_appearance_result = 'HomeRun' THEN 1 ELSE 0 END) as hr_vs_r,
    SUM(CASE WHEN p.throws = 'R' AND e.plate_appearance_result = 'Walk' THEN 1 ELSE 0 END) as walks_vs_r,
    SUM(CASE WHEN p.throws = 'R' AND e.plate_appearance_result = 'HitByPitch' THEN 1 ELSE 0 END) as hbp_vs_r
  FROM event.events e
  JOIN dim.players p ON e.batter_id = p.player_id
  WHERE e.plate_appearance_result IS NOT NULL
    AND e.no_play_flag = false
  GROUP BY e.batter_id, p.bats, p.last_name, p.first_name, p.teams_played
)
SELECT
  batter_id,
  bats,
  last_name,
  first_name,
  primary_team,
  pa_vs_l,
  pa_vs_r
FROM batter_totals
WHERE pa_vs_l >= 50 OR pa_vs_r >= 50
ORDER BY pa_vs_l + pa_vs_r DESC
LIMIT 20;
`;

const PITCHER_STATS_QUERY = `
WITH pitcher_totals AS (
  SELECT
    e.pitcher_id,
    p.throws,
    p.last_name,
    p.first_name,
    p.teams_played[1] as primary_team,
    -- Count outcomes vs LHB
    SUM(CASE WHEN p.bats = 'L' THEN 1 ELSE 0 END) as pa_vs_l,
    SUM(CASE WHEN p.bats = 'L' AND e.plate_appearance_result = 'Out' THEN 1 ELSE 0 END) as outs_vs_l,
    SUM(CASE WHEN p.bats = 'L' AND e.plate_appearance_result = 'Single' THEN 1 ELSE 0 END) as singles_vs_l,
    SUM(CASE WHEN p.bats = 'L' AND e.plate_appearance_result = 'Double' THEN 1 ELSE 0 END) as doubles_vs_l,
    SUM(CASE WHEN p.bats = 'L' AND e.plate_appearance_result = 'Triple' THEN 1 ELSE 0 END) as triples_vs_l,
    SUM(CASE WHEN p.bats = 'L' AND e.plate_appearance_result = 'HomeRun' THEN 1 ELSE 0 END) as hr_vs_l,
    SUM(CASE WHEN p.bats = 'L' AND e.plate_appearance_result = 'Walk' THEN 1 ELSE 0 END) as walks_vs_l,
    SUM(CASE WHEN p.bats = 'L' AND e.plate_appearance_result = 'HitByPitch' THEN 1 ELSE 0 END) as hbp_vs_l,
    -- Count outcomes vs RHB
    SUM(CASE WHEN p.bats = 'R' THEN 1 ELSE 0 END) as pa_vs_r,
    SUM(CASE WHEN p.bats = 'R' AND e.plate_appearance_result = 'Out' THEN 1 ELSE 0 END) as outs_vs_r,
    SUM(CASE WHEN p.bats = 'R' AND e.plate_appearance_result = 'Single' THEN 1 ELSE 0 END) as singles_vs_r,
    SUM(CASE WHEN p.bats = 'R' AND e.plate_appearance_result = 'Double' THEN 1 ELSE 0 END) as doubles_vs_r,
    SUM(CASE WHEN p.bats = 'R' AND e.plate_appearance_result = 'Triple' THEN 1 ELSE 0 END) as triples_vs_r,
    SUM(CASE WHEN p.bats = 'R' AND e.plate_appearance_result = 'HomeRun' THEN 1 ELSE 0 END) as hr_vs_r,
    SUM(CASE WHEN p.bats = 'R' AND e.plate_appearance_result = 'Walk' THEN 1 ELSE 0 END) as walks_vs_r,
    SUM(CASE WHEN p.bats = 'R' AND e.plate_appearance_result = 'HitByPitch' THEN 1 ELSE 0 END) as hbp_vs_r
  FROM event.events e
  JOIN dim.players p ON e.pitcher_id = p.player_id
  WHERE e.plate_appearance_result IS NOT NULL
    AND e.no_play_flag = false
  GROUP BY e.pitcher_id, p.throws, p.last_name, p.first_name, p.teams_played
)
SELECT
  pitcher_id,
  throws,
  last_name,
  first_name,
  primary_team,
  pa_vs_l,
  pa_vs_r
FROM pitcher_totals
WHERE pa_vs_l >= 50 OR pa_vs_r >= 50
ORDER BY pa_vs_l + pa_vs_r DESC
LIMIT 20;
`;

const LEAGUE_AVERAGES_QUERY = `
SELECT
  -- vs LHP/LHB
  AVG(CASE WHEN dim_players.throws = 'L' THEN
    CASE WHEN plate_appearance_result = 'Out' THEN 1 ELSE 0 END
  END) as out_vs_l,
  AVG(CASE WHEN dim_players.throws = 'L' THEN
    CASE WHEN plate_appearance_result = 'Single' THEN 1 ELSE 0 END
  END) as single_vs_l,
  AVG(CASE WHEN dim_players.throws = 'L' THEN
    CASE WHEN plate_appearance_result = 'Double' THEN 1 ELSE 0 END
  END) as double_vs_l,
  AVG(CASE WHEN dim_players.throws = 'L' THEN
    CASE WHEN plate_appearance_result = 'Triple' THEN 1 ELSE 0 END
  END) as triple_vs_l,
  AVG(CASE WHEN dim_players.throws = 'L' THEN
    CASE WHEN plate_appearance_result = 'HomeRun' THEN 1 ELSE 0 END
  END) as hr_vs_l,
  AVG(CASE WHEN dim_players.throws = 'L' THEN
    CASE WHEN plate_appearance_result = 'Walk' THEN 1 ELSE 0 END
  END) as walk_vs_l,
  AVG(CASE WHEN dim_players.throws = 'L' THEN
    CASE WHEN plate_appearance_result = 'HitByPitch' THEN 1 ELSE 0 END
  END) as hbp_vs_l,
  -- vs RHP/RHB
  AVG(CASE WHEN dim_players.throws = 'R' THEN
    CASE WHEN plate_appearance_result = 'Out' THEN 1 ELSE 0 END
  END) as out_vs_r,
  AVG(CASE WHEN dim_players.throws = 'R' THEN
    CASE WHEN plate_appearance_result = 'Single' THEN 1 ELSE 0 END
  END) as single_vs_r,
  AVG(CASE WHEN dim_players.throws = 'R' THEN
    CASE WHEN plate_appearance_result = 'Double' THEN 1 ELSE 0 END
  END) as double_vs_r,
  AVG(CASE WHEN dim_players.throws = 'R' THEN
    CASE WHEN plate_appearance_result = 'Triple' THEN 1 ELSE 0 END
  END) as triple_vs_r,
  AVG(CASE WHEN dim_players.throws = 'R' THEN
    CASE WHEN plate_appearance_result = 'HomeRun' THEN 1 ELSE 0 END
  END) as hr_vs_r,
  AVG(CASE WHEN dim_players.throws = 'R' THEN
    CASE WHEN plate_appearance_result = 'Walk' THEN 1 ELSE 0 END
  END) as walk_vs_r,
  AVG(CASE WHEN dim_players.throws = 'R' THEN
    CASE WHEN plate_appearance_result = 'HitByPitch' THEN 1 ELSE 0 END
  END) as hbp_vs_r
FROM event.events
JOIN dim.players ON event.events.batter_id = dim_players.player_id
WHERE plate_appearance_result IS NOT NULL
  AND no_play_flag = false;
`;

const TEAMS_QUERY = `
SELECT
  team_id,
  league,
  city,
  nickname,
  first_year,
  last_year
FROM dim.teams
WHERE last_year >= 1970
ORDER BY league, city;
`;

const GAMES_QUERY = `
SELECT
  game_id,
  date,
  away_team_id,
  home_team_id,
  use_dh,
  winning_pitcher,
  losing_pitcher
FROM game.games
WHERE EXTRACT(YEAR FROM date) = 1976
ORDER BY date
LIMIT 10;
`;

// Main execution
async function main() {
  console.log('=== Baseball Data Extraction ===\n');

  const queries = [
    { name: 'Sample Batters', sql: BATTER_STATS_QUERY },
    { name: 'Sample Pitchers', sql: PITCHER_STATS_QUERY },
    { name: 'League Averages', sql: LEAGUE_AVERAGES_QUERY },
    { name: 'Teams', sql: TEAMS_QUERY },
    { name: 'Sample Games (1976)', sql: GAMES_QUERY },
  ];

  for (const query of queries) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`📊 ${query.name}`);
    console.log('='.repeat(50));

    const sqlFile = `/tmp/query_${query.name.replace(/\s+/g, '_')}.sql`;
    fs.writeFileSync(sqlFile, query.sql);

    console.log(`\nQuery saved to: ${sqlFile}`);
    console.log('Run with: duckdb baseball.duckdb < ' + sqlFile);
    console.log('\nOr paste this SQL into duckdb:\n');
    console.log(query.sql);
  }

  console.log('\n\n=== Summary ===');
  console.log('SQL queries generated. You can run them with:');
  console.log('  duckdb baseball.duckdb < query_file.sql');
  console.log('\nOr interactively:');
  console.log('  duckdb baseball.duckdb');
}

main();
