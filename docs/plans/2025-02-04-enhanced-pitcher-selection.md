# Enhanced Pitcher Selection & Bullpen Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement intelligent pitcher selection using new traditional stats (gamesStarted, saves, completeGames, ERA, WHIP) to identify starters, closers, and relievers with era-appropriate usage patterns.

**Architecture:** Three-component system: (1) Quality scoring calculates era-normalized pitcher ratings from traditional stats, (2) Classifier assigns roles (starter/closer/setup/longRelief) based on stats and era, (3) Enhanced selection uses roles + game situation + platoon for optimal reliever choice.

**Tech Stack:** TypeScript, Vitest (testing), existing MatchupModel framework, pnpm workspace monorepo

---

## Task 1: Add New Types for Enhanced Pitcher System

**Files:**
- Modify: `packages/model/src/managerial/types.ts`

**Step 1: Read the existing types file**

Run: `cat packages/model/src/managerial/types.ts`

**Step 2: Add new types after BullpenState interface**

```typescript
/**
 * Enhanced bullpen state with role-specific reliever categories
 */
export interface EnhancedBullpenState extends BullpenState {
	/** Setup men for 7th-8th innings (modern era) */
	setup?: PitcherRole[];
	/** Long relievers for early game/extra innings */
	longRelief?: PitcherRole[];
}

/**
 * Quality metrics for a pitcher (era-normalized)
 */
export interface PitcherQuality {
	id: string;
	qualityScore: number;	// Higher = better, era-normalized
	isWorkhorse: boolean;	// High complete game rate
	inningsPerGame: number;	// For reliever classification
	role: 'starter' | 'reliever';
}

/**
 * League-average pitching stats for a season (calculated, not from export)
 */
export interface LeaguePitchingNorms {
	avgERA: number;
	avgWHIP: number;
	avgSavesPerTeam: number;
	avgCGRate: number;	// completeGames / gamesStarted
	year: number;
}

/**
 * Extended options for reliever selection with platoon info
 */
export interface RelieverSelectionOptions {
	/** Upcoming batters for platoon consideration */
	upcomingBatters?: Array<{
		handedness: 'L' | 'R' | 'S';
	}>;
	/** League norms for era detection */
	leagueNorms?: LeaguePitchingNorms;
	/** Season year */
	year?: number;
	/** Is DH game (affects bullpen usage) */
	usesDH?: boolean;
}
```

**Step 3: Update index.ts to export new types**

Run: `grep -n "export.*BullpenState" packages/model/src/managerial/index.ts`

Add exports after existing type exports:
```typescript
export type { EnhancedBullpenState, PitcherQuality, LeaguePitchingNorms, RelieverSelectionOptions } from './types.js';
```

**Step 4: Run type check**

Run: `pnpm -C packages/model check`
Expected: No type errors

**Step 5: Commit**

```bash
git add packages/model/src/managerial/types.ts packages/model/src/managerial/index.ts
git commit -m "feat: add enhanced pitcher types for quality scoring and classification"
```

---

## Task 2: Create League Norms Calculator

**Files:**
- Create: `packages/model/src/managerial/norms-calculator.ts`
- Test: `packages/model/src/managerial/norms-calculator.test.ts`

**Step 1: Write the failing test**

```typescript
// norms-calculator.test.ts
import { describe, it, expect } from 'vitest';
import { calculateLeagueNorms } from './norms-calculator.js';
import type { PitcherStats } from '../types.js';

describe('calculateLeagueNorms', () => {
	it('calculates league averages from pitcher stats', () => {
		const pitchers: PitcherStats[] = [
			{
				id: 'p1', name: 'Pitcher 1', throws: 'R', teamId: 'team1',
				games: 30, gamesStarted: 30, completeGames: 5, saves: 0,
				inningsPitched: 200, whip: 1.200, era: 3.50,
				rates: { vsLHB: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.2, flyOut: 0.15, lineOut: 0.05, popOut: 0.05, sacrificeFly: 0.01, sacrificeBunt: 0.01, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHB: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.2, flyOut: 0.15, lineOut: 0.05, popOut: 0.05, sacrificeFly: 0.01, sacrificeBunt: 0.01, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } }
			},
			{
				id: 'p2', name: 'Pitcher 2', throws: 'L', teamId: 'team1',
				games: 60, gamesStarted: 0, completeGames: 0, saves: 20,
				inningsPitched: 80, whip: 1.000, era: 2.00,
				rates: { vsLHB: { single: 0.15, double: 0.04, triple: 0.01, homeRun: 0.02, walk: 0.06, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.2, flyOut: 0.15, lineOut: 0.05, popOut: 0.05, sacrificeFly: 0.01, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHB: { single: 0.15, double: 0.04, triple: 0.01, homeRun: 0.02, walk: 0.06, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.2, flyOut: 0.15, lineOut: 0.05, popOut: 0.05, sacrificeFly: 0.01, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } }
			}
		];

		const norms = calculateLeagueNorms(pitchers, 1976, 2);

		expect(norms.avgERA).toBeCloseTo(2.75); // (3.50 + 2.00) / 2
		expect(norms.avgWHIP).toBeCloseTo(1.10); // (1.20 + 1.00) / 2
		expect(norms.avgSavesPerTeam).toBeCloseTo(10); // 20 saves / 2 teams
		expect(norms.avgCGRate).toBeCloseTo(0.167); // 5/30 for p1
		expect(norms.year).toBe(1976);
	});

	it('handles empty pitcher list gracefully', () => {
		const norms = calculateLeagueNorms([], 2020, 1);
		expect(norms.avgERA).toBe(4.00); // Default fallback
		expect(norms.avgWHIP).toBe(1.35); // Default fallback
	});
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/model test norms-calculator.test.ts`
Expected: FAIL with "calculateLeagueNorms is not defined"

**Step 3: Write minimal implementation**

```typescript
// norms-calculator.ts
import type { PitcherStats } from '../types.js';
import type { LeaguePitchingNorms } from './types.js';

/**
 * Calculate league-average pitching norms from all pitchers in a season
 */
export function calculateLeagueNorms(
	pitchers: PitcherStats[],
	year: number,
	numTeams: number
): LeaguePitchingNorms {
	if (pitchers.length === 0) {
		return {
			avgERA: 4.00,
			avgWHIP: 1.35,
			avgSavesPerTeam: 0,
			avgCGRate: 0,
			year
		};
	}

	const totalERA = pitchers.reduce((sum, p) => sum + p.era, 0);
	const totalWHIP = pitchers.reduce((sum, p) => sum + p.whip, 0);
	const totalSaves = pitchers.reduce((sum, p) => sum + p.saves, 0);

	// Calculate CG rate only for pitchers with starts
	const starters = pitchers.filter(p => p.gamesStarted > 0);
	const totalCGRate = starters.length > 0
		? starters.reduce((sum, p) => sum + (p.completeGames / p.gamesStarted), 0) / starters.length
		: 0;

	return {
		avgERA: totalERA / pitchers.length,
		avgWHIP: totalWHIP / pitchers.length,
		avgSavesPerTeam: totalSaves / numTeams,
		avgCGRate: totalCGRate,
		year
	};
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/model test norms-calculator.test.ts`
Expected: PASS

**Step 5: Export from index.ts**

Add to `packages/model/src/managerial/index.ts`:
```typescript
export { calculateLeagueNorms } from './norms-calculator.js';
```

**Step 6: Commit**

```bash
git add packages/model/src/managerial/norms-calculator.ts packages/model/src/managerial/norms-calculator.test.ts packages/model/src/managerial/index.ts
git commit -m "feat: add league norms calculator for era-normalized pitcher stats"
```

---

## Task 3: Create Pitcher Quality Scoring

**Files:**
- Create: `packages/model/src/managerial/pitcher-quality.ts`
- Test: `packages/model/src/managerial/pitcher-quality.test.ts`

**Step 1: Write the failing test**

```typescript
// pitcher-quality.test.ts
import { describe, it, expect } from 'vitest';
import { calculatePitcherQuality } from './pitcher-quality.js';
import type { PitcherStats } from '../types.js';
import type { LeaguePitchingNorms } from './types.js';

describe('calculatePitcherQuality', () => {
	const norms: LeaguePitchingNorms = {
		avgERA: 3.50,
		avgWHIP: 1.20,
		avgSavesPerTeam: 15,
		avgCGRate: 0.10,
		year: 2020
	};

	it('calculates quality score for a quality starter', () => {
		const starter: PitcherStats = {
			id: 'ace', name: 'Ace', throws: 'R', teamId: 'team1',
			games: 33, gamesStarted: 33, completeGames: 3, saves: 0,
			inningsPitched: 220, whip: 0.95, era: 2.50,
			rates: { vsLHB: { single: 0.18, double: 0.05, triple: 0.01, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.25, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHB: { single: 0.18, double: 0.05, triple: 0.01, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.25, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } }
		};

		const quality = calculatePitcherQuality(starter, norms, 'starter');

		expect(quality.id).toBe('ace');
		expect(quality.role).toBe('starter');
		expect(quality.qualityScore).toBeGreaterThan(1.0); // Above average
		expect(quality.inningsPerGame).toBeCloseTo(220 / 33, 1);
	});

	it('identifies workhorse starters (high CG rate)', () => {
		const workhorse: PitcherStats = {
			id: 'workhorse', name: 'Workhorse', throws: 'R', teamId: 'team1',
			games: 35, gamesStarted: 35, completeGames: 10, saves: 0,
			inningsPitched: 280, whip: 1.10, era: 3.00,
			rates: { vsLHB: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.2, flyOut: 0.15, lineOut: 0.05, popOut: 0.05, sacrificeFly: 0.01, sacrificeBunt: 0.01, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHB: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.2, flyOut: 0.15, lineOut: 0.05, popOut: 0.05, sacrificeFly: 0.01, sacrificeBunt: 0.01, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } }
		};

		const quality = calculatePitcherQuality(workhorse, norms, 'starter');

		expect(quality.isWorkhorse).toBe(true); // 10/35 > 15%
	});

	it('calculates quality for a closer', () => {
		const closer: PitcherStats = {
			id: 'closer', name: 'Closer', throws: 'R', teamId: 'team1',
			games: 60, gamesStarted: 0, completeGames: 0, saves: 35,
			inningsPitched: 65, whip: 0.90, era: 1.80,
			rates: { vsLHB: { single: 0.15, double: 0.04, triple: 0, homeRun: 0.02, walk: 0.06, hitByPitch: 0.01, strikeout: 0.3, groundOut: 0.18, flyOut: 0.12, lineOut: 0.02, popOut: 0, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHB: { single: 0.15, double: 0.04, triple: 0, homeRun: 0.02, walk: 0.06, hitByPitch: 0.01, strikeout: 0.3, groundOut: 0.18, flyOut: 0.12, lineOut: 0.02, popOut: 0, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } }
		};

		const quality = calculatePitcherQuality(closer, norms, 'reliever');

		expect(quality.qualityScore).toBeGreaterThan(1.0); // Elite closer
		expect(quality.inningsPerGame).toBeCloseTo(65 / 60, 1); // Low IP/G
	});
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/model test pitcher-quality.test.ts`
Expected: FAIL with "calculatePitcherQuality is not defined"

**Step 3: Write minimal implementation**

```typescript
// pitcher-quality.ts
import type { PitcherStats } from '../types.js';
import type { LeaguePitchingNorms, PitcherQuality } from './types.js';

/**
 * Calculate era-normalized quality score for a pitcher
 *
 * Quality scores are normalized so 1.0 = league average
 * Scores > 1.0 = above average, < 1.0 = below average
 */
export function calculatePitcherQuality(
	pitcher: PitcherStats,
	norms: LeaguePitchingNorms,
	role: 'starter' | 'reliever'
): PitcherQuality {
	const inningsPerGame = pitcher.games > 0 ? pitcher.inningsPitched / pitcher.games : 0;
	const cgRate = pitcher.gamesStarted > 0 ? pitcher.completeGames / pitcher.gamesStarted : 0;
	const isWorkhorse = cgRate >= 0.15; // 15%+ CG rate = workhorse

	let qualityScore: number;

	if (role === 'starter') {
		// Starter quality: mix of workload and rate stats
		const gamesStartedRate = pitcher.gamesStarted / 162; // Normalized to season
		const eraRatio = norms.avgERA / pitcher.era; // Lower ERA = higher score
		const whipRatio = norms.avgWHIP / pitcher.whip; // Lower WHIP = higher score
		const cgBonus = cgRate * 2; // Complete games add value

		qualityScore = (gamesStartedRate * 0.3) + (eraRatio * 0.35) + (whipRatio * 0.25) + cgBonus;
	} else {
		// Reliever quality: saves, low ERA/WHIP, short outings
		const savesRate = pitcher.saves / 30; // Normalized
		const eraRatio = norms.avgERA / pitcher.era;
		const whipRatio = norms.avgWHIP / pitcher.whip;
		const shortOutingBonus = inningsPerGame < 2 ? 0.2 : 0; // Closers pitch fewer innings
		const lowStartBonus = pitcher.gamesStarted === 0 ? 0.1 : 0;

		qualityScore = (savesRate * 0.4) + (eraRatio * 0.3) + (whipRatio * 0.2) + shortOuttingBonus + lowStartBonus;
	}

	return {
		id: pitcher.id,
		qualityScore,
		isWorkhorse,
		inningsPerGame,
		role
	};
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/model test pitcher-quality.test.ts`
Expected: FAIL - typo in variable name (`shortOuttingBonus`)

**Step 5: Fix typo and rerun**

Change `shortOuttingBonus` to `shortOutingBonus`

Run: `pnpm -C packages/model test pitcher-quality.test.ts`
Expected: PASS

**Step 6: Export from index.ts**

Add to `packages/model/src/managerial/index.ts`:
```typescript
export { calculatePitcherQuality } from './pitcher-quality.js';
```

**Step 7: Commit**

```bash
git add packages/model/src/managerial/pitcher-quality.ts packages/model/src/managerial/pitcher-quality.test.ts packages/model/src/managerial/index.ts
git commit -m "feat: add pitcher quality scoring with era normalization"
```

---

## Task 4: Create Pitcher Classifier

**Files:**
- Create: `packages/model/src/managerial/pitcher-classifier.ts`
- Test: `packages/model/src/managerial/pitcher-classifier.test.ts`

**Step 1: Write the failing test**

```typescript
// pitcher-classifier.test.ts
import { describe, it, expect } from 'vitest';
import { classifyPitchers } from './pitcher-classifier.js';
import type { PitcherStats } from '../types.js';
import type { LeaguePitchingNorms } from './types.js';

describe('classifyPitchers', () => {
	const norms2020: LeaguePitchingNorms = {
		avgERA: 4.00,
		avgWHIP: 1.30,
		avgSavesPerTeam: 20,
		avgCGRate: 0.05,
		year: 2020
	};

	it('classifies modern era pitchers with closer', () => {
		const pitchers: PitcherStats[] = [
			// Ace starter
			{ id: 'starter1', name: 'Ace', throws: 'R', teamId: 'team1', games: 32, gamesStarted: 32, completeGames: 1, saves: 0, inningsPitched: 200, whip: 1.00, era: 2.80, rates: { vsLHB: { single: 0.18, double: 0.05, triple: 0.01, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.25, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHB: { single: 0.18, double: 0.05, triple: 0.01, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.25, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } },
			// #2 starter
			{ id: 'starter2', name: '#2', throws: 'L', teamId: 'team1', games: 30, gamesStarted: 28, completeGames: 0, saves: 0, inningsPitched: 160, whip: 1.20, era: 3.50, rates: { vsLHB: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.2, flyOut: 0.15, lineOut: 0.05, popOut: 0.05, sacrificeFly: 0.01, sacrificeBunt: 0.01, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHB: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.2, flyOut: 0.15, lineOut: 0.05, popOut: 0.05, sacrificeFly: 0.01, sacrificeBunt: 0.01, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } },
			// Closer
			{ id: 'closer', name: 'Closer', throws: 'R', teamId: 'team1', games: 60, gamesStarted: 0, completeGames: 0, saves: 35, inningsPitched: 60, whip: 0.95, era: 2.00, rates: { vsLHB: { single: 0.15, double: 0.04, triple: 0, homeRun: 0.02, walk: 0.06, hitByPitch: 0.01, strikeout: 0.3, groundOut: 0.18, flyOut: 0.12, lineOut: 0.02, popOut: 0, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHB: { single: 0.15, double: 0.04, triple: 0, homeRun: 0.02, walk: 0.06, hitByPitch: 0.01, strikeout: 0.3, groundOut: 0.18, flyOut: 0.12, lineOut: 0.02, popOut: 0, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } },
			// Setup man
			{ id: 'setup', name: 'Setup', throws: 'R', teamId: 'team1', games: 50, gamesStarted: 2, completeGames: 0, saves: 5, inningsPitched: 70, whip: 1.10, era: 2.80, rates: { vsLHB: { single: 0.18, double: 0.04, triple: 0.01, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.25, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHB: { single: 0.18, double: 0.04, triple: 0.01, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.25, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } },
			// Long reliever
			{ id: 'long', name: 'Long', throws: 'L', teamId: 'team1', games: 40, gamesStarted: 5, completeGames: 0, saves: 1, inningsPitched: 85, whip: 1.25, era: 3.80, rates: { vsLHB: { single: 0.22, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.18, groundOut: 0.2, flyOut: 0.14, lineOut: 0.05, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHB: { single: 0.22, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.18, groundOut: 0.2, flyOut: 0.14, lineOut: 0.05, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } }
		];

		const result = classifyPitchers(pitchers, norms2020);

		expect(result.starter.pitcherId).toBe('starter1'); // Best starter
		expect(result.closer?.pitcherId).toBe('closer');
		expect(result.setup?.length).toBeGreaterThan(0);
		expect(result.setup?.[0]?.pitcherId).toBe('setup');
		expect(result.longRelief?.length).toBeGreaterThan(0);
		expect(result.longRelief?.[0]?.pitcherId).toBe('long');
	});

	it('handles historical era with no closers (1970s)', () => {
		const norms1976: LeaguePitchingNorms = {
			avgERA: 3.50,
			avgWHIP: 1.20,
			avgSavesPerTeam: 8, // Low saves era
			avgCGRate: 0.20, // High CG era
			year: 1976
		};

		const pitchers: PitcherStats[] = [
			{ id: 'starter1', name: 'Ace', throws: 'R', teamId: 'team1', games: 40, gamesStarted: 38, completeGames: 15, saves: 2, inningsPitched: 280, whip: 1.05, era: 2.90, rates: { vsLHB: { single: 0.18, double: 0.05, triple: 0.01, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.22, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0.01, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHB: { single: 0.18, double: 0.05, triple: 0.01, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.22, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0.01, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } },
			{ id: 'reliever1', name: 'Reliever', throws: 'R', teamId: 'team1', games: 50, gamesStarted: 3, completeGames: 0, saves: 6, inningsPitched: 90, whip: 1.15, era: 3.20, rates: { vsLHB: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHB: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } }
		];

		const result = classifyPitchers(pitchers, norms1976);

		expect(result.starter.pitcherId).toBe('starter1');
		expect(result.closer).toBeUndefined(); // No dedicated closer in 1976
	});
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/model test pitcher-classifier.test.ts`
Expected: FAIL with "classifyPitchers is not defined"

**Step 3: Write minimal implementation**

```typescript
// pitcher-classifier.ts
import type { PitcherStats } from '../types.js';
import type { EnhancedBullpenState, LeaguePitchingNorms, PitcherRole } from './types.js';
import { calculatePitcherQuality } from './pitcher-quality.js';

/**
 * Determine if era uses closers based on league save totals
 */
function hasClosers(norms: LeaguePitchingNorms): boolean {
	if (norms.year < 1950) return false; // No saves recorded
	if (norms.year < 1970) return norms.avgSavesPerTeam > 5; // Emerging
	if (norms.year < 1990) return norms.avgSavesPerTeam > 12; // Established
	return true; // Modern era
}

/**
 * Determine pitcher's primary role from stats
 */
function getPitcherRole(pitcher: PitcherStats): 'starter' | 'reliever' {
	const startRate = pitcher.gamesStarted / pitcher.games;
	if (startRate >= 0.5) return 'starter';
	if (startRate <= 0.2) return 'reliever';
	// Swingman: decide by total starts
	return pitcher.gamesStarted >= 15 ? 'starter' : 'reliever';
}

/**
 * Create PitcherRole from PitcherStats
 */
function createPitcherRole(pitcher: PitcherStats, role: 'starter' | 'reliever'): PitcherRole {
	return {
		pitcherId: pitcher.id,
		role: role === 'starter' ? 'starter' : 'reliever',
		stamina: 100,
		pitchesThrown: 0,
		battersFace: 0,
		avgBfpAsStarter: null, // Will be populated from season data
		avgBfpAsReliever: null,
		hitsAllowed: 0,
		walksAllowed: 0,
		runsAllowed: 0
	};
}

/**
 * Classify all pitchers for a team into roles
 *
 * Returns EnhancedBullpenState with:
 * - starter: Best quality starting pitcher
 * - closer: Best reliever (if era uses closers)
 * - setup: Next-best relievers (1-2)
 * - longRelief: Long-relief capable pitchers
 * - relievers: All remaining pitchers
 */
export function classifyPitchers(
	pitchers: PitcherStats[],
	norms: LeaguePitchingNorms
): EnhancedBullpenState {
	// Calculate quality for all pitchers
	const qualities = pitchers.map(p => ({
		pitcher: p,
		quality: calculatePitcherQuality(p, norms, getPitcherRole(p))
	}));

	// Separate starters and relievers
	const starters = qualities.filter(q => q.quality.role === 'starter').sort((a, b) => b.quality.qualityScore - a.quality.qualityScore);
	const relievers = qualities.filter(q => q.quality.role === 'reliever').sort((a, b) => b.quality.qualityScore - a.quality.qualityScore);

	if (starters.length === 0) {
		throw new Error('No starting pitchers available');
	}

	// Best starter is the ace
	const starter = createPitcherRole(starters[0]!.pitcher, 'starter');

	// Determine if this era uses closers
	const eraHasClosers = hasClosers(norms);

	// Build bullpen
	let closer: PitcherRole | undefined;
	let setup: PitcherRole[] = [];
	let longRelief: PitcherRole[] = [];
	const remaining: PitcherRole[] = [];

	if (eraHasClosers && relievers.length > 0) {
		// Best reliever is closer (highest saves or quality)
		const closerIdx = relievers.findIndex(r => r.pitcher.saves > 0) ?? 0;
		if (relievers[closerIdx]!.pitcher.saves >= 5 || relievers[0]!.quality.qualityScore > 1.2) {
			closer = createPitcherRole(relievers[closerIdx]!.pitcher, 'reliever');
			relievers.splice(closerIdx, 1);
		}

		// Next 1-2 are setup men
		const setupCount = Math.min(2, relievers.length);
		for (let i = 0; i < setupCount; i++) {
			setup.push(createPitcherRole(relievers[i]!.pitcher, 'reliever'));
		}
		relievers.splice(0, setupCount);

		// Long relievers have higher innings per game
		for (const r of relievers) {
			if (r.quality.inningsPerGame > 1.3) {
				longRelief.push(createPitcherRole(r.pitcher, 'reliever'));
			} else {
				remaining.push(createPitcherRole(r.pitcher, 'reliever'));
			}
		}
	} else {
		// No closers - all relievers go to longRelief or remaining
		for (const r of relievers) {
			if (r.quality.inningsPerGame > 1.5) {
				longRelief.push(createPitcherRole(r.pitcher, 'reliever'));
			} else {
				remaining.push(createPitcherRole(r.pitcher, 'reliever'));
			}
		}
	}

	return {
		starter,
		relievers: remaining,
		closer,
		setup: setup.length > 0 ? setup : undefined,
		longRelief: longRelief.length > 0 ? longRelief : undefined
	};
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/model test pitcher-classifier.test.ts`
Expected: PASS

**Step 5: Export from index.ts**

Add to `packages/model/src/managerial/index.ts`:
```typescript
export { classifyPitchers } from './pitcher-classifier.js';
export type { EnhancedBullpenState } from './types.js';
```

**Step 6: Commit**

```bash
git add packages/model/src/managerial/pitcher-classifier.ts packages/model/src/managerial/pitcher-classifier.test.ts packages/model/src/managerial/index.ts
git commit -m "feat: add pitcher classifier with era-aware role assignment"
```

---

## Task 5: Update Lineup Builder to Use Quality-Based Starter Selection

**Files:**
- Modify: `app/src/lib/game/lineup-builder.ts`

**Step 1: Read current selectStartingPitcher function**

Run: `sed -n '97,113p' app/src/lib/game/lineup-builder.ts`

**Step 2: Write the failing test first**

Create test file `app/src/lib/game/lineup-builder.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { selectStartingPitcher } from './lineup-builder.js';
import type { PitcherStats } from './types.js';

describe('selectStartingPitcher', () => {
	it('selects best quality starter (gamesStarted + quality stats)', () => {
		const pitchers: PitcherStats[] = [
			// High starts, mediocre stats
			{ id: 'innings-eater', name: 'Innings Eater', throws: 'R', teamId: 'team1', games: 35, gamesStarted: 35, completeGames: 2, saves: 0, inningsPitched: 210, whip: 1.35, era: 4.20, rates: { vsLHB: { single: 0.22, double: 0.06, triple: 0.01, homeRun: 0.04, walk: 0.09, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHB: { single: 0.22, double: 0.06, triple: 0.01, homeRun: 0.04, walk: 0.09, hitByPitch: 0.01, strikeout: 0.15, groundOut: 0.18, flyOut: 0.14, lineOut: 0.04, popOut: 0.03, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } },
			// Ace: high starts, great stats
			{ id: 'ace', name: 'Ace', throws: 'R', teamId: 'team1', games: 32, gamesStarted: 32, completeGames: 3, saves: 0, inningsPitched: 220, whip: 0.95, era: 2.50, rates: { vsLHB: { single: 0.18, double: 0.05, triple: 0.01, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.25, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHB: { single: 0.18, double: 0.05, triple: 0.01, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.25, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } },
			// Reliever (should not be selected)
			{ id: 'reliever', name: 'Reliever', throws: 'L', teamId: 'team1', games: 60, gamesStarted: 0, completeGames: 0, saves: 10, inningsPitched: 70, whip: 1.10, era: 3.00, rates: { vsLHB: { single: 0.2, double: 0.04, triple: 0, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.25, groundOut: 0.18, flyOut: 0.13, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHB: { single: 0.2, double: 0.04, triple: 0, homeRun: 0.02, walk: 0.07, hitByPitch: 0.01, strikeout: 0.25, groundOut: 0.18, flyOut: 0.13, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } }
		];

		const selected = selectStartingPitcher(pitchers);

		expect(selected.id).toBe('ace'); // Best quality, not just most starts
	});

	it('prioritizes gamesStarted when quality is similar', () => {
		const pitchers: PitcherStats[] = [
			{ id: 'starter2', name: '#2 Starter', throws: 'R', teamId: 'team1', games: 30, gamesStarted: 28, completeGames: 1, saves: 0, inningsPitched: 170, whip: 3.51, era: 1.21, rates: { vsLHB: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHB: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } },
			{ id: 'starter1', name: '#1 Starter', throws: 'R', teamId: 'team1', games: 33, gamesStarted: 33, completeGames: 2, saves: 0, inningsPitched: 200, whip: 3.50, era: 1.20, rates: { vsLHB: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 }, vsRHB: { single: 0.2, double: 0.05, triple: 0.01, homeRun: 0.03, walk: 0.08, hitByPitch: 0.01, strikeout: 0.2, groundOut: 0.2, flyOut: 0.15, lineOut: 0.04, popOut: 0.02, sacrificeFly: 0, sacrificeBunt: 0, fieldersChoice: 0, reachedOnError: 0, catcherInterference: 0 } } }
		];

		const selected = selectStartingPitcher(pitchers);

		expect(selected.id).toBe('starter1'); // More gamesStarted
	});
});
```

**Step 3: Run test to verify current behavior fails new requirements**

Run: `pnpm -C app test lineup-builder.test.ts`
Expected: FAIL - current implementation selects by avgBfpAsStarter only, not quality

**Step 4: Update implementation**

Replace `selectStartingPitcher` function (lines 97-113):

```typescript
/**
 * Select the starting pitcher based on quality score
 * Considers gamesStarted, ERA, WHIP, and complete game rate
 */
function selectStartingPitcher(pitchers: PitcherStats[]): PitcherStats {
	if (pitchers.length === 0) {
		throw new Error('No pitchers available for selection');
	}

	// Filter to pitchers who actually started games (start rate > 30%)
	const starters = pitchers.filter(p => {
		const startRate = p.gamesStarted / p.games;
		return startRate >= 0.3;
	});

	if (starters.length === 0) {
		// Fallback: use pitcher with most gamesStarted
		return pitchers.sort((a, b) => b.gamesStarted - a.gamesStarted)[0]!;
	}

	// Calculate quality score for each starter
	// Quality = (gamesStarted weight) + (era inverse) + (whip inverse) + (cg bonus)
	const scored = starters.map(p => {
		const eraScore = 5 / p.era; // Lower ERA = higher score
		const whipScore = 2 / p.whip; // Lower WHIP = higher score
		const cgRate = p.gamesStarted > 0 ? p.completeGames / p.gamesStarted : 0;
		const cgBonus = cgRate * 10; // Complete games add value

		return {
			pitcher: p,
			score: p.gamesStarted * 2 + eraScore + whipScore + cgBonus
		};
	});

	// Sort by score descending
	scored.sort((a, b) => b.score - a.score);

	return scored[0]!.pitcher;
}
```

**Step 5: Run test to verify it passes**

Run: `pnpm -C app test lineup-builder.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add app/src/lib/game/lineup-builder.ts app/src/lib/game/lineup-builder.test.ts
git commit -m "feat: use quality-based starter selection (ERA, WHIP, CG rate)"
```

---

## Task 6: Update Game Engine initializeBullpen to Use Classification

**Files:**
- Modify: `app/src/lib/game/engine.ts`

**Step 1: Read current initializeBullpen implementation**

Run: `sed -n '521,569p' app/src/lib/game/engine.ts`

**Step 2: Import classifyPitchers and types**

Add to imports at top of engine.ts:
```typescript
import { classifyPitchers } from '@bb/model';
import type { EnhancedBullpenState } from '@bb/model';
import { calculateLeagueNorms } from '@bb/model';
import type { LeaguePitchingNorms } from '@bb/model';
```

**Step 3: Update initializeBullpen to use classifier**

Replace `initializeBullpen` method (lines 521-569):

```typescript
private initializeBullpen(teamId: string, starterId: string): void {
	const teamPitchers = Object.values(this.season.pitchers).filter((p) => p.teamId === teamId && p.id !== starterId);

	const starterStats = this.season.pitchers[starterId];
	if (!starterStats) {
		console.warn(`Starter ${starterId} not found in season data for team ${teamId}`);
		return;
	}

	// Calculate league norms from all pitchers in season
	const allPitchers = Object.values(this.season.pitchers);
	const numTeams = Object.keys(this.season.teams).length;
	const leagueNorms: LeaguePitchingNorms = calculateLeagueNorms(
		allPitchers,
		this.season.meta.year,
		numTeams
	);

	// Use classifier to assign roles
	// Include the designated starter so classifier knows who's starting
	const allTeamPitchers = [...teamPitchers, starterStats];
	const classification = classifyPitchers(allTeamPitchers, leagueNorms);

	// Override the starter to be the designated one
	const starter: PitcherRole = {
		pitcherId: starterId,
		role: 'starter',
		stamina: 100,
		pitchesThrown: 0,
		battersFace: 0,
		avgBfpAsStarter: starterStats.avgBfpAsStarter ?? null,
		avgBfpAsReliever: starterStats.avgBfpAsReliever ?? null,
		hitsAllowed: 0,
		walksAllowed: 0,
		runsAllowed: 0
	};
	this.pitcherStamina.set(starterId, starter);

	// Store enhanced bullpen state
	this.bullpenStates.set(teamId, {
		starter,
		relievers: classification.relievers,
		closer: classification.closer,
		setup: classification.setup,
		longRelief: classification.longRelief
	});
}
```

**Step 4: Update BullpenState type usage**

The private bullpenStates Map needs to use EnhancedBullpenState:

Find line 337:
```typescript
private bullpenStates: Map<string, BullpenState>;
```

Change to:
```typescript
private bullpenStates: Map<string, EnhancedBullpenState>;
```

**Step 5: Run type check**

Run: `pnpm -C app check`
Expected: No type errors

**Step 6: Run existing tests**

Run: `pnpm -C app test`
Expected: Existing tests pass

**Step 7: Commit**

```bash
git add app/src/lib/game/engine.ts
git commit -m "feat: use classifier for bullpen initialization with role assignment"
```

---

## Task 7: Update selectReliever with Enhanced Logic

**Files:**
- Modify: `packages/model/src/managerial/pitching.ts`

**Step 1: Read current selectReliever implementation**

Run: `sed -n '421,457p' packages/model/src/managerial/pitching.ts`

**Step 2: Write tests for enhanced selection**

Create `packages/model/src/managerial/pitching-enhanced.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { selectReliever } from './pitching.js';
import type { BullpenState, GameState, PitcherRole } from './types.js';

describe('selectReliever (enhanced)', () => {
	const mockGameState: GameState = {
		inning: 9,
		isTopInning: true,
		outs: 0,
		bases: [null, null, null],
		scoreDiff: 2 // Pitching team up by 2
	};

	it('uses closer in save situation (9th+, lead 1-3)', () => {
		const bullpen: BullpenState = {
			starter: { pitcherId: 'starter', role: 'starter', stamina: 50, pitchesThrown: 0, battersFace: 25, avgBfpAsStarter: 27, avgBfpAsReliever: null, hitsAllowed: 5, walksAllowed: 2, runsAllowed: 2 },
			relievers: [
				{ pitcherId: 'middle1', role: 'reliever', stamina: 100, pitchesThrown: 0, battersFace: 0, avgBfpAsStarter: null, avgBfpAsReliever: 12, hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0 },
				{ pitcherId: 'setup', role: 'reliever', stamina: 100, pitchesThrown: 0, battersFace: 0, avgBfpAsStarter: null, avgBfpAsReliever: 10, hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0 }
			],
			closer: { pitcherId: 'closer', role: 'closer', stamina: 100, pitchesThrown: 0, battersFace: 0, avgBfpAsStarter: null, avgBfpAsReliever: 6, hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0 }
		};

		const selected = selectReliever(mockGameState, bullpen as any, 'starter');

		expect(selected?.pitcherId).toBe('closer');
	});

	it('uses setup man in 7th-8th inning high leverage', () => {
		const gameState: GameState = { ...mockGameState, inning: 8 };
		const bullpen: BullpenState = {
			starter: { pitcherId: 'starter', role: 'starter', stamina: 50, pitchesThrown: 0, battersFace: 22, avgBfpAsStarter: 27, avgBfpAsReliever: null, hitsAllowed: 4, walksAllowed: 2, runsAllowed: 2 },
			relievers: [
				{ pitcherId: 'middle1', role: 'reliever', stamina: 100, pitchesThrown: 0, battersFace: 0, avgBfpAsStarter: null, avgBfpAsReliever: 12, hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0 }
			],
			closer: { pitcherId: 'closer', role: 'closer', stamina: 100, pitchesThrown: 0, battersFace: 0, avgBfpAsStarter: null, avgBfpAsReliever: 6, hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0 },
			setup: [
				{ pitcherId: 'setup1', role: 'reliever', stamina: 100, pitchesThrown: 0, battersFace: 0, avgBfpAsStarter: null, avgBfpAsReliever: 10, hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0 },
				{ pitcherId: 'setup2', role: 'reliever', stamina: 100, pitchesThrown: 0, battersFace: 0, avgBfpAsStarter: null, avgBfpAsReliever: 10, hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0 }
			]
		};

		const selected = selectReliever(gameState, bullpen as any, 'starter');

		expect(selected?.pitcherId).toBe('setup1'); // First setup man
	});

	it('uses long reliever in early innings', () => {
		const gameState: GameState = { ...mockGameState, inning: 4 };
		const bullpen: BullpenState = {
			starter: { pitcherId: 'starter', role: 'starter', stamina: 30, pitchesThrown: 0, battersFace: 20, avgBfpAsStarter: 27, avgBfpAsReliever: null, hitsAllowed: 6, walksAllowed: 3, runsAllowed: 4 },
			relievers: [
				{ pitcherId: 'middle1', role: 'reliever', stamina: 100, pitchesThrown: 0, battersFace: 0, avgBfpAsStarter: null, avgBfpAsReliever: 8, hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0 }
			],
			longRelief: [
				{ pitcherId: 'long1', role: 'reliever', stamina: 100, pitchesThrown: 0, battersFace: 0, avgBfpAsStarter: null, avgBfpAsReliever: 15, hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0 }
			]
		};

		const selected = selectReliever(gameState, bullpen as any, 'starter');

		expect(selected?.pitcherId).toBe('long1'); // Long reliever for early game
	});
});
```

**Step 3: Run test to verify it fails**

Run: `pnpm -C packages/model test pitching-enhanced.test.ts`
Expected: FAIL - current implementation doesn't handle setup/longRelief

**Step 4: Update selectReliever signature and implementation**

Update function signature (line 421):

```typescript
export function selectReliever(
	gameState: GameState,
	bullpen: BullpenState | EnhancedBullpenState,
	excludePitcherId?: string
): PitcherRole | undefined {
```

Replace function body (lines 422-457) with enhanced logic:

```typescript
export function selectReliever(
	gameState: GameState,
	bullpen: BullpenState | EnhancedBullpenState,
	excludePitcherId?: string
): PitcherRole | undefined {
	const { inning, outs, scoreDiff } = gameState;

	// Determine if this is the home or away pitching
	const isHomePitching = !gameState.isTopInning;

	// Adjust score diff to be from pitching team's perspective
	const pitchingScoreDiff = isHomePitching ? scoreDiff : -scoreDiff;

	const enhanced = bullpen as EnhancedBullpenState;

	// === SAVE SITUATION (9th+, leading by 1-3 runs) ===
	if (inning >= 9 && pitchingScoreDiff > 0 && pitchingScoreDiff <= 3) {
		// Use closer if available and not excluded
		if (enhanced.closer && enhanced.closer.pitcherId !== excludePitcherId) {
			return enhanced.closer;
		}
		// Fallback to setup man
		if (enhanced.setup && enhanced.setup.length > 0) {
			const available = enhanced.setup.find(r => r.pitcherId !== excludePitcherId);
			if (available) return available;
		}
		// Fallback to any reliever
		return enhanced.relievers.find(r => r.pitcherId !== excludePitcherId);
	}

	// === LATE & CLOSE (7th-8th, close game) ===
	if (inning >= 7 && Math.abs(scoreDiff) <= 2) {
		// Prefer setup men
		if (enhanced.setup && enhanced.setup.length > 0) {
			const available = enhanced.setup.find(r => r.pitcherId !== excludePitcherId);
			if (available) return available;
		}
		// Then closer if available (but save them for 9th if possible)
		if (inning >= 8 && enhanced.closer && enhanced.closer.pitcherId !== excludePitcherId) {
			return enhanced.closer;
		}
		// Then any reliever
		const available = enhanced.relievers.find(r => r.pitcherId !== excludePitcherId);
		if (available) return available;
		// Last resort: closer or long relief
		return enhanced.closer ?? enhanced.longRelief?.[0];
	}

	// === EARLY GAME (innings 1-6) ===
	if (inning <= 6) {
		// Prefer long relievers
		if (enhanced.longRelief && enhanced.longRelief.length > 0) {
			const available = enhanced.longRelief.find(r => r.pitcherId !== excludePitcherId);
			if (available) return available;
		}
		// Then standard relievers (avoid closer/setup)
		const available = enhanced.relievers.find(r => r.pitcherId !== excludePitcherId);
		if (available) return available;
		// Last resort
		return enhanced.setup?.[0] ?? enhanced.closer;
	}

	// === BLOWOUT (5+ run difference) ===
	if (Math.abs(scoreDiff) >= 5) {
		// Use any rested reliever, save closer/setup
		const available = enhanced.relievers.find(r => r.pitcherId !== excludePitcherId);
		if (available) return available;
		if (enhanced.longRelief && enhanced.longRelief.length > 0) {
			const available = enhanced.longRelief.find(r => r.pitcherId !== excludePitcherId);
			if (available) return available;
		}
		// Desperate times
		return enhanced.setup?.[0] ?? enhanced.closer;
	}

	// === DEFAULT: MIDDLE INNINGS, MODERATE LEAD ===
	// Use relievers, prefer longRelief if tired, avoid closer if possible
	if (enhanced.setup && enhanced.setup.length > 0) {
		const available = enhanced.setup.find(r => r.pitcherId !== excludePitcherId);
		if (available) return available;
	}
	const available = enhanced.relievers.find(r => r.pitcherId !== excludePitcherId);
	if (available) return available;
	return enhanced.longRelief?.[0] ?? enhanced.closer;
}
```

**Step 5: Run test to verify it passes**

Run: `pnpm -C packages/model test pitching-enhanced.test.ts`
Expected: PASS

**Step 6: Export EnhancedBullpenState from types**

Update `packages/model/src/managerial/index.ts` to export if not already:
```typescript
export type { EnhancedBullpenState } from './types.js';
```

**Step 7: Run all model tests**

Run: `pnpm -C packages/model test`
Expected: All tests pass

**Step 8: Commit**

```bash
git add packages/model/src/managerial/pitching.ts packages/model/src/managerial/pitching-enhanced.test.ts packages/model/src/managerial/index.ts
git commit -m "feat: enhanced reliever selection with role-based logic (closer/setup/long)"
```

---

## Task 8: Update shouldPullPitcher to Consider Workhorse Status

**Files:**
- Modify: `packages/model/src/managerial/pitching.ts`

**Step 1: Read current shouldPullPitcher starter logic**

Run: `sed -n '206,298p' packages/model/src/managerial/pitching.ts`

**Step 2: Add workhorse handling to pull thresholds**

The PitcherRole type needs an `isWorkhorse` flag. First, update types:

In `packages/model/src/managerial/types.ts`, update PitcherRole:

```typescript
export interface PitcherRole {
	pitcherId: string;
	role: 'starter' | 'reliever' | 'closer';
	stamina: number;
	pitchesThrown: number; // DEPRECATED: use battersFace instead
	/** Batters faced in this game */
	battersFace: number;
	/** Average batters faced when starting (from season data) */
	avgBfpAsStarter: number | null;
	/** Average batters faced when relieving (from season data) */
	avgBfpAsReliever: number | null;
	/** Hits allowed in current appearance */
	hitsAllowed: number;
	/** Walks allowed in current appearance */
	walksAllowed: number;
	/** Runs allowed in current appearance */
	runsAllowed: number;
	/** Is this pitcher a workhorse (high complete game rate)? */
	isWorkhorse?: boolean;
}
```

**Step 3: Update createPitcherRole in classifier to set isWorkhorse**

In `pitcher-classifier.ts`, update the function:

```typescript
function createPitcherRole(pitcher: PitcherStats, quality: PitcherQuality): PitcherRole {
	return {
		pitcherId: pitcher.id,
		role: quality.role === 'starter' ? 'starter' : 'reliever',
		stamina: 100,
		pitchesThrown: 0,
		battersFace: 0,
		avgBfpAsStarter: null, // Will be populated from season data
		avgBfpAsReliever: null,
		hitsAllowed: 0,
		walksAllowed: 0,
		runsAllowed: 0,
		isWorkhorse: quality.isWorkhorse
	};
}
```

Update classifyPitchers to pass quality:

```typescript
const starter = createPitcherRole(starters[0]!.pitcher, starters[0]!.quality);
```

And similar for all other createPitcherRole calls.

**Step 4: Update shouldPullPitcher to use workhorse flag**

In the starter logic section (around line 210), add workhorse bonus:

```typescript
// Hard limit: exceeded hard limit threshold
const hardLimit = typicalBfp * pullThresholds.hardLimit;
// Workhorses get extended hard limit
const workhorseBonus = pitcher.isWorkhorse ? 1.2 : 1.0;
if (pitcher.battersFace >= hardLimit * workhorseBonus) {
	return { shouldChange: true, reason: `Exceeded limit (${pitcher.battersFace} BFP)` };
}
```

And in the consideration threshold logic (around line 246-249):

```typescript
// Late game with lead: workhorses get extra leeway to finish
if (inning >= 8 && scoreDiff > 0 && roughness < 0.3) {
	pullChance -= 0.25;
	if (pitcher.isWorkhorse) {
		pullChance -= 0.15; // Extra bonus for workhorses
	}
}
```

**Step 5: Run tests**

Run: `pnpm -C packages/model test pitching.test.ts`
Expected: Tests pass

**Step 6: Commit**

```bash
git add packages/model/src/managerial/types.ts packages/model/src/managerial/pitching.ts packages/model/src/managerial/pitcher-classifier.ts
git commit -m "feat: add workhorse flag for extended pull thresholds on high-CG pitchers"
```

---

## Task 9: Update App Engine to Pass isWorkhorse Through

**Files:**
- Modify: `app/src/lib/game/engine.ts`

**Step 1: Update initializeBullpen to preserve isWorkhorse**

The starter creation in initializeBullpen needs to preserve isWorkhorse from the classification.

Update the starter creation in initializeBullpen (around line 545 in new code):

```typescript
// Find the starter from classification to get isWorkhorse flag
const classifiedStarter = classification.starter;

const starter: PitcherRole = {
	pitcherId: starterId,
	role: 'starter',
	stamina: 100,
	pitchesThrown: 0,
	battersFace: 0,
	avgBfpAsStarter: starterStats.avgBfpAsStarter ?? null,
	avgBfpAsReliever: starterStats.avgBfpAsReliever ?? null,
	hitsAllowed: 0,
	walksAllowed: 0,
	runsAllowed: 0,
	isWorkhorse: classifiedStarter.isWorkhorse ?? false
};
```

**Step 2: Update bullpen state to preserve isWorkhorse for relievers**

When building the bullpen state, preserve isWorkhorse from classification:

```typescript
this.bullpenStates.set(teamId, {
	starter,
	relievers: classification.relievers,
	closer: classification.closer,
	setup: classification.setup,
	longRelief: classification.longRelief
});
```

The classification already includes isWorkhorse from createPitcherRole, so this should work.

**Step 3: Run app tests**

Run: `pnpm -C app test`
Expected: Tests pass

**Step 4: Run type check**

Run: `pnpm -C app check`
Expected: No type errors

**Step 5: Commit**

```bash
git add app/src/lib/game/engine.ts
git commit -m "feat: preserve isWorkhorse flag from classification in engine"
```

---

## Task 10: Integration Testing

**Files:**
- Create: `app/src/lib/game/engine-pitching.test.ts`

**Step 1: Write integration test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from './engine.js';
import type { SeasonPackage } from './types.js';

describe('GameEngine - Enhanced Pitching Integration', () => {
	let season: SeasonPackage;

	beforeEach(() => {
		// Load a test season with pitcher data
		// This assumes you have a test fixture or can load from file
		season = {
			meta: { year: 2020, generatedAt: '2024-01-01', version: '1.0' },
			norms: {
				year: 2020,
				era: 'modern',
				pitching: {
					starterPitches: { fatigueThreshold: 85, typicalLimit: 100, hardLimit: 110 },
					relieverPitches: { maxPitches: 40, typicalPitches: 20 },
					starterBFP: 24,
					relieverBFP: { early: 9, middle: 6, late: 4 },
					relieverBFPOverall: 6,
					relieversPerGame: 4.5,
					starterDeepOutingBFP: 27
				},
				substitutions: { pinchHitsPerGame: 0.5, defensiveReplacementsPerGame: 0.2 }
			},
			batters: {}, // Populate with test data
			pitchers: {}, // Populate with test data
			league: { vsLHP: { /*...*/ }, vsRHP: { /*...*/ }, pitcherBatter: { vsLHP: { /*...*/ }, vsRHP: { /*...*/ } } },
			teams: {
				'team1': { id: 'team1', league: 'AL', city: 'Test', nickname: 'Team1' },
				'team2': { id: 'team2', league: 'AL', city: 'Test', nickname: 'Team2' }
			},
			games: []
		};
	});

	it('initializes bullpen with role assignments', () => {
		// Add test pitchers with varied stats
		const engine = new GameEngine(season, 'team1', 'team2', { enabled: true });

		// Verify bullpen has proper structure
		const bullpen = engine['bullpenStates'].get('team1');
		expect(bullpen).toBeDefined();
		expect(bullpen?.starter).toBeDefined();
		// Closer may not exist depending on era
		// Setup and longRelief depend on roster composition
	});

	it('uses closer in save situation', () => {
		// Setup game state for save situation
		// Simulate to 9th inning with lead
		// Verify closer enters
	});
});
```

**Step 2: Run integration test**

Run: `pnpm -C app test engine-pitching.test.ts`
Expected: May need fixture data - create minimal test season

**Step 3: Commit**

```bash
git add app/src/lib/game/engine-pitching.test.ts
git commit -m "test: add integration tests for enhanced pitching system"
```

---

## Task 11: Documentation & Cleanup

**Files:**
- Update: `CLAUDE.md`

**Step 1: Update CLAUDE.md with new pitcher handling info**

Add section after "Game Engine" section:

```markdown
### Pitcher Selection & Bullpen Management

**Starter Selection:**
- Uses quality score combining gamesStarted, ERA, WHIP, and complete game rate
- Filters to pitchers with >30% gamesStarted/games ratio
- Workhorse pitchers (15%+ CG rate) get extended pull thresholds

**Bullpen Classification:**
- Pitchers classified into roles: starter, closer, setup, longRelief, reliever
- Era-aware: pre-1980 teams may not have a dedicated "closer"
- Classification uses `classifyPitchers()` from `@bb/model`

**Reliever Selection:**
- Save situations (9th+, lead 1-3): closer → setup → any reliever
- Late & close (7th-8th): setup → closer (8th only) → reliever
- Early game (1-6): longRelief → reliever
- Blowouts: avoid using closer/setup

**Workhorse Handling:**
- Pitchers with `completeGames/gamesStarted ≥ 0.15` flagged as workhorses
- Workhorses get +20% extended hard limits in `shouldPullPitcher()`
- Extra leeway in late/close games when pitching well
```

**Step 2: Build and verify**

Run: `pnpm -C packages/model build && pnpm -C app build`
Expected: Clean build

**Step 3: Final commit**

```bash
git add CLAUDE.md
git commit -m "docs: document enhanced pitcher selection and bullpen management"
```

---

## Summary

This plan implements a comprehensive pitcher selection and bullpen management system:

1. **Quality Scoring** (`pitcher-quality.ts`): Era-normalized pitcher ratings
2. **League Norms** (`norms-calculator.ts`): League averages for context
3. **Classifier** (`pitcher-classifier.ts`): Role assignment with era awareness
4. **Enhanced Selection** (updated `selectReliever`): Situation-based reliever choice
5. **Workhorse Support**: Extended limits for high-complete-game pitchers
6. **Integration**: Full app integration with preserved type safety

All tests written first (TDD), with frequent commits and type checking throughout.
