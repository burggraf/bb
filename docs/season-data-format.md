# Season Data Format

This document describes the structure and format of season data files used by the baseball simulation engine.

## Overview

Season data files contain all the statistical information needed to simulate games for a given MLB season. Each file includes player statistics with platoon splits, league averages, team information, and game schedules.

**File location:** `app/static/seasons/{year}.json.gz`

**Format:** Gzip-compressed JSON

**Version:** 2.0.0

## File Structure

```typescript
interface SeasonPackage {
  meta: SeasonMeta;
  norms: SeasonNorms;
  batters: Record<string, BatterStats>;
  pitchers: Record<string, PitcherStats>;
  league: LeagueAverages;
  teams: Record<string, TeamInfo>;
  games: GameInfo[];
}
```

## Sections

### 1. Meta

Metadata about the season file.

```typescript
{
  "year": 1976,                      // Season year
  "generatedAt": "2026-02-03T21:29:32.862Z",  // ISO timestamp of export
  "version": "2.0.0"                 // Data format version
}
```

### 2. Norms

Era-appropriate managerial norms for pitching changes and substitutions. These evolve based on historical baseball research.

```typescript
{
  "year": 1976,
  "era": "expansion-era",            // Era identifier
  "pitching": {
    "starterPitches": {
      "fatigueThreshold": 100,       // Pitch count where fatigue begins
      "typicalLimit": 120,           // Typical pitch count limit
      "hardLimit": 140               // Absolute maximum
    },
    "relieverPitches": {
      "maxPitches": 50,              // Max for relievers
      "typicalPitches": 22           // Typical for one-inning reliever
    },
    "starterBFP": 29,                // Avg batters faced by starters
    "relieverBFP": {
      "early": 4.1,                  // Innings 1-3 (long men)
      "middle": 3.9,                 // Innings 4-6 (middle relievers)
      "late": 3.5                    // Innings 7+ (closers/specialists)
    },
    "relieverBFPOverall": 12,        // Overall reliever average (legacy)
    "relieversPerGame": 3,           // Avg relievers used per game
    "starterDeepOutingBFP": 29,      // Median BFP for starter deep outings
    "pullThresholds": {
      "consider": 1.15,              // When to START considering pull (fraction of avgBFP)
      "likely": 1.45,                // When pull is LIKELY
      "hardLimit": 1.7               // Hard limit (fraction of avgBFP)
    },
    "expectedPitchersPerGame": 4.83  // Historical pitchers per game
  },
  "substitutions": {
    "pinchHitsPerGame": 2.8,         // Avg pinch hit appearances per game
    "defensiveReplacementsPerGame": 2.4
  }
}
```

**Era classifications:**
- `modern` (2010+): Analytics era, strict pitch limits
- `early-modern` (2000-2009): Pitch count monitoring standardizing
- `bullpen-specialization` (1980-1999): Specialized relievers emerging
- `expansion-era` (1960-1979): Starters still go deep
- `integration` (1940-1959): Complete games declining
- `lively-ball` (1920-1939): Complete games common
- `deadball` (1910-1919): Complete games very common

### 3. Batters

Map of player ID to batter statistics. Includes both position players and pitchers (who may have limited at-bats). Each batter has **platoon splits** - separate statistics against left-handed and right-handed pitchers.

```typescript
{
  "rosep001": {
    "id": "rosep001",                // Retro sheet player ID
    "name": "Rose, Pete",             // "Last, First" format
    "bats": "S",                      // "L", "R", or "S" (switch)
    "teamId": "CIN",                  // Primary team ID
    "primaryPosition": 5,             // 1=P, 2=C, 3=1B, 4=2B, 5=3B, 6=SS, 7=LF, 8=CF, 9=RF, 10=DH
    "positionEligibility": {
      "5": 41328                      // Position number -> outs played
    },
    "rates": {
      "vsLHP": {                      // vs Left-Handed Pitcher
        "single": 0.1822,
        "double": 0.04,
        "triple": 0.0133,
        "homeRun": 0.0178,
        "walk": 0.0756,
        "hitByPitch": 0.0089,
        "strikeout": 0.0844,
        "groundOut": 0.2596,
        "flyOut": 0.1467,
        "lineOut": 0.0898,
        "popOut": 0.0729,
        "sacrificeFly": 0.0044,
        "sacrificeBunt": 0,
        "fieldersChoice": 0,
        "reachedOnError": 0.0044,
        "catcherInterference": 0
      },
      "vsRHP": {                      // vs Right-Handed Pitcher
        "single": 0.2201,
        "double": 0.0626,
        "triple": 0.0057,
        "homeRun": 0.0114,
        "walk": 0.1176,
        "hitByPitch": 0.0076,
        "strikeout": 0.0664,
        "groundOut": 0.2244,
        "flyOut": 0.1258,
        "lineOut": 0.0826,
        "popOut": 0.0625,
        "sacrificeFly": 0.0019,
        "sacrificeBunt": 0,
        "fieldersChoice": 0.0019,
        "reachedOnError": 0.0095,
        "catcherInterference": 0
      }
    }
  }
}
```

**Position numbers:**
| Number | Position     |
|--------|--------------|
| 1      | Pitcher      |
| 2      | Catcher      |
| 3      | First Base   |
| 4      | Second Base  |
| 5      | Third Base   |
| 6      | Shortstop    |
| 7      | Left Field   |
| 8      | Center Field |
| 9      | Right Field  |
| 10     | DH           |

### 4. Pitchers

Map of player ID to pitcher statistics. Each pitcher has **platoon splits** - separate statistics against left-handed and right-handed batters.

```typescript
{
  "palmj001": {
    "id": "palmj001",                // Retro sheet player ID
    "name": "Palmer, Jim",            // "Last, First" format
    "throws": "R",                    // "L" or "R"
    "teamId": "BAL",                  // Primary team ID
    "avgBfpAsStarter": 29.86,         // Avg batters faced when starting (null if never started)
    "avgBfpAsReliever": 32.84,        // Avg batters faced when relieving (null if never relieved)
    "rates": {
      "vsLHB": {                      // vs Left-Handed Batter
        "single": 0.1667,
        "double": 0.0238,
        "triple": 0.0092,
        "homeRun": 0.0073,
        "walk": 0.0623,
        "hitByPitch": 0.0018,
        "strikeout": 0.1062,
        "groundOut": 0.2532,
        "flyOut": 0.1654,
        "lineOut": 0.0944,
        "popOut": 0.0841,
        "sacrificeFly": 0.0092,
        "sacrificeBunt": 0.0055,
        "fieldersChoice": 0.0055,
        "reachedOnError": 0.0055,
        "catcherInterference": 0
      },
      "vsRHB": {                      // vs Right-Handed Batter
        "single": 0.1414,
        "double": 0.0296,
        "triple": 0.0049,
        "homeRun": 0.0247,
        "walk": 0.0576,
        "hitByPitch": 0.0115,
        "strikeout": 0.148,
        "groundOut": 0.2361,
        "flyOut": 0.1558,
        "lineOut": 0.0705,
        "popOut": 0.0869,
        "sacrificeFly": 0.0132,
        "sacrificeBunt": 0.0082,
        "fieldersChoice": 0,
        "reachedOnError": 0.0115,
        "catcherInterference": 0
      }
    }
  }
}
```

### 5. EventRates

The core statistical structure - outcome rates per plate appearance. All values are probabilities (0-1) that sum to approximately 1.0 (excluding intentional walks which are not modeled).

```typescript
{
  "single": 0.1822,                  // Single rate
  "double": 0.04,                    // Double rate (includes ground rule doubles)
  "triple": 0.0133,                  // Triple rate
  "homeRun": 0.0178,                 // Home run rate (includes inside-the-park)
  "walk": 0.0756,                    // Walk rate (excludes intentional walks)
  "hitByPitch": 0.0089,              // Hit by pitch rate
  "strikeout": 0.0844,               // Strikeout rate
  "groundOut": 0.2596,               // Ground out rate (includes bunts)
  "flyOut": 0.1467,                  // Fly out rate (includes foul bunts)
  "lineOut": 0.0898,                 // Line out rate (includes line drive bunts)
  "popOut": 0.0729,                  // Pop out rate (includes popup bunts)
  "sacrificeFly": 0.0044,            // Sacrifice fly rate
  "sacrificeBunt": 0,                // Sacrifice bunt rate
  "fieldersChoice": 0,               // Fielder's choice rate
  "reachedOnError": 0.0044,          // Reached on error rate
  "catcherInterference": 0           // Catcher interference rate
}
```

**Trajectory imputation:** For seasons before 1990 when trajectory data wasn't reliably recorded, unknown outs are distributed using modern averages:
- Ground outs: 44%
- Fly outs: 30%
- Pop outs: 14%
- Line outs: 12%

### 6. League Averages

League-average outcome rates for the season. Used as the prior in the log5 model. Includes pitcher-batter averages for pitchers with few at-bats.

```typescript
{
  "vsLHP": {                        // League avg vs Left-Handed Pitcher
    "single": 0.168,
    "double": 0.043,
    // ... all 17 EventRates fields
  },
  "vsRHP": {                        // League avg vs Right-Handed Pitcher
    "single": 0.171,
    "double": 0.045,
    // ... all 17 EventRates fields
  },
  "pitcherBatter": {
    "vsLHP": { /* EventRates */ },  // League avg for pitchers batting vs LHP
    "vsRHP": { /* EventRates */ }   // League avg for pitchers batting vs RHP
  }
}
```

The `pitcherBatter` rates are used for pitchers with fewer than 5 plate appearances - their own stats are insufficient, so they use the league average for pitchers.

### 7. Teams

Map of team ID to team information.

```typescript
{
  "BAL": {
    "id": "BAL",                     // Team ID (abbrev)
    "league": "AL",                  // "AL" or "NL"
    "city": "Baltimore",             // City name
    "nickname": "Orioles"            // Team nickname
  }
}
```

### 8. Games

Array of all games played in the season, in chronological order.

```typescript
[
  {
    "id": "CIN197604080",           // Game ID (format: {homeTeam}{YYYYMMDD}{suffix})
    "date": "1976-04-08",           // Game date (YYYY-MM-DD)
    "awayTeam": "HOU",              // Away team ID
    "homeTeam": "CIN",              // Home team ID
    "useDH": false                  // Whether DH was used (AL=true after 1973, NL=false until 2022)
  }
]
```

## Data Generation

Season files are generated from `baseball.duckdb` using the export script:

```bash
cd data-prep
pnpm exec tsx src/export-season.ts 1976
```

**Source tables:**
- `event.events` - 17.4M plate appearance events (1910-2024)
- `dim.players` - Player demographics (bats/throws)
- `dim.teams` - Team information
- `game.games` - Game schedule and DH usage
- `defensive_stats` - Positional data (outs played by position)

**Filters applied:**
- Minimum 25 PA for batters (to appear in file)
- Minimum 25 PA for pitchers
- Intentional walks excluded
- No-play events excluded

**Compression:**
- Exported as uncompressed JSON first
- Then compressed with gzip for browser delivery
- Typical compressed size: 65-180 KB per season

## Season Manifest

`app/static/seasons/season-manifest.json` contains metadata about all available seasons:

```typescript
{
  "meta": {
    "generatedAt": "2026-02-02T18:47:14.000Z",
    "totalYears": 115,
    "totalCompressedSize": 11886592
  },
  "seasons": [
    {"year": 1910, "file": "1910.json.gz", "compressedSize": 68284},
    {"year": 1911, "file": "1911.json.gz", "compressedSize": 70564},
    // ... up to 2024
  ]
}
```

## Usage in the App

Seasons are loaded client-side via `fetch()` with decompression:

```typescript
const response = await fetch(`/seasons/${year}.json.gz`);
const compressed = await response.arrayBuffer();
const decompressed = pako.ungzip(compressed, { to: 'string' });
const season = JSON.parse(decompressed) as SeasonPackage;
```

The engine uses this data to:
1. Build lineups from team batters (filtered by `teamId`)
2. Create `Matchup` objects with batter/pitcher/league rates
3. Sample outcomes from the probability distribution
4. Apply era-appropriate pitching changes (using `norms`)

## Platoon Split Naming Convention

**Important:** The data files and model package use different key names for platoon splits:

| Context | Batter Keys | Pitcher Keys |
|---------|-------------|--------------|
| **Data files** (season JSON) | `vsLHP`, `vsRHP` | `vsLHB`, `vsRHB` |
| **Model package** (`@bb/model`) | `vsLeft`, `vsRight` | `vsLeft`, `vsRight` |

- **vsLHP** = "vs Left-Handed Pitcher" (batter facing LHP)
- **vsRHP** = "vs Right-Handed Pitcher" (batter facing RHP)
- **vsLHB** = "vs Left-Handed Batter" (pitcher facing LHB)
- **vsRHB** = "vs Right-Handed Batter" (pitcher facing RHB)

The engine (`app/src/lib/game/engine.ts`) translates between these formats when creating `Matchup` objects for the model.

## Type Definitions

All TypeScript types are defined in `data-prep/src/export-season.ts`:

- `SeasonPackage` - Top-level season structure
- `SeasonNorms` - Era-specific managerial norms
- `EventRates` - Outcome probability distribution
- `BatterStats` - Individual batter statistics
- `PitcherStats` - Individual pitcher statistics
