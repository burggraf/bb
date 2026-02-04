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
    /** Average batters faced by starters (based on era data) */
    starterBFP: number;
    /** Average batters faced by relievers by inning group */
    relieverBFP: {
      /** Early game (innings 1-3): long men, spot starters */
      early: number;
      /** Middle game (innings 4-6): middle relievers */
      middle: number;
      /** Late game (innings 7+): closers, specialists */
      late: number;
    };
    /** Overall average batters faced by relievers (for backward compatibility) */
    relieverBFPOverall: number;
    /** Average number of relievers used per game (both teams combined) */
    relieversPerGame: number;
    /** Median BFP for starters - represents typical deep outing for this season */
    starterDeepOutingBFP: number;
    /** Pitcher pull thresholds - when to consider pulling starters */
    pullThresholds: {
      /** When to START considering pull (fraction of avg BFP, e.g., 0.85 = 85%) */
      consider: number;
      /** When pull is LIKELY (fraction of avg BFP, e.g., 1.0 = 100%) */
      likely: number;
      /** Hard limit (fraction of avg BFP, e.g., 1.3 = 130%) */
      hardLimit: number;
    };
    /** Expected pitchers per game (for validation/tuning) - averaged across all games */
    expectedPitchersPerGame: number;
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
 * Pull thresholds are calculated from actual BFP data:
 * - consider: 90th percentile (when managers START thinking about pulling)
 * - likely: 75th percentile (when pull becomes LIKELY)
 * - hardLimit: 95th percentile (absolute max, rarely exceeded)
 *
 * @param medianBFP - Median BFP for starters from actual season data
 * @param p90BFP - 90th percentile BFP for starters
 * @param relieverBFP - Reliever BFP by inning group from actual season data
 * @param actualPitchersPerGame - Actual pitchers per game from data
 */
function getSeasonNorms(
  year: number,
  medianBFP?: number,
  p90BFP?: number,
  relieverBFP?: { early: number; middle: number; late: number },
  actualPitchersPerGame?: number
): SeasonNorms {
  // Use actual data when available, otherwise fall back to era defaults
  const avgStarterBFP = medianBFP ?? 27;

  // Calculate pull thresholds based on actual BFP distribution
  // These are FRACTIONS of avgBFP that the engine will multiply to get absolute thresholds
  // Tuned to produce historically accurate pitcher usage per team (not total per game)
  const calculatePullThresholds = (avgBFP: number, p90: number) => {
    // Earlier eras: higher thresholds (starters went deeper)
    // Later eras: lower thresholds (quicker hooks)
    // All values represent fractions of avgBFP
    if (year >= 2009) {
      // Analytics era: Starters typically go 5-6 innings, need to balance with bullpen usage
      return {
        consider: 1.05,  // Start considering at 105% of average (let them go slightly over)
        likely: 1.35,    // Likely pull at 135% of average
        hardLimit: 1.60  // Hard limit at 160% of average
      };
    } else if (year >= 1995) {
      // Modern era: Starters typically 6-7 innings
      return {
        consider: 1.10,
        likely: 1.40,
        hardLimit: 1.65
      };
    } else if (year >= 1973) {
      // DH era: Starters still going 6-7 innings typically
      return {
        consider: 1.15,
        likely: 1.45,
        hardLimit: 1.70
      };
    } else if (year >= 1960) {
      // Expansion era: Starters routinely go 7+ innings
      return {
        consider: 1.20,
        likely: 1.50,
        hardLimit: 1.75
      };
    } else if (year >= 1940) {
      // Integration era: High complete game rates, starters go deep
      return {
        consider: 1.30,
        likely: 1.55,
        hardLimit: 1.85
      };
    } else if (year >= 1920) {
      // Lively ball era
      return {
        consider: 1.35,
        likely: 1.60,
        hardLimit: 1.90
      };
    } else {
      // Deadball era: Complete games very common
      return {
        consider: 1.40,
        likely: 1.70,
        hardLimit: 2.00
      };
    }
  };

  const pullThresholds = calculatePullThresholds(avgStarterBFP, p90BFP ?? avgStarterBFP * 1.3);

  // Use actual pitchers per game when available, otherwise estimate from era
  const estimatedPitchersPerGame = actualPitchersPerGame ?? (
    year >= 2009 ? 8.0 :
    year >= 1995 ? 7.3 :
    year >= 1973 ? 5.5 :
    year >= 1960 ? 4.5 :
    year >= 1940 ? 3.5 :
    year >= 1920 ? 3.2 :
    3.0
  );

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
        starterBFP: avgStarterBFP,
        relieverBFP: relieverBFP ?? { early: 12, middle: 8, late: 4 },
        relieverBFPOverall: 7.1,
        relieversPerGame: 6.3,
        starterDeepOutingBFP: medianBFP ?? 23,
        pullThresholds,
        expectedPitchersPerGame: estimatedPitchersPerGame
      },
      substitutions: {
        pinchHitsPerGame: 2.0,
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
        starterBFP: avgStarterBFP,
        relieverBFP: relieverBFP ?? { early: 14, middle: 10, late: 5 },
        relieverBFPOverall: 7.9,
        relieversPerGame: 5.5,
        starterDeepOutingBFP: medianBFP ?? 29,
        pullThresholds,
        expectedPitchersPerGame: estimatedPitchersPerGame
      },
      substitutions: {
        pinchHitsPerGame: 2.8,
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
        starterBFP: avgStarterBFP,
        relieverBFP: relieverBFP ?? { early: 16, middle: 11, late: 6 },
        relieverBFPOverall: 9.9,
        relieversPerGame: 4.1,
        starterDeepOutingBFP: medianBFP ?? 30,
        pullThresholds,
        expectedPitchersPerGame: estimatedPitchersPerGame
      },
      substitutions: {
        pinchHitsPerGame: 3.0,
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
        starterBFP: avgStarterBFP,
        relieverBFP: relieverBFP ?? { early: 18, middle: 13, late: 8 },
        relieverBFPOverall: 12.0,
        relieversPerGame: 3.0,
        starterDeepOutingBFP: medianBFP ?? 29,
        pullThresholds,
        expectedPitchersPerGame: estimatedPitchersPerGame
      },
      substitutions: {
        pinchHitsPerGame: 2.8,
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
        starterBFP: avgStarterBFP,
        relieverBFP: relieverBFP ?? { early: 20, middle: 15, late: 10 },
        relieverBFPOverall: 14.5,
        relieversPerGame: 2.3,
        starterDeepOutingBFP: medianBFP ?? 32,
        pullThresholds,
        expectedPitchersPerGame: estimatedPitchersPerGame
      },
      substitutions: {
        pinchHitsPerGame: 2.2,
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
        starterBFP: avgStarterBFP,
        relieverBFP: relieverBFP ?? { early: 22, middle: 17, late: 12 },
        relieverBFPOverall: 17.5,
        relieversPerGame: 1.7,
        starterDeepOutingBFP: medianBFP ?? 33,
        pullThresholds,
        expectedPitchersPerGame: estimatedPitchersPerGame
      },
      substitutions: {
        pinchHitsPerGame: 2.2,
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
        starterBFP: avgStarterBFP,
        relieverBFP: relieverBFP ?? { early: 25, middle: 20, late: 15 },
        relieverBFPOverall: 20.0,
        relieversPerGame: 1.5,
        starterDeepOutingBFP: medianBFP ?? 35,
        pullThresholds,
        expectedPitchersPerGame: estimatedPitchersPerGame
      },
      substitutions: {
        pinchHitsPerGame: 2.0,
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
    -- Traditional stats from validation.lahman_batting_season_agg
    COALESCE(lbs.at_bats, 0) as at_bats,
    COALESCE(lbs.batting_average, 0) as batting_average,
    COALESCE(lbs.on_base_percentage, 0) as on_base_percentage,
    COALESCE(lbs.slugging_percentage, 0) as slugging_percentage,
    COALESCE(lbs.ops, 0) as ops,
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
    -- Ball-in-play outs by trajectory (includes bunt variants mapped to equivalents)
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory IN ('GroundBall', 'GroundBallBunt') THEN 1 ELSE 0 END) as ground_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory IN ('Fly', 'FoulBunt') THEN 1 ELSE 0 END) as fly_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory IN ('LineDrive', 'LineDriveBunt') THEN 1 ELSE 0 END) as line_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory IN ('PopUp', 'PopUpBunt', 'UnspecifiedBunt') THEN 1 ELSE 0 END) as pop_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND (e.batted_trajectory IS NULL OR e.batted_trajectory IN ('Unknown', 'Unspecified')) THEN 1 ELSE 0 END) as unknown_outs,
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
  -- Join through lahman_people because lahman tables use different player_id format
  LEFT JOIN validation.lahman_people lppl ON e.batter_id = lppl.retro_id
  LEFT JOIN validation.lahman_batting_season_agg lbs ON lppl.player_id = lbs.player_id AND lbs.season = ${year}
  WHERE EXTRACT(YEAR FROM g.date) = ${year}
    AND e.plate_appearance_result IS NOT NULL
    AND e.plate_appearance_result != 'IntentionalWalk'
    AND e.no_play_flag = false
  GROUP BY e.batter_id, b.last_name, b.first_name, b.bats, p.throws, e.batting_team_id, lbs.at_bats, lbs.batting_average, lbs.on_base_percentage, lbs.slugging_percentage, lbs.ops
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
    -- Traditional stats (these are season totals, not split by handedness)
    MAX(r.at_bats) as at_bats,
    MAX(r.batting_average) as batting_average,
    MAX(r.on_base_percentage) as on_base_percentage,
    MAX(r.slugging_percentage) as slugging_percentage,
    MAX(r.ops) as ops,
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

/**
 * Get batting statistics for pitchers only.
 * Uses a very low PA threshold (1) to include all pitchers who batted.
 */
function getPitcherBattingStatsSQL(year: number, minPA: number = 1): string {
  return `
WITH raw_pitcher_batter_stats AS (
  SELECT
    e.batter_id,
    b.last_name || ', ' || b.first_name as name,
    b.bats,
    p.throws as pitcher_throws,
    e.batting_team_id,
    COUNT(*) as pa,
    -- Traditional stats from validation.lahman_batting_season_agg
    COALESCE(lbs.at_bats, 0) as at_bats,
    COALESCE(lbs.hits, 0) as hits,
    COALESCE(lbs.batting_average, 0) as batting_average,
    COALESCE(lbs.on_base_percentage, 0) as on_base_percentage,
    COALESCE(lbs.slugging_percentage, 0) as slugging_percentage,
    COALESCE(lbs.ops, 0) as ops,
    COALESCE(lbs.walks, 0) as walks,
    COALESCE(lbs.hit_by_pitch, 0) as hit_by_pitch,
    COALESCE(lbs.sacrifice_bunts, 0) as sacrifice_bunts,
    COALESCE(lbs.sacrifice_flies, 0) as sacrifice_flies,
    -- Event-level stats for platoon split calculations
    SUM(CASE WHEN e.plate_appearance_result = 'Walk' THEN 1 ELSE 0 END) as walks_events,
    SUM(CASE WHEN e.plate_appearance_result = 'HitByPitch' THEN 1 ELSE 0 END) as hbp,
    -- Strikeouts
    SUM(CASE WHEN e.plate_appearance_result = 'StrikeOut' THEN 1 ELSE 0 END) as strikeouts,
    -- Hits
    SUM(CASE WHEN e.plate_appearance_result = 'Single' THEN 1 ELSE 0 END) as singles,
    SUM(CASE WHEN e.plate_appearance_result IN ('Double', 'GroundRuleDouble') THEN 1 ELSE 0 END) as doubles,
    SUM(CASE WHEN e.plate_appearance_result = 'Triple' THEN 1 ELSE 0 END) as triples,
    SUM(CASE WHEN e.plate_appearance_result IN ('HomeRun', 'InsideTheParkHomeRun') THEN 1 ELSE 0 END) as home_runs,
    -- Ball-in-play outs by trajectory (includes bunt variants mapped to equivalents)
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory IN ('GroundBall', 'GroundBallBunt') THEN 1 ELSE 0 END) as ground_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory IN ('Fly', 'FoulBunt') THEN 1 ELSE 0 END) as fly_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory IN ('LineDrive', 'LineDriveBunt') THEN 1 ELSE 0 END) as line_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory IN ('PopUp', 'PopUpBunt', 'UnspecifiedBunt') THEN 1 ELSE 0 END) as pop_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND (e.batted_trajectory IS NULL OR e.batted_trajectory IN ('Unknown', 'Unspecified')) THEN 1 ELSE 0 END) as unknown_outs,
    -- Sacrifices (for event-level split calculations)
    SUM(CASE WHEN e.plate_appearance_result = 'SacrificeFly' THEN 1 ELSE 0 END) as sacrifice_flies_events,
    SUM(CASE WHEN e.plate_appearance_result = 'SacrificeHit' THEN 1 ELSE 0 END) as sacrifice_bunts_events,
    -- Other
    SUM(CASE WHEN e.plate_appearance_result = 'FieldersChoice' THEN 1 ELSE 0 END) as fielders_choices,
    SUM(CASE WHEN e.plate_appearance_result = 'ReachedOnError' THEN 1 ELSE 0 END) as reached_on_errors,
    SUM(CASE WHEN e.plate_appearance_result = 'Interference' THEN 1 ELSE 0 END) as catcher_interferences
  FROM event.events e
  JOIN dim.players b ON e.batter_id = b.player_id
  JOIN dim.players p ON e.pitcher_id = p.player_id
  JOIN game.games g ON e.game_id = g.game_id
  -- Join through lahman_people because lahman tables use different player_id format
  LEFT JOIN validation.lahman_people lppl ON e.batter_id = lppl.retro_id
  LEFT JOIN validation.lahman_batting_season_agg lbs ON lppl.player_id = lbs.player_id AND lbs.season = ${year}
  WHERE EXTRACT(YEAR FROM g.date) = ${year}
    AND e.plate_appearance_result IS NOT NULL
    AND e.plate_appearance_result != 'IntentionalWalk'
    AND e.no_play_flag = false
    -- Only include players who are pitchers (appear as pitcher_id in events)
    AND e.batter_id IN (
      SELECT DISTINCT pitcher_id
      FROM event.events e2
      JOIN game.games g2 ON e2.game_id = g2.game_id
      WHERE EXTRACT(YEAR FROM g2.date) = ${year}
    )
  GROUP BY e.batter_id, b.last_name, b.first_name, b.bats, p.throws, e.batting_team_id, lbs.at_bats, lbs.hits, lbs.batting_average, lbs.on_base_percentage, lbs.slugging_percentage, lbs.ops, lbs.walks, lbs.hit_by_pitch, lbs.sacrifice_bunts, lbs.sacrifice_flies
),
-- Find primary team for each pitcher-batter (most PAs)
pitcher_batter_primary_team AS (
  SELECT
    batter_id,
    batting_team_id,
    SUM(pa) as team_pa
  FROM raw_pitcher_batter_stats
  GROUP BY batter_id, batting_team_id
),
pitcher_batter_best_team AS (
  SELECT
    batter_id,
    batting_team_id as primary_team_id,
    ROW_NUMBER() OVER (PARTITION BY batter_id ORDER BY team_pa DESC) as rn
  FROM pitcher_batter_primary_team
),
aggregated AS (
  SELECT
    r.batter_id,
    r.name,
    r.bats,
    pbt.primary_team_id,
    -- Traditional stats from lahman tables (season totals, not split by handedness)
    MAX(r.at_bats) as at_bats,
    MAX(r.hits) as hits,
    MAX(r.batting_average) as batting_average,
    MAX(r.on_base_percentage) as on_base_percentage,
    MAX(r.slugging_percentage) as slugging_percentage,
    MAX(r.ops) as ops,
    MAX(r.walks) as walks,
    MAX(r.hit_by_pitch) as hit_by_pitch,
    MAX(r.sacrifice_bunts) as sacrifice_bunts,
    MAX(r.sacrifice_flies) as sacrifice_flies,
    -- vs LHP
    SUM(CASE WHEN pitcher_throws = 'L' THEN pa ELSE 0 END) as pa_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN strikeouts ELSE 0 END) as strikeouts_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN singles ELSE 0 END) as singles_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN doubles ELSE 0 END) as doubles_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN triples ELSE 0 END) as triples_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN home_runs ELSE 0 END) as hr_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN walks_events ELSE 0 END) as walks_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN hbp ELSE 0 END) as hbp_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN ground_outs ELSE 0 END) as ground_outs_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN fly_outs ELSE 0 END) as fly_outs_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN line_outs ELSE 0 END) as line_outs_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN pop_outs ELSE 0 END) as pop_outs_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN unknown_outs ELSE 0 END) as unknown_outs_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN sacrifice_flies_events ELSE 0 END) as sacrifice_flies_vs_l,
    SUM(CASE WHEN pitcher_throws = 'L' THEN sacrifice_bunts_events ELSE 0 END) as sacrifice_bunts_vs_l,
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
    SUM(CASE WHEN pitcher_throws = 'R' THEN walks_events ELSE 0 END) as walks_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN hbp ELSE 0 END) as hbp_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN ground_outs ELSE 0 END) as ground_outs_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN fly_outs ELSE 0 END) as fly_outs_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN line_outs ELSE 0 END) as line_outs_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN pop_outs ELSE 0 END) as pop_outs_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN unknown_outs ELSE 0 END) as unknown_outs_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN sacrifice_flies_events ELSE 0 END) as sacrifice_flies_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN sacrifice_bunts_events ELSE 0 END) as sacrifice_bunts_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN fielders_choices ELSE 0 END) as fielders_choices_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN reached_on_errors ELSE 0 END) as reached_on_errors_vs_r,
    SUM(CASE WHEN pitcher_throws = 'R' THEN catcher_interferences ELSE 0 END) as catcher_interferences_vs_r
  FROM raw_pitcher_batter_stats r
  JOIN pitcher_batter_best_team pbt ON r.batter_id = pbt.batter_id AND pbt.rn = 1
  GROUP BY r.batter_id, r.name, r.bats, pbt.primary_team_id
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
    -- Traditional stats from validation.lahman_pitching and lahman_pitching_season_agg
    -- Need to join through lahman_people because player_id formats differ
    COALESCE(lp.games, 0) as games,
    COALESCE(lp.games_started, 0) as games_started,
    COALESCE(lp.complete_games, 0) as complete_games,
    COALESCE(lp.saves, 0) as saves,
    COALESCE(lp.innings_pitched, 0) as innings_pitched,
    COALESCE(lps.whip, 0) as whip,
    COALESCE(lps.era, 0) as era,
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
    -- Ball-in-play outs by trajectory (includes bunt variants mapped to equivalents)
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory IN ('GroundBall', 'GroundBallBunt') THEN 1 ELSE 0 END) as ground_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory IN ('Fly', 'FoulBunt') THEN 1 ELSE 0 END) as fly_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory IN ('LineDrive', 'LineDriveBunt') THEN 1 ELSE 0 END) as line_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory IN ('PopUp', 'PopUpBunt', 'UnspecifiedBunt') THEN 1 ELSE 0 END) as pop_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND (e.batted_trajectory IS NULL OR e.batted_trajectory IN ('Unknown', 'Unspecified')) THEN 1 ELSE 0 END) as unknown_outs,
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
  -- Join through lahman_people because lahman tables use different player_id format
  -- lahman_people.retro_id matches dim.players.player_id
  LEFT JOIN validation.lahman_people lppl ON e.pitcher_id = lppl.retro_id
  LEFT JOIN validation.lahman_pitching lp ON lppl.player_id = lp.player_id AND lp.season = ${year}
  LEFT JOIN validation.lahman_pitching_season_agg lps ON lppl.player_id = lps.player_id AND lps.season = ${year}
  WHERE EXTRACT(YEAR FROM g.date) = ${year}
    AND e.plate_appearance_result IS NOT NULL
    AND e.plate_appearance_result != 'IntentionalWalk'
    AND e.no_play_flag = false
  GROUP BY e.pitcher_id, p.last_name, p.first_name, p.throws, b.bats, e.fielding_team_id, lp.games, lp.games_started, lp.complete_games, lp.saves, lp.innings_pitched, lps.whip, lps.era
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
    -- Traditional stats from lahman tables (season totals, not split by handedness)
    MAX(r.games) as games,
    MAX(r.games_started) as games_started,
    MAX(r.complete_games) as complete_games,
    MAX(r.saves) as saves,
    MAX(r.innings_pitched) as innings_pitched,
    MAX(r.whip) as whip,
    MAX(r.era) as era,
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
    -- Ball-in-play outs by trajectory (includes bunt variants mapped to equivalents)
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory IN ('GroundBall', 'GroundBallBunt') THEN 1 ELSE 0 END) as ground_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory IN ('Fly', 'FoulBunt') THEN 1 ELSE 0 END) as fly_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory IN ('LineDrive', 'LineDriveBunt') THEN 1 ELSE 0 END) as line_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory IN ('PopUp', 'PopUpBunt', 'UnspecifiedBunt') THEN 1 ELSE 0 END) as pop_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND (e.batted_trajectory IS NULL OR e.batted_trajectory IN ('Unknown', 'Unspecified')) THEN 1 ELSE 0 END) as unknown_outs,
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

/**
 * Get league-average batting statistics for pitchers only.
 * This is used as a fallback for pitchers with few or no at-bats.
 */
function getPitcherBatterLeagueAveragesSQL(year: number): string {
  return `
WITH pitcher_batter_rates AS (
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
    -- Walks
    SUM(CASE WHEN e.plate_appearance_result = 'Walk' THEN 1 ELSE 0 END) as walks,
    SUM(CASE WHEN e.plate_appearance_result = 'HitByPitch' THEN 1 ELSE 0 END) as hbp,
    -- Ball-in-play outs by trajectory (includes bunt variants mapped to equivalents)
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory IN ('GroundBall', 'GroundBallBunt') THEN 1 ELSE 0 END) as ground_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory IN ('Fly', 'FoulBunt') THEN 1 ELSE 0 END) as fly_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory IN ('LineDrive', 'LineDriveBunt') THEN 1 ELSE 0 END) as line_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND e.batted_trajectory IN ('PopUp', 'PopUpBunt', 'UnspecifiedBunt') THEN 1 ELSE 0 END) as pop_outs,
    SUM(CASE WHEN e.plate_appearance_result = 'InPlayOut' AND (e.batted_trajectory IS NULL OR e.batted_trajectory IN ('Unknown', 'Unspecified')) THEN 1 ELSE 0 END) as unknown_outs,
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
    -- Only include PAs where the batter is a pitcher
    AND e.batter_id IN (
      SELECT DISTINCT pitcher_id
      FROM event.events e2
      JOIN game.games g2 ON e2.game_id = g2.game_id
      WHERE EXTRACT(YEAR FROM g2.date) = ${year}
    )
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
FROM pitcher_batter_rates
WHERE pitcher_throws IN ('L', 'R')
ORDER BY pitcher_throws;
`;
}

function getTeamsSQL(year: number): string {
  return `
SELECT
  team_id,
  league,
  city,
  nickname
FROM dim.teams
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
  ds.player_id,
  ds.fielding_position,
  SUM(ds.outs_played) AS outs_played
FROM defensive_stats ds
WHERE ds.season = ${year}
GROUP BY ds.player_id, ds.fielding_position
ORDER BY ds.player_id, outs_played DESC;
`;
}

function getPitcherBfpSQL(year: number): string {
  return `
WITH first_pitchers AS (
  -- Find the first pitcher for each game and side
  SELECT DISTINCT
    e.game_id,
    e.side,
    e.pitcher_id as starter_id
  FROM event.events e
  JOIN game.games g ON e.game_id = g.game_id
  WHERE EXTRACT(YEAR FROM g.date) = ${year}
    AND e.plate_appearance_result IS NOT NULL
    AND e.plate_appearance_result != 'IntentionalWalk'
    AND e.no_play_flag = false
  QUALIFY ROW_NUMBER() OVER (PARTITION BY e.game_id, e.side ORDER BY e.event_id) = 1
),
pitcher_roles AS (
  SELECT
    e.pitcher_id,
    e.game_id,
    CASE
      WHEN fp.starter_id IS NOT NULL THEN 'starter'
      ELSE 'reliever'
    END as role
  FROM event.events e
  JOIN game.games g ON e.game_id = g.game_id
  LEFT JOIN first_pitchers fp ON e.game_id = fp.game_id AND e.side = fp.side AND e.pitcher_id = fp.starter_id
  WHERE EXTRACT(YEAR FROM g.date) = ${year}
    AND e.plate_appearance_result IS NOT NULL
    AND e.plate_appearance_result != 'IntentionalWalk'
    AND e.no_play_flag = false
),
pitcher_bfp AS (
  SELECT
    pitcher_id,
    role,
    COUNT(*) as bfp,
    COUNT(DISTINCT game_id) as games
  FROM pitcher_roles
  GROUP BY pitcher_id, role
)
SELECT
  pb.pitcher_id,
  -- Average BFP as starter (only pitchers who started at least 5 games)
  CASE
    WHEN MAX(CASE WHEN role = 'starter' THEN games END) >= 5
    THEN COALESCE(SUM(CASE WHEN role = 'starter' THEN bfp END), 0) / NULLIF(MAX(CASE WHEN role = 'starter' THEN games END), 0)
    ELSE NULL
  END as avg_bfp_as_starter,
  -- Average BFP as reliever (only pitchers who relieved at least 5 games)
  CASE
    WHEN MAX(CASE WHEN role = 'reliever' THEN games END) >= 5
    THEN COALESCE(SUM(CASE WHEN role = 'reliever' THEN bfp END), 0) / NULLIF(MAX(CASE WHEN role = 'reliever' THEN games END), 0)
    ELSE NULL
  END as avg_bfp_as_reliever
FROM pitcher_bfp pb
GROUP BY pb.pitcher_id
HAVING COALESCE(SUM(CASE WHEN role = 'starter' THEN bfp END), 0) + COALESCE(SUM(CASE WHEN role = 'reliever' THEN bfp END), 0) >= 25
ORDER BY COALESCE(SUM(CASE WHEN role = 'starter' THEN bfp END), 0) + COALESCE(SUM(CASE WHEN role = 'reliever' THEN bfp END), 0) DESC;
`;
}

/**
 * Query season-specific median BFP for starters
 * This represents the "typical deep outing" - what pitchers commonly achieved
 */
function getSeasonStaminaSQL(year: number): string {
  return `
WITH first_pitchers AS (
  SELECT DISTINCT
    e.game_id,
    e.side,
    e.pitcher_id as starter_id
  FROM event.events e
  JOIN game.games g ON e.game_id = g.game_id
  WHERE EXTRACT(YEAR FROM g.date) = ${year}
    AND e.plate_appearance_result IS NOT NULL
    AND e.plate_appearance_result != 'IntentionalWalk'
    AND e.no_play_flag = false
  QUALIFY ROW_NUMBER() OVER (PARTITION BY e.game_id, e.side ORDER BY e.event_id) = 1
),
starter_outings AS (
  SELECT
    fp.starter_id as pitcher_id,
    e.game_id,
    COUNT(*) as bfp
  FROM event.events e
  JOIN first_pitchers fp ON e.game_id = fp.game_id AND e.side = fp.side AND e.pitcher_id = fp.starter_id
  JOIN game.games g ON e.game_id = g.game_id
  WHERE EXTRACT(YEAR FROM g.date) = ${year}
    AND e.plate_appearance_result IS NOT NULL
    AND e.plate_appearance_result != 'IntentionalWalk'
    AND e.no_play_flag = false
  GROUP BY fp.starter_id, e.game_id
)
SELECT
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY bfp), 1) as deep_outing_bfp
FROM starter_outings;
`;
}

/**
 * Query reliever BFP averages by inning group
 * Early (1-3): long men, spot starters
 * Middle (4-6): middle relievers
 * Late (7+): closers, specialists
 */
function getRelieverBFPByInningSQL(year: number): string {
  return `
WITH first_pitchers AS (
  SELECT DISTINCT
    e.game_id,
    e.side,
    e.pitcher_id as starter_id
  FROM event.events e
  JOIN game.games g ON e.game_id = g.game_id
  WHERE EXTRACT(YEAR FROM g.date) = ${year}
    AND e.plate_appearance_result IS NOT NULL
    AND e.plate_appearance_result != 'IntentionalWalk'
    AND e.no_play_flag = false
  QUALIFY ROW_NUMBER() OVER (PARTITION BY e.game_id, e.side ORDER BY e.event_id) = 1
),
reliever_appearances AS (
  SELECT
    e.pitcher_id,
    e.game_id,
    e.side,
    e.inning,
    COUNT(*) as bfp,
    -- Determine if this is early, middle, or late entry
    CASE
      WHEN e.inning <= 3 THEN 'early'
      WHEN e.inning <= 6 THEN 'middle'
      ELSE 'late'
    END as inning_group
  FROM event.events e
  JOIN game.games g ON e.game_id = g.game_id
  LEFT JOIN first_pitchers fp ON e.game_id = fp.game_id AND e.side = fp.side AND e.pitcher_id = fp.starter_id
  WHERE EXTRACT(YEAR FROM g.date) = ${year}
    AND e.plate_appearance_result IS NOT NULL
    AND e.plate_appearance_result != 'IntentionalWalk'
    AND e.no_play_flag = false
    -- Exclude first pitcher in each game/side (starters)
    AND fp.starter_id IS NULL
  GROUP BY e.pitcher_id, e.game_id, e.side, e.inning
)
SELECT
  inning_group,
  ROUND(AVG(bfp), 1) as avg_bfp
FROM reliever_appearances
GROUP BY inning_group
ORDER BY inning_group;
`;
}

/**
 * Calculate actual pitchers used per game from historical data
 */
function getPitchersPerGameSQL(year: number): string {
  return `
WITH game_pitchers AS (
    SELECT
        g.game_id,
        COUNT(DISTINCT e.pitcher_id) as pitchers_used
    FROM game.games g
    JOIN event.events e ON g.game_id = e.game_id
    WHERE EXTRACT(YEAR FROM g.date) = ${year}
        AND e.pitcher_id IS NOT NULL
        AND e.plate_appearance_result IS NOT NULL
        AND e.no_play_flag = false
    GROUP BY g.game_id
)
SELECT
    ROUND(AVG(pitchers_used), 2) as avg_pitchers_per_game
FROM game_pitchers;
`;
}

/**
 * Query 90th percentile BFP for starters (for calculating hard limits)
 */
function getStarterBFP90SQL(year: number): string {
  return `
WITH first_pitchers AS (
  SELECT DISTINCT
    e.game_id,
    e.side,
    e.pitcher_id as starter_id
  FROM event.events e
  JOIN game.games g ON e.game_id = g.game_id
  WHERE EXTRACT(YEAR FROM g.date) = ${year}
    AND e.plate_appearance_result IS NOT NULL
    AND e.plate_appearance_result != 'IntentionalWalk'
    AND e.no_play_flag = false
  QUALIFY ROW_NUMBER() OVER (PARTITION BY e.game_id, e.side ORDER BY e.event_id) = 1
),
starter_outings AS (
  SELECT
    fp.starter_id as pitcher_id,
    e.game_id,
    COUNT(*) as bfp
  FROM event.events e
  JOIN first_pitchers fp ON e.game_id = fp.game_id AND e.side = fp.side AND e.pitcher_id = fp.starter_id
  JOIN game.games g ON e.game_id = g.game_id
  WHERE EXTRACT(YEAR FROM g.date) = ${year}
    AND e.plate_appearance_result IS NOT NULL
    AND e.plate_appearance_result != 'IntentionalWalk'
    AND e.no_play_flag = false
  GROUP BY fp.starter_id, e.game_id
)
SELECT
  ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY bfp), 1) as p90_bfp
FROM starter_outings;
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
    /** Traditional stats from lahman_batting_season_agg */
    pa: number;
    avg: number;
    obp: number;
    slg: number;
    ops: number;
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
    /** Average batters faced when starting (for fatigue modeling) */
    avgBfpAsStarter: number | null;
    /** Average batters faced when relieving (for fatigue modeling) */
    avgBfpAsReliever: number | null;
    /** Traditional stats from lahman_pitching and lahman_pitching_season_agg */
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
  }>;
  league: {
    vsLHP: EventRates;
    vsRHP: EventRates;
    /** League-average batting stats for pitchers (for pitchers with few/no at-bats) */
    pitcherBatter: {
      vsLHP: EventRates;
      vsRHP: EventRates;
    };
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
  const playerPositions = new Map<string, Array<{ position: number; outsPlayed: number }>>();
  for (const row of positionsRaw) {
    const playerId = row.player_id;
    const position = parseNumber(row.fielding_position);
    const outsPlayed = parseNumber(row.outs_played);

    if (!playerPositions.has(playerId)) {
      playerPositions.set(playerId, []);
    }
    playerPositions.get(playerId)!.push({ position, outsPlayed });
  }

  // Determine primary position and build eligibility map
  for (const [playerId, positions] of playerPositions) {
    // Sort by outs played, excluding DH (position 10) from primary consideration
    const sorted = positions.sort((a, b) => b.outsPlayed - a.outsPlayed);
    const primary = sorted.find(p => p.position !== 10) || sorted[0];

    const eligibility: Record<number, number> = {};
    for (const pos of sorted) {
      eligibility[pos.position] = pos.outsPlayed;
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
      // Traditional stats from lahman_batting_season_agg
      pa: parseNumber(row.at_bats) + parseNumber(row.walks) + parseNumber(row.hit_by_pitch) + parseNumber(row.sacrifice_bunts) + parseNumber(row.sacrifice_flies), // PA = AB + BB + HBP + SH + SF
      avg: parseNumber(row.batting_average),
      obp: parseNumber(row.on_base_percentage),
      slg: parseNumber(row.slugging_percentage),
      ops: parseNumber(row.ops),
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

  // Extract pitcher BFP data
  console.log('  📊 Pitcher BFP data...');
  const pitcherBfpResult = runDuckDB(getPitcherBfpSQL(year), dbPath);
  const pitcherBfpRaw = parseCSV(pitcherBfpResult);
  const pitcherBfpMap = new Map<string, { avgBfpAsStarter: number | null; avgBfpAsReliever: number | null }>();

  // Note: getPitcherBfpSQL has a bug where it counts all team PAs for starters
  // We'll use lahman innings_pitched as a fallback to estimate BFP
  // Roughly 3 batters per inning
  const ESTIMATED_BFP_PER_IP = 3;

  for (const row of pitcherBfpRaw) {
    const avgBfpAsStarter = row.avg_bfp_as_starter && row.avg_bfp_as_starter !== 'NULL' ? parseFloat(row.avg_bfp_as_starter) : null;
    // If avgBfpAsStarter is suspiciously high (>100), the query overcounted
    // Use lahman innings_pitched / games_started as a fallback
    if (avgBfpAsStarter && avgBfpAsStarter > 100) {
      pitcherBfpMap.set(row.pitcher_id, {
        avgBfpAsStarter: null,  // Will be calculated from innings_pitched below
        avgBfpAsReliever: row.avg_bfp_as_reliever && row.avg_bfp_as_reliever !== 'NULL' ? parseFloat(row.avg_bfp_as_reliever) : null,
      });
    } else {
      pitcherBfpMap.set(row.pitcher_id, {
        avgBfpAsStarter: avgBfpAsStarter,
        avgBfpAsReliever: row.avg_bfp_as_reliever && row.avg_bfp_as_reliever !== 'NULL' ? parseFloat(row.avg_bfp_as_reliever) : null,
      });
    }
  }
  console.log(`    ✓ ${pitcherBfpMap.size} pitchers with BFP data`);

  // Extract pitchers
  console.log('  📊 Pitchers...');
  const pitchersResult = runDuckDB(getPitcherStatsSQL(year), dbPath);
  const pitchersRaw = parseCSV(pitchersResult);
  const pitchers: SeasonPackage['pitchers'] = {};

  for (const row of pitchersRaw) {
    const paL = parseNumber(row.pa_vs_l);
    const paR = parseNumber(row.pa_vs_r);

    // Get BFP data
    let bfpData = pitcherBfpMap.get(row.pitcher_id) || { avgBfpAsStarter: null, avgBfpAsReliever: null };

    // Calculate avgBfpAsStarter from innings_pitched if BFP query returned null or wrong value
    const gamesStarted = parseNumber(row.games_started);
    const inningsPitched = parseNumber(row.innings_pitched);
    if (bfpData.avgBfpAsStarter === null && gamesStarted > 0) {
      // Estimate BFP from innings pitched (roughly 3 batters per inning)
      bfpData = {
        ...bfpData,
        avgBfpAsStarter: Math.round((inningsPitched / gamesStarted) * ESTIMATED_BFP_PER_IP)
      };
    }

    pitchers[row.pitcher_id] = {
      id: row.pitcher_id,
      name: row.name,
      throws: row.throws,
      teamId: row.primary_team_id,
      avgBfpAsStarter: bfpData.avgBfpAsStarter,
      avgBfpAsReliever: bfpData.avgBfpAsReliever,
      // Traditional stats from lahman tables
      games: parseNumber(row.games),
      gamesStarted: gamesStarted,
      completeGames: parseNumber(row.complete_games),
      saves: parseNumber(row.saves),
      inningsPitched: inningsPitched,
      whip: parseNumber(row.whip),
      era: parseNumber(row.era),
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
    pitcherBatter: {
      vsLHP: getZeroRates(),
      vsRHP: getZeroRates(),
    },
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

  // Extract pitcher-batter league averages (for pitchers with few/no at-bats)
  console.log('  📈 Pitcher-batter league averages...');
  const pitcherBatterLeagueResult = runDuckDB(getPitcherBatterLeagueAveragesSQL(year), dbPath);
  const pitcherBatterLeagueRaw = parseCSV(pitcherBatterLeagueResult);
  const pitcherBatterLeague: { vsLHP: EventRates; vsRHP: EventRates } = {
    vsLHP: getZeroRates(),
    vsRHP: getZeroRates(),
  };

  for (const row of pitcherBatterLeagueRaw) {
    // Apply trajectory imputation to pitcher-batter league averages
    const unknownRate = parseNumber(row.unknown_out_rate || 0);
    const imputed = imputeUnknownOuts(
      parseNumber(row.ground_out_rate),
      parseNumber(row.fly_out_rate),
      parseNumber(row.line_out_rate),
      parseNumber(row.pop_out_rate),
      unknownRate
    );

    if (row.pitcher_throws === 'L') {
      pitcherBatterLeague.vsLHP = {
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
      pitcherBatterLeague.vsRHP = {
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
  console.log('    ✓ Pitcher-batter league averages calculated');

  // Extract pitcher batting stats
  console.log('  📊 Pitcher batting stats...');
  const pitcherBatterResult = runDuckDB(getPitcherBattingStatsSQL(year), dbPath);
  const pitcherBatterRaw = parseCSV(pitcherBatterResult);

  // Add pitcher batting stats to batters
  let pitchersAdded = 0;
  let pitchersUsingLeagueAvg = 0;
  const PA_THRESHOLD = 5; // Use actual stats if PA >= 5, otherwise use league average

  for (const row of pitcherBatterRaw) {
    const pitcherId = row.batter_id;
    const paL = parseNumber(row.pa_vs_l);
    const paR = parseNumber(row.pa_vs_r);
    const totalPA = paL + paR;

    // Skip if already in batters (shouldn't happen, but just in case)
    if (batters[pitcherId]) {
      continue;
    }

    // Get team ID from pitchers object (since we have their team from pitching stats)
    const pitcherInfo = pitchers[pitcherId];
    if (!pitcherInfo) {
      continue; // Skip if we don't have this pitcher's info
    }

    let rates: { vsLHP: EventRates; vsRHP: EventRates };

    // If pitcher has enough PAs, use their actual stats
    if (totalPA >= PA_THRESHOLD) {
      rates = {
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
      };
    } else {
      // Use league pitcher-batter averages for pitchers with few at-bats
      rates = pitcherBatterLeague;
      pitchersUsingLeagueAvg++;
    }

    // Add to batters with pitcher position
    batters[pitcherId] = {
      id: pitcherId,
      name: row.name,
      bats: row.bats === 'B' ? 'S' : row.bats,
      teamId: pitcherInfo.teamId,
      primaryPosition: 1, // Pitcher
      positionEligibility: { 1: 1 }, // Only eligible at pitcher
      // Traditional stats - 0 for pitchers who use league average
      pa: totalPA,
      avg: totalPA >= PA_THRESHOLD ? parseFloat(row.at_bats) > 0 ? parseFloat(row.hits) / parseFloat(row.at_bats) : 0 : 0,
      obp: totalPA >= PA_THRESHOLD ? parseFloat(row.on_base_percentage) : 0,
      slg: totalPA >= PA_THRESHOLD ? parseFloat(row.slugging_percentage) : 0,
      ops: totalPA >= PA_THRESHOLD ? parseFloat(row.ops) : 0,
      rates,
    };

    pitchersAdded++;
  }
  console.log(`    ✓ ${pitchersAdded} pitchers added to batters (${pitchersUsingLeagueAvg} using league avg)`);

  // Extract teams
  console.log('  🏟️  Teams...');
  const teamsResult = runDuckDB(getTeamsSQL(year), dbPath);
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

  // Get season-specific stamina data (90th percentile BFP for starters)
  console.log('  📊 Season stamina data...');
  const staminaResult = runDuckDB(getSeasonStaminaSQL(year), dbPath);
  const staminaRaw = parseCSV(staminaResult);
  const deepOutingBFP = staminaRaw.length > 0 && staminaRaw[0].deep_outing_bfp
    ? parseFloat(staminaRaw[0].deep_outing_bfp)
    : undefined;
  console.log(`    ✓ Deep outing BFP (90th percentile): ${deepOutingBFP ?? 'N/A'}`);

  // Get reliever BFP by inning group
  console.log('  📊 Reliever BFP by inning group...');
  const relieverBFPResult = runDuckDB(getRelieverBFPByInningSQL(year), dbPath);
  const relieverBPFRaw = parseCSV(relieverBFPResult);

  let relieverBFP: { early: number; middle: number; late: number } | undefined;
  if (relieverBPFRaw.length >= 3) {
    const earlyRow = relieverBPFRaw.find((r: any) => r.inning_group === 'early');
    const middleRow = relieverBPFRaw.find((r: any) => r.inning_group === 'middle');
    const lateRow = relieverBPFRaw.find((r: any) => r.inning_group === 'late');

    if (earlyRow && middleRow && lateRow) {
      relieverBFP = {
        early: parseFloat(earlyRow.avg_bfp),
        middle: parseFloat(middleRow.avg_bfp),
        late: parseFloat(lateRow.avg_bfp),
      };
      console.log(`    ✓ Early (1-3): ${relieverBFP.early} BFP, Middle (4-6): ${relieverBFP.middle} BFP, Late (7+): ${relieverBFP.late} BFP`);
    }
  }

  if (!relieverBFP) {
    console.log('    ⚠ Could not load reliever BFP data, using defaults');
  }

  // Get actual pitchers per game from data
  console.log('  📊 Pitchers per game...');
  const pitchersPerGameResult = runDuckDB(getPitchersPerGameSQL(year), dbPath);
  const pitchersPerGameRaw = parseCSV(pitchersPerGameResult);
  const actualPitchersPerGame = pitchersPerGameRaw.length > 0
    ? parseFloat(pitchersPerGameRaw[0].avg_pitchers_per_game)
    : undefined;
  console.log(`    ✓ Actual pitchers per game: ${actualPitchersPerGame ?? 'N/A'}`);

  // Get 90th percentile BFP for calculating hard limits
  console.log('  📊 Starter BFP percentiles...');
  const p90BFPResult = runDuckDB(getStarterBFP90SQL(year), dbPath);
  const p90BPFRaw = parseCSV(p90BFPResult);
  const p90BFP = p90BPFRaw.length > 0
    ? parseFloat(p90BPFRaw[0].p90_bfp)
    : undefined;
  console.log(`    ✓ 90th percentile BFP: ${p90BFP ?? 'N/A'}`);

  // Get era-appropriate norms
  console.log('  📋 Season norms...');
  const norms = getSeasonNorms(year, deepOutingBFP, p90BFP, relieverBFP, actualPitchersPerGame);
  console.log(`    ✓ Era: ${norms.era}, Starter limit: ${norms.pitching.starterPitches.typicalLimit} pitches`);
  console.log(`    ✓ Pull thresholds: consider=${norms.pitching.pullThresholds.consider.toFixed(1)}, likely=${norms.pitching.pullThresholds.likely.toFixed(1)}, hardLimit=${norms.pitching.pullThresholds.hardLimit.toFixed(1)}`);

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
    league: {
      ...league,
      pitcherBatter: pitcherBatterLeague,
    },
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
