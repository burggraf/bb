/**
 * Tests for lineup-validator
 */

import { describe, it, expect } from 'vitest';
import { validateLineup, type LineupValidationResult } from './lineup-validator.js';
import type { BatterStats } from './types.js';

// Mock batter data for testing
function createMockBatter(
	id: string,
	name: string,
	primaryPosition: number,
	positionEligibility: Record<number, number>
): BatterStats {
	return {
		id,
		name,
		bats: 'R',
		teamId: 'team1',
		primaryPosition,
		positionEligibility,
		pa: 500,
		avg: 0.270,
		obp: 0.340,
		slg: 0.430,
		ops: 0.770,
		rates: {
			vsLHP: {
				single: 0.1,
				double: 0.05,
				triple: 0.01,
				homeRun: 0.03,
				walk: 0.08,
				hitByPitch: 0.01,
				strikeout: 0.2,
				groundOut: 0.2,
				flyOut: 0.15,
				lineOut: 0.05,
				popOut: 0.05,
				sacrificeFly: 0.01,
				sacrificeBunt: 0.005,
				fieldersChoice: 0.02,
				reachedOnError: 0.01,
				catcherInterference: 0
			},
			vsRHP: {
				single: 0.12,
				double: 0.05,
				triple: 0.01,
				homeRun: 0.04,
				walk: 0.07,
				hitByPitch: 0.01,
				strikeout: 0.18,
				groundOut: 0.18,
				flyOut: 0.14,
				lineOut: 0.05,
				popOut: 0.04,
				sacrificeFly: 0.01,
				sacrificeBunt: 0.005,
				fieldersChoice: 0.02,
				reachedOnError: 0.01,
				catcherInterference: 0
			}
		}
	};
}

describe('validateLineup', () => {
	const batters: Record<string, BatterStats> = {
		// A catcher who can also play 1B
		catcher1: createMockBatter('catcher1', 'Joe Catcher', 2, { 2: 500, 3: 50 }),
		// A first baseman who can also play OF
		firstbase1: createMockBatter('firstbase1', 'First Baseman', 3, { 3: 800, 7: 100, 9: 50 }),
		// A shortstop who only plays SS
		shortstop1: createMockBatter('shortstop1', 'Short Stop', 6, { 6: 1000 }),
		// A pitcher
		pitcher1: createMockBatter('pitcher1', 'Pitcher', 1, { 1: 2000 }),
		// A center fielder
		cf1: createMockBatter('cf1', 'Center Field', 8, { 8: 600 }),
		// A second baseman
		sb1: createMockBatter('sb1', 'Second Base', 4, { 4: 700 }),
		// A third baseman
		tb1: createMockBatter('tb1', 'Third Base', 5, { 5: 650 }),
		// A left fielder
		lf1: createMockBatter('lf1', 'Left Field', 7, { 7: 550 }),
		// A right fielder
		rf1: createMockBatter('rf1', 'Right Field', 9, { 9: 580 })
	};

	it('should validate a correct lineup', () => {
		const lineup = [
			{ playerId: 'pitcher1', position: 1 },
			{ playerId: 'catcher1', position: 2 },
			{ playerId: 'firstbase1', position: 3 },
			{ playerId: 'sb1', position: 4 },
			{ playerId: 'tb1', position: 5 },
			{ playerId: 'shortstop1', position: 6 },
			{ playerId: 'lf1', position: 7 },
			{ playerId: 'cf1', position: 8 },
			{ playerId: 'rf1', position: 9 }
		];

		const result = validateLineup(lineup, batters);

		expect(result.isValid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it('should detect null player IDs', () => {
		const lineup = [
			{ playerId: 'pitcher1', position: 1 },
			{ playerId: null, position: 2 }, // Missing catcher
			{ playerId: 'firstbase1', position: 3 },
			{ playerId: 'sb1', position: 4 },
			{ playerId: 'tb1', position: 5 },
			{ playerId: 'shortstop1', position: 6 },
			{ playerId: 'lf1', position: 7 },
			{ playerId: 'cf1', position: 8 },
			{ playerId: 'rf1', position: 9 }
		];

		const result = validateLineup(lineup, batters);

		expect(result.isValid).toBe(false);
		expect(result.errors.some(e => e.includes('Position 2'))).toBe(true);
	});

	it('should detect duplicate players', () => {
		const lineup = [
			{ playerId: 'pitcher1', position: 1 },
			{ playerId: 'catcher1', position: 2 },
			{ playerId: 'firstbase1', position: 3 },
			{ playerId: 'firstbase1', position: 4 }, // Duplicate!
			{ playerId: 'tb1', position: 5 },
			{ playerId: 'shortstop1', position: 6 },
			{ playerId: 'lf1', position: 7 },
			{ playerId: 'cf1', position: 8 },
			{ playerId: 'rf1', position: 9 }
		];

		const result = validateLineup(lineup, batters);

		expect(result.isValid).toBe(false);
		expect(result.errors.some(e => e.includes('multiple times'))).toBe(true);
	});

	it('should detect ineligible position assignments', () => {
		const lineup = [
			{ playerId: 'pitcher1', position: 1 },
			{ playerId: 'catcher1', position: 2 },
			{ playerId: 'shortstop1', position: 3 }, // SS at 1B - not eligible
			{ playerId: 'sb1', position: 4 },
			{ playerId: 'tb1', position: 5 },
			{ playerId: 'shortstop1', position: 6 },
			{ playerId: 'lf1', position: 7 },
			{ playerId: 'cf1', position: 8 },
			{ playerId: 'rf1', position: 9 }
		];

		const result = validateLineup(lineup, batters);

		expect(result.isValid).toBe(false);
		expect(result.errors.some(e => e.includes('only eligible'))).toBe(true);
	});

	it('should require position 1 to be a pitcher', () => {
		const lineup = [
			{ playerId: 'catcher1', position: 1 }, // Catcher at P - not allowed
			{ playerId: 'pitcher1', position: 2 },
			{ playerId: 'firstbase1', position: 3 },
			{ playerId: 'sb1', position: 4 },
			{ playerId: 'tb1', position: 5 },
			{ playerId: 'shortstop1', position: 6 },
			{ playerId: 'lf1', position: 7 },
			{ playerId: 'cf1', position: 8 },
			{ playerId: 'rf1', position: 9 }
		];

		const result = validateLineup(lineup, batters);

		expect(result.isValid).toBe(false);
		expect(result.errors.some(e => e.includes('Position 1') && e.includes('must be a pitcher'))).toBe(true);
	});

	it('should allow catcher playing first base (multi-position eligibility)', () => {
		const lineup = [
			{ playerId: 'pitcher1', position: 1 },
			{ playerId: 'shortstop1', position: 2 }, // Some other player at C (not ideal but valid if eligible)
			{ playerId: 'catcher1', position: 3 }, // Catcher at 1B - eligible per positionEligibility
			{ playerId: 'sb1', position: 4 },
			{ playerId: 'tb1', position: 5 },
			{ playerId: 'shortstop1', position: 6 },
			{ playerId: 'lf1', position: 7 },
			{ playerId: 'cf1', position: 8 },
			{ playerId: 'rf1', position: 9 }
		];

		const result = validateLineup(lineup, batters);

		// Note: shortstop1 at position 2 would fail since SS isn't eligible at C
		// This test demonstrates that catcher1 at 1B is valid
		expect(result.errors.some(e => e.includes('catcher1') && e.includes('only eligible'))).toBe(false);
	});

	it('should warn when players play away from primary position', () => {
		const lineup = [
			{ playerId: 'pitcher1', position: 1 },
			{ playerId: 'catcher1', position: 3 }, // Catcher at 1B
			{ playerId: 'firstbase1', position: 2 },
			{ playerId: 'sb1', position: 4 },
			{ playerId: 'tb1', position: 5 },
			{ playerId: 'shortstop1', position: 6 },
			{ playerId: 'lf1', position: 7 },
			{ playerId: 'cf1', position: 8 },
			{ playerId: 'rf1', position: 9 }
		];

		const result = validateLineup(lineup, batters);

		// Should have warnings about players away from primary position
		expect(result.warnings.some(w => w.includes('Joe Catcher') && w.includes('1B'))).toBe(true);
	});

	it('should use primary position as fallback when no explicit eligibility', () => {
		// Create a player with no position eligibility data
		const unknownPlayer = createMockBatter('unknown1', 'Unknown', 6, {}); // Primary SS but no eligibility data

		const battersWithUnknown = { ...batters, unknown1: unknownPlayer };

		const lineup = [
			{ playerId: 'pitcher1', position: 1 },
			{ playerId: 'catcher1', position: 2 },
			{ playerId: 'firstbase1', position: 3 },
			{ playerId: 'sb1', position: 4 },
			{ playerId: 'tb1', position: 5 },
			{ playerId: 'unknown1', position: 6 }, // At primary position
			{ playerId: 'lf1', position: 7 },
			{ playerId: 'cf1', position: 8 },
			{ playerId: 'rf1', position: 9 }
		];

		const result = validateLineup(lineup, battersWithUnknown);

		// Should be valid since primary position is used as fallback
		expect(result.isValid).toBe(true);
	});

	it('should reject players with no eligibility at assigned position', () => {
		const unknownPlayer = createMockBatter('unknown1', 'Unknown', 6, {}); // Primary SS but no eligibility data

		const battersWithUnknown = { ...batters, unknown1: unknownPlayer };

		const lineup = [
			{ playerId: 'pitcher1', position: 1 },
			{ playerId: 'unknown1', position: 3 }, // At 1B but not eligible
			{ playerId: 'firstbase1', position: 2 },
			{ playerId: 'sb1', position: 4 },
			{ playerId: 'tb1', position: 5 },
			{ playerId: 'shortstop1', position: 6 },
			{ playerId: 'lf1', position: 7 },
			{ playerId: 'cf1', position: 8 },
			{ playerId: 'rf1', position: 9 }
		];

		const result = validateLineup(lineup, battersWithUnknown);

		expect(result.isValid).toBe(false);
		expect(result.errors.some(e => e.includes('Unknown') && e.includes('only eligible'))).toBe(true);
	});
});
