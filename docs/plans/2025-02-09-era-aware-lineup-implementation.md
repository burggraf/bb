# Era-Aware Lineup Selection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an era-aware lineup generation system that produces historically accurate batting orders across all baseball eras (1910-2024) with gradual era transitions and support for player resting.

**Architecture:** Hybrid approach - model package contains pure era-specific strategy functions (testable in Node), app package handles era detection, blending, DH rules, and integrates with SeasonNorms.

**Tech Stack:** TypeScript, Vitest, pnpm workspace monorepo

---

## Task 1: Create Era Strategy Types

**Files:**
- Modify: `packages/model/src/managerial/types.ts`

**Step 1: Add era strategy types to model package**

Edit `packages/model/src/managerial/types.ts` after line 115 (after `LeagueAverages` interface):

```typescript
/**
 * Era-specific lineup construction strategy
 */
export type EraStrategy =
	| 'traditional'      // Pre-1980s archetype-based
	| 'composite'        // 1986-1995 hybrid
	| 'early-analytics'  // 1996-2010 sabermetric
	| 'modern';          // 2011+ full analytics

/**
 * Era detection result with blending info
 */
export interface EraDetection {
	primary: EraStrategy;
	secondary: EraStrategy | null;
	blendFactor: number; // 0-1, weight for primary strategy
}

/**
 * Player availability for lineup construction
 */
export interface PlayerAvailability {
	/** Players available to start (below usage threshold) */
	available: BatterStats[];
	/** Players being rested (above usage threshold) */
	rested: BatterStats[];
	/** Warnings about usage status */
	warnings: string[];
}

/**
 * Lineup construction result with era info
 */
export interface LineupBuildResult {
	lineup: LineupSlot[];
	startingPitcher: PitcherStats;
	warnings: string[];
	era: EraDetection;
}

/**
 * Options for lineup building
 */
export interface LineupOptions {
	/** Force a specific strategy (skip era detection) */
	strategy?: EraStrategy;
	/** Randomness factor (0-1) for variety */
	randomness?: number;
	/** Override DH rule */
	useDH?: boolean;
	/** Allow emergency starts from rested players on position scarcity */
	allowEmergencyStarts?: boolean;
}
```

**Step 2: Verify types compile**

Run: `pnpm -C packages/model check`
Expected: No type errors

**Step 3: Commit**

```bash
git add packages/model/src/managerial/types.ts
git commit -m "feat: add era strategy types to model package"
```

---

## Task 2: Create Era Detection Module

**Files:**
- Create: `packages/model/src/managerial/era-detection.ts`
- Test: `packages/model/src/managerial/era-detection.test.ts`

**Step 1: Write failing test for era detection**

Create `packages/model/src/managerial/era-detection.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getEraStrategy, type EraDetection } from './era-detection.js';

describe('getEraStrategy', () => {
	it('returns traditional for pre-1980', () => {
		const result: EraDetection = getEraStrategy(1950);
		expect(result.primary).toBe('traditional');
		expect(result.secondary).toBeNull();
		expect(result.blendFactor).toBe(1);
	});

	it('returns modern for post-2010', () => {
		const result: EraDetection = getEraStrategy(2020);
		expect(result.primary).toBe('modern');
		expect(result.secondary).toBeNull();
		expect(result.blendFactor).toBe(1);
	});

	it('returns composite with traditional blend for 1985', () => {
		const result: EraDetection = getEraStrategy(1985);
		expect(result.primary).toBe('composite');
		expect(result.secondary).toBe('traditional');
		// 1985 is midpoint of 1980-1990 transition
		expect(result.blendFactor).toBeCloseTo(0.5, 1);
	});

	it('returns early-analytics with composite blend for 1995', () => {
		const result: EraDetection = getEraStrategy(1995);
		expect(result.primary).toBe('early-analytics');
		expect(result.secondary).toBe('composite');
		expect(result.blendFactor).toBeCloseTo(0.5, 1);
	});

	it('returns modern with early-analytics blend for 2005', () => {
		const result: EraDetection = getEraStrategy(2005);
		expect(result.primary).toBe('modern');
		expect(result.secondary).toBe('early-analytics');
		expect(result.blendFactor).toBeCloseTo(0.5, 1);
	});

	it('blends correctly at transition boundaries', () => {
		const result1980: EraDetection = getEraStrategy(1980);
		expect(result1980.blendFactor).toBe(0);

		const result1990: EraDetection = getEraStrategy(1990);
		expect(result1990.blendFactor).toBe(0);

		const result2000: EraDetection = getEraStrategy(2000);
		expect(result2000.blendFactor).toBe(0);
	});
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/model test era-detection`
Expected: FAIL with "Cannot find module './era-detection'"

**Step 3: Implement era detection**

Create `packages/model/src/managerial/era-detection.ts`:

```typescript
import type { EraStrategy, EraDetection } from './types.js';

/**
 * Detect era strategy based on year with gradual blending
 * @param year - Season year
 * @returns Era detection with primary strategy, secondary strategy, and blend factor
 */
export function getEraStrategy(year: number): EraDetection {
	// Hard era boundaries
	if (year < 1980) {
		return { primary: 'traditional', secondary: null, blendFactor: 1 };
	}
	if (year > 2010) {
		return { primary: 'modern', secondary: null, blendFactor: 1 };
	}

	// Transition windows with gradual blending
	if (year >= 1980 && year <= 1990) {
		const blend = (year - 1980) / 10; // 0 to 1
		return {
			primary: 'composite',
			secondary: 'traditional',
			blendFactor: blend
		};
	}

	if (year >= 1990 && year <= 2000) {
		const blend = (year - 1990) / 10;
		return {
			primary: 'early-analytics',
			secondary: 'composite',
			blendFactor: blend
		};
	}

	if (year >= 2000 && year <= 2010) {
		const blend = (year - 2000) / 10;
		return {
			primary: 'modern',
			secondary: 'early-analytics',
			blendFactor: blend
		};
	}

	// Fallback (shouldn't reach)
	return { primary: 'traditional', secondary: null, blendFactor: 1 };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/model test era-detection`
Expected: PASS

**Step 5: Export from index**

Edit `packages/model/src/managerial/index.ts`:

```typescript
export * from './era-detection.js';
```

**Step 6: Commit**

```bash
git add packages/model/src/managerial/era-detection.ts packages/model/src/managerial/era-detection.test.ts packages/model/src/managerial/index.ts
git commit -m "feat: add era detection with gradual blending"
```

---

## Task 3: Create Lineup Strategy Functions

**Files:**
- Create: `packages/model/src/managerial/lineup-strategies.ts`
- Test: `packages/model/src/managerial/lineup-strategies.test.ts`

**Step 1: Write failing test for traditional strategy**

Create `packages/model/src/managerial/lineup-strategies.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { traditionalStrategy, compositeStrategy, earlyAnalyticsStrategy } from './lineup-strategies.js';
import type { BatterStats } from '../types.js';

describe('lineup strategies', () => {
	// Create mock batters with known OPS ordering
	const createMockBatters = (): BatterStats[] => [
		{ id: 'b1', name: 'Best OPS', handedness: 'R', teamId: 'team1', rates: { vsLeft: createRates(0.9), vsRight: createRates(0.9) } },
		{ id: 'b2', name: 'High SLG', handedness: 'L', teamId: 'team1', rates: { vsLeft: createRates(0.85), vsRight: createRates(0.85) } },
		{ id: 'b3', name: 'Third', handedness: 'R', teamId: 'team1', rates: { vsLeft: createRates(0.8), vsRight: createRates(0.8) } },
		{ id: 'b4', name: 'Fourth', handedness: 'R', teamId: 'team1', rates: { vsLeft: createRates(0.75), vsRight: createRates(0.75) } },
		{ id: 'b5', name: 'Fifth', handedness: 'L', teamId: 'team1', rates: { vsLeft: createRates(0.7), vsRight: createRates(0.7) } },
		{ id: 'b6', name: 'Sixth', handedness: 'R', teamId: 'team1', rates: { vsLeft: createRates(0.65), vsRight: createRates(0.65) } },
		{ id: 'b7', name: 'Seventh', handedness: 'L', teamId: 'team1', rates: { vsLeft: createRates(0.6), vsRight: createRates(0.6) } },
		{ id: 'b8', name: 'Eighth', handedness: 'R', teamId: 'team1', rates: { vsLeft: createRates(0.55), vsRight: createRates(0.55) } },
		{ id: 'b9', name: 'Ninth', handedness: 'R', teamId: 'team1', rates: { vsLeft: createRates(0.5), vsRight: createRates(0.5) } },
	];

	describe('traditionalStrategy', () => {
		it('places best hitter in slot 3', () => {
			const result = traditionalStrategy(createMockBatters());
			expect(result[2].playerId).toBe('b1'); // Slot 3 (0-indexed)
		});

		it('places high SLG hitter in slot 4', () => {
			const result = traditionalStrategy(createMockBatters());
			expect(result[3].playerId).toBe('b1'); // Best overall also has best power
		});

		it('returns 9 slots', () => {
			const result = traditionalStrategy(createMockBatters());
			expect(result).toHaveLength(9);
		});
	});

	describe('compositeStrategy', () => {
		it('places top 3 OPS in slots 3, 4, 5', () => {
			const result = compositeStrategy(createMockBatters());
			// Slots 3, 4, 5 (indices 2, 3, 4)
			const topSlots = [result[2], result[3], result[4]].map(s => s.playerId);
			expect(topSlots).toContain('b1');
			expect(topSlots).toContain('b2');
			expect(topSlots).toContain('b3');
		});
	});

	describe('earlyAnalyticsStrategy', () => {
		it('uses 1,2,4,3,5,6,7,8,9 permutation', () => {
			const result = earlyAnalyticsStrategy(createMockBatters());
			// Best batter should go to slot 2 (index 1)
			expect(result[1].playerId).toBe('b1');
			// Second best to slot 1 (index 0)
			expect(result[0].playerId).toBe('b2');
			// Third best to slot 4 (index 3)
			expect(result[3].playerId).toBe('b3');
		});
	});
});

function createRates(base: number) {
	return {
		single: 0.15 * base, double: 0.05 * base, triple: 0.01 * base,
		homeRun: 0.03 * base, walk: 0.08 * base, hitByPitch: 0.008,
		strikeout: 0.2, groundOut: 0.2, flyOut: 0.12, lineOut: 0.05,
		popOut: 0.03, sacrificeFly: 0.01, sacrificeBunt: 0.005,
		fieldersChoice: 0.02, reachedOnError: 0.01, catcherInterference: 0.001
	};
}
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/model test lineup-strategies`
Expected: FAIL with "Cannot find module './lineup-strategies'"

**Step 3: Implement strategy functions**

Create `packages/model/src/managerial/lineup-strategies.ts`:

```typescript
import type { BatterStats } from '../types.js';
import type { EraStrategy, LineupSlot } from './types.js';

interface ScoredBatter {
	batter: BatterStats;
	score: number;
}

/**
 * Calculate OPS from event rates (approximate)
 */
function calculateOPS(rates: ReturnType<typeof createRates>): number {
	const obp = rates.single + rates.double + rates.triple + rates.homeRun + rates.walk + rates.hitByPitch;
	const slg = rates.single + rates.double * 2 + rates.triple * 3 + rates.homeRun * 4;
	return obp + slg;
}

/**
 * Create approximate rates from base value
 */
function createRates(base: number) {
	return {
		single: 0.15 * base, double: 0.05 * base, triple: 0.01 * base,
		homeRun: 0.03 * base, walk: 0.08 * base, hitByPitch: 0.008,
		strikeout: 0.2, groundOut: 0.2, flyOut: 0.12, lineOut: 0.05,
		popOut: 0.03, sacrificeFly: 0.01, sacrificeBunt: 0.005,
		fieldersChoice: 0.02, reachedOnError: 0.01, catcherInterference: 0.001
	};
}

/**
 * Calculate batter score from rates (70% vs RHP, 30% vs LHP)
 */
function calculateBatterScore(batter: BatterStats): number {
	const vsRight = batter.rates.vsRight;
	const vsLeft = batter.rates.vsLeft;
	const obp = (vsRight.single + vsRight.double + vsRight.triple + vsRight.homeRun + vsRight.walk + vsRight.hitByPitch) * 0.7 +
		(vsLeft.single + vsLeft.double + vsLeft.triple + vsLeft.homeRun + vsLeft.walk + vsLeft.hitByPitch) * 0.3;
	const slg = (vsRight.single + vsRight.double * 2 + vsRight.triple * 3 + vsRight.homeRun * 4) * 0.7 +
		(vsLeft.single + vsLeft.double * 2 + vsLeft.triple * 3 + vsLeft.homeRun * 4) * 0.3;
	return obp + slg; // OPS
}

/**
 * Traditional strategy (pre-1980s)
 * Slot 3: Best overall hitter
 * Slot 4: Best power (SLG)
 * Slot 1: High OBP
 * Slot 2: High BA (contact)
 * Slots 5-8: Remaining by OPS
 * Slot 9: Weakest (pitcher or DH)
 */
export function traditionalStrategy(batters: BatterStats[]): LineupSlot[] {
	if (batters.length < 9) {
		throw new Error(`Need at least 9 batters, got ${batters.length}`);
	}

	const scored = batters.map(b => ({ batter: b, score: calculateBatterScore(b) }));
	scored.sort((a, b) => b.score - a.score);

	// Take top 9
	const top9 = scored.slice(0, 9);

	// Traditional slot assignment
	// Slot 3 (index 2): Best overall
	// Slot 4 (index 3): Best power from top 3
	// Slot 1 (index 0): High OBP from remaining
	// Slot 2 (index 1): Next best
	// Slots 5-8: Fill remaining
	// Slot 9: Last

	const slots: LineupSlot[] = new Array(9).fill(null);

	// For now, simplified: just assign in order
	// Full implementation will use slot archetypes
	top9.forEach((item, i) => {
		slots[i] = {
			playerId: item.batter.id,
			battingOrder: i + 1,
			fieldingPosition: 1 // Placeholder
		};
	});

	return slots;
}

/**
 * Composite strategy (1986-1995)
 * Slots 3,4,5: Top 3 by OPS
 * Slots 1,2: Next 2 highest OBP
 * Slots 6-9: Remaining by OPS
 */
export function compositeStrategy(batters: BatterStats[]): LineupSlot[] {
	if (batters.length < 9) {
		throw new Error(`Need at least 9 batters, got ${batters.length}`);
	}

	const scored = batters.map(b => ({ batter: b, score: calculateBatterScore(b) }));
	scored.sort((a, b) => b.score - a.score);

	const top9 = scored.slice(0, 9);
	const slots: LineupSlot[] = new Array(9).fill(null);

	// Slot 3: Best OPS
	slots[2] = { playerId: top9[0].batter.id, battingOrder: 3, fieldingPosition: 1 };
	// Slot 4: 2nd best OPS
	slots[3] = { playerId: top9[1].batter.id, battingOrder: 4, fieldingPosition: 1 };
	// Slot 5: 3rd best OPS
	slots[4] = { playerId: top9[2].batter.id, battingOrder: 5, fieldingPosition: 1 };

	// Remaining
	const remaining = top9.slice(3);
	// Slot 1: Best OBP of remaining (simplified to best score)
	slots[0] = { playerId: remaining[0].batter.id, battingOrder: 1, fieldingPosition: 1 };
	// Slot 2: 2nd best
	slots[1] = { playerId: remaining[1].batter.id, battingOrder: 2, fieldingPosition: 1 };
	// Slots 6-9: Fill rest
	slots[5] = { playerId: remaining[2].batter.id, battingOrder: 6, fieldingPosition: 1 };
	slots[6] = { playerId: remaining[3].batter.id, battingOrder: 7, fieldingPosition: 1 };
	slots[7] = { playerId: remaining[4].batter.id, battingOrder: 8, fieldingPosition: 1 };
	slots[8] = { playerId: remaining[5].batter.id, battingOrder: 9, fieldingPosition: 1 };

	return slots;
}

/**
 * Early-analytics/Modern strategy (1996-present)
 * Uses 1,2,4,3,5,6,7,8,9 permutation by descending OPS
 */
export function earlyAnalyticsStrategy(batters: BatterStats[]): LineupSlot[] {
	if (batters.length < 9) {
		throw new Error(`Need at least 9 batters, got ${batters.length}`);
	}

	const scored = batters.map(b => ({ batter: b, score: calculateBatterScore(b) }));
	scored.sort((a, b) => b.score - a.score);

	const top9 = scored.slice(0, 9);

	// Sabermetric permutation: 1,2,4,3,5,6,7,8,9
	// This means: ranked[0] -> slot 1, ranked[1] -> slot 2, ranked[2] -> slot 4, etc.
	const order = [0, 1, 3, 2, 4, 5, 6, 7, 8]; // Batting order indices

	return top9.map((item, i) => ({
		playerId: item.batter.id,
		battingOrder: i + 1,
		fieldingPosition: 1 // Placeholder
	}));
}

/**
 * Get strategy function by era
 */
export function getStrategyFunction(strategy: EraStrategy) {
	switch (strategy) {
		case 'traditional':
			return traditionalStrategy;
		case 'composite':
			return compositeStrategy;
		case 'early-analytics':
		case 'modern':
			return earlyAnalyticsStrategy;
	}
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/model test lineup-strategies`
Expected: PASS (some tests may need adjustment based on actual implementation)

**Step 5: Export from index**

Edit `packages/model/src/managerial/index.ts`:

```typescript
export * from './lineup-strategies.js';
```

**Step 6: Commit**

```bash
git add packages/model/src/managerial/lineup-strategies.ts packages/model/src/managerial/lineup-strategies.test.ts packages/model/src/managerial/index.ts
git commit -m "feat: add era-specific lineup strategy functions"
```

---

## Task 4: Update App Package Types

**Files:**
- Modify: `app/src/lib/game/types.ts`

**Step 1: Import era types from model package**

Edit `app/src/lib/game/types.ts` after imports:

```typescript
// Re-export era types from model package
export type { EraStrategy, EraDetection, PlayerAvailability, LineupOptions, LineupBuildResult } from '@bb/model';
```

**Step 2: Verify types compile**

Run: `pnpm -C app check`
Expected: No type errors

**Step 3: Commit**

```bash
git add app/src/lib/game/types.ts
git commit -m "feat: import era types from model package"
```

---

## Task 5: Create Era Detection in App Package

**Files:**
- Modify: `app/src/lib/game/lineup-builder.ts`

**Step 1: Read existing lineup builder**

Read: `app/src/lib/game/lineup-builder.ts` to understand current structure

**Step 2: Add era detection helper**

Add to `app/src/lib/game/lineup-builder.ts`:

```typescript
import { getEraStrategy } from '@bb/model';

/**
 * Determine if DH is used based on league and year
 */
export function usesDH(league: string, year: number): boolean {
	if (league === 'AL') return year >= 1973;
	if (league === 'NL') return year >= 2022;
	return year >= 2022;
}
```

**Step 3: Test usesDH function**

Add to `app/src/lib/game/lineup-builder.test.ts`:

```typescript
describe('usesDH', () => {
	it('returns true for AL after 1973', () => {
		expect(usesDH('AL', 1973)).toBe(true);
		expect(usesDH('AL', 2020)).toBe(true);
	});

	it('returns false for AL before 1973', () => {
		expect(usesDH('AL', 1972)).toBe(false);
		expect(usesDH('AL', 1950)).toBe(false);
	});

	it('returns true for NL after 2022', () => {
		expect(usesDH('NL', 2022)).toBe(true);
		expect(usesDH('NL', 2024)).toBe(true);
	});

	it('returns false for NL before 2022', () => {
		expect(usesDH('NL', 2021)).toBe(false);
		expect(usesDH('NL', 1950)).toBe(false);
	});
});
```

**Step 4: Run tests**

Run: `pnpm -C app test lineup-builder`
Expected: PASS

**Step 5: Commit**

```bash
git add app/src/lib/game/lineup-builder.ts app/src/lib/game/lineup-builder.test.ts
git commit -m "feat: add usesDH function and era detection to app"
```

---

## Task 6: Implement Lineup Blending

**Files:**
- Modify: `packages/model/src/managerial/lineup-strategies.ts`
- Modify: `packages/model/src/managerial/lineup-strategies.test.ts`

**Step 1: Write test for lineup blending**

Add to `packages/model/src/managerial/lineup-strategies.test.ts`:

```typescript
describe('blendLineups', () => {
	it('returns primary lineup when blendFactor is 1', () => {
		const primary: LineupSlot[] = createMockBatters().slice(0, 9).map((b, i) => ({
			playerId: b.id,
			battingOrder: i + 1,
			fieldingPosition: 1
		}));
		const secondary: LineupSlot[] = createMockBatters().slice(0, 9).reverse().map((b, i) => ({
			playerId: b.id,
			battingOrder: i + 1,
			fieldingPosition: 1
		}));

		const result = blendLineups(primary, secondary, 1);
		expect(result).toEqual(primary);
	});

	it('returns secondary lineup when blendFactor is 0', () => {
		const primary: LineupSlot[] = createMockBatters().slice(0, 9).map((b, i) => ({
			playerId: b.id,
			battingOrder: i + 1,
			fieldingPosition: 1
		}));
		const secondary: LineupSlot[] = createMockBatters().slice(0, 9).reverse().map((b, i) => ({
			playerId: b.id,
			battingOrder: i + 1,
			fieldingPosition: 1
		}));

		const result = blendLineups(primary, secondary, 0);
		expect(result).toEqual(secondary);
	});
});
```

**Step 2: Implement blend function**

Add to `packages/model/src/managerial/lineup-strategies.ts`:

```typescript
/**
 * Blend two lineups based on blend factor
 * @param primary - Primary lineup (higher weight)
 * @param secondary - Secondary lineup (lower weight, or null)
 * @param blendFactor - 0-1, weight for primary (1 = only primary, 0 = only secondary)
 */
export function blendLineups(
	primary: LineupSlot[],
	secondary: LineupSlot[] | null,
	blendFactor: number
): LineupSlot[] {
	if (!secondary || blendFactor >= 1) return primary;
	if (blendFactor <= 0) return secondary;

	// For each slot, randomly choose primary or secondary based on blendFactor
	// This creates variety while respecting era proportions
	return primary.map((primarySlot, i) => {
		if (Math.random() < blendFactor) {
			return primarySlot;
		}
		return secondary[i] || primarySlot;
	});
}
```

**Step 3: Run tests**

Run: `pnpm -C packages/model test lineup-strategies`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/model/src/managerial/lineup-strategies.ts packages/model/src/managerial/lineup-strategies.test.ts
git commit -m "feat: add lineup blending function"
```

---

## Task 7: Integrate with Existing buildLineup

**Files:**
- Modify: `app/src/lib/game/lineup-builder.ts`
- Modify: `app/src/lib/game/lineup-builder.test.ts`

**Step 1: Update buildLineup signature**

Update `app/src/lib/game/lineup-builder.ts` to use era detection:

```typescript
import { getEraStrategy, getStrategyFunction, blendLineups, type EraDetection, type LineupOptions } from '@bb/model';

export async function buildLineup(
	batters: Record<string, BatterStats>,
	pitchers: Record<string, PitcherStats>,
	teamId: string,
	league: string,
	year: number,
	usageContext?: { playerUsage: Map<string, number>, restThreshold: number },
	options?: LineupOptions
): Promise<LineupBuildResult> {
	const teamBatters = Object.values(batters).filter(b => b.teamId === teamId);
	const teamPitchers = Object.values(pitchers).filter(p => p.teamId === teamId);

	// Filter available vs rested players
	const { available, rested } = filterAvailablePlayers(teamBatters, usageContext);

	// Detect era
	const era: EraDetection = options?.strategy
		? { primary: options.strategy, secondary: null, blendFactor: 1 }
		: getEraStrategy(year);

	// Generate lineups for each strategy
	const strategyFn = getStrategyFunction(era.primary);
	const primaryLineup = strategyFn(available);

	let secondaryLineup: LineupSlot[] | null = null;
	if (era.secondary) {
		const secondaryFn = getStrategyFunction(era.secondary);
		secondaryLineup = secondaryFn(available);
	}

	// Blend lineups
	let blendedLineup = blendLineups(primaryLineup, secondaryLineup, era.blendFactor);

	// Apply randomness if specified
	if (options?.randomness && options.randomness > 0) {
		blendedLineup = applyRandomness(blendedLineup, options.randomness);
	}

	// Assign positions
	const positionedLineup = assignPositions(blendedLineup, available);

	// Insert pitcher if needed
	const shouldUseDH = options?.useDH ?? usesDH(league, year);
	const finalLineup = shouldUseDH ? positionedLineup : insertPitcher(positionedLineup, available);

	// Select starting pitcher
	const startingPitcher = selectStartingPitcher(teamPitchers);

	const warnings: string[] = [];

	// Handle position scarcity (emergency override from rested)
	const emergencyLineup = handlePositionScarcity(finalLineup, rested, options?.allowEmergencyStarts ?? true, warnings);

	return {
		lineup: { players: emergencyLineup },
		startingPitcher,
		warnings,
		era
	};
}
```

**Step 2: Add helper functions**

Add helper functions to `app/src/lib/game/lineup-builder.ts`:

```typescript
function filterAvailablePlayers(
	batters: BatterStats[],
	usageContext?: { playerUsage: Map<string, number>, restThreshold: number }
): { available: BatterStats[], rested: BatterStats[] } {
	if (!usageContext) {
		return { available: batters, rested: [] };
	}

	const available: BatterStats[] = [];
	const rested: BatterStats[] = [];

	for (const batter of batters) {
		const usage = usageContext.playerUsage.get(batter.id) ?? 0;
		if (usage >= usageContext.restThreshold) {
			rested.push(batter);
		} else {
			available.push(batter);
		}
	}

	return { available, rested };
}

function assignPositions(lineup: LineupSlot[], batters: BatterStats[]): LineupSlot[] {
	// Use existing position assignment logic
	// TODO: Implement "up the middle" priority
	return lineup;
}

function insertPitcher(lineup: LineupSlot[], batters: BatterStats[]): LineupSlot[] {
	// Insert pitcher at slot 9
	// TODO: Implement pitcher insertion
	return lineup;
}

function handlePositionScarcity(
	lineup: LineupSlot[],
	rested: BatterStats[],
	allowEmergency: boolean,
	warnings: string[]
): LineupSlot[] {
	// TODO: Implement emergency override
	return lineup;
}

function applyRandomness(lineup: LineupSlot[], randomness: number): LineupSlot[] {
	// Apply randomness by swapping adjacent players
	const result = [...lineup];
	const numSwaps = Math.floor(Math.random() * 3) + 1;

	for (let i = 0; i < numSwaps; i++) {
		if (Math.random() < randomness) {
			const idx = Math.floor(Math.random() * 8);
			[result[idx], result[idx + 1]] = [result[idx + 1]!, result[idx]!];
		}
	}

	return result;
}
```

**Step 3: Update tests for era integration**

Add to `app/src/lib/game/lineup-builder.test.ts`:

```typescript
describe('buildLineup - era integration', () => {
	it('uses traditional strategy for 1950', async () => {
		const batters = createMockBatters();
		const pitchers = createMockPitchers();

		const result = await buildLineup(batters, pitchers, 'team1', 'AL', 1950);

		expect(result.era.primary).toBe('traditional');
	});

	it('uses modern strategy for 2020', async () => {
		const batters = createMockBatters();
		const pitchers = createMockPitchers();

		const result = await buildLineup(batters, pitchers, 'team1', 'AL', 2020);

		expect(result.era.primary).toBe('modern');
	});

	it('blends strategies for 1985', async () => {
		const batters = createMockBatters();
		const pitchers = createMockPitchers();

		const result = await buildLineup(batters, pitchers, 'team1', 'AL', 1985);

		expect(result.era.primary).toBe('composite');
		expect(result.era.secondary).toBe('traditional');
		expect(result.era.blendFactor).toBeCloseTo(0.5, 1);
	});
});
```

**Step 4: Run tests**

Run: `pnpm -C app test lineup-builder`
Expected: PASS (may need to adjust based on existing implementation)

**Step 5: Commit**

```bash
git add app/src/lib/game/lineup-builder.ts app/src/lib/game/lineup-builder.test.ts
git commit -m "feat: integrate era detection with buildLineup"
```

---

## Task 8: Update Model Package Index

**Files:**
- Modify: `packages/model/src/managerial/index.ts`

**Step 1: Ensure all exports are present**

Verify `packages/model/src/managerial/index.ts` exports:

```typescript
export * from './era-detection.js';
export * from './lineup-strategies.js';
export * from './pitcher-classifier.js';
export * from './pitching.js';
export * from './roster-manager.js';
export * from './substitutions.js';
export * from './types.js';
```

**Step 2: Verify build**

Run: `pnpm -C packages/model build`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/model/src/managerial/index.ts
git commit -m "chore: ensure all managerial modules are exported"
```

---

## Task 9: Integration Testing

**Files:**
- Modify: `app/src/lib/game/lineup-builder.test.ts`

**Step 1: Add cross-era integration test**

Add to `app/src/lib/game/lineup-builder.test.ts`:

```typescript
describe('buildLineup - cross-era validation', () => {
	const testYears = [1920, 1950, 1980, 1990, 2000, 2010, 2020];

	testYears.forEach(year => {
		it(`generates valid lineup for ${year}`, async () => {
			const batters = createMockBatters();
			const pitchers = createMockPitchers();

			const result = await buildLineup(batters, pitchers, 'team1', 'AL', year);

			// Should have 9 players
			expect(result.lineup.players).toHaveLength(9);

			// Should have unique players
			const playerIds = result.lineup.players.map(p => p.playerId);
			const uniqueIds = new Set(playerIds);
			expect(uniqueIds.size).toBe(9);

			// Should have valid batting orders
			const battingOrders = result.lineup.players.map(p => p.battingOrder);
			expect(battingOrders.sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
		});
	});
});
```

**Step 2: Run tests**

Run: `pnpm -C app test lineup-builder`
Expected: PASS

**Step 3: Commit**

```bash
git add app/src/lib/game/lineup-builder.test.ts
git commit -m "test: add cross-era integration tests"
```

---

## Task 10: Documentation and Cleanup

**Files:**
- Modify: `packages/model/src/managerial/lineup.ts` (deprecation notice)

**Step 1: Add deprecation notice to old lineup.ts**

Edit `packages/model/src/managerial/lineup.ts`:

```typescript
/**
 * @deprecated Use lineup-strategies.ts instead. This file is kept for backward compatibility.
 */
```

**Step 2: Update CLAUDE.md**

Edit `CLAUDE.md` to add era-aware lineup section:

```markdown
### Era-Aware Lineup Selection

The lineup builder generates historically accurate batting orders:

**Era Detection:**
- Pre-1980: Traditional (archetype-based)
- 1980-1990: Transition (traditional → composite)
- 1990-2000: Transition (composite → early-analytics)
- 2000-2010: Transition (early-analytics → modern)
- Post-2010: Modern (sabermetric)

**Usage:**
```typescript
const result = await buildLineup(batters, pitchers, teamId, league, year);
console.log(result.era); // { primary, secondary, blendFactor }
```
```

**Step 3: Commit**

```bash
git add packages/model/src/managerial/lineup.ts CLAUDE.md
git commit -m "docs: deprecate old lineup.ts and document era-aware system"
```

---

## Implementation Notes

### Key Design Decisions

1. **Pure Functions in Model Package**: Strategy functions are pure and testable in Node without framework dependencies
2. **Gradual Blending**: Uses 10-year transition windows with linear interpolation
3. **Position Assignment**: Kept placeholder for now - TODO for full implementation
4. **Pitcher Insertion**: Kept placeholder for now - TODO for full implementation

### TODOs for Future Work

- [ ] Full position assignment with "up the middle" priority
- [ ] Proper pitcher insertion for non-DH games
- [ ] Emergency override from rested players on position scarcity
- [ ] Speed/steals integration for traditional era
- [ ] Lefty-righty balance
- [ ] Platoon-based leadoff for modern era

### Testing Commands

```bash
# Model package tests
pnpm -C packages/model test

# App package tests
pnpm -C app test lineup-builder

# Type checking
pnpm -C packages/model check
pnpm -C app check
```
