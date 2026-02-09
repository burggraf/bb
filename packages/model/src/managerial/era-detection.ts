/**
 * Era Detection Module
 *
 * Detects the appropriate strategy for lineup construction based on year.
 * Uses gradual blending at transition points to avoid abrupt changes.
 *
 * Era boundaries:
 * - Pre-1980: Traditional (archetype-based)
 * - 1980-1990: Transition to Composite
 * - 1990-2000: Transition to Early Analytics
 * - 2000-2010: Transition to Modern
 * - Post-2010: Modern (full analytics)
 */

import type { EraDetection, EraStrategy } from './types.js';

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
	// Note: boundaries (1980, 1990, 2000) start the NEXT transition period
	// with blendFactor 0, then blend toward the new strategy

	if (year >= 1980 && year < 1990) {
		const blend = (year - 1980) / 10; // 0 to 0.9
		return {
			primary: 'composite',
			secondary: 'traditional',
			blendFactor: blend
		};
	}

	if (year >= 1990 && year < 2000) {
		const blend = (year - 1990) / 10; // 0 to 0.9
		return {
			primary: 'early-analytics',
			secondary: 'composite',
			blendFactor: blend
		};
	}

	if (year >= 2000 && year < 2010) {
		const blend = (year - 2000) / 10; // 0 to 0.9
		return {
			primary: 'modern',
			secondary: 'early-analytics',
			blendFactor: blend
		};
	}

	// Handle year 2010 explicitly (end of last transition)
	if (year === 2010) {
		// At 2010, we're fully in modern era but it's the transition endpoint
		return {
			primary: 'modern',
			secondary: 'early-analytics',
			blendFactor: 1
		};
	}

	// Fallback (shouldn't reach)
	return { primary: 'traditional', secondary: null, blendFactor: 1 };
}

/**
 * Check if a given year is in a transition period
 * @param year - Season year
 * @returns true if year is in a transition period (1980-2010)
 */
export function isTransitionYear(year: number): boolean {
	return year >= 1980 && year <= 2010;
}

/**
 * Get the pure strategy for a year (no blending)
 * @param year - Season year
 * @returns The primary era strategy
 */
export function getPureEraStrategy(year: number): EraStrategy {
	const detection = getEraStrategy(year);
	return detection.primary;
}
