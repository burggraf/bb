# Game Results Database Design

## Overview

A persistent SQLite database (stored in IndexedDB, exportable as `.sqlite`) that stores all simulation results across all seasons. Enables standings, league leaders, box scores, game replay, and comparison with historical data.

## Key Design Decisions

1. **Single database** for all simulation data (not per-season or per-series)
2. **Series-based** organization — a series can be a season replay, tournament, dream matchup set, or exhibition
3. **Full play-by-play** storage with earned/unearned run tracking
4. **Explicit runner columns** (not JSON) for efficient queries
5. **Outs count** stored per event for complete game state reconstruction
6. **Pre-computed inning lines** for fast box score rendering
7. **Normalized runs_scored** table for runner stat leaderboards
8. **Stats derived via SQL views** — single source of truth, no sync issues
9. **Export/import** as `.sqlite` for external analysis (DBeaver, Python, etc.)
10. **Future-proof** for stolen bases, wild pitches, balks, and other baserunning events

## Schema

### `series`

Top-level container. Every game belongs to exactly one series.

```sql
CREATE TABLE series (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  series_type TEXT NOT NULL,     -- 'season_replay' | 'tournament' | 'exhibition' | 'custom'
  created_at TEXT NOT NULL,      -- ISO 8601
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'  -- 'active' | 'completed' | 'archived'
);
```

### `series_teams`

Teams participating in a series, with their source season. Enables cross-season matchups (e.g., 1927 NYA vs 1988 LAN).

```sql
CREATE TABLE series_teams (
  series_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  season_year INTEGER NOT NULL,
  league TEXT,                   -- 'AL' | 'NL'
  division TEXT,                 -- 'East' | 'Central' | 'West' | NULL (pre-division era)
  PRIMARY KEY (series_id, team_id, season_year),
  FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE
);
```

### `games`

One row per completed simulated game.

```sql
CREATE TABLE games (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  game_number INTEGER,           -- Position in series schedule

  -- Teams with season context
  away_team_id TEXT NOT NULL,
  away_season_year INTEGER NOT NULL,
  home_team_id TEXT NOT NULL,
  home_season_year INTEGER NOT NULL,

  -- Final score
  away_score INTEGER NOT NULL,
  home_score INTEGER NOT NULL,
  innings INTEGER NOT NULL,      -- 9 for regulation, more for extras

  -- Pitching decisions
  away_starter_id TEXT,
  home_starter_id TEXT,
  winning_pitcher_id TEXT,
  losing_pitcher_id TEXT,
  save_pitcher_id TEXT,

  -- Metadata
  scheduled_date TEXT,           -- Original schedule date (if season replay)
  played_at TEXT NOT NULL,       -- ISO 8601: when the sim was run
  duration_ms INTEGER,           -- Simulation wall-clock time
  use_dh INTEGER NOT NULL DEFAULT 0,

  FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE
);

CREATE INDEX idx_games_series ON games(series_id);
CREATE INDEX idx_games_away ON games(away_team_id, away_season_year);
CREATE INDEX idx_games_home ON games(home_team_id, home_season_year);
```

### `game_events`

Every event in a game — plate appearances, lineups, pitching changes, substitutions.

```sql
CREATE TABLE game_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,     -- Chronological order within game

  -- Game state context
  inning INTEGER NOT NULL,
  is_top_inning INTEGER NOT NULL,
  outs INTEGER NOT NULL DEFAULT 0,  -- Outs BEFORE this event
  event_type TEXT NOT NULL,
    -- Current: 'plateAppearance', 'startingLineup', 'pitchingChange',
    --          'pinchHit', 'defensiveSub', 'lineupAdjustment'
    -- Future:  'stolenBase', 'caughtStealing', 'wildPitch', 'passedBall', 'balk'

  -- Plate appearance data (NULL for non-PA events)
  outcome TEXT,                  -- 17 PA outcomes + future: 'stolenBase', 'caughtStealing'
  batter_id TEXT,
  batter_name TEXT,
  pitcher_id TEXT,
  pitcher_name TEXT,
  runs_scored INTEGER NOT NULL DEFAULT 0,
  earned_runs INTEGER NOT NULL DEFAULT 0,
  unearned_runs INTEGER NOT NULL DEFAULT 0,

  -- Runners BEFORE the play (player ID or NULL)
  runner_1b_before TEXT,
  runner_2b_before TEXT,
  runner_3b_before TEXT,

  -- Runners AFTER the play
  runner_1b_after TEXT,
  runner_2b_after TEXT,
  runner_3b_after TEXT,

  -- Managerial / display data
  description TEXT,              -- Human-readable play description
  lineup_json TEXT,              -- JSON for starting lineup events
  substituted_player TEXT,       -- Who was replaced (PH/defensive sub)
  position INTEGER,              -- New fielding position

  is_summary INTEGER NOT NULL DEFAULT 0,

  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE INDEX idx_events_game ON game_events(game_id, sequence);
CREATE INDEX idx_events_batter ON game_events(batter_id) WHERE batter_id IS NOT NULL;
CREATE INDEX idx_events_pitcher ON game_events(pitcher_id) WHERE pitcher_id IS NOT NULL;
CREATE INDEX idx_events_outcome ON game_events(outcome) WHERE outcome IS NOT NULL;
```

### `inning_lines`

Pre-computed box score line. Populated at game-save time.

```sql
CREATE TABLE inning_lines (
  game_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  inning INTEGER NOT NULL,
  runs INTEGER NOT NULL DEFAULT 0,
  hits INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, team_id, inning),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);
```

### `runs_scored`

Junction table: which player scored on which event. Enables "runs scored" leaderboards.

```sql
CREATE TABLE runs_scored (
  event_id INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  is_earned INTEGER NOT NULL DEFAULT 1,  -- 1 = earned, 0 = unearned
  PRIMARY KEY (event_id, player_id),
  FOREIGN KEY (event_id) REFERENCES game_events(id) ON DELETE CASCADE
);
```

## SQL Views

### `series_standings`

W/L record, runs scored/allowed per team within a series.

```sql
CREATE VIEW series_standings AS
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
```

### `batting_stats`

Traditional batting statistics per player per series, derived from plate appearances.

```sql
CREATE VIEW batting_stats AS
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
  -- Computed rates
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
```

### `pitching_stats`

Pitching statistics per pitcher per series, with earned run tracking for ERA.

```sql
CREATE VIEW pitching_stats AS
SELECT
  g.series_id,
  e.pitcher_id,
  e.pitcher_name,
  COUNT(DISTINCT e.game_id) as games,
  COUNT(*) as batters_faced,
  SUM(CASE WHEN e.outcome IN ('strikeout','groundOut','flyOut','lineOut','popOut',
    'sacrificeFly','sacrificeBunt','fieldersChoice') THEN 1 ELSE 0 END) as outs_recorded,
  -- Innings pitched (outs / 3, displayed as X.Y where Y is remaining outs)
  SUM(CASE WHEN e.outcome IN ('single','double','triple','homeRun') THEN 1 ELSE 0 END) as hits_allowed,
  SUM(CASE WHEN e.outcome IN ('walk','hitByPitch') THEN 1 ELSE 0 END) as walks_allowed,
  SUM(CASE WHEN e.outcome = 'strikeout' THEN 1 ELSE 0 END) as strikeouts,
  SUM(CASE WHEN e.outcome = 'homeRun' THEN 1 ELSE 0 END) as home_runs_allowed,
  SUM(e.runs_scored) as runs_allowed,
  SUM(e.earned_runs) as earned_runs,
  -- ERA = earned_runs * 9 / (outs_recorded / 3)
  ROUND(CAST(SUM(e.earned_runs) AS REAL) * 27.0 /
    NULLIF(SUM(CASE WHEN e.outcome IN ('strikeout','groundOut','flyOut','lineOut','popOut',
      'sacrificeFly','sacrificeBunt','fieldersChoice') THEN 1 ELSE 0 END), 0), 2) as era,
  -- WHIP = (walks + hits) / (outs / 3)
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
```

## Storage Estimates

| Table | Rows per 162-game season | Avg row size | Total |
|-------|--------------------------|-------------|-------|
| `series` | 1 | ~200 bytes | ~200 B |
| `series_teams` | ~16-30 | ~100 bytes | ~3 KB |
| `games` | 162 | ~400 bytes | ~65 KB |
| `game_events` | ~60,000 | ~300 bytes | ~18 MB |
| `inning_lines` | ~3,000 | ~60 bytes | ~180 KB |
| `runs_scored` | ~1,500 | ~40 bytes | ~60 KB |
| **Total** | | | **~18 MB per 162-game season** |

Compressed (SQLite pages compress well): ~5-8 MB per season.

## Export/Import

```typescript
// Export entire game database as downloadable .sqlite file
async function exportGameDatabase(): Promise<Blob>

// Import a .sqlite file, replacing or merging with existing data
async function importGameDatabase(file: File): Promise<void>
```

Exported files can be opened in DBeaver, sqlite3 CLI, Python, DuckDB, etc.

## Database Lifecycle

- **Single global database** — created lazily on first game save
- Stored in IndexedDB (`bb-game-results` store)
- Persists across browser sessions
- Export/import for backup and external analysis

## Earned Run Tracking

When the engine saves a game:
1. Track which runners reached base on errors (`reachedOnError` outcome)
2. When those runners score, their runs are flagged as unearned
3. `earned_runs` + `unearned_runs` = `runs_scored` for each event
4. The `runs_scored` junction table also carries `is_earned` per scoring player

## Future: Baserunning Events

The schema supports future baserunning events without migration:
- `event_type = 'stolenBase'` / `'caughtStealing'` / `'wildPitch'` / `'passedBall'` / `'balk'`
- Existing columns (batter_id as runner, pitcher_id, runner columns, outs) accommodate these naturally
- `outcome` column can hold `'stolenBase'`, `'caughtStealing'` etc.

## Example Queries

```sql
-- League batting leaders (top 10 by AVG, min 50 PA)
SELECT * FROM batting_stats
WHERE series_id = ? AND pa >= 50
ORDER BY avg DESC LIMIT 10;

-- Standings with win percentage
SELECT *, ROUND(CAST(wins AS REAL) / games_played, 3) as win_pct
FROM series_standings
WHERE series_id = ?
ORDER BY league, division, wins DESC;

-- Box score inning line
SELECT * FROM inning_lines
WHERE game_id = ?
ORDER BY team_id, inning;

-- Game log for a player
SELECT g.scheduled_date, e.outcome, e.runs_scored, e.description
FROM game_events e
JOIN games g ON e.game_id = g.id
WHERE e.batter_id = ? AND g.series_id = ?
  AND e.event_type = 'plateAppearance'
ORDER BY g.game_number, e.sequence;

-- Runs scored leaderboard
SELECT rs.player_id, COUNT(*) as runs
FROM runs_scored rs
JOIN game_events e ON rs.event_id = e.id
JOIN games g ON e.game_id = g.id
WHERE g.series_id = ?
GROUP BY rs.player_id
ORDER BY runs DESC LIMIT 10;
```
