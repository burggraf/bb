# SQLite Database Viewer Design

**Date:** 2025-02-05
**Status:** Design
**Purpose:** Development tool for inspecting SQLite season databases in the browser

## Overview

A minimal database viewer UI at `/data-browser` route for development debugging. Allows inspecting table schemas and running raw SQL queries against cached season SQLite databases.

**Scope:** Core viewer only - browse tables, view schemas, run queries with text-based results table.

## Architecture

### Route Structure
- **URL:** `/data-browser`
- **Optional query param:** `?year=1976` to pre-select season
- **Location:** `app/src/routes/data-browser/+page.svelte`

### Data Flow
1. User selects season → `SeasonDatabase.load(year)` retrieves SQLite bytes from IndexedDB
2. sql.js creates `SQL.Database` instance in-memory
3. Query executes → results rendered as `<table>`
4. Database closes when switching seasons

### Reused Components
- `SeasonDatabase` class from `app/src/lib/data/season-loader.ts`
- sql.js (already loaded via CDN)
- Svelte 5 runes (`$state`, `$derived`)

## UI Components

### Layout (vertical stack)

1. **Season Selector**
   - Standard `<select>` dropdown
   - Populated from `getAvailableSeasons()` (years 1910-2024)
   - Auto-loads first available season on mount

2. **Schema Browser** - Two-column layout
   - **Left:** List of tables (`batters`, `pitchers`, `teams`, `games`, `norms`, `meta`, `league_averages`, `pitcher_batter_league`)
   - **Right:** Table schema (column name, type, nullable?)
   - Clicking a table runs `PRAGMA table_info(table_name)`

3. **Query Editor**
   - Textarea with monospace font
   - Placeholder: "SELECT * FROM batters LIMIT 10"
   - Run button

4. **Results Table**
   - Basic HTML `<table>` with borders
   - Column headers from query result
   - Rows from query results
   - States: empty ("Run a query"), error (red message), results

### State Management (Svelte 5 runes)

```svelte
let selectedYear = $state<number | null>(null);
let db = $state<SQL.Database | null>(null);
let tables = $state<string[]>([]);
let selectedTable = $state<string | null>(null);
let tableSchema = $state<SchemaRow[]>([]);
let query = $state<string>("");
let results = $state<QueryResults | null>(null);
let error = $state<string | null>(null);
```

## Error Handling

| Scenario | Handling |
|----------|----------|
| Season not cached | "Download required" message + download button |
| Invalid SQL | Error message below query editor in red |
| No results | "No results" message |
| Database corruption | "Database corrupted" + clear cache button |
| Schema query fails | Fallback to listing table names from `sqlite_master` |

**Loading states:**
- Season loading: "Loading {year}..." spinner
- Query running: "Running query..."

**Safety notes:**
- Dev-only tool, no SQL injection concerns
- Only SELECT queries exposed (no write operations)
- Database is in-memory, no risk to persisted data

## Implementation Checklist

1. Create `app/src/routes/data-browser/+page.svelte`
2. Wire up season selector to `SeasonDatabase.load()`
3. Add schema browser with `PRAGMA table_info()`
4. Add query textarea + execute button
5. Render results as HTML table
6. Handle error cases
7. Add URL query param support for pre-selecting season

## Database Schema Reference

Tables in each season database:
- `batters` - Season batting stats with platoon splits
- `pitchers` - Season pitching stats with platoon splits
- `teams` - Team information
- `games` - Game schedule/results
- `norms` - Normalization factors
- `meta` - Season metadata
- `league_averages` - League aggregate stats
- `pitcher_batter_league` - League context for matchups
