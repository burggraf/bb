/**
 * Types for Managerial System
 *
 * Minimal game state interfaces for strategic decisions.
 * The app package has the full GameState; this is the subset needed
 * for managerial decisions.
 */

import type { BatterStats, PitcherStats } from '../types.js';

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

/**
 * Era-specific lineup construction strategy
 */
export type EraStrategy =
	| 'traditional'      // Pre-1980s archetype-based
	| 'composite'        // 1986-1995 hybrid
	| 'early-analytics'  // 1996-2010 sabermetric
	| 'modern';          // 2011+ full analytics

/**
 * Era detection result with blending info
 */
export interface EraDetection {
	primary: EraStrategy;
	secondary: EraStrategy | null;
	blendFactor: number; // 0-1, weight for primary strategy
}

/**
 * Player availability for lineup construction
 */
export interface PlayerAvailability {
	/** Players available to start (below usage threshold) */
	available: BatterStats[];
	/** Players being rested (above usage threshold) */
	rested: BatterStats[];
	/** Warnings about usage status */
	warnings: string[];
}

/**
 * Lineup construction result with era info
 */
export interface LineupBuildResult {
	lineup: LineupSlot[];
	startingPitcher: PitcherStats;
	warnings: string[];
	era: EraDetection;
}

/**
 * Options for era-aware lineup building
 */
export interface EraLineupOptions {
	/** Force a specific strategy (skip era detection) */
	strategy?: EraStrategy;
	/** Randomness factor (0-1) for variety */
	randomness?: number;
	/** Override DH rule */
	useDH?: boolean;
	/** Allow emergency starts from rested players on position scarcity */
	allowEmergencyStarts?: boolean;
}

/**
 * Lineup slot with batting order and position
 */
export interface LineupSlot {
	playerId: string;
	battingOrder: number; // 1-9
	fieldingPosition: number; // 1-9 (TODO: 10=DH, 11=PH, 12=PR for future work)
}
