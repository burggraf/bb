# Game Results Viewer Design

## Overview

A dedicated UI for viewing saved game results from the SQLite database, providing progressive drill-down from series standings to individual game box scores and play-by-play details.

## User Flow

1. **Series List** (`/game-results`) → Shows all saved series
2. **Series Detail** (`/game-results/series/[id]`) → Standings, games, leaders
3. **Game Detail** (Modal) → Box score + play-by-play
4. **Navigation** → Breadcrumbs, back button, browser history

## Pages

### 1. Series List Page

**URL:** `/game-results`

**Components:**
- Page header with title "Game Results"
- Grid of series cards with:
  - Series name
  - Series type badge (exhibition/season_replay/tournament)
  - Game count
  - Status badge (active/completed/archived)
  - Last updated date
- "Create New Series" button

**Data Source:**
- `listSeries()` for series list
- Each card links to `/game-results/series/[id]`

**Empty State:**
- "No games saved yet. Simulate a game to get started!"
- CTA button to go to game page

### 2. Series Detail Page

**URL:** `/game-results/series/[seriesId]`

**Layout:** Two-column layout

**Left Column - Standings Table:**
- Columns: Team, Season Year, League, Division, Games, W-L, Win%, Runs Scored, Runs Allowed, GB
- Sorted by wins descending
- League/division grouping if applicable

**Right Column - Games List:**
- Tabs: Standings (default) | Games | Leaders
- Games table: Date, Away Team, Home Team, Score, Winner
- Most recent games first
- Click game → opens box score modal
- Pagination if > 20 games per page

**Page Header:**
- Series name
- Series type + status badges
- "Back to all series" link
- Action buttons: Export, Delete (with confirmation)

**Data Sources:**
- `getSeriesStandingsEnhanced(seriesId)` for standings
- `getGamesBySeries(seriesId)` for games list
- `getBattingStats({ seriesId })` for batting leaders tab
- `getPitchingStats({ seriesId })` for pitching leaders tab

### 3. Leaders Tab (within Series Detail)

**Sub-tabs:** Batting Leaders | Pitching Leaders

**Batting Leaders Table:**
- Columns: Player, Team, Games, AB, AVG, OBP, SLG, HR, RBI
- Minimum PA filter (default: 10)
- Sort by: AVG (default), HR, RBI, OBP, SLG
- Top 10-20 players

**Pitching Leaders Table:**
- Columns: Player, Team, Games, IP, ERA, WHIP, W, SV, K
- Minimum BF filter (default: 10)
- Sort by: ERA (default), W, K, WHIP, SV
- Top 10-20 players

**Features:**
- Qualification filter input
- Sort dropdown
- Click player row → future: show player game log

### 4. Game Detail Modal

**Trigger:** Click on game in games list

**Modal Structure:**

**Top Section - Box Score:**
- Game header: teams, date, final score
- Standard 9-inning grid with R/H/E
- Extra innings shown as needed

**Middle Section - Game Info:**
- Pitching decisions: W, L, S pitcher
- Game duration
- Umpire info (future: if added)

**Bottom Section - Play-by-Play:**
- Collapsible list of all game events
- Each play: inning, batter, pitcher, outcome, description
- Scoring plays highlighted
- Runner advancement shown

**Data Sources:**
- `getGame(gameId)` for game info
- `getGameEvents(gameId)` for play-by-play
- `getInningLines(gameId)` for inning totals

## Navigation

**Main Navigation:**
- Add "Game Results" link to main nav (between Home and Data Browser)

**Breadcrumbs:**
- Series list: "Game Results"
- Series detail: "Game Results → [Series Name]"
- Game modal: "Game Results → [Series Name] → [Game]"

**Browser History:**
- Proper history management for back button
- URL updates reflect current view

## Styling

**Design System:**
- Consistent with existing app (Tailwind + shadcn-svelte)
- Same color scheme and components
- Responsive design for mobile

**Component Usage:**
- Reuse existing table components from Data Browser
- Reuse modal/dialog components
- Consistent button styles and badges

## Data Loading

**Loading States:**
- Skeleton screens while sql.js initializes (1-2 seconds)
- Spinners for data fetching
- Progressive enhancement (show data as it loads)

**Empty States:**
- No series: "No games saved yet"
- Empty series: "This series has no games yet"
- No leaders: "Not enough data for leaders"

**Error States:**
- Toast messages for failures
- Retry buttons where appropriate
- Fallback to empty state with error message

## Performance

**Optimizations:**
- Lazy load game events (only fetch when modal opens)
- Pagination for games list (20 per page)
- Debounce search/filter inputs
- Efficient SQL queries with proper indexes

**Caching:**
- Series list cached in memory (invalidates on game save)
- Standings recalculated via SQL views (no stale data)

## Technical Implementation

**Routes:**
```
/src/routes/game-results/
  +page.svelte              # Series list
  +page.server.ts            # Load series data (optional, can client-fetch)
  /series/
    +page.svelte            # Series detail
    +page.server.ts          # Load series data
```

**API Functions Used:**
- `listSeries()` - Get all series
- `getSeries(id)` - Get single series
- `getSeriesStandingsEnhanced(id)` - Standings with calculated fields
- `getGamesBySeries(id)` - Games in series
- `getGame(id)` - Single game details
- `getGameEvents(id)` - Play-by-play events
- `getInningLines(id)` - Inning totals
- `getBattingStats({ seriesId })` - Batting stats
- `getPitchingStats({ seriesId })` - Pitching stats

**State Management:**
- Svelte 5 runes for reactive state
- No additional stores needed

## Future Enhancements (Out of Scope)

- Player game logs (all games for a player)
- Head-to-head matchup records
- Advanced filters (date range, teams, etc.)
- Game comparison tools
- Export/print functionality
- Charts and visualizations
- Cross-series combined stats
