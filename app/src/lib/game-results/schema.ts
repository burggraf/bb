/**
 * SQL schema for game results database
 */
export const GAME_RESULTS_SCHEMA = `
  -- Tables
  CREATE TABLE IF NOT EXISTS series (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    metadata TEXT,
    series_type TEXT NOT NULL CHECK(series_type IN ('season_replay', 'tournament', 'exhibition', 'custom')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'archived'))
  );

  CREATE TABLE IF NOT EXISTS series_teams (
    series_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    season_year INTEGER NOT NULL,
    league TEXT,
    division TEXT,
    PRIMARY KEY (series_id, team_id, season_year),
    FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    series_id TEXT NOT NULL,
    game_number INTEGER,
    away_team_id TEXT NOT NULL,
    away_season_year INTEGER NOT NULL,
    home_team_id TEXT NOT NULL,
    home_season_year INTEGER NOT NULL,
    away_score INTEGER NOT NULL,
    home_score INTEGER NOT NULL,
    innings INTEGER NOT NULL,
    away_starter_id TEXT,
    home_starter_id TEXT,
    winning_pitcher_id TEXT,
    losing_pitcher_id TEXT,
    save_pitcher_id TEXT,
    scheduled_date TEXT,
    played_at TEXT NOT NULL,
    duration_ms INTEGER,
    use_dh INTEGER NOT NULL DEFAULT 1 CHECK(use_dh IN (0, 1)),
    FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS game_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    inning INTEGER NOT NULL,
    is_top_inning INTEGER NOT NULL CHECK(is_top_inning IN (0, 1)),
    outs INTEGER NOT NULL DEFAULT 0,
    event_type TEXT NOT NULL,
    outcome TEXT,
    batter_id TEXT,
    batter_name TEXT,
    pitcher_id TEXT,
    pitcher_name TEXT,
    runs_scored INTEGER NOT NULL DEFAULT 0,
    earned_runs INTEGER NOT NULL DEFAULT 0,
    unearned_runs INTEGER NOT NULL DEFAULT 0,
    runner_1b_before TEXT,
    runner_2b_before TEXT,
    runner_3b_before TEXT,
    runner_1b_after TEXT,
    runner_2b_after TEXT,
    runner_3b_after TEXT,
    description TEXT,
    lineup_json TEXT,
    substituted_player TEXT,
    position INTEGER,
    is_summary INTEGER NOT NULL DEFAULT 0 CHECK(is_summary IN (0, 1)),
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS inning_lines (
    game_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    inning INTEGER NOT NULL,
    runs INTEGER NOT NULL DEFAULT 0,
    hits INTEGER NOT NULL DEFAULT 0,
    errors INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (game_id, team_id, inning),
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS runs_scored (
    event_id INTEGER NOT NULL,
    player_id TEXT NOT NULL,
    is_earned INTEGER NOT NULL DEFAULT 1 CHECK(is_earned IN (0, 1)),
    PRIMARY KEY (event_id, player_id),
    FOREIGN KEY (event_id) REFERENCES game_events(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS player_usage (
    series_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    is_pitcher INTEGER NOT NULL,

    -- Target values (from season export)
    actual_season_total INTEGER NOT NULL,
    games_played_actual INTEGER NOT NULL,

    -- Replay values (cumulative)
    replay_current_total INTEGER NOT NULL DEFAULT 0,
    replay_games_played INTEGER NOT NULL DEFAULT 0,

    -- Calculated fields
    percentage_of_actual REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'inRange',

    PRIMARY KEY (series_id, player_id),
    FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_games_series ON games(series_id);
  CREATE INDEX IF NOT EXISTS idx_games_away ON games(away_team_id, away_season_year);
  CREATE INDEX IF NOT EXISTS idx_games_home ON games(home_team_id, home_season_year);
  CREATE INDEX IF NOT EXISTS idx_events_game ON game_events(game_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_events_batter ON game_events(batter_id) WHERE batter_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_events_pitcher ON game_events(pitcher_id) WHERE pitcher_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_events_outcome ON game_events(outcome) WHERE outcome IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_player_usage_series_pitcher ON player_usage(series_id, is_pitcher);
  CREATE INDEX IF NOT EXISTS idx_player_usage_team ON player_usage(team_id);
  CREATE INDEX IF NOT EXISTS idx_player_usage_status ON player_usage(status);

  -- Views
  CREATE VIEW IF NOT EXISTS series_standings AS
  SELECT
    g.series_id,
    t.team_id,
    t.season_year,
    t.league,
    t.division,
    COUNT(*) as games_played,
    SUM(CASE
      WHEN (t.team_id = g.away_team_id AND t.season_year = g.away_season_year AND g.away_score > g.home_score) OR
           (t.team_id = g.home_team_id AND t.season_year = g.home_season_year AND g.home_score > g.away_score)
      THEN 1 ELSE 0 END) as wins,
    SUM(CASE
      WHEN (t.team_id = g.away_team_id AND t.season_year = g.away_season_year AND g.away_score < g.home_score) OR
           (t.team_id = g.home_team_id AND t.season_year = g.home_season_year AND g.home_score < g.away_score)
      THEN 1 ELSE 0 END) as losses,
    SUM(CASE WHEN t.team_id = g.away_team_id AND t.season_year = g.away_season_year
      THEN g.away_score ELSE g.home_score END) as runs_scored,
    SUM(CASE WHEN t.team_id = g.away_team_id AND t.season_year = g.away_season_year
      THEN g.home_score ELSE g.away_score END) as runs_allowed
  FROM series_teams t
  JOIN games g ON g.series_id = t.series_id
    AND (
      (g.away_team_id = t.team_id AND g.away_season_year = t.season_year) OR
      (g.home_team_id = t.team_id AND g.home_season_year = t.season_year)
    )
  GROUP BY g.series_id, t.team_id, t.season_year;

  CREATE VIEW IF NOT EXISTS batting_stats AS
  SELECT
    g.series_id,
    e.batter_id,
    e.batter_name,
    COUNT(*) as pa,
    SUM(CASE WHEN e.outcome NOT IN ('walk','hitByPitch','sacrificeFly','sacrificeBunt','catcherInterference')
      THEN 1 ELSE 0 END) as ab,
    SUM(CASE WHEN e.outcome IN ('single','double','triple','homeRun') THEN 1 ELSE 0 END) as hits,
    SUM(CASE WHEN e.outcome = 'single' THEN 1 ELSE 0 END) as singles,
    SUM(CASE WHEN e.outcome = 'double' THEN 1 ELSE 0 END) as doubles,
    SUM(CASE WHEN e.outcome = 'triple' THEN 1 ELSE 0 END) as triples,
    SUM(CASE WHEN e.outcome = 'homeRun' THEN 1 ELSE 0 END) as home_runs,
    SUM(CASE WHEN e.outcome = 'walk' THEN 1 ELSE 0 END) as walks,
    SUM(CASE WHEN e.outcome = 'hitByPitch' THEN 1 ELSE 0 END) as hbp,
    SUM(CASE WHEN e.outcome = 'strikeout' THEN 1 ELSE 0 END) as strikeouts,
    SUM(e.runs_scored) as rbi,
    ROUND(CAST(SUM(CASE WHEN e.outcome IN ('single','double','triple','homeRun') THEN 1 ELSE 0 END) AS REAL) /
      NULLIF(SUM(CASE WHEN e.outcome NOT IN ('walk','hitByPitch','sacrificeFly','sacrificeBunt','catcherInterference')
        THEN 1 ELSE 0 END), 0), 3) as avg,
    ROUND(CAST(SUM(CASE WHEN e.outcome IN ('single','double','triple','homeRun','walk','hitByPitch')
      THEN 1 ELSE 0 END) AS REAL) / NULLIF(COUNT(*), 0), 3) as obp,
    ROUND(CAST(
      SUM(CASE WHEN e.outcome = 'single' THEN 1 ELSE 0 END) +
      SUM(CASE WHEN e.outcome = 'double' THEN 2 ELSE 0 END) +
      SUM(CASE WHEN e.outcome = 'triple' THEN 3 ELSE 0 END) +
      SUM(CASE WHEN e.outcome = 'homeRun' THEN 4 ELSE 0 END)
    AS REAL) /
      NULLIF(SUM(CASE WHEN e.outcome NOT IN ('walk','hitByPitch','sacrificeFly','sacrificeBunt','catcherInterference')
        THEN 1 ELSE 0 END), 0), 3) as slg
  FROM game_events e
  JOIN games g ON e.game_id = g.id
  WHERE e.event_type = 'plateAppearance'
    AND e.outcome IS NOT NULL
  GROUP BY g.series_id, e.batter_id;

  CREATE VIEW IF NOT EXISTS pitching_stats AS
  SELECT
    g.series_id,
    e.pitcher_id,
    e.pitcher_name,
    COUNT(DISTINCT e.game_id) as games,
    COUNT(*) as batters_faced,
    SUM(CASE WHEN e.outcome IN ('strikeout','groundOut','flyOut','lineOut','popOut',
      'sacrificeFly','sacrificeBunt','fieldersChoice') THEN 1 ELSE 0 END) as outs_recorded,
    SUM(CASE WHEN e.outcome IN ('single','double','triple','homeRun') THEN 1 ELSE 0 END) as hits_allowed,
    SUM(CASE WHEN e.outcome IN ('walk','hitByPitch') THEN 1 ELSE 0 END) as walks_allowed,
    SUM(CASE WHEN e.outcome = 'strikeout' THEN 1 ELSE 0 END) as strikeouts,
    SUM(CASE WHEN e.outcome = 'homeRun' THEN 1 ELSE 0 END) as home_runs_allowed,
    SUM(e.runs_scored) as runs_allowed,
    SUM(e.earned_runs) as earned_runs,
    ROUND(CAST(SUM(e.earned_runs) AS REAL) * 27.0 /
      NULLIF(SUM(CASE WHEN e.outcome IN ('strikeout','groundOut','flyOut','lineOut','popOut',
        'sacrificeFly','sacrificeBunt','fieldersChoice') THEN 1 ELSE 0 END), 0), 2) as era,
    ROUND(CAST(
      SUM(CASE WHEN e.outcome IN ('single','double','triple','homeRun') THEN 1 ELSE 0 END) +
      SUM(CASE WHEN e.outcome IN ('walk','hitByPitch') THEN 1 ELSE 0 END)
    AS REAL) * 3.0 /
      NULLIF(SUM(CASE WHEN e.outcome IN ('strikeout','groundOut','flyOut','lineOut','popOut',
        'sacrificeFly','sacrificeBunt','fieldersChoice') THEN 1 ELSE 0 END), 0), 3) as whip
  FROM game_events e
  JOIN games g ON e.game_id = g.id
  WHERE e.event_type = 'plateAppearance'
    AND e.outcome IS NOT NULL
  GROUP BY g.series_id, e.pitcher_id;
`;

import type { Database } from 'sql.js';

/**
 * Create all tables, indexes, and views in an existing database
 */
export function createGameResultsSchema(db: Database): void {
  db.exec(GAME_RESULTS_SCHEMA);
}

/**
 * Migrate existing databases to add metadata column to series table
 * Checks if the column exists before attempting to add it
 */
export function migrateSeriesMetadata(db: Database): void {
  try {
    const stmt = db.prepare('PRAGMA table_info(series)');
    const columns: Record<string, any>[] = [];
    while (stmt.step()) {
      columns.push(stmt.getAsObject());
    }
    const hasMetadata = columns.some((col) => col.name === 'metadata');
    stmt.free();

    if (!hasMetadata) {
      console.log('[Schema] Adding metadata column to series table');
      db.exec('ALTER TABLE series ADD COLUMN metadata TEXT');
    }
  } catch (error) {
    console.error('[Schema] Migration error:', error);
    throw error;
  }
}
