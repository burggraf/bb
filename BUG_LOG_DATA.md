# Data Preparation Bug Log

| ID | Issue | Severity | Status | File | Description |
|---|---|---|---|---|---|
| DATA-001 | Batter PA Calculation | Medium | Open | `export-season.ts` | The `pa` calculation for batters `parseNumber(row.at_bats) + parseNumber(row.walks) + parseNumber(row.hit_by_pitch) + parseNumber(row.sacrifice_bunts) + parseNumber(row.sacrifice_flies)` might be missing Catcher's Interference and Fielders Choice, though the query `getBatterStatsSQL` has them. |
| DATA-002 | Pitcher BFP Query Bug | Low | Open | `export-season.ts` | The code explicitly mentions a bug in `getPitcherBfpSQL` where it counts all team PAs for starters, and uses a fallback. The query itself should be fixed. |
| DATA-003 | Batters Primary Team ROW_NUMBER | Low | Open | `export-season.ts` | `batter_best_team` uses `ROW_NUMBER()` but if there's a tie in `team_pa`, the primary team selection is non-deterministic. |
| DATA-004 | SQLite Schema Bats Check | Low | Open | `sqlite-schema.ts` | `bats TEXT NOT NULL CHECK(bats IN ('L', 'R', 'S', '?'))` - `export-season.ts` converts 'B' to 'S', but other values like '?' or 'NULL' might still cause issues if they leak through. |
| DATA-005 | DuckDB Output Parsing | Medium | Open | `export-season.ts` | `parseDuckDBOutput` is complex and relies on box-drawing characters. `runDuckDB` now uses `.mode csv`, making `parseDuckDBOutput` possibly dead code or inconsistent if used elsewhere. |
| DATA-006 | Parks Query JOIN | Low | Open | `export-season.ts` | `getParksSQL` uses `LEFT JOIN dim.parks p ON g.park_id = p.park_id`. If `park_id` exists in `games` but not in `parks`, it creates a row with NULLs. |
| DATA-007 | Pitcher Batting Team ID | Medium | Open | `export-season.ts` | When adding pitchers to batters, it uses `pitcherInfo.teamId`. If a pitcher was traded, this might not match the team they batted for in specific games, though it uses "primary team". |
| DATA-008 | Manifest Estimation | Low | Open | `update-manifest.ts` | `estimatedSize` uses a hardcoded `2.8` multiplier. While just for the manifest, it's an estimate that could be far off. |
