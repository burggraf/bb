# Baseball Sim - Development Memory

## SQLite Database Viewer Feature

### Overview
Built a client-side SQLite database viewer at `/data-browser` for development debugging. Allows inspecting cached season databases, browsing table schemas, and running raw SQL queries.

### Tech Stack
- Svelte 5 runes ($state, $props)
- sql.js for in-memory SQLite execution
- IndexedDB for caching season databases
- Tailwind CSS for styling

### Implementation Details

**Route:** `app/src/routes/data-browser/+page.svelte`

**Features:**
1. Season selector (1910-2024)
2. Schema browser - click tables to view columns
3. Raw SQL query editor with Ctrl+Enter shortcut
4. Results table with zebra striping and row counts
5. URL param support: `/data-browser?year=1976`

**Data Sources:**
- `getAvailableYears()` from `$lib/game/season-loader`
- `getDatabaseBytes(year)` from `$lib/game/sqlite-season-loader`
- SQLite databases cached in IndexedDB (`bb-sqlite-cache`)

**Key Patterns:**
- Use `await getAvailableYears()` - returns Promise<number[]>
- Use `await getDatabaseBytes(year)` - returns Promise<Uint8Array>
- sql.js initialized with CDN: `initSqlJs({ locateFile: file => 'https://sql.js.org/dist/${file}' })`
- Query results: `db.exec(sql)` returns `QueryResults[]` with `.columns` and `.values`

### Security Note
SQL queries execute raw without sanitization - this is intentional for a dev tool. Table names in PRAGMA are quoted: `PRAGMA table_info("${tableName}")` to prevent injection.

### Files Created
- `app/src/routes/data-browser/+page.svelte` - Main component
- `app/src/routes/data-browser/+page.ts` - Server load for URL params

### Files Modified
- `app/src/routes/+layout.svelte` - Added global navigation header
- `app/src/lib/game/sqlite-season-loader.ts` - Exported helper functions
- `app/package.json` - Added @types/sql.js

### Commits
- feat: add database viewer route with basic layout
- feat: populate season selector with available years
- feat: load SQLite database from IndexedDB cache
- feat: add schema browser with table_info
- fix: quote table name in PRAGMA to prevent SQL injection
- feat: add SQL query execution with results table
- feat: render query results table with formatting
- feat: support ?year= URL query param for pre-selecting season
- feat: add global navigation header with data browser link

## Project Notes

### Client-Side Only App
- All computation happens in the browser
- No server-side rendering
- SQLite databases load via sql.js WASM

### Svelte 5 Runes
- Use `$state()` for reactive state (not `let x;`)
- Use `$props()` for component props (not `export let`)
- Use `{@render children()}` for slots

### Data Flow
1. Season SQLite files served as `.sqlite.gz` from `/static/seasons/`
2. Browser auto-decompresses and caches in IndexedDB
3. sql.js loads database from cached bytes into memory
4. Queries execute in-memory sql.js database
