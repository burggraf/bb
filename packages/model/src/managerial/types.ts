/**
 * Types for Managerial System
 *
 * Minimal game state interfaces for strategic decisions.
 * The app package has the full GameState; this is the subset needed
 * for managerial decisions.
 */

/**
 * Simplified game state for managerial decisions
 */
export interface GameState {
	/** Current inning (1-9+) */
	inning: number;
	/** Is this the top of the inning? */
	isTopInning: boolean;
	/** Current outs (0-2) */
	outs: number;
	/** Runners on base [1B, 2B, 3B] - null if empty, runner ID if occupied */
	bases: [string | null, string | null, string | null];
	/** Score difference from pitching team's perspective */
	/** (positive = pitching team winning, negative = losing) */
	scoreDiff: number;
}

/**
 * Pitcher role and status
 */
export interface PitcherRole {
	pitcherId: string;
	role: 'starter' | 'reliever' | 'closer';
	stamina: number; // 0-100
	pitchesThrown: number;
}

/**
 * Available bullpen pitchers
 */
export interface BullpenState {
	starter: PitcherRole;
	relievers: PitcherRole[];
	closer?: PitcherRole;
}

/**
 * Decision about whether to change pitchers
 */
export interface PitchingDecision {
	shouldChange: boolean;
	newPitcher?: string;
	reason?: string;
}
