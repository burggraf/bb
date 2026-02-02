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
import type { EventRates } from '@bb/model';

/**
 * Modern trajectory distribution for imputing unknown outs.
 * Based on 1990+ data where trajectory is reliably recorded.
 */
const TRAJECTORY_DISTRIBUTION = {
  groundOut: 0.44,
  flyOut: 0.30,
  popOut: 0.14,
  lineOut: 0.12,
};

/**
 * Season-wide norms for era-appropriate managerial decisions.
 * These norms evolve over baseball history.
 */
export interface SeasonNorms {
  year: number;
  era: string;
  pitching: {
    /** Typical pitch count range for starting pitchers */
    starterPitches: {
      /** Pitch count where starters typically begin to get fatigued */
      fatigueThreshold: number;
      /** Typical pitch count limit for starters */
      typicalLimit: number;
      /** Absolute upper limit for starting pitchers */
      hardLimit: number;
    };
    /** Typical pitch count range for relief pitchers */
    relieverPitches: {
      /** Maximum pitches for a reliever in a single appearance */
      maxPitches: number;
      /** Typical pitches for a one-inning reliever */
      typicalPitches: number;
    };
  };
  /** How often pinch hitters are used per game (both teams combined) */
  substitutions: {
    /** Average pinch hit appearances per game */
    pinchHitsPerGame: number;
    /** Average defensive substitution appearances per game */
    defensiveReplacementsPerGame: number;
  };
}

/**
 * Get era-appropriate season norms based on historical baseball research.
 *
 * Complete game rates and pitch count management evolved significantly:
 * - 1910s-1940s: Complete games common, 150+ pitches typical
 * - 1950s-1970s: Complete games declining, but still common
 * - 1980s-1990s: Bullpens专业化, pitch counts monitored more closely
 * - 2000s-present: 100-pitch limit standard, strict management
 */
function getSeasonNorms(year: number): SeasonNorms {
  if (year >= 2010) {
    // Modern era: Strict pitch limits, 100-pitch standard, high bullpen usage
    return {
      year,
      era: 'modern',
      pitching: {
        starterPitches: {
          fatigueThreshold: 85,
          typicalLimit: 100,
          hardLimit: 110,
        },
        relieverPitches: {
          maxPitches: 35,
          typicalPitches: 15,
        },
      },
      substitutions: {
        pinchHitsPerGame: 9.3,
        defensiveReplacementsPerGame: 2.75,
      },
    };
  } else if (year >= 2000) {
    // Early 2000s: Pitch count monitoring becoming standard
    return {
      year,
      era: 'early-modern',
      pitching: {
        starterPitches: {
          fatigueThreshold: 90,
          typicalLimit: 105,
          hardLimit: 120,
        },
        relieverPitches: {
          maxPitches: 40,
          typicalPitches: 18,
        },
      },
      substitutions: {
        pinchHitsPerGame: 9.0,
        defensiveReplacementsPerGame: 2.6,
      },
    };
  } else if (year >= 1980) {
    // 1980s-1990s: Bullpens becoming more specialized
    return {
      year,
      era: 'bullpen-specialization',
      pitching: {
        starterPitches: {
          fatigueThreshold: 95,
          typicalLimit: 115,
          hardLimit: 130,
        },
        relieverPitches: {
          maxPitches: 45,
          typicalPitches: 20,
        },
      },
      substitutions: {
        pinchHitsPerGame: 7.5,
        defensiveReplacementsPerGame: 2.4,
      },
    };
  } else if (year >= 1960) {
    // 1960s-1970s: Complete games declining, but starters still go deep
    return {
      year,
      era: 'expansion-era',
      pitching: {
        starterPitches: {
          fatigueThreshold: 100,
          typicalLimit: 120,
          hardLimit: 140,
        },
        relieverPitches: {
          maxPitches: 50,
          typicalPitches: 22,
        },
      },
      substitutions: {
        pinchHitsPerGame: 7.0,
        defensiveReplacementsPerGame: 2.4,
      },
    };
  } else if (year >= 1940) {
    // 1940s-1950s: Integration era, starters still go deep
    return {
      year,
      era: 'integration',
      pitching: {
        starterPitches: {
          fatigueThreshold: 105,
          typicalLimit: 125,
          hardLimit: 150,
        },
        relieverPitches: {
          maxPitches: 60,
          typicalPitches: 25,
        },
      },
      substitutions: {
        pinchHitsPerGame: 6.5,
        defensiveReplacementsPerGame: 2.2,
      },
    };
  } else if (year >= 1920) {
    // 1920s-1930s: Lively ball era, complete games common
    return {
      year,
      era: 'lively-ball',
      pitching: {
        starterPitches: {
          fatigueThreshold: 110,
          typicalLimit: 130,
          hardLimit: 160,
        },
        relieverPitches: {
          maxPitches: 70,
          typicalPitches: 30,
        },
      },
      substitutions: {
        pinchHitsPerGame: 6.0,
        defensiveReplacementsPerGame: 2.0,
      },
    };
  } else {
    // Deadball and early baseball: Complete games very common
    return {
      year,
      era: 'deadball',
      pitching: {
        starterPitches: {
          fatigueThreshold: 120,
          typicalLimit: 150,
          hardLimit: 175,
        },
        relieverPitches: {
          maxPitches: 80,
          typicalPitches: 35,
        },
      },
      substitutions: {
        pinchHitsPerGame: 5.0,
        defensiveReplacementsPerGame: 1.5,
      },
    };
  }
}

/**
 * Distribute unknown outs across trajectory types using modern distribution.
 */
function imputeUnknownOuts(
  groundOuts: number,
  flyOuts: number,
  lineOuts: number,
  popOuts: number,
  unknownOuts: number
): { groundOut: number; flyOut: number; lineOut: number; popOut: number } {
  return {
    groundOut: groundOuts + unknownOuts * TRAJECTORY_DISTRIBUTION.groundOut,
    flyOut: flyOuts + unknownOuts * TRAJECTORY_DISTRIBUTION.flyOut,
    lineOut: lineOuts + unknownOuts * TRAJECTORY_DISTRIBUTION.lineOut,
    popOut: popOuts + unknownOuts * TRAJECTORY_DISTRIBUTION.popOut,
  };
}

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
    -- Strikeouts
    SUM(CASE WHEN e.plate_appearance_result = 'StrikeOut' THEN 1 ELSE 0 END) as strikeouts,
    -- Hits
    SUM(CASE WHEN e.plate_appearance_result = 'Single' THEN 1 ELSE 0 END) as singles,
    SUM(CASE WHEN e.plate_appearance_result IN ('Double', 'GroundRuleDouble') THEN 1 ELSE 0 END) as doubles,
    SUM(CASE WHEN e.plate_appearance_result = 'Triple' THEN 1 ELSE 0 END) as triples,
    SUM(CASE WHEN e.plate_appearance_result IN ('HomeRun', 'InsideTheParkHomeRun') THEN 1 ELSE 0 END) as home_runs,
    -- Walks
    SUM(CASE WHEN e.plate_appearance_result = 'Walk' THEN 1 ELSE 0 END) as walks,
    SUM(CASE WHEN e.plate_appearance_result = 'HitByPitch' THEN 1 ELSE 0 END) as hbp,
    -- Ball-in-play outs by trajectory
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory IN ('GroundBall', 'GroundBallBunt') THEN 1 ELSE 0 END) as ground_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory = 'Fly' THEN 1 ELSE 0 END) as fly_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory = 'LineDrive' THEN 1 ELSE 0 END) as line_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory = 'PopUp' THEN 1 ELSE 0 END) as pop_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND (e.batted_trajectory IS NULL OR e.batted_trajectory = 'Unknown') THEN 1 ELSE 0 END) as unknown_outs,
    -- Sacrifices
    SUM(CASE WHEN e.plate_appearance_result = 'SacrificeFly' THEN 1 ELSE 0 END) as sacrifice_flies,
    SUM(CASE WHEN e.plate_appearance_result = 'SacrificeHit' THEN 1 ELSE 0 END) as sacrifice_bunts,
    -- Other
    SUM(CASE WHEN e.plate_appearance_result = 'FieldersChoice' THEN 1 ELSE 0 END) as fielders_choices,
    SUM(CASE WHEN e.plate_appearance_result = 'ReachedOnError' THEN 1 ELSE 0 END) as reached_on_errors,
    SUM(CASE WHEN e.plate_appearance_result = 'Interference' THEN 1 ELSE 0 END) as catcher_interferences
  FROM event.events e
  JOIN dim.players b ON e.batter_id = b.player_id
  JOIN dim.players p ON e.pitcher_id = p.player_id
  JOIN game.games g ON e.game_id = g.game_id
  WHERE EXTRACT(YEAR FROM g.date) = ${year}
    AND e.plate_appearance_result IS NOT NULL
    AND e.plate_appearance_result != 'IntentionalWalk'
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
    SUM(CASE WHEN pitcher_throws = 'L' THEN strikeouts ELSE 0 END) as strikeouts_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN singles ELSE 0 END) as singles_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN doubles ELSE 0 END) as doubles_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN triples ELSE 0 END) as triples_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN home_runs ELSE 0 END) as hr_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN walks ELSE 0 END) as walks_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN hbp ELSE 0 END) as hbp_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN ground_outs ELSE 0 END) as ground_outs_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN fly_outs ELSE 0 END) as fly_outs_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN line_outs ELSE 0 END) as line_outs_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN pop_outs ELSE 0 END) as pop_outs_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN unknown_outs ELSE 0 END) as unknown_outs_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN sacrifice_flies ELSE 0 END) as sacrifice_flies_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN sacrifice_bunts ELSE 0 END) as sacrifice_bunts_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN fielders_choices ELSE 0 END) as fielders_choices_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN reached_on_errors ELSE 0 END) as reached_on_errors_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN catcher_interferences ELSE 0 END) as catcher_interferences_vs_l,
    -- vs RHP
    SUM(CASE WHEN pitcher_throws = 'R' THEN pa ELSE 0 END) as pa_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN strikeouts ELSE 0 END) as strikeouts_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN singles ELSE 0 END) as singles_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN doubles ELSE 0 END) as doubles_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN triples ELSE 0 END) as triples_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN home_runs ELSE 0 END) as hr_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN walks ELSE 0 END) as walks_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN hbp ELSE 0 END) as hbp_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN ground_outs ELSE 0 END) as ground_outs_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN fly_outs ELSE 0 END) as fly_outs_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN line_outs ELSE 0 END) as line_outs_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN pop_outs ELSE 0 END) as pop_outs_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN unknown_outs ELSE 0 END) as unknown_outs_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN sacrifice_flies ELSE 0 END) as sacrifice_flies_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN sacrifice_bunts ELSE 0 END) as sacrifice_bunts_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN fielders_choices ELSE 0 END) as fielders_choices_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN reached_on_errors ELSE 0 END) as reached_on_errors_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN catcher_interferences ELSE 0 END) as catcher_interferences_vs_r
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
    -- Strikeouts
    SUM(CASE WHEN e.plate_appearance_result = 'StrikeOut' THEN 1 ELSE 0 END) as strikeouts,
    -- Hits
    SUM(CASE WHEN e.plate_appearance_result = 'Single' THEN 1 ELSE 0 END) as singles,
    SUM(CASE WHEN e.plate_appearance_result IN ('Double', 'GroundRuleDouble') THEN 1 ELSE 0 END) as doubles,
    SUM(CASE WHEN e.plate_appearance_result = 'Triple' THEN 1 ELSE 0 END) as triples,
    SUM(CASE WHEN e.plate_appearance_result IN ('HomeRun', 'InsideTheParkHomeRun') THEN 1 ELSE 0 END) as home_runs,
    -- Walks (excluding intentional walks)
    SUM(CASE WHEN e.plate_appearance_result = 'Walk' THEN 1 ELSE 0 END) as walks,
    SUM(CASE WHEN e.plate_appearance_result = 'HitByPitch' THEN 1 ELSE 0 END) as hbp,
    -- Ball-in-play outs by trajectory
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory IN ('GroundBall', 'GroundBallBunt') THEN 1 ELSE 0 END) as ground_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory = 'Fly' THEN 1 ELSE 0 END) as fly_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory = 'LineDrive' THEN 1 ELSE 0 END) as line_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory = 'PopUp' THEN 1 ELSE 0 END) as pop_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND (e.batted_trajectory IS NULL OR e.batted_trajectory = 'Unknown') THEN 1 ELSE 0 END) as unknown_outs,
    -- Sacrifices
    SUM(CASE WHEN e.plate_appearance_result = 'SacrificeFly' THEN 1 ELSE 0 END) as sacrifice_flies,
    SUM(CASE WHEN e.plate_appearance_result = 'SacrificeHit' THEN 1 ELSE 0 END) as sacrifice_bunts,
    -- Other
    SUM(CASE WHEN e.plate_appearance_result = 'FieldersChoice' THEN 1 ELSE 0 END) as fielders_choices,
    SUM(CASE WHEN e.plate_appearance_result = 'ReachedOnError' THEN 1 ELSE 0 END) as reached_on_errors,
    SUM(CASE WHEN e.plate_appearance_result = 'Interference' THEN 1 ELSE 0 END) as catcher_interferences
  FROM event.events e
  JOIN dim.players p ON e.pitcher_id = p.player_id
  JOIN dim.players b ON e.batter_id = b.player_id
  JOIN game.games g ON e.game_id = g.game_id
  WHERE EXTRACT(YEAR FROM g.date) = ${year}
    AND e.plate_appearance_result IS NOT NULL
    AND e.plate_appearance_result != 'IntentionalWalk'
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
    SUM(CASE WHEN batter_bats = 'L' THEN strikeouts ELSE 0 END) as strikeouts_vs_l,
    SUM(CASE WHEN batter_bats = 'L' THEN singles ELSE 0 END) as singles_vs_l,
    SUM(CASE WHEN batter_bats = 'L' THEN doubles ELSE 0 END) as doubles_vs_l,
    SUM(CASE WHEN batter_bats = 'L' THEN triples ELSE 0 END) as triples_vs_l,
    SUM(CASE WHEN batter_bats = 'L' THEN home_runs ELSE 0 END) as hr_vs_l,
    SUM(CASE WHEN batter_bats = 'L' THEN walks ELSE 0 END) as walks_vs_l,
    SUM(CASE WHEN batter_bats = 'L' THEN hbp ELSE 0 END) as hbp_vs_l,
    SUM(CASE WHEN batter_bats = 'L' THEN ground_outs ELSE 0 END) as ground_outs_vs_l,
    SUM(CASE WHEN batter_bats = 'L' THEN fly_outs ELSE 0 END) as fly_outs_vs_l,
    SUM(CASE WHEN batter_bats = 'L' THEN line_outs ELSE 0 END) as line_outs_vs_l,
    SUM(CASE WHEN batter_bats = 'L' THEN pop_outs ELSE 0 END) as pop_outs_vs_l,
    SUM(CASE WHEN batter_bats = 'L' THEN unknown_outs ELSE 0 END) as unknown_outs_vs_l,
    SUM(CASE WHEN batter_bats = 'L' THEN sacrifice_flies ELSE 0 END) as sacrifice_flies_vs_l,
    SUM(CASE WHEN batter_bats = 'L' THEN sacrifice_bunts ELSE 0 END) as sacrifice_bunts_vs_l,
    SUM(CASE WHEN batter_bats = 'L' THEN fielders_choices ELSE 0 END) as fielders_choices_vs_l,
    SUM(CASE WHEN batter_bats = 'L' THEN reached_on_errors ELSE 0 END) as reached_on_errors_vs_l,
    SUM(CASE WHEN batter_bats = 'L' THEN catcher_interferences ELSE 0 END) as catcher_interferences_vs_l,
    -- vs RHB
    SUM(CASE WHEN batter_bats = 'R' THEN pa ELSE 0 END) as pa_vs_r,
    SUM(CASE WHEN batter_bats = 'R' THEN strikeouts ELSE 0 END) as strikeouts_vs_r,
    SUM(CASE WHEN batter_bats = 'R' THEN singles ELSE 0 END) as singles_vs_r,
    SUM(CASE WHEN batter_bats = 'R' THEN doubles ELSE 0 END) as doubles_vs_r,
    SUM(CASE WHEN batter_bats = 'R' THEN triples ELSE 0 END) as triples_vs_r,
    SUM(CASE WHEN batter_bats = 'R' THEN home_runs ELSE 0 END) as hr_vs_r,
    SUM(CASE WHEN batter_bats = 'R' THEN walks ELSE 0 END) as walks_vs_r,
    SUM(CASE WHEN batter_bats = 'R' THEN hbp ELSE 0 END) as hbp_vs_r,
    SUM(CASE WHEN batter_bats = 'R' THEN ground_outs ELSE 0 END) as ground_outs_vs_r,
    SUM(CASE WHEN batter_bats = 'R' THEN fly_outs ELSE 0 END) as fly_outs_vs_r,
    SUM(CASE WHEN batter_bats = 'R' THEN line_outs ELSE 0 END) as line_outs_vs_r,
    SUM(CASE WHEN batter_bats = 'R' THEN pop_outs ELSE 0 END) as pop_outs_vs_r,
    SUM(CASE WHEN batter_bats = 'R' THEN unknown_outs ELSE 0 END) as unknown_outs_vs_r,
    SUM(CASE WHEN batter_bats = 'R' THEN sacrifice_flies ELSE 0 END) as sacrifice_flies_vs_r,
    SUM(CASE WHEN batter_bats = 'R' THEN sacrifice_bunts ELSE 0 END) as sacrifice_bunts_vs_r,
    SUM(CASE WHEN batter_bats = 'R' THEN fielders_choices ELSE 0 END) as fielders_choices_vs_r,
    SUM(CASE WHEN batter_bats = 'R' THEN reached_on_errors ELSE 0 END) as reached_on_errors_vs_r,
    SUM(CASE WHEN batter_bats = 'R' THEN catcher_interferences ELSE 0 END) as catcher_interferences_vs_r
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
    -- Strikeouts
    SUM(CASE WHEN e.plate_appearance_result = 'StrikeOut' THEN 1 ELSE 0 END) as strikeouts,
    -- Hits
    SUM(CASE WHEN e.plate_appearance_result = 'Single' THEN 1 ELSE 0 END) as singles,
    SUM(CASE WHEN e.plate_appearance_result IN ('Double', 'GroundRuleDouble') THEN 1 ELSE 0 END) as doubles,
    SUM(CASE WHEN e.plate_appearance_result = 'Triple' THEN 1 ELSE 0 END) as triples,
    SUM(CASE WHEN e.plate_appearance_result IN ('HomeRun', 'InsideTheParkHomeRun') THEN 1 ELSE 0 END) as home_runs,
    -- Walks (excluding intentional walks)
    SUM(CASE WHEN e.plate_appearance_result = 'Walk' THEN 1 ELSE 0 END) as walks,
    SUM(CASE WHEN e.plate_appearance_result = 'HitByPitch' THEN 1 ELSE 0 END) as hbp,
    -- Ball-in-play outs by trajectory
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory IN ('GroundBall', 'GroundBallBunt') THEN 1 ELSE 0 END) as ground_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory = 'Fly' THEN 1 ELSE 0 END) as fly_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory = 'LineDrive' THEN 1 ELSE 0 END) as line_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory = 'PopUp' THEN 1 ELSE 0 END) as pop_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND (e.batted_trajectory IS NULL OR e.batted_trajectory = 'Unknown') THEN 1 ELSE 0 END) as unknown_outs,
    -- Sacrifices
    SUM(CASE WHEN e.plate_appearance_result = 'SacrificeFly' THEN 1 ELSE 0 END) as sacrifice_flies,
    SUM(CASE WHEN e.plate_appearance_result = 'SacrificeHit' THEN 1 ELSE 0 END) as sacrifice_bunts,
    -- Other
    SUM(CASE WHEN e.plate_appearance_result = 'FieldersChoice' THEN 1 ELSE 0 END) as fielders_choices,
    SUM(CASE WHEN e.plate_appearance_result = 'ReachedOnError' THEN 1 ELSE 0 END) as reached_on_errors,
    SUM(CASE WHEN e.plate_appearance_result = 'Interference' THEN 1 ELSE 0 END) as catcher_interferences
  FROM event.events e
  JOIN dim.players p ON e.pitcher_id = p.player_id
  JOIN game.games g ON e.game_id = g.game_id
  WHERE EXTRACT(YEAR FROM g.date) = ${year}
    AND e.plate_appearance_result IS NOT NULL
    AND e.plate_appearance_result != 'IntentionalWalk'
    AND e.no_play_flag = false
  GROUP BY p.throws
)
SELECT
  pitcher_throws,
  -- Hit rates
  singles::FLOAT / pa as single_rate,
  doubles::FLOAT / pa as double_rate,
  triples::FLOAT / pa as triple_rate,
  home_runs::FLOAT / pa as hr_rate,
  -- Walk rates
  walks::FLOAT / pa as walk_rate,
  hbp::FLOAT / pa as hbp_rate,
  -- Out rates
  strikeouts::FLOAT / pa as strikeout_rate,
  ground_outs::FLOAT / pa as ground_out_rate,
  fly_outs::FLOAT / pa as fly_out_rate,
  line_outs::FLOAT / pa as line_out_rate,
  pop_outs::FLOAT / pa as pop_out_rate,
  unknown_outs::FLOAT / pa as unknown_out_rate,
  -- Sacrifice rates
  sacrifice_flies::FLOAT / pa as sacrifice_fly_rate,
  sacrifice_bunts::FLOAT / pa as sacrifice_bunt_rate,
  -- Other rates
  fielders_choices::FLOAT / pa as fielders_choice_rate,
  reached_on_errors::FLOAT / pa as reached_on_error_rate,
  catcher_interferences::FLOAT / pa as catcher_interference_rate
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

function getBatterPositionsSQL(year: number): string {
  return `
SELECT
  gfa.player_id,
  gfa.fielding_position,
  COUNT(*) AS appearances
FROM game.game_fielding_appearances gfa
JOIN game.games g ON gfa.game_id = g.game_id
WHERE EXTRACT(YEAR FROM g.date) = ${year}
GROUP BY gfa.player_id, gfa.fielding_position
ORDER BY gfa.player_id, appearances DESC;
`;
}

export interface SeasonPackage {
  meta: {
    year: number;
    generatedAt: string;
    version: string;
  };
  /** Season-wide norms for era-appropriate managerial decisions */
  norms: SeasonNorms;
  batters: Record<string, {
    id: string;
    name: string;
    bats: 'L' | 'R' | 'S';
    teamId: string;
    /** Positions player can play (1=P, 2=C, 3=1B, 4=2B, 5=3B, 6=SS, 7=LF, 8=CF, 9=RF, 10=DH) */
    primaryPosition: number;
    /** All positions played, with appearance counts */
    positionEligibility: Record<number, number>;
    rates: {
      vsLHP: EventRates;
      vsRHP: EventRates;
    };
  }>;
  pitchers: Record<string, {
    id: string;
    name: string;
    throws: 'L' | 'R';
    teamId: string;
    rates: {
      vsLHB: EventRates;
      vsRHB: EventRates;
    };
  }>;
  league: {
    vsLHP: EventRates;
    vsRHP: EventRates;
  };
  teams: Record<string, { id: string; league: string; city: string; nickname: string }>;
  games: Array<{ id: string; date: string; awayTeam: string; homeTeam: string; useDH: boolean }>;
}

function calcEventRates(row: {
  singles: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  walks: number;
  hitByPitches: number;
  strikeouts: number;
  groundOuts: number;
  flyOuts: number;
  lineOuts: number;
  popOuts: number;
  unknownOuts: number;
  sacrificeFlies: number;
  sacrificeBunts: number;
  fieldersChoices: number;
  reachedOnErrors: number;
  catcherInterferences: number;
  pa: number;
}): EventRates {
  const pa = row.pa;
  if (pa === 0) {
    return getZeroRates();
  }

  // Impute unknown trajectory outs
  const imputed = imputeUnknownOuts(
    row.groundOuts,
    row.flyOuts,
    row.lineOuts,
    row.popOuts,
    row.unknownOuts
  );

  const rates: EventRates = {
    single: row.singles / pa,
    double: row.doubles / pa,
    triple: row.triples / pa,
    homeRun: row.homeRuns / pa,
    walk: row.walks / pa,
    hitByPitch: row.hitByPitches / pa,
    strikeout: row.strikeouts / pa,
    groundOut: imputed.groundOut / pa,
    flyOut: imputed.flyOut / pa,
    lineOut: imputed.lineOut / pa,
    popOut: imputed.popOut / pa,
    sacrificeFly: row.sacrificeFlies / pa,
    sacrificeBunt: row.sacrificeBunts / pa,
    fieldersChoice: row.fieldersChoices / pa,
    reachedOnError: row.reachedOnErrors / pa,
    catcherInterference: row.catcherInterferences / pa,
  };

  // Round to 4 decimal places
  for (const key of Object.keys(rates) as (keyof EventRates)[]) {
    rates[key] = Math.round(rates[key] * 10000) / 10000;
  }

  return rates;
}

function getZeroRates(): EventRates {
  return {
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
}

function calcRate(count: number, pa: number): number {
  if (pa === 0) return 0;
  return Math.round((count / pa) * 10000) / 10000;
}

export async function exportSeason(year: number, dbPath: string, outputPath: string): Promise<SeasonPackage> {
  console.log(`📦 Exporting ${year} season to ${outputPath}...\n`);

  // Extract batter positions first
  console.log('  📋 Batter positions...');
  const positionsResult = runDuckDB(getBatterPositionsSQL(year), dbPath);
  const positionsRaw = parseCSV(positionsResult);
  const positionMap = new Map<string, { primaryPosition: number; positionEligibility: Record<number, number> }>();

  // Aggregate positions by player
  const playerPositions = new Map<string, Array<{ position: number; appearances: number }>>();
  for (const row of positionsRaw) {
    const playerId = row.player_id;
    const position = parseNumber(row.fielding_position);
    const appearances = parseNumber(row.appearances);

    if (!playerPositions.has(playerId)) {
      playerPositions.set(playerId, []);
    }
    playerPositions.get(playerId)!.push({ position, appearances });
  }

  // Determine primary position and build eligibility map
  for (const [playerId, positions] of playerPositions) {
    // Sort by appearances, excluding DH (position 10) from primary consideration
    const sorted = positions.sort((a, b) => b.appearances - a.appearances);
    const primary = sorted.find(p => p.position !== 10) || sorted[0];

    const eligibility: Record<number, number> = {};
    for (const pos of sorted) {
      eligibility[pos.position] = pos.appearances;
    }

    positionMap.set(playerId, {
      primaryPosition: primary.position,
      positionEligibility: eligibility
    });
  }
  console.log(`    ✓ ${positionMap.size} players with position data`);

  // Extract batters
  console.log('  📊 Batters...');
  const battersResult = runDuckDB(getBatterStatsSQL(year), dbPath);
  const battersRaw = parseCSV(battersResult);
  const batters: SeasonPackage['batters'] = {};

  for (const row of battersRaw) {
    const paL = parseNumber(row.pa_vs_l);
    const paR = parseNumber(row.pa_vs_r);

    // Get position data
    const posData = positionMap.get(row.batter_id);
    let primaryPosition = 9; // Default to RF
    let positionEligibility: Record<number, number> = {};

    if (posData) {
      primaryPosition = posData.primaryPosition;
      positionEligibility = posData.positionEligibility;
    } else {
      // No position data - default to RF
      positionEligibility = { 9: 1 };
    }

    batters[row.batter_id] = {
      id: row.batter_id,
      name: row.name,
      bats: row.bats === 'B' ? 'S' : row.bats,
      teamId: row.primary_team_id,
      primaryPosition,
      positionEligibility,
      rates: {
        vsLHP: calcEventRates({
          singles: parseNumber(row.singles_vs_l),
          doubles: parseNumber(row.doubles_vs_l),
          triples: parseNumber(row.triples_vs_l),
          homeRuns: parseNumber(row.hr_vs_l),
          walks: parseNumber(row.walks_vs_l),
          hitByPitches: parseNumber(row.hbp_vs_l),
          strikeouts: parseNumber(row.strikeouts_vs_l),
          groundOuts: parseNumber(row.ground_outs_vs_l),
          flyOuts: parseNumber(row.fly_outs_vs_l),
          lineOuts: parseNumber(row.line_outs_vs_l),
          popOuts: parseNumber(row.pop_outs_vs_l),
          unknownOuts: parseNumber(row.unknown_outs_vs_l),
          sacrificeFlies: parseNumber(row.sacrifice_flies_vs_l),
          sacrificeBunts: parseNumber(row.sacrifice_bunts_vs_l),
          fieldersChoices: parseNumber(row.fielders_choices_vs_l),
          reachedOnErrors: parseNumber(row.reached_on_errors_vs_l),
          catcherInterferences: parseNumber(row.catcher_interferences_vs_l),
          pa: paL,
        }),
        vsRHP: calcEventRates({
          singles: parseNumber(row.singles_vs_r),
          doubles: parseNumber(row.doubles_vs_r),
          triples: parseNumber(row.triples_vs_r),
          homeRuns: parseNumber(row.hr_vs_r),
          walks: parseNumber(row.walks_vs_r),
          hitByPitches: parseNumber(row.hbp_vs_r),
          strikeouts: parseNumber(row.strikeouts_vs_r),
          groundOuts: parseNumber(row.ground_outs_vs_r),
          flyOuts: parseNumber(row.fly_outs_vs_r),
          lineOuts: parseNumber(row.line_outs_vs_r),
          popOuts: parseNumber(row.pop_outs_vs_r),
          unknownOuts: parseNumber(row.unknown_outs_vs_r),
          sacrificeFlies: parseNumber(row.sacrifice_flies_vs_r),
          sacrificeBunts: parseNumber(row.sacrifice_bunts_vs_r),
          fieldersChoices: parseNumber(row.fielders_choices_vs_r),
          reachedOnErrors: parseNumber(row.reached_on_errors_vs_r),
          catcherInterferences: parseNumber(row.catcher_interferences_vs_r),
          pa: paR,
        }),
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
        vsLHB: calcEventRates({
          singles: parseNumber(row.singles_vs_l),
          doubles: parseNumber(row.doubles_vs_l),
          triples: parseNumber(row.triples_vs_l),
          homeRuns: parseNumber(row.hr_vs_l),
          walks: parseNumber(row.walks_vs_l),
          hitByPitches: parseNumber(row.hbp_vs_l),
          strikeouts: parseNumber(row.strikeouts_vs_l),
          groundOuts: parseNumber(row.ground_outs_vs_l),
          flyOuts: parseNumber(row.fly_outs_vs_l),
          lineOuts: parseNumber(row.line_outs_vs_l),
          popOuts: parseNumber(row.pop_outs_vs_l),
          unknownOuts: parseNumber(row.unknown_outs_vs_l),
          sacrificeFlies: parseNumber(row.sacrifice_flies_vs_l),
          sacrificeBunts: parseNumber(row.sacrifice_bunts_vs_l),
          fieldersChoices: parseNumber(row.fielders_choices_vs_l),
          reachedOnErrors: parseNumber(row.reached_on_errors_vs_l),
          catcherInterferences: parseNumber(row.catcher_interferences_vs_l),
          pa: paL,
        }),
        vsRHB: calcEventRates({
          singles: parseNumber(row.singles_vs_r),
          doubles: parseNumber(row.doubles_vs_r),
          triples: parseNumber(row.triples_vs_r),
          homeRuns: parseNumber(row.hr_vs_r),
          walks: parseNumber(row.walks_vs_r),
          hitByPitches: parseNumber(row.hbp_vs_r),
          strikeouts: parseNumber(row.strikeouts_vs_r),
          groundOuts: parseNumber(row.ground_outs_vs_r),
          flyOuts: parseNumber(row.fly_outs_vs_r),
          lineOuts: parseNumber(row.line_outs_vs_r),
          popOuts: parseNumber(row.pop_outs_vs_r),
          unknownOuts: parseNumber(row.unknown_outs_vs_r),
          sacrificeFlies: parseNumber(row.sacrifice_flies_vs_r),
          sacrificeBunts: parseNumber(row.sacrifice_bunts_vs_r),
          fieldersChoices: parseNumber(row.fielders_choices_vs_r),
          reachedOnErrors: parseNumber(row.reached_on_errors_vs_r),
          catcherInterferences: parseNumber(row.catcher_interferences_vs_r),
          pa: paR,
        }),
      },
    };
  }
  console.log(`    ✓ ${Object.keys(pitchers).length} pitchers`);

  // Extract league averages
  console.log('  📈 League averages...');
  const leagueResult = runDuckDB(getLeagueAveragesSQL(year), dbPath);
  const leagueRaw = parseCSV(leagueResult);
  const league: SeasonPackage['league'] = {
    vsLHP: getZeroRates(),
    vsRHP: getZeroRates(),
  };

  for (const row of leagueRaw) {
    // Apply trajectory imputation to league averages
    const unknownRate = parseNumber(row.unknown_out_rate || 0);
    const imputed = imputeUnknownOuts(
      parseNumber(row.ground_out_rate),
      parseNumber(row.fly_out_rate),
      parseNumber(row.line_out_rate),
      parseNumber(row.pop_out_rate),
      unknownRate
    );

    if (row.pitcher_throws === 'L') {
      league.vsLHP = {
        single: Math.round(parseNumber(row.single_rate) * 10000) / 10000,
        double: Math.round(parseNumber(row.double_rate) * 10000) / 10000,
        triple: Math.round(parseNumber(row.triple_rate) * 10000) / 10000,
        homeRun: Math.round(parseNumber(row.hr_rate) * 10000) / 10000,
        walk: Math.round(parseNumber(row.walk_rate) * 10000) / 10000,
        hitByPitch: Math.round(parseNumber(row.hbp_rate) * 10000) / 10000,
        strikeout: Math.round(parseNumber(row.strikeout_rate) * 10000) / 10000,
        groundOut: Math.round(imputed.groundOut * 10000) / 10000,
        flyOut: Math.round(imputed.flyOut * 10000) / 10000,
        lineOut: Math.round(imputed.lineOut * 10000) / 10000,
        popOut: Math.round(imputed.popOut * 10000) / 10000,
        sacrificeFly: Math.round(parseNumber(row.sacrifice_fly_rate) * 10000) / 10000,
        sacrificeBunt: Math.round(parseNumber(row.sacrifice_bunt_rate) * 10000) / 10000,
        fieldersChoice: Math.round(parseNumber(row.fielders_choice_rate) * 10000) / 10000,
        reachedOnError: Math.round(parseNumber(row.reached_on_error_rate) * 10000) / 10000,
        catcherInterference: Math.round(parseNumber(row.catcher_interference_rate) * 10000) / 10000,
      };
    } else if (row.pitcher_throws === 'R') {
      league.vsRHP = {
        single: Math.round(parseNumber(row.single_rate) * 10000) / 10000,
        double: Math.round(parseNumber(row.double_rate) * 10000) / 10000,
        triple: Math.round(parseNumber(row.triple_rate) * 10000) / 10000,
        homeRun: Math.round(parseNumber(row.hr_rate) * 10000) / 10000,
        walk: Math.round(parseNumber(row.walk_rate) * 10000) / 10000,
        hitByPitch: Math.round(parseNumber(row.hbp_rate) * 10000) / 10000,
        strikeout: Math.round(parseNumber(row.strikeout_rate) * 10000) / 10000,
        groundOut: Math.round(imputed.groundOut * 10000) / 10000,
        flyOut: Math.round(imputed.flyOut * 10000) / 10000,
        lineOut: Math.round(imputed.lineOut * 10000) / 10000,
        popOut: Math.round(imputed.popOut * 10000) / 10000,
        sacrificeFly: Math.round(parseNumber(row.sacrifice_fly_rate) * 10000) / 10000,
        sacrificeBunt: Math.round(parseNumber(row.sacrifice_bunt_rate) * 10000) / 10000,
        fieldersChoice: Math.round(parseNumber(row.fielders_choice_rate) * 10000) / 10000,
        reachedOnError: Math.round(parseNumber(row.reached_on_error_rate) * 10000) / 10000,
        catcherInterference: Math.round(parseNumber(row.catcher_interference_rate) * 10000) / 10000,
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

  // Get era-appropriate norms
  console.log('  📋 Season norms...');
  const norms = getSeasonNorms(year);
  console.log(`    ✓ Era: ${norms.era}, Starter limit: ${norms.pitching.starterPitches.typicalLimit} pitches`);

  // Create season package
  const season: SeasonPackage = {
    meta: {
      year,
      generatedAt: new Date().toISOString(),
      version: '2.0.0',
    },
    norms,
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
