/**
 * Lineup Validator
 *
 * Validates that a lineup configuration is "legal" - meaning every position
 * has a player who is actually eligible to play there.
 */

import type { BatterStats } from './types.js';

export interface LineupValidationResult {
	/** Whether the lineup passes all validation rules */
	isValid: boolean;
	/** Critical errors that prevent the lineup from being valid */
	errors: string[];
	/** Warnings about unusual but legal configurations */
	warnings: string[];
}

/**
 * Position names for error messages
 */
const POSITION_NAMES: Record<number, string> = {
	1: 'P',
	2: 'C',
	3: '1B',
	4: '2B',
	5: '3B',
	6: 'SS',
	7: 'LF',
	8: 'CF',
	9: 'RF',
	10: 'DH'
};

/**
 * Get a human-readable position name
 */
function getPositionName(position: number): string {
	return POSITION_NAMES[position] ?? `Pos${position}`;
}

/**
 * Check if a player is eligible to play a specific position.
 * A player is eligible if:
 * 1. They have explicit eligibility data for that position (> 0 outs played)
 * 2. OR the position matches their primary position
 */
function isPlayerEligibleAtPosition(
	player: BatterStats,
	position: number
): boolean {
	// Check explicit position eligibility
	const outsAtPosition = player.positionEligibility[position];
	if (outsAtPosition && outsAtPosition > 0) {
		return true;
	}

	// Check if it's their primary position
	if (player.primaryPosition === position) {
		return true;
	}

	return false;
}

/**
 * Validate a lineup configuration.
 *
 * Validation rules:
 * 1. All 9 positions (1-9) must have a non-null player ID
 * 2. Each player must be eligible at their assigned position
 * 3. No player can appear twice in the field
 * 4. Position 1 must always be a pitcher
 *
 * @param lineupSlots - Array of {playerId, position} tuples (length 9 for full lineup)
 * @param batters - Record of all batters in the season
 * @returns Validation result with errors and warnings
 */
export function validateLineup(
	lineupSlots: Array<{ playerId: string | null; position: number }>,
	batters: Record<string, BatterStats>
): LineupValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	const seenPlayers = new Set<string>();

	// Rule 1: Check all 9 positions have non-null player IDs
	for (let i = 0; i < lineupSlots.length; i++) {
		const slot = lineupSlots[i];
		if (!slot.playerId) {
			errors.push(`Position ${i + 1} (${getPositionName(i + 1)}) has no player assigned`);
		}
	}

	// Rule 2: Check each player is eligible at their position
	// Rule 3: Check for duplicate players
	// Rule 4: Check position 1 is a pitcher
	for (const slot of lineupSlots) {
		if (!slot.playerId) continue; // Skip null slots (already reported as error)

		const player = batters[slot.playerId];
		if (!player) {
			errors.push(`Player ${slot.playerId} not found in season data at position ${getPositionName(slot.position)}`);
			continue;
		}

		// Check for duplicates
		if (seenPlayers.has(slot.playerId)) {
			errors.push(`Player ${player.name} appears multiple times in the lineup`);
		}
		seenPlayers.add(slot.playerId);

		// Check position eligibility
		if (!isPlayerEligibleAtPosition(player, slot.position)) {
			const primaryName = getPositionName(player.primaryPosition);
			errors.push(
				`Player ${player.name} at ${getPositionName(slot.position)} but only eligible at ${primaryName} (and others per positionEligibility)`
			);
		}

		// Check if playing away from primary position (warning, not error)
		if (player.primaryPosition !== slot.position) {
			const primaryName = getPositionName(player.primaryPosition);
			warnings.push(`Player ${player.name} at ${getPositionName(slot.position)} (primary: ${primaryName})`);
		}

		// Rule 4: Position 1 must be a pitcher
		if (slot.position === 1 && player.primaryPosition !== 1) {
			errors.push(`Position 1 (P) must be a pitcher, but ${player.name} is assigned there`);
		}
	}

	return {
		isValid: errors.length === 0,
		errors,
		warnings
	};
}
