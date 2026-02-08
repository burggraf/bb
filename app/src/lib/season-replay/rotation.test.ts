/**
 * Unit tests for pitcher rotation logic
 */

import { describe, it, expect } from 'vitest';

describe('Pitcher Rotation Logic', () => {
	describe('Rotation order by gamesStarted', () => {
		it('should order starters by gamesStarted descending', () => {
			const pitchers = [
				{ id: 'p1', name: 'Pitcher 1', gamesStarted: 30, games: 30 },
				{ id: 'p2', name: 'Pitcher 2', gamesStarted: 25, games: 30 },
				{ id: 'p3', name: 'Pitcher 3', gamesStarted: 20, games: 25 },
				{ id: 'p4', name: 'Pitcher 4', gamesStarted: 15, games: 20 },
				{ id: 'p5', name: 'Pitcher 5', gamesStarted: 10, games: 20 }
			];

			// Simulate rotation initialization
			const starters = pitchers.filter(p => {
				const startRate = p.gamesStarted / p.games;
				return startRate >= 0.3 && p.gamesStarted >= 5;
			});

			starters.sort((a, b) => b.gamesStarted - a.gamesStarted);

			expect(starters[0]?.id).toBe('p1'); // Ace - most starts
			expect(starters[1]?.id).toBe('p2');
			expect(starters[2]?.id).toBe('p3');
			expect(starters[3]?.id).toBe('p4');
			expect(starters[4]?.id).toBe('p5');
		});
	});

	describe('Start rate filtering', () => {
		it('should include only pitchers with start rate >= 30%', () => {
			const pitchers = [
				{ id: 'p1', gamesStarted: 20, games: 30, startRate: 0.67 }, // Included
				{ id: 'p2', gamesStarted: 15, games: 30, startRate: 0.50 }, // Included
				{ id: 'p3', gamesStarted: 8, games: 30, startRate: 0.27 }, // Excluded (< 30%)
				{ id: 'p4', gamesStarted: 5, games: 30, startRate: 0.17 }, // Excluded (< 30%)
				{ id: 'p5', gamesStarted: 25, games: 30, startRate: 0.83 }  // Included
			];

			const starters = pitchers.filter(p => {
				const startRate = p.gamesStarted / p.games;
				return startRate >= 0.3;
			});

			expect(starters.length).toBe(3);
			// Sort by gamesStarted descending for consistent ordering
			starters.sort((a, b) => b.gamesStarted - a.gamesStarted);
			expect(starters.map(s => s.id)).toEqual(['p5', 'p1', 'p2']);
		});

		it('should require minimum 5 starts to qualify', () => {
			const pitchers = [
				{ id: 'p1', gamesStarted: 20, games: 30 }, // Qualified
				{ id: 'p2', gamesStarted: 5, games: 10 },  // Qualified (exactly 5)
				{ id: 'p3', gamesStarted: 4, games: 10 },  // Not qualified (< 5 starts)
				{ id: 'p4', gamesStarted: 15, games: 30 }  // Qualified
			];

			const starters = pitchers.filter(p => {
				const startRate = p.gamesStarted / p.games;
				return startRate >= 0.3 && p.gamesStarted >= 5;
			});

			expect(starters.length).toBe(3);
			// Sort by gamesStarted descending for consistent ordering
			starters.sort((a, b) => b.gamesStarted - a.gamesStarted);
			expect(starters.map(s => s.id)).toEqual(['p1', 'p4', 'p2']);
		});
	});

	describe('Rotation progression', () => {
		it('should cycle through rotation correctly', () => {
			const rotation = ['p1', 'p2', 'p3', 'p4', 'p5'];
			let index = 0;

			const selections = [];
			for (let i = 0; i < 10; i++) {
				selections.push(rotation[index]);
				index = (index + 1) % rotation.length;
			}

			expect(selections).toEqual([
				'p1', 'p2', 'p3', 'p4', 'p5', // First cycle
				'p1', 'p2', 'p3', 'p4', 'p5'  // Second cycle
			]);
		});

		it('should skip overused pitchers and continue', () => {
			const rotation = ['p1', 'p2', 'p3', 'p4', 'p5'];
			const usage = new Map([
				['p1', 1.3], // Overused (>125%)
				['p2', 0.8], // Normal
				['p3', 1.4], // Overused
				['p4', 0.9], // Normal
				['p5', 0.7]  // Normal
			]);

			let index = 0;
			const selections = [];

			// Simulate selecting 5 starters, skipping overused
			let attempts = 0;
			while (selections.length < 5 && attempts < rotation.length * 2) {
				const pitcherId = rotation[index];
				const pitcherUsage = usage.get(pitcherId) ?? 0;

				if (pitcherUsage <= 1.25) {
					selections.push(pitcherId);
				}

				index = (index + 1) % rotation.length;
				attempts++;
			}

			// Should skip p1 and p3 (overused), use p2, p4, p5
			expect(selections).toEqual(['p2', 'p4', 'p5', 'p2', 'p4']);
		});
	});

	describe('Overuse threshold', () => {
		it('should skip pitchers at >125% usage', () => {
			const usage = new Map([
				['p1', 1.24], // Not overused (<= 125%)
				['p2', 1.25], // Not overused (exactly 125%)
				['p3', 1.26], // Overused (> 125%)
				['p4', 1.50], // Overused
				['p5', 0.80]  // Not overused
			]);

			const overused = [];
			const notOverused = [];

			for (const [id, pct] of usage) {
				if (pct > 1.25) {
					overused.push(id);
				} else {
					notOverused.push(id);
				}
			}

			expect(overused).toEqual(['p3', 'p4']);
			expect(notOverused).toEqual(['p1', 'p2', 'p5']);
		});
	});
});
