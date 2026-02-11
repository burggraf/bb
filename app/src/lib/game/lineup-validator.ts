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
 * Options for lineup validation
 */
export interface ValidateLineupOptions {
	/** Allow players at positions they're not rated for (emergency roster exhaustion) */
	allowEmergencyPositions?: boolean;
	/** Season year for era-specific validation rules (e.g., early baseball had more position flexibility) */
	year?: number;
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
	10: 'DH',
	11: 'PH',
	12: 'PR'
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
 * 1. They are assigned to DH (position 10), PH (position 11), or PR (position 12) - any player can fill these
 * 2. They have explicit eligibility data for that position (> 0 outs played)
 * 3. OR the position matches their primary position
 * 4. LENIENT: If they have SOME position eligibility data, allow similar positions (OF->OF, IF->IF)
 *
 * This must match the canPlayPosition logic in engine.ts
 */
function isPlayerEligibleAtPosition(
	player: BatterStats,
	position: number
): boolean {
	// Any player can DH, PH, or PR
	if (position === 10 || position === 11 || position === 12) {
		return true;
	}

	// Position 1 (pitcher) has special restrictions - only players whose primary position is pitcher
	if (position === 1) {
		return player.primaryPosition === 1;
	}

	// Check explicit position eligibility
	const outsAtPosition = player.positionEligibility[position];
	if (outsAtPosition && outsAtPosition > 0) {
		return true;
	}

	// Check if it's their primary position
	if (player.primaryPosition === position) {
		return true;
	}

	// LENIENT: If no explicit eligibility data for this specific position, allow similar positions
	// Outfielders can play other outfield positions (7-9)
	// Infielders can play other infield positions (2-6)
	const hasAnyEligibility = Object.keys(player.positionEligibility).length > 0;
	if (hasAnyEligibility) {
		// Only use this lenient rule if they have SOME eligibility data but not for this specific position
		const isOutfield = (pos: number) => pos >= 7 && pos <= 9;
		const isSkillInfield = (pos: number) => pos === 4 || pos === 5 || pos === 6; // 2B, 3B, SS are somewhat interchangeable

		const playerIsOutfield = isOutfield(player.primaryPosition);
		const playerIsSkillInfield = isSkillInfield(player.primaryPosition);
		const targetIsOutfield = isOutfield(position);
		const targetIsSkillInfield = isSkillInfield(position);

		// Allow outfielders to play any OF position, skill infielders any skill IF position
		if ((playerIsOutfield && targetIsOutfield) || (playerIsSkillInfield && targetIsSkillInfield)) {
			return true;
		}
	}

	return false;
}

/**
 * Validate a lineup configuration.
 *
 * Validation rules:
 * 1. All 9 positions (1-9) must have a non-null player ID
 * 2. Each player must be eligible at their assigned position (unless allowEmergencyPositions is true)
 * 3. No player can appear twice in the field
 * 4. Position 1 must always be a pitcher
 *
 * @param lineupSlots - Array of {playerId, position} tuples (length 9 for full lineup)
 * @param batters - Record of all batters in the season
 * @param options - Optional validation settings
 * @returns Validation result with errors and warnings
 */
export function validateLineup(
	lineupSlots: Array<{ playerId: string | null; position: number }>,
	batters: Record<string, BatterStats>,
	options?: ValidateLineupOptions
): LineupValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	const seenPlayers = new Set<string>();
	const seenPositions = new Set<number>();

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
	// Rule 5: Check for duplicate positions (e.g., two players at 2B)
	for (const slot of lineupSlots) {
		if (!slot.playerId) continue; // Skip null slots (already reported as error)

		const player = batters[slot.playerId];
		if (!player) {
			errors.push(`Player ${slot.playerId} not found in season data at position ${getPositionName(slot.position)}`);
			continue;
		}

		// Check for duplicate players
		if (seenPlayers.has(slot.playerId)) {
			errors.push(`Player ${player.name} appears multiple times in the lineup`);
		}
		seenPlayers.add(slot.playerId);

		// Check for duplicate positions (only for real positions 1-9, not PH/PR/DH)
		if (slot.position >= 1 && slot.position <= 9) {
			if (seenPositions.has(slot.position)) {
				errors.push(`Position ${getPositionName(slot.position)} is assigned to multiple players`);
			}
			seenPositions.add(slot.position);
		}

		// Check position eligibility (unless in emergency mode or early era)
		// Early baseball (pre-1920) had less strict position specialization - players often played multiple positions
		// even if not explicitly rated for them. We allow more flexibility for these early seasons.
		const isEarlyEra = options?.year && options.year < 1920;
		const allowAnyPosition = options?.allowEmergencyPositions || isEarlyEra;

		if (!allowAnyPosition && !isPlayerEligibleAtPosition(player, slot.position)) {
			const primaryName = getPositionName(player.primaryPosition);
			errors.push(
				`Player ${player.name} at ${getPositionName(slot.position)} but only eligible at ${primaryName} (and others per positionEligibility)`
			);
		}

		// For early era, only warn about severe position mismatches (e.g., pitcher at a skill position)
		// For normal eras, check if playing away from primary position (warning, not error)
		if (player.primaryPosition !== slot.position) {
			const primaryName = getPositionName(player.primaryPosition);
			if (isEarlyEra && player.primaryPosition === 1 && slot.position >= 2 && slot.position <= 6) {
				// Pitcher playing infield in early era is a warning but acceptable
				warnings.push(`Player ${player.name} (pitcher) at ${getPositionName(slot.position)} (early era flexibility)`);
			} else if (!isEarlyEra) {
				warnings.push(`Player ${player.name} at ${getPositionName(slot.position)} (primary: ${primaryName})`);
			}
		}

		// Rule 4: Position 1 must be a pitcher (except for early era when this was sometimes allowed)
		if (slot.position === 1 && player.primaryPosition !== 1 && !isEarlyEra) {
			errors.push(`Position 1 (P) must be a pitcher, but ${player.name} is assigned there`);
		}
	}

	return {
		isValid: errors.length === 0,
		errors,
		warnings
	};
}
