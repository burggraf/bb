/**
 * Tests for RosterManager - Rotation building, starter selection, and batter rest decisions
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RosterManager } from './roster-manager.js';
import type { RotationSlot, RestDecision } from './roster-manager.js';
import type { ExtendedPitcherStats } from '../types.js';
import type { BatterStats } from '../types.js';

// Helper to create mock pitcher stats
const createPitcher = (
	id: string,
	games: number,
	gamesStarted: number,
	era: number,
	whip: number,
	completeGames = 0
): ExtendedPitcherStats => ({
	id,
	name: `Pitcher ${id}`,
	handedness: 'R',
	throws: 'R',
	teamId: 'team1',
	games,
	gamesStarted,
	completeGames,
	saves: 0,
	inningsPitched: gamesStarted * 7, // Approximate
	whip,
	era,
	avgBfpAsStarter: gamesStarted > 0 ? 27 : null,
	avgBfpAsReliever: null,
	rates: {
		vsLeft: {
			single: 0.18,
			double: 0.05,
			triple: 0.01,
			homeRun: 0.02,
			walk: 0.07,
			hitByPitch: 0.01,
			strikeout: 0.25,
			groundOut: 0.2,
			flyOut: 0.15,
			lineOut: 0.04,
			popOut: 0.02,
			sacrificeFly: 0,
			sacrificeBunt: 0,
			fieldersChoice: 0,
			reachedOnError: 0,
			catcherInterference: 0
		},
		vsRight: {
			single: 0.18,
			double: 0.05,
			triple: 0.01,
			homeRun: 0.02,
			walk: 0.07,
			hitByPitch: 0.01,
			strikeout: 0.25,
			groundOut: 0.2,
			flyOut: 0.15,
			lineOut: 0.04,
			popOut: 0.02,
			sacrificeFly: 0,
			sacrificeBunt: 0,
			fieldersChoice: 0,
			reachedOnError: 0,
			catcherInterference: 0
		}
	}
});

// Helper to create mock batter stats
const createBatter = (
	id: string,
	obp: number
): BatterStats => ({
	id,
	name: `Batter ${id}`,
	handedness: 'R',
	rates: {
		vsLeft: {
			single: obp * 0.5,
			double: obp * 0.15,
			triple: obp * 0.02,
			homeRun: obp * 0.08,
			walk: obp * 0.25,
			hitByPitch: 0.008,
			strikeout: 0.2,
			groundOut: 0.18,
			flyOut: 0.11,
			lineOut: 0.04,
			popOut: 0.03,
			sacrificeFly: 0.01,
			sacrificeBunt: 0.005,
			fieldersChoice: 0.015,
			reachedOnError: 0.01,
			catcherInterference: 0.001
		},
		vsRight: {
			single: obp * 0.5,
			double: obp * 0.15,
			triple: obp * 0.02,
			homeRun: obp * 0.08,
			walk: obp * 0.25,
			hitByPitch: 0.008,
			strikeout: 0.2,
			groundOut: 0.18,
			flyOut: 0.11,
			lineOut: 0.04,
			popOut: 0.03,
			sacrificeFly: 0.01,
			sacrificeBunt: 0.005,
			fieldersChoice: 0.015,
			reachedOnError: 0.01,
			catcherInterference: 0.001
		}
	}
});

// Mock UsageTracker interface (minimal implementation for testing)
interface MockUsageRecord {
	playerId: string;
	actualSeasonTotal: number;
	replayCurrentTotal: number;
	percentageOfActual: number;
	status: 'under' | 'inRange' | 'over';
}

class MockUsageTracker {
	private records = new Map<string, MockUsageRecord>();

	setUsage(record: MockUsageRecord): void {
		this.records.set(record.playerId, record);
	}

	getUsage(playerId: string): MockUsageRecord | null {
		return this.records.get(playerId) ?? null;
	}

	// Type assertion to match UsageContext interface
	asUsageContext(): UsageContext {
		return {
			getUsage: (playerId: string) => this.getUsage(playerId)
		};
	}
}

describe('RosterManager', () => {
	let rosterManager: RosterManager;
	let mockUsageTracker: MockUsageTracker;

	beforeEach(() => {
		mockUsageTracker = new MockUsageTracker();
		rosterManager = new RosterManager(mockUsageTracker.asUsageContext());
	});

	describe('buildRotations', () => {
		it('filters pitchers with gamesStarted/games >= 0.3', () => {
			const pitchers: Record<string, ExtendedPitcherStats> = {
				p1: createPitcher('p1', 30, 30, 3.00, 1.10), // 100% GS
				p2: createPitcher('p2', 30, 15, 3.50, 1.20), // 50% GS
				p3: createPitcher('p3', 30, 8, 4.00, 1.30), // 27% GS - below 30%
				p4: createPitcher('p4', 20, 6, 3.20, 1.15) // 30% GS - exactly at threshold
			};

			rosterManager.buildRotations(pitchers, { team1: { name: 'Team 1' } });

			const rotation = rosterManager.getRotation('team1');
			expect(rotation).toBeDefined();
			expect(rotation?.length).toBe(3); // p1, p2, p4 only
			expect(rotation?.map((p) => p.pitcherId)).not.toContain('p3');
		});

		it('sorts rotation by quality score (highest first)', () => {
			const pitchers: Record<string, ExtendedPitcherStats> = {
				p1: createPitcher('p1', 30, 30, 2.50, 0.95), // Best
				p2: createPitcher('p2', 30, 30, 3.50, 1.20),
				p3: createPitcher('p3', 30, 30, 4.50, 1.50), // Worst
				p4: createPitcher('p4', 30, 30, 3.00, 1.10)
			};

			rosterManager.buildRotations(pitchers, { team1: { name: 'Team 1' } });

			const rotation = rosterManager.getRotation('team1');
			expect(rotation?.[0]?.pitcherId).toBe('p1'); // Best quality first
			expect(rotation?.[3]?.pitcherId).toBe('p3'); // Worst last
		});

		it('creates 5-man rotation when 5+ qualified starters', () => {
			const pitchers: Record<string, ExtendedPitcherStats> = {};
			for (let i = 1; i <= 7; i++) {
				pitchers[`p${i}`] = createPitcher(`p${i}`, 30, 30, 3.0 + i * 0.1, 1.2);
			}

			rosterManager.buildRotations(pitchers, { team1: { name: 'Team 1' } });

			const rotation = rosterManager.getRotation('team1');
			expect(rotation?.length).toBe(5); // Max 5
		});

		it('creates 4-man rotation when only 4 qualified starters', () => {
			const pitchers: Record<string, ExtendedPitcherStats> = {
				p1: createPitcher('p1', 30, 30, 3.00, 1.10),
				p2: createPitcher('p2', 30, 30, 3.20, 1.15),
				p3: createPitcher('p3', 30, 30, 3.40, 1.20),
				p4: createPitcher('p4', 30, 30, 3.60, 1.25)
			};

			rosterManager.buildRotations(pitchers, { team1: { name: 'Team 1' } });

			const rotation = rosterManager.getRotation('team1');
			expect(rotation?.length).toBe(4);
		});

		it('creates 3-man rotation for deadball era teams', () => {
			const pitchers: Record<string, ExtendedPitcherStats> = {
				p1: createPitcher('p1', 40, 40, 2.50, 1.00),
				p2: createPitcher('p2', 40, 40, 2.80, 1.10),
				p3: createPitcher('p3', 40, 40, 3.00, 1.20)
			};

			rosterManager.buildRotations(pitchers, { team1: { name: 'Team 1' } });

			const rotation = rosterManager.getRotation('team1');
			expect(rotation?.length).toBe(3);
		});

		it('calculates quality score using correct formula', () => {
			// Quality formula: gamesStarted * 2 + (5/era) + (2/whip) + (cgRate * 10)
			const pitchers: Record<string, ExtendedPitcherStats> = {
				// p1: 30 * 2 + (5/2.5) + (2/1.0) + (0/30 * 10) = 60 + 2 + 2 + 0 = 64
				p1: createPitcher('p1', 30, 30, 2.5, 1.0, 0),
				// p2: 20 * 2 + (5/3.5) + (2/1.3) + (5/20 * 10) = 40 + 1.43 + 1.54 + 2.5 = 45.47
				p2: createPitcher('p2', 20, 20, 3.5, 1.3, 5)
			};

			rosterManager.buildRotations(pitchers, { team1: { name: 'Team 1' } });

			const rotation = rosterManager.getRotation('team1');
			expect(rotation?.[0]?.pitcherId).toBe('p1'); // Higher score
			expect(rotation?.[0]?.qualityScore).toBeCloseTo(64, 1);
			expect(rotation?.[1]?.qualityScore).toBeCloseTo(45.47, 1);
		});
	});

	describe('selectStartingPitcher', () => {
		beforeEach(() => {
			const pitchers: Record<string, ExtendedPitcherStats> = {
				p1: createPitcher('p1', 30, 30, 2.50, 0.95),
				p2: createPitcher('p2', 30, 30, 3.00, 1.10),
				p3: createPitcher('p3', 30, 30, 3.20, 1.15),
				p4: createPitcher('p4', 30, 30, 3.40, 1.20),
				p5: createPitcher('p5', 30, 30, 3.60, 1.25)
			};

			rosterManager.buildRotations(pitchers, { team1: { name: 'Team 1' } });
		});

		it('cycles through rotation in fixed order', () => {
			// First call should return p1 (index 0)
			const first = rosterManager.selectStartingPitcher('team1');
			expect(first).toBe('p1');

			// Second call should return p2 (index 1)
			const second = rosterManager.selectStartingPitcher('team1');
			expect(second).toBe('p2');

			// Continue through rotation
			expect(rosterManager.selectStartingPitcher('team1')).toBe('p3');
			expect(rosterManager.selectStartingPitcher('team1')).toBe('p4');
			expect(rosterManager.selectStartingPitcher('team1')).toBe('p5');

			// Should wrap back to p1
			expect(rosterManager.selectStartingPitcher('team1')).toBe('p1');
		});

		it('maintains separate rotation indices for each team', () => {
			// Create a fresh manager for this test
			const freshTracker = new MockUsageTracker();
			const freshManager = new RosterManager(freshTracker.asUsageContext());

			// Create pitchers for both teams with proper teamId
			const team1Pitchers: Record<string, ExtendedPitcherStats> = {
				p1: createPitcher('p1', 30, 30, 2.50, 0.95),
				p2: createPitcher('p2', 30, 30, 3.00, 1.10),
				p3: createPitcher('p3', 30, 30, 3.20, 1.15)
			};

			const team2Pitchers: Record<string, ExtendedPitcherStats> = {
				q1: createPitcher('q1', 30, 30, 3.00, 1.10),
				q2: createPitcher('q2', 30, 30, 3.20, 1.15),
				q3: createPitcher('q3', 30, 30, 3.40, 1.20)
			};

			// Update team2 pitchers to have correct teamId
			for (const p of Object.values(team2Pitchers)) {
				(p as any).teamId = 'team2';
			}

			// Build rotations for both teams at once
			freshManager.buildRotations(
				{ ...team1Pitchers, ...team2Pitchers },
				{ team1: { name: 'Team 1' }, team2: { name: 'Team 2' } }
			);

			// Each team should have independent rotation state
			expect(freshManager.selectStartingPitcher('team1')).toBe('p1');
			expect(freshManager.selectStartingPitcher('team2')).toBe('q1');

			expect(freshManager.selectStartingPitcher('team1')).toBe('p2');
			expect(freshManager.selectStartingPitcher('team2')).toBe('q2');
		});
	});

	describe('shouldRestBatter', () => {
		it('returns no rest when under target', () => {
			mockUsageTracker.setUsage({
				playerId: 'b1',
				actualSeasonTotal: 600,
				replayCurrentTotal: 200,
				percentageOfActual: 33,
				status: 'under'
			});

			const decision = rosterManager.shouldRestBatter('b1', 'team1', 54, 162);
			expect(decision.shouldRest).toBe(false);
		});

		it('returns high rest probability when significantly over target (>25%)', () => {
			// Game 81 of 162, should have 300 PA, has 450 (150% = 50% over)
			mockUsageTracker.setUsage({
				playerId: 'b1',
				actualSeasonTotal: 600,
				replayCurrentTotal: 450,
				percentageOfActual: 150,
				status: 'over'
			});

			// Run multiple times to check probability (90% chance)
			const decisions = Array.from({ length: 100 }, () =>
				rosterManager.shouldRestBatter('b1', 'team1', 81, 162)
			);

			const restCount = decisions.filter((d) => d.shouldRest).length;
			expect(restCount).toBeGreaterThan(80); // Should be around 90%
		});

		it('returns moderate rest probability when slightly over target (>10%)', () => {
			// Game 90 of 162, should have ~333 PA, has 400 (~11% overage)
			// This hits the 0.10 threshold (50% rest chance)
			mockUsageTracker.setUsage({
				playerId: 'b1',
				actualSeasonTotal: 600,
				replayCurrentTotal: 400,
				percentageOfActual: 120,
				status: 'over'
			});

			const decisions = Array.from({ length: 100 }, () =>
				rosterManager.shouldRestBatter('b1', 'team1', 90, 162)
			);

			const restCount = decisions.filter((d) => d.shouldRest).length;
			// ~11% overage = 50% rest chance
			expect(restCount).toBeGreaterThan(35);
			expect(restCount).toBeLessThan(65);
		});

		it('provides reason when suggesting rest', () => {
			mockUsageTracker.setUsage({
				playerId: 'b1',
				actualSeasonTotal: 600,
				replayCurrentTotal: 400,
				percentageOfActual: 133,
				status: 'over'
			});

			const decision = rosterManager.shouldRestBatter('b1', 'team1', 72, 162);
			if (decision.shouldRest) {
				expect(decision.reason).toBeDefined();
				expect(decision.reason).toContain('Over target');
			}
		});

		it('handles missing usage record gracefully', () => {
			const decision = rosterManager.shouldRestBatter('unknown', 'team1', 50, 162);
			expect(decision.shouldRest).toBe(false);
		});
	});

	describe('findReplacement', () => {
		it('selects batter with highest OBP', () => {
			const candidates = [
				createBatter('b1', 0.300),
				createBatter('b2', 0.350), // Best OBP
				createBatter('b3', 0.280)
			];

			// No usage boost - all at target
			mockUsageTracker.setUsage({
				playerId: 'b1',
				actualSeasonTotal: 500,
				replayCurrentTotal: 250,
				percentageOfActual: 100,
				status: 'inRange'
			});

			const replacementId = rosterManager.findReplacement('resting', candidates, 81, 162);
			expect(replacementId).toBe('b2');
		});

		it('applies underage boost to under-used players', () => {
			const candidates = [
				createBatter('b1', 0.320), // Better OBP but at target
				createBatter('b2', 0.300) // Worse OBP but severely under-used
			];

			mockUsageTracker.setUsage({
				playerId: 'b1',
				actualSeasonTotal: 500,
				replayCurrentTotal: 250,
				percentageOfActual: 100,
				status: 'inRange'
			});

			// b2 is 25% under target - should get significant boost
			mockUsageTracker.setUsage({
				playerId: 'b2',
				actualSeasonTotal: 500,
				replayCurrentTotal: 150, // Only 30% of target at 50% season
				percentageOfActual: 60,
				status: 'under'
			});

			const replacementId = rosterManager.findReplacement('resting', candidates, 81, 162);
			// b2 should be selected due to under-use boost
			expect(replacementId).toBe('b2');
		});

		it('caps underage boost at 2x maximum', () => {
			const candidates = [
				createBatter('b1', 0.350), // Much better OBP
				createBatter('b2', 0.200) // Terrible OBP but severely under-used
			];

			mockUsageTracker.setUsage({
				playerId: 'b1',
				actualSeasonTotal: 500,
				replayCurrentTotal: 250,
				percentageOfActual: 100,
				status: 'inRange'
			});

			// b2 is extremely under-used (50%)
			mockUsageTracker.setUsage({
				playerId: 'b2',
				actualSeasonTotal: 500,
				replayCurrentTotal: 25, // Only 10% of target
				percentageOfActual: 10,
				status: 'under'
			});

			const replacementId = rosterManager.findReplacement('resting', candidates, 50, 162);
			// Even with 2x boost, 0.200 * 2 = 0.400 < 0.350, so b1 should still win
			expect(replacementId).toBe('b1');
		});

		it('handles empty candidate list', () => {
			const replacementId = rosterManager.findReplacement('resting', [], 'team1', 50, 162);
			expect(replacementId).toBe('');
		});

		it('excludes resting player from candidates', () => {
			const candidates = [
				createBatter('b1', 0.350),
				createBatter('b2', 0.300)
			];

			const replacementId = rosterManager.findReplacement('b1', candidates, 81, 162);
			expect(replacementId).toBe('b2'); // Only b2 is available
		});
	});

	describe('getRotation', () => {
		it('returns undefined for team with no rotation', () => {
			const rotation = rosterManager.getRotation('nonexistent');
			expect(rotation).toBeUndefined();
		});

		it('returns rotation array for valid team', () => {
			const pitchers: Record<string, ExtendedPitcherStats> = {
				p1: createPitcher('p1', 30, 30, 3.00, 1.10),
				p2: createPitcher('p2', 30, 30, 3.20, 1.15)
			};

			rosterManager.buildRotations(pitchers, { team1: { name: 'Team 1' } });

			const rotation = rosterManager.getRotation('team1');
			expect(rotation).toBeDefined();
			expect(Array.isArray(rotation)).toBe(true);
		});
	});

	describe('edge cases', () => {
		it('handles pitcher with zero games', () => {
			const pitchers: Record<string, ExtendedPitcherStats> = {
				p_no_games: createPitcher('p_no_games', 0, 0, 0, 0)
			};

			// Should not throw
			expect(() =>
				rosterManager.buildRotations(pitchers, { team1: { name: 'Team 1' } })
			).not.toThrow();

			const rotation = rosterManager.getRotation('team1');
			expect(rotation).toEqual([]);
		});

		it('handles team with no qualified starters', () => {
			const pitchers: Record<string, ExtendedPitcherStats> = {
				p1: createPitcher('p1', 30, 5, 4.50, 1.60), // 17% GS - below threshold
				p2: createPitcher('p2', 20, 3, 5.00, 1.70) // 15% GS - below threshold
			};

			rosterManager.buildRotations(pitchers, { team1: { name: 'Team 1' } });

			const rotation = rosterManager.getRotation('team1');
			expect(rotation).toEqual([]);
		});
	});
});
