# SQLite Database Viewer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a minimal database viewer UI at `/data-browser` for development debugging of SQLite season databases.

**Architecture:** Single Svelte 5 component (`+page.svelte`) that loads cached SQLite databases via existing `SeasonDatabase` class, exposes schema browser and raw SQL query interface using sql.js.

**Tech Stack:** Svelte 5 runes ($state), sql.js, TypeScript, Tailwind CSS

---

## Task 1: Create route structure and basic page layout

**Files:**
- Create: `app/src/routes/data-browser/+page.svelte`

**Step 1: Create the route file with basic layout**

```svelte
<script lang="ts">
  import type { Database } from 'sql.js';

  let selectedYear = $state<number | null>(null);
  let db = $state<Database | null>(null);
  let tables = $state<string[]>([]);
  let selectedTable = $state<string | null>(null);
  let tableSchema = $state<Array<{name: string, type: string, notnull: number, dflt_value: string | null, pk: number}>>([]);
  let query = $state<string>("");
  let results = $state<Array<string[]>>([]);
  let columns = $state<string[]>([]);
  let error = $state<string | null>(null);
  let loading = $state<boolean>(false);

  // TODO: Load season database and populate tables
</script>

<div class="container mx-auto p-4">
  <h1 class="text-2xl font-bold mb-4">Database Viewer</h1>

  <!-- Season Selector -->
  <div class="mb-4">
    <label class="block mb-1">Season:</label>
    <select class="border rounded p-2">
      <option>Select a year...</option>
      <!-- Options will be populated -->
    </select>
  </div>

  <!-- Schema Browser -->
  <div class="mb-4 grid grid-cols-2 gap-4">
    <div>
      <h2 class="font-bold mb-2">Tables</h2>
      <ul class="border rounded p-2">
        <!-- Table list -->
      </ul>
    </div>
    <div>
      <h2 class="font-bold mb-2">Schema</h2>
      <div class="border rounded p-2">
        <!-- Schema display -->
      </div>
    </div>
  </div>

  <!-- Query Editor -->
  <div class="mb-4">
    <h2 class="font-bold mb-2">Query</h2>
    <textarea
      class="w-full border rounded p-2 font-mono"
      rows="3"
      placeholder="SELECT * FROM batters LIMIT 10"
    ></textarea>
    <button class="mt-2 bg-blue-500 text-white px-4 py-2 rounded">
      Run Query
    </button>
  </div>

  <!-- Results -->
  <div>
    <h2 class="font-bold mb-2">Results</h2>
    {#if error}
      <p class="text-red-500">{error}</p>
    {:else if results.length === 0}
      <p class="text-gray-500">Run a query to see results</p>
    {:else}
      <table class="border-collapse border">
        <!-- Results table -->
      </table>
    {/if}
  </div>
</div>
```

**Step 2: Verify page loads**

Run: `pnpm -C app dev`
Visit: `http://localhost:5173/data-browser`
Expected: Page loads with empty UI elements

**Step 3: Commit**

```bash
git add app/src/routes/data-browser/+page.svelte
git commit -m "feat: add database viewer route with basic layout"
```

---

## Task 2: Wire up season selector with available years

**Files:**
- Modify: `app/src/routes/data-browser/+page.svelte`

**Step 1: Import season loader and get available years**

Add to `<script lang="ts">`:

```typescript
import { getAvailableSeasons } from '$lib/data/season-loader';
import { onMount } from 'svelte';

let availableYears = $state<number[]>([]);

onMount(() => {
  availableYears = getAvailableSeasons();
  if (availableYears.length > 0) {
    selectedYear = availableYears[0];
    loadDatabase(availableYears[0]);
  }
});
```

**Step 2: Update season selector HTML**

Replace the select with:

```svelte
<select
  class="border rounded p-2"
  onchange={(e) => {
    const year = parseInt((e.target as HTMLSelectElement).value);
    selectedYear = year;
    loadDatabase(year);
  }}
>
  {#each availableYears as year}
    <option value={year} selected={year === selectedYear}>
      {year}
    </option>
  {/each}
</select>
```

**Step 3: Test season selector**

Run: `pnpm -C app dev`
Visit: `http://localhost:5173/data-browser`
Expected: Dropdown shows years 1910-2024, first year selected

**Step 4: Commit**

```bash
git add app/src/routes/data-browser/+page.svelte
git commit -m "feat: populate season selector with available years"
```

---

## Task 3: Load SQLite database from IndexedDB cache

**Files:**
- Modify: `app/src/routes/data-browser/+page.svelte`

**Step 1: Import database loader and sql.js**

Add to `<script lang="ts">` imports:

```typescript
import { SeasonDatabase } from '$lib/data/database';
import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';

let SQL: typeof import('sql.js') | null = null;
```

**Step 2: Initialize sql.js on mount**

Add to `onMount()`:

```typescript
onMount(async () => {
  // Initialize sql.js
  SQL = await initSqlJs({
    locateFile: (file: string) => `https://sql.js.org/dist/${file}`
  });

  availableYears = getAvailableSeasons();
  if (availableYears.length > 0) {
    selectedYear = availableYears[0];
    await loadDatabase(availableYears[0]);
  }
});
```

**Step 3: Implement loadDatabase function**

Add after `onMount`:

```typescript
async function loadDatabase(year: number) {
  loading = true;
  error = null;

  try {
    // Load from IndexedDB cache or download
    const dbBytes = await SeasonDatabase.load(year);

    if (!SQL) {
      throw new Error('sql.js not initialized');
    }

    // Create in-memory database
    db = new SQL.Database(dbBytes);

    // Get list of tables
    const tableResult = db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );

    if (tableResult.length > 0) {
      tables = tableResult[0].values.map((row) => row[0] as string);
    }

    // Clear previous state
    selectedTable = null;
    tableSchema = [];
    results = [];
    columns = [];
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to load database';
  } finally {
    loading = false;
  }
}
```

**Step 4: Add loading state to UI**

Add below season selector:

```svelte
{#if loading}
  <p class="text-gray-500">Loading {selectedYear}...</p>
{/if}
```

**Step 5: Test database loading**

Run: `pnpm -C app dev`
Visit: `http://localhost:5173/data-browser`
Expected: Selecting a year shows "Loading..." then populates tables list

**Step 6: Commit**

```bash
git add app/src/routes/data-browser/+page.svelte
git commit -m "feat: load SQLite database from IndexedDB cache"
```

---

## Task 4: Implement schema browser

**Files:**
- Modify: `app/src/routes/data-browser/+page.svelte`

**Step 1: Create loadTableSchema function**

Add after `loadDatabase`:

```typescript
function loadTableSchema(tableName: string) {
  if (!db) return;

  selectedTable = tableName;

  try {
    const result = db.exec(`PRAGMA table_info(${tableName})`);

    if (result.length > 0) {
      const [pragmaCols, ...rows] = result[0];
      tableSchema = rows.map((row) => ({
        name: row[1] as string,
        type: row[2] as string,
        notnull: row[3] as number,
        dflt_value: row[4] as string | null,
        pk: row[5] as number
      }));
    }
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to load schema';
  }
}
```

**Step 2: Update tables list HTML**

Replace the tables list with:

```svelte
<ul class="border rounded p-2">
  {#each tables as table}
    <li
      class="cursor-pointer hover:bg-gray-100 p-1 {selectedTable === table ? 'bg-blue-100' : ''}"
      onclick={() => loadTableSchema(table)}
    >
      {table}
    </li>
  {/each}
</ul>
```

**Step 3: Update schema display HTML**

Replace the schema display with:

```svelte
{#if tableSchema.length > 0}
  <table class="w-full text-sm">
    <thead>
      <tr class="border-b">
        <th class="text-left">Column</th>
        <th class="text-left">Type</th>
        <th class="text-left">Nullable</th>
        <th class="text-left">PK</th>
      </tr>
    </thead>
    <tbody>
      {#each tableSchema as col}
        <tr class="border-b">
          <td class="py-1">{col.name}</td>
          <td>{col.type}</td>
          <td>{col.notnull ? 'NO' : 'YES'}</td>
          <td>{col.pk ? '✓' : ''}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{:else}
  <p class="text-gray-500">Select a table to view schema</p>
{/if}
```

**Step 4: Test schema browser**

Run: `pnpm -C app dev`
Visit: `http://localhost:5173/data-browser`
Expected: Clicking a table shows its column schema

**Step 5: Commit**

```bash
git add app/src/routes/data-browser/+page.svelte
git commit -m "feat: add schema browser with table_info"
```

---

## Task 5: Implement SQL query execution

**Files:**
- Modify: `app/src/routes/data-browser/+page.svelte`

**Step 1: Bind query textarea to state**

Update textarea:

```svelte
<textarea
  class="w-full border rounded p-2 font-mono"
  rows="3"
  placeholder="SELECT * FROM batters LIMIT 10"
  bind:value={query}
></textarea>
```

**Step 2: Create executeQuery function**

Add after `loadTableSchema`:

```typescript
function executeQuery() {
  if (!db || !query.trim()) return;

  error = null;
  results = [];
  columns = [];

  try {
    const queryResult = db.exec(query);

    if (queryResult.length === 0) {
      // No results (e.g., INSERT without RETURNING)
      return;
    }

    const result = queryResult[0];
    columns = result.columns;
    results = result.values.map((row) => row.map(String));
  } catch (e) {
    error = e instanceof Error ? e.message : 'Query failed';
  }
}
```

**Step 3: Wire up run button**

Update button:

```svelte
<button
  class="mt-2 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
  onclick={executeQuery}
>
  Run Query
</button>
```

**Step 4: Add keyboard shortcut (Ctrl+Enter)**

Add to textarea:

```svelte
<textarea
  class="w-full border rounded p-2 font-mono"
  rows="3"
  placeholder="SELECT * FROM batters LIMIT 10"
  bind:value={query}
  onkeydown={(e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      executeQuery();
    }
  }}
></textarea>
```

**Step 5: Test query execution**

Run: `pnpm -C app dev`
Visit: `http://localhost:5173/data-browser`
Expected: Running `SELECT * FROM batters LIMIT 10` shows results table

**Step 6: Commit**

```bash
git add app/src/routes/data-browser/+page.svelte
git commit -m "feat: add SQL query execution with results table"
```

---

## Task 6: Implement results table rendering

**Files:**
- Modify: `app/src/routes/data-browser/+page.svelte`

**Step 1: Replace results placeholder with table**

Replace the results section with:

```svelte
{#if error}
  <p class="text-red-500">{error}</p>
{:else if columns.length === 0}
  <p class="text-gray-500">Run a query to see results</p>
{:else if results.length === 0}
  <p class="text-gray-500">No results</p>
{:else}
  <div class="overflow-x-auto">
    <table class="border-collapse border border-gray-300 text-sm">
      <thead>
        <tr class="bg-gray-100">
          {#each columns as col}
            <th class="border border-gray-300 px-2 py-1 text-left">{col}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each results as row, rowIndex}
          <tr class="{rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}">
            {#each row as cell}
              <td class="border border-gray-300 px-2 py-1">{cell}</td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="text-gray-500 mt-2 text-sm">{results.length} rows</p>
  </div>
{/if}
```

**Step 2: Test results display**

Run: `pnpm -C app dev`
Visit: `http://localhost:5173/data-browser`
Expected: Results show with proper formatting, row count displayed

**Step 3: Commit**

```bash
git add app/src/routes/data-browser/+page.svelte
git commit -m "feat: render query results table with formatting"
```

---

## Task 7: Add URL query param support for pre-selecting season

**Files:**
- Create: `app/src/routes/data-browser/+page.ts`
- Modify: `app/src/routes/data-browser/+page.svelte`

**Step 1: Create page load function**

Create `app/src/routes/data-browser/+page.ts`:

```typescript
import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
  const yearParam = url.searchParams.get('year');
  const initialYear = yearParam ? parseInt(yearParam) : null;

  return {
    initialYear
  };
};
```

**Step 2: Update component to use initial year**

Add to `<script lang="ts">`:

```typescript
import type { PageData } from './$types';

export let data: PageData;

onMount(async () => {
  // Initialize sql.js
  SQL = await initSqlJs({
    locateFile: (file: string) => `https://sql.js.org/dist/${file}`
  });

  availableYears = getAvailableSeasons();

  // Use URL param or default to first year
  const initialYear = data.initialYear && availableYears.includes(data.initialYear)
    ? data.initialYear
    : availableYears[0];

  selectedYear = initialYear;
  await loadDatabase(initialYear);
});
```

**Step 3: Test URL param**

Run: `pnpm -C app dev`
Visit: `http://localhost:5173/data-browser?year=1976`
Expected: Page loads with 1976 pre-selected

**Step 4: Commit**

```bash
git add app/src/routes/data-browser/+page.ts app/src/routes/data-browser/+page.svelte
git commit -m "feat: support ?year= URL query param for pre-selecting season"
```

---

## Task 8: Add navigation link in app header

**Files:**
- Find and modify: Header/nav component (likely in `app/src/routes/` or `app/src/components/`)

**Step 1: Find the header component**

Run: `find app/src -name "*.svelte" | xargs grep -l "nav\|header\|Home" | head -5`

**Step 2: Add database viewer link**

Add link to header (exact location depends on existing header structure):

```svelte
<a href="/data-browser" class="...">Data Browser</a>
```

**Step 3: Test navigation**

Run: `pnpm -C app dev`
Expected: "Data Browser" link visible in header, navigates to `/data-browser`

**Step 4: Commit**

```bash
git add app/src/routes/+layout.svelte  # or wherever header is
git commit -m "feat: add data browser link to navigation"
```

---

## Verification Steps

After all tasks complete:

1. **Test full workflow:**
   - Visit `/data-browser`
   - Select different seasons
   - Browse table schemas
   - Run various queries:
     - `SELECT * FROM batters LIMIT 10`
     - `SELECT COUNT(*) FROM pitchers`
     - `SELECT * FROM teams`
     - Invalid query (should show error)

2. **Test edge cases:**
   - Query with no results
   - Malformed SQL
   - Non-existent year in URL param

3. **Verify all database tables accessible:**
   - batters, pitchers, teams, games, norms, meta, league_averages, pitcher_batter_league

Run final verification:
```bash
pnpm -C app build
pnpm -C app preview
```

---

**Total estimated time:** 45-60 minutes
**Final file count:** 2 new files (+page.ts, +page.svelte)
