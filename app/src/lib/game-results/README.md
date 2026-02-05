# Game Results Database

A client-side only database for storing and querying baseball game simulation results. Built with IndexedDB for persistence and sql.js (SQLite) for querying.

## Quick Start

```typescript
import {
  createSeries,
  saveGameFromState,
  getSeriesStandings,
  getLeagueLeadersByCategory
} from '@/lib/game-results';

// Create a series
const series = await createSeries({
  name: '1976 AL East',
  description: 'Season replay',
  seriesType: 'season_replay'
});

// Save a completed game
await saveGameFromState(gameState, series.id, 1, '1976-05-15');

// Get standings
const standings = await getSeriesStandings(series.id);

// Get league leaders
const hrLeaders = await getLeagueLeadersByCategory(series.id, 'batting', 'homeRuns', 10);
```

## Features

- **Client-side only**: No server required, all data stored in browser IndexedDB
- **SQLite queries**: Full SQL power via sql.js WASM
- **Series management**: Organize games into season replays, tournaments, exhibitions
- **Statistics**: Automatic calculation of batting, pitching, and fielding stats
- **Export/Import**: Backup and restore game databases
- **Play-by-play**: Complete event tracking for each game
- **Box scores**: Inning-by-inning lines and traditional stats

## Architecture

```
app/src/lib/game-results/
├── database.ts      # IndexedDB storage, sql.js initialization
├── schema.ts        # SQLite schema creation
├── types.ts         # TypeScript interfaces
├── series.ts        # Series CRUD operations
├── games.ts         # Game save/load, earned runs calculation
├── stats.ts         # Standings, leaderboards, player stats
├── export.ts        # Download/import database files
├── barrels.ts       # GameState -> GameSaveInput converter
└── index.ts         # Public API entry point
```

## API Reference

### Database Management

```typescript
// Get database instance (auto-initializes on first call)
const db = await getGameDatabase();

// Close and persist to IndexedDB
await closeGameDatabase();

// Export database as Blob
const blob = await exportGameDatabase();

// Import database from file
await importGameDatabaseFromFile(file);

// Clear all data
await clearGameDatabase();

// Get database size info
const sizeInfo = await getGameDatabaseSize();
// { totalBytes: 12345, formattedSize: '12.34 KB', estimatedGames: 5, estimatedEvents: 250 }
```

### Series Management

```typescript
// Create a new series
const series = await createSeries({
  name: '1976 Season',
  description: 'Full season replay',
  seriesType: 'season_replay' // | 'tournament' | 'exhibition' | 'custom'
});

// Get a series
const series = await getSeries(seriesId);

// List all series
const seriesList = await listSeries();

// Update series
await updateSeries(seriesId, { name: 'New Name', status: 'completed' });

// Delete series
await deleteSeries(seriesId);

// Add team to series
await addSeriesTeam(seriesId, {
  teamId: 'NYA',
  seasonYear: 1976,
  league: 'AL',
  division: 'East'
});

// Get teams in series
const teams = await getSeriesTeams(seriesId);
```

### Game Management

```typescript
// Save game from GameState (convenience wrapper)
const gameId = await saveGameFromState(
  gameState,        // Final GameState from engine
  seriesId,         // Series UUID
  1,                // Game number (optional)
  '1976-05-15'      // Scheduled date (optional)
);

// Save game with full control
await saveGame({
  seriesId: 'uuid',
  gameNumber: 1,
  awayTeamId: 'NYA',
  awaySeasonYear: 1976,
  homeTeamId: 'BOS',
  homeSeasonYear: 1976,
  awayScore: 5,
  homeScore: 3,
  innings: 9,
  awayStarterId: 'pitcher-id',
  homeStarterId: 'pitcher-id',
  winningPitcherId: null, // Auto-calculated if null
  losingPitcherId: null,  // Auto-calculated if null
  savePitcherId: null,    // Auto-calculated if null
  scheduledDate: '1976-05-15',
  playedAt: new Date().toISOString(),
  durationMs: 900000,
  useDh: true,
  events: [...],      // Play-by-play events
  inningLines: [...]  // Box score lines
});

// Get a game
const game = await getGame(gameId);

// Get all games in a series
const games = await getGamesBySeries(seriesId);
```

### Statistics

```typescript
// Get series standings
const standings = await getSeriesStandings(seriesId);
// [{ teamId, wins, losses, runsScored, runsAllowed, ... }, ...]

// Get batting stats
const battingStats = await getBattingStats({
  seriesId: 'uuid',
  sortBy: 'homeRuns',  // 'avg' | 'homeRuns' | 'rbi' | 'obp' | 'slg' ...
  order: 'desc',
  limit: 10,
  minPa: 50           // Minimum plate appearances (optional)
});

// Get pitching stats
const pitchingStats = await getPitchingStats({
  seriesId: 'uuid',
  sortBy: 'era',      // 'era' | 'strikeouts' | 'whip' ...
  order: 'asc',       // 'asc' for ERA, 'desc' for most stats
  limit: 10,
  minBattersFaced: 100 // Minimum batters faced (optional)
});

// Get league leaders (convenience wrapper)
const hrLeaders = await getLeagueLeadersByCategory(
  seriesId,
  'batting',      // or 'pitching'
  'homeRuns',
  10
);
```

### GameState Conversion

```typescript
// Convert game engine output to database format
import { gameStateToGameSaveInput } from '@/lib/game-results';

const input = gameStateToGameSaveInput(
  gameState,        // Final GameState from engine
  seriesId,         // Series UUID
  1,                // Game number (optional)
  '1976-05-15'      // Scheduled date (optional)
);

// Calculate inning lines separately
const lines = calculateInningLines(plays, awayTeamId, homeTeamId);

// Extract starting pitchers
const { awayStarterId, homeStarterId } = extractPitchingDecisions(gameState);

// Detect DH usage
const usesDH = detectDesignatedHitter(gameState);
```

### Export/Import

```typescript
// Download database as file
await exportDatabase('my-season.sqlite');

// Import database from file input
const file = fileInput.files[0];
await importDatabaseFromFile(file);

// Validate file before importing
const validation = validateDatabaseFile(file);
if (!validation.isValid) {
  console.error(validation.error);
}
```

## Data Model

### Tables

#### `series`
- `id` (UUID): Primary key
- `name`: Series name
- `description`: Optional description
- `series_type`: 'season_replay' | 'tournament' | 'exhibition' | 'custom'
- `created_at`, `updated_at`: Timestamps
- `status`: 'active' | 'completed' | 'archived'

#### `series_teams`
- `series_id` (UUID): FK to series
- `team_id`: Team identifier
- `season_year`: Season year
- `league`: League identifier (optional)
- `division`: Division identifier (optional)

#### `games`
- `id` (UUID): Primary key
- `series_id` (UUID): FK to series
- `game_number`: Game number within series
- `away_team_id`, `home_team_id`: Team identifiers
- `away_season_year`, `home_season_year`: Season years
- `away_score`, `home_score`: Final scores
- `innings`: Number of innings (9+, extra innings)
- `away_starter_id`, `home_starter_id`: Starting pitcher IDs
- `winning_pitcher_id`, `losing_pitcher_id`, `save_pitcher_id`: Pitching decisions
- `scheduled_date`: ISO 8601 date (optional)
- `played_at`: ISO 8601 timestamp
- `duration_ms`: Game duration in milliseconds
- `use_dh`: Whether DH was used

#### `game_events`
- `id`: Auto-increment primary key
- `game_id` (UUID): FK to games
- `sequence`: Event sequence number
- `inning`, `is_top_inning`: Inning info
- `outs`: Outs before play
- `event_type`: 'plateAppearance' | 'startingLineup' | 'pitchingChange' ...
- `outcome`: Play outcome ('single', 'strikeout', etc.)
- `batter_id`, `batter_name`: Batter info
- `pitcher_id`, `pitcher_name`: Pitcher info
- `runs_scored`, `earned_runs`, `unearned_runs`: Run info
- `runner_1b_before`, `runner_2b_before`, `runner_3b_before`: Base state before
- `runner_1b_after`, `runner_2b_after`, `runner_3b_after`: Base state after
- `description`: Play description
- `lineup_json`: JSON for lineup events
- `substituted_player`: For substitution events
- `position`: For defensive substitutions
- `is_summary`: For half-inning summaries

#### `inning_lines`
- `game_id` (UUID): FK to games
- `team_id`: Team identifier
- `inning`: Inning number
- `runs`, `hits`, `errors`: Box score totals

#### `runs_scored`
- `event_id`: FK to game_events
- `player_id`: Player who scored
- `is_earned`: Whether run is earned

### Views

#### `series_standings`
Aggregated standings from games in a series:
- `series_id`, `team_id`, `season_year`
- `league`, `division`
- `games_played`, `wins`, `losses`
- `runs_scored`, `runs_allowed`

#### `batting_stats`
Aggregated batting statistics:
- `series_id`, `batter_id`, `batter_name`
- `pa`, `ab`, `hits`, `singles`, `doubles`, `triples`, `home_runs`
- `walks`, `hbp`, `strikeouts`, `rbi`
- `avg`, `obp`, `slg`

#### `pitching_stats`
Aggregated pitching statistics:
- `series_id`, `pitcher_id`, `pitcher_name`
- `games`, `batters_faced`, `outs_recorded`
- `hits_allowed`, `walks_allowed`, `strikeouts`
- `home_runs_allowed`, `runs_allowed`, `earned_runs`
- `era`, `whip`

## Examples

### Save a Simulated Game

```typescript
import { GameEngine } from '@/lib/game/engine';
import { createSeries, saveGameFromState } from '@/lib/game-results';

// Setup engine
const engine = new GameEngine(seasonData);
await engine.initialize();

// Simulate game
const finalState = engine.simulateToCompletion();

// Create series
const series = await createSeries({
  name: '1976 Season',
  seriesType: 'season_replay'
});

// Save game
const gameId = await saveGameFromState(
  finalState,
  series.id,
  1,
  '1976-05-15'
);

console.log('Game saved:', gameId);
```

### Display Standings

```typescript
import { getSeriesStandingsEnhanced } from '@/lib/game-results';

const standings = await getSeriesStandingsEnhanced(seriesId);

standings.forEach(team => {
  console.log(`${team.teamId}: ${team.wins}-${team.losses} (${team.winPercentage.toFixed(3)})`);
});
```

### Export Database

```typescript
import { exportDatabase } from '@/lib/game-results';

// Trigger download with custom filename
await exportDatabase('1976-season-backup.sqlite');

// Or use default timestamped filename
await exportDatabase();
```

## Testing

```bash
# Run all game-results tests
pnpm -C app test game-results

# Run specific test file
pnpm -C app test barrels
pnpm -C app test export
pnpm -C app test integration
```

Note: Full integration tests require a browser environment (sql.js WASM + IndexedDB). Unit tests use mocks to verify logic without browser dependencies.

## Performance Considerations

- **Database size**: ~1KB per game (varies with play count)
- **Query performance**: Indexed views for fast stats queries
- **Memory**: sql.js runs in WebAssembly memory (~3MB base)
- **Persistence**: Auto-saves to IndexedDB on page unload

## Troubleshooting

### Database not initializing

Ensure sql.js WASM is loading:
```typescript
// Check console for "[GameResultsDB] sql.js initialized"
```

### Data not persisting

Call `closeGameDatabase()` before page unload:
```typescript
window.addEventListener('beforeunload', () => {
  closeGameDatabase().catch(console.error);
});
```

This is automatic, but you can call it manually for immediate saves.

### Large databases

For databases > 50MB, consider:
1. Exporting and archiving old series
2. Creating separate series per season
3. Clearing and re-importing as needed

## Version History

- **v1.0.0**: Initial release with core functionality
  - Series management
  - Game save/load
  - Statistics calculation
  - Export/import
  - GameState conversion
