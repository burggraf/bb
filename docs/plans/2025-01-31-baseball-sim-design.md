# Baseball Statistical Simulation Game - Design Document

**Date:** 2025-01-31
**Status:** Design Approved

## Overview

A client-side web application for simulating baseball games using real historical MLB data from Retrosheet and Baseball Databank. The game prioritizes statistical accuracy above all else, using a Bayesian hierarchical log5 model for batter-pitcher matchup probability calculations.

## Key Requirements

- **Statistical Accuracy:** Most advanced probability model available (Bayesian hierarchical log5)
- **Historical Data:** ~120 MLB seasons from `baseball.duckdb`
- **Game Modes:** Both strategic management and tactical play-by-play
- **Multiplayer:** Online multiplayer (future implementation)
- **Season-based:** Users replay/manage specific seasons (e.g., 1976 Reds)
- **Cross-era Matchups:** Support teams from different eras playing each other

---

## Architecture

### Tech Stack

- **Frontend:** Vite + Svelte 5 + TypeScript
- **UI Library:** Tailwind CSS + shadcn-svelte
- **Data Preparation:** Node.js/TypeScript + DuckDB CLI
- **Data Format:** Custom binary format (MessagePack or similar)

### Project Structure

```
bb/
├── data-prep/           # Node scripts for data extraction & model fitting
│   ├── extract-season.ts
│   ├── calculate-stats.ts
│   ├── fit-model.ts
│   └── export-season.ts
├── packages/
│   └── model/           # Standalone TypeScript package (no framework deps)
│       ├── src/
│       │   ├── MatchupModel.ts
│       │   ├── types.ts
│       │   └── utils.ts
│       └── test/
└── app/                 # Svelte web application
    ├── src/
    │   ├── routes/
    │   ├── lib/
    │   │   ├── stores/
    │   │   └── components/
    │   └── app.css
    └── static/
```

### Module Separation

1. **`/data-prep`** - Query DuckDB, calculate stats, fit model parameters, export seasons
2. **`/packages/model`** - Pure TypeScript, fully tested, usable in Node and browser
3. **`/app`** - Svelte app consuming season data and model package

---

## The Statistical Model

### Bayesian Hierarchical Log5

For each plate appearance outcome (out, 1B, 2B, 3B, HR, BB, HBP):

```
P(outcome | batter, pitcher, league) ∝ (batter_rate)^α × (pitcher_rate)^β × (league_rate)^γ
```

Where α, β, γ are **learned coefficients** (not fixed at 1, 1, -1).

### Hierarchy

- Each batter's true rate: θ_b,i ~ Normal(league_mean_i, league_sd_i)
- Each pitcher's true rate: φ_p,i ~ Normal(league_mean_i, league_sd_i)
- Coefficients have priors based on historical fitting

### Platoon Splits

Separate rates maintained for:
- Batter vs LHP, Batter vs RHP
- Pitcher vs LHB, Pitcher vs RHB

### Implementation Phases

1. **Phase 1:** Generalized log5 with fixed coefficients (baseline)
2. **Phase 2:** Add learned coefficients from historical fitting
3. **Phase 3:** Full hierarchical Bayesian with partial pooling

### Model API

```typescript
class MatchupModel {
  predict(matchup: {
    batter: { vsL: Rates, vsR: Rates }
    pitcher: { vsL: Rates, vsR: Rates }
    league: { vsL: Rates, vsR: Rates }
    batterHandedness: 'L' | 'R'
    pitcherHandedness: 'L' | 'R'
  }): ProbabilityDistribution

  sample(distribution: ProbabilityDistribution): Outcome
}
```

---

## Data Flow

### Season Package Format

```
season/
├── meta.json                 # Season metadata (year, teams, etc.)
├── teams.{bin|idx}           # Team roster data + daily lineups
├── batters.{bin|idx}         # Batter stats (split by handedness)
├── pitchers.{bin|idx}        # Pitcher stats (split by handedness)
├── schedule.{bin|idx}        # Game schedule with matchups
├── league-averages.json      # League rates for the season
└── model-params.json         # Pre-fitted hierarchical model coefficients
```

### Stats Per Player

- Event rates per PA: 1B, 2B, 3B, HR, BB, HBP, outs
- Split by: vs LHP / vs RHP (or vs LHB / vs RHB)
- Park-adjusted if possible
- Regressed toward league mean (partial pooling)

### Data Pipeline

1. Extract season data from DuckDB
2. Calculate player statistics with platoon splits
3. Fit hierarchical model on historical data
4. Package into season file
5. Browser lazy-loads and caches via IndexedDB

---

## Game State

### State Model

```typescript
interface GameState {
  metadata: {
    homeTeam: TeamId
    awayTeam: TeamId
    season: number
    date?: string
  }

  inning: number
  isTopInning: boolean
  outs: number
  bases: [batterId?, runner1Id?, runner2Id?, runner3Id?]

  homeLineup: LineupState
  awayLineup: LineupState
  currentPitcher: PitcherId
  currentBatter: BatterId

  balls: number
  strikes: number

  plays: PlayEvent[]

  mode: 'pitch-by-pitch' | 'auto-play' | 'quick-sim'
}
```

### Simulation Loop

1. **Pre-PA:** Stolen base attempts (V1: static rules)
2. **PA Outcome:** Sample from MatchupModel probabilities
3. **Post-PA:** Apply baserunning advancement (V1: static rules)
4. **Update State:** Increment outs, advance inning, substitutions
5. **Repeat** until complete

### State Management

- Svelte 5 runes (`$state`, `$derived`) for reactivity
- `GameStore` class maintains state and exposes methods
- localStorage persistence for resume capability

---

## UI Design

### Screen Flow

**Home Screen**
- Select Season (year dropdown + team grid)
- Choose Mode: Quick Match | Historical Game
- Select teams/years or choose from schedule

**Game Screen**
- Field View (2D diamond with runners/fielders)
- Scoreboard (score, inning, count, matchup)
- Play-by-Play Feed (scrollable)
- Game Controls (play/pause, skip to end)

**Post-Game Screen**
- Final box score
- Play again / Return to home

### Components

- `SeasonSelector` - Team grid, year picker
- `FieldView` - SVG diamond visualization
- `Scoreboard` - Live game info
- `PlayFeed` - Event log
- `GameControls` - Playback controls

### Visual Style

- Hybrid: text play-by-play + 2D field diagram
- Clean, readable typography
- Responsive design

---

## Phase 1 Implementation

### Tasks

1. **Scaffold Svelte App**
   - Initialize project with TypeScript, Tailwind
   - Configure shadcn-svelte
   - Set up directory structure

2. **Build Model Package (MVP)**
   - Implement generalized log5
   - Add platoon splits
   - Write unit tests

3. **Explore DuckDB Schema**
   - Inspect `event.events` table
   - Validate extractable stats
   - Understand daily lineup data

4. **Build UI Skeleton**
   - Route structure
   - Placeholder components
   - Mock game state for testing

5. **Data Export MVP**
   - Extract one season (1976)
   - Calculate basic stats with splits
   - Export to JSON

### Success Criteria

- Navigate from home to mock game screen
- Model produces probability distributions
- Data prep extracts real player stats

---

## Future Enhancements (Beyond V1)

- Full Bayesian hierarchical model fitting
- Non-PA event modeling (steals, advancement, throws)
- Fielding ability modifiers
- Online multiplayer
- Full roster management UI
- Park factors
- Pitch type modeling
- Injury/fatigue systems
