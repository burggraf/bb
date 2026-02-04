import { describe, it, expect } from 'vitest';
import { selectReliever } from './pitching.js';
import type { BullpenState, GameState, PitcherRole } from './types.js';

describe('selectReliever (enhanced)', () => {
	const mockGameState: GameState = {
		inning: 9,
		isTopInning: false, // Bottom of 9th, pitching team = home team
		outs: 0,
		bases: [null, null, null],
		scoreDiff: 2 // Home team (pitching) up by 2
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

	it('uses any reliever in blowout (avoids closer/setup)', () => {
		const gameState: GameState = { ...mockGameState, scoreDiff: 6 }; // 6 run lead
		const bullpen: BullpenState = {
			starter: { pitcherId: 'starter', role: 'starter', stamina: 50, pitchesThrown: 0, battersFace: 22, avgBfpAsStarter: 27, avgBfpAsReliever: null, hitsAllowed: 4, walksAllowed: 2, runsAllowed: 2 },
			relievers: [
				{ pitcherId: 'middle1', role: 'reliever', stamina: 100, pitchesThrown: 0, battersFace: 0, avgBfpAsStarter: null, avgBfpAsReliever: 12, hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0 }
			],
			closer: { pitcherId: 'closer', role: 'closer', stamina: 100, pitchesThrown: 0, battersFace: 0, avgBfpAsStarter: null, avgBfpAsReliever: 6, hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0 },
			setup: [
				{ pitcherId: 'setup1', role: 'reliever', stamina: 100, pitchesThrown: 0, battersFace: 0, avgBfpAsStarter: null, avgBfpAsReliever: 10, hitsAllowed: 0, walksAllowed: 0, runsAllowed: 0 }
			]
		};

		const selected = selectReliever(gameState, bullpen as any, 'starter');
		expect(selected?.pitcherId).toBe('middle1'); // Uses regular reliever, not closer/setup
	});
});
