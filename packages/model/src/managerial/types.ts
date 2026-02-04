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
	pitchesThrown: number; // DEPRECATED: use battersFace instead
	/** Batters faced in this game */
	battersFace: number;
	/** Average batters faced when starting (from season data) */
	avgBfpAsStarter: number | null;
	/** Average batters faced when relieving (from season data) */
	avgBfpAsReliever: number | null;
	/** Hits allowed in current appearance */
	hitsAllowed: number;
	/** Walks allowed in current appearance */
	walksAllowed: number;
	/** Runs allowed in current appearance */
	runsAllowed: number;
	/** Is this pitcher a workhorse (high complete game rate)? */
	isWorkhorse?: boolean;
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
 * Enhanced bullpen state with role-specific reliever categories
 */
export interface EnhancedBullpenState extends BullpenState {
	/** Setup men for 7th-8th innings (modern era) */
	setup?: PitcherRole[];
	/** Long relievers for early game/extra innings */
	longRelief?: PitcherRole[];
}

/**
 * Quality metrics for a pitcher (era-normalized)
 */
export interface PitcherQuality {
	id: string;
	qualityScore: number; // Higher = better, era-normalized
	isWorkhorse: boolean; // High complete game rate
	inningsPerGame: number; // For reliever classification
	role: 'starter' | 'reliever';
}

/**
 * League-average pitching stats for a season (calculated, not from export)
 */
export interface LeaguePitchingNorms {
	avgERA: number;
	avgWHIP: number;
	avgSavesPerTeam: number;
	avgCGRate: number; // completeGames / gamesStarted
	year: number;
}

/**
 * Extended options for reliever selection with platoon info
 */
export interface RelieverSelectionOptions {
	/** Upcoming batters for platoon consideration */
	upcomingBatters?: Array<{
		handedness: 'L' | 'R' | 'S';
	}>;
	/** League norms for era detection */
	leagueNorms?: LeaguePitchingNorms;
	/** Season year */
	year?: number;
	/** Is DH game (affects bullpen usage) */
	usesDH?: boolean;
}

/**
 * Decision about whether to change pitchers
 */
export interface PitchingDecision {
	shouldChange: boolean;
	newPitcher?: string;
	reason?: string;
}
