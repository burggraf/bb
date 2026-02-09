/**
 * Managerial System - Strategic decision-making for baseball games
 *
 * This module provides algorithmic decision-making for:
 * - Lineup generation
 * - Pitcher management (bullpen usage)
 * - Pinch-hitter selection
 * - Platoon advantage
 * - League norms calculation
 * - Roster management and rotation building
 */

// Core modules (export all)
export * from './era-detection.js';
export * from './lineup-strategies.js';
export * from './pitcher-classifier.js';
export * from './pitching.js';
export * from './roster-manager.js';
export * from './substitutions.js';
export * from './types.js';

// Supporting modules (selective exports for backward compatibility)
export { generateLineup, type LineupOptions } from './lineup.js';

export {
	applyPlatoonAdvantage,
	addNoise,
	isPlatoonDisadvantage,
	getPlatoonRates
} from './platoon.js';

export { calculateLeagueNorms } from './norms-calculator.js';
export { calculatePitcherQuality } from './pitcher-quality.js';
