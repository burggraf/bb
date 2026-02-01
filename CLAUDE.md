# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A **client-side only** web application for simulating baseball games using historical MLB data (1910-2024) and a Bayesian hierarchical log5 probability model for batter-pitcher matchups. The goal is maximum statistical accuracy - this is a research-quality simulation, not an arcade game.

**Tech Stack:**
- **Frontend:** Svelte 5 with runes (`$state`, `$derived`) for reactive state management
- **UI:** Tailwind CSS + shadcn-svelte (component library)
- **Build:** Vite + SvelteKit
- **Language:** TypeScript throughout
- **Database:** DuckDB for data preparation (not used in browser)

## Project Structure

This is a **pnpm workspace monorepo** with three packages:

```
bb/
├── app/                 # SvelteKit web application (game UI, game engine)
├── packages/model/      # Standalone MatchupModel library (no framework deps)
└── data-prep/          # DuckDB data extraction and season export scripts
```

**Key point:** The `@bb/model` package is framework-agnostic TypeScript - it runs in Node (data-prep) and browser (app) without any dependencies on Svelte/Vite. This is intentional for model validation and testing.

### Development Commands

```bash
# App development
pnpm -C app dev           # Start dev server (http://localhost:5173)
pnpm -C app build         # Production build
pnpm -C app check         # Run svelte-check for type errors

# Model package
pnpm -C packages/model build   # Build with tsup
pnpm -C packages/model dev     # Watch mode
pnpm -C packages/model test    # Run Vitest tests

# Data preparation
cd data-prep && pnpm exec tsx src/export-season.ts 1976  # Export a season
```

### Data & Database

**Source:** `baseball.duckdb` (1.2GB, local only - in .gitignore)
- 17.4M plate appearance events from 1910-2024
- Tables: `event.events`, `dim.players`, `dim.teams`, `game.games`
- Use DuckDB CLI directly: `duckdb baseball.duckdb` to query

**Season Export:** `data-prep/src/export-season.ts` extracts:
- Batter stats with platoon splits (vs LHP/RHP)
- Pitcher stats with platoon splits (vs LHB/RHB)
- League averages per season
- Output: `app/static/seasons/{year}.json`

### The MatchupModel (`packages/model/`)

Core types to understand:
- `EventRates`: Currently 7 outcomes `{ out, single, double, triple, homeRun, walk, hitByPitch }`. Will expand to 17 outcomes (see detailed-outcomes-design.md).
- `SplitRates`: `{ vsLeft, vsRight }` - key for platoon splits
- `Matchup`: `{ batter, pitcher, league }` - all have `rates: SplitRates`

**MatchupModel API:**
- `predict(matchup): ProbabilityDistribution` - gets outcome probabilities
- `sample(distribution): Outcome` - samples from distribution
- `simulate(matchup): Outcome` - predict + sample in one call

**Type naming difference between packages:**
- **Model package** uses generic `vsLeft`/`vsRight` keys
- **App/data-prep** uses explicit `vsLHP`/`vsRHP` (batters) and `vsLHB`/`vsRHB` (pitchers)
- The engine (`app/src/lib/game/engine.ts`) translates between them when creating Matchup objects

### Game Engine (`app/src/lib/game/engine.ts`)

The `GameEngine` class orchestrates the simulation:
- Generates lineups from team batters (filtered by `teamId`)
- For each PA: creates Matchup, samples outcome, applies baserunning via state machine
- State tracks: inning, outs, bases, current batter/pitcher, plays

**Current limitations (V1):**
- Pitchers are random (will be rotation-specific in V2)
- No substitutions yet

### Baserunning State Machine (`app/src/lib/game/state-machine/`)

Models all 24 game states (0/1/2 outs × 8 base configurations) using a 3-bit bitmap:
- `BaseConfig`: 0-7 where bit 0=1B, bit 1=2B, bit 2=3B
- `transition(state, outcome, batterId)`: Returns `{ nextState, runsScored, scorerIds }`

Rules are split into separate files in `rules/`:
- `ground-out.ts`: Force plays, double play logic
- `walk.ts`: Walk/HBP runner advancement
- `hit.ts`: Single/double/triple/HR advancement
- `strikeout.ts`, `fly-out.ts`: Out handling

Tests are in `transitions.test.ts` - run with `pnpm -C app test` (requires Vitest setup in app).

### Svelte 5 Specifics

The app uses Svelte 5 runes (`$state`, `$derived`, etc.). Key patterns:
- `let x = $state(initial)` for reactive state (not `let x;` - that's not reactive)
- `onMount()` for client-side initialization
- Components use `<script lang="ts">` with TypeScript
- **Client-side only app:** All computation happens in the browser, no server-side rendering

**Important:** If a state variable isn't updating, check it's declared with `$state()`. Svelte 5 requires explicit reactivity declarations.

### Data Flow for Adding New Seasons

1. Extract from DuckDB: `cd data-prep && pnpm exec tsx src/export-season.ts YEAR`
2. JSON goes to `app/static/seasons/YEAR.json`
3. Update `getAvailableYears()` in `season-loader.ts` to include new year
4. Season data loads in browser via `fetch('/seasons/YEAR.json')`

### Common Issues

- **Model package not found:** Run `pnpm install` from root to link workspace packages
- **Type mismatches between packages:** Remember the vsLeft/vsRight vs vsLHP/vsRHP naming difference
- **State not updating in Svelte:** Ensure variables are declared with `$state()` rune

### Architecture Decision Records

See `docs/plans/2025-01-31-baseball-sim-design.md` for:
- Phase 1: Generalized log5 with fixed coefficients (current)
- Phase 2: Learned coefficients from historical fitting
- Phase 3: Full Bayesian hierarchical with partial pooling

See `docs/plans/2025-02-01-detailed-outcomes-design.md` for:
- Expanding from 7 to 17 outcome types (splitting "out" into groundOut, flyOut, etc.)
- Conditional DP probability modeling (48% league avg, player-specific rates)
- Probabilistic runner advancement tables from historical data
- Trajectory imputation for pre-1990 data

### Data Model Notes

From the research doc `matchup-model-research.md`:
- The "gold standard" is Bayesian hierarchical log5
- Beats standard log5 and generalized log5 on prediction error
- Handles sparse data through shrinkage (partial pooling)
- League averages provide prior for small-sample players
