/**
 * RosterManager - Strategic roster management for season replays
 *
 * Handles:
 * - Building starting rotations from season pitcher data
 * - Cycling through starting rotations
 * - Probabilistic batter rest decisions based on usage targets
 * - Finding replacement players with under-usage priority boost
 */

import type { ExtendedPitcherStats, BatterStats } from '../types.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * A slot in the starting rotation
 */
export interface RotationSlot {
	/** Pitcher ID */
	pitcherId: string;
	/** Position in rotation (0-based) */
	rotationIndex: number;
	/** Quality score (higher = better) */
	qualityScore: number;
	/** Average batters faced as starter */
	avgBfpAsStarter: number;
}

/**
 * Decision about whether to rest a batter
 */
export interface RestDecision {
	/** Should the batter be rested? */
	shouldRest: boolean;
	/** Reason for the rest decision */
	reason?: string;
	/** Suggested replacement player ID */
	suggestedReplacement?: string;
}

/**
 * Usage context for roster decisions
 */
export interface UsageContext {
	/** Get usage record for a player */
	getUsage(playerId: string): UsageRecord | null;
}

/**
 * Usage record for tracking player performance against targets
 */
export interface UsageRecord {
	playerId: string;
	actualSeasonTotal: number;
	replayCurrentTotal: number;
	percentageOfActual: number;
	status: 'under' | 'inRange' | 'over';
}

/**
 * Team information for rotation building
 */
export interface TeamInfo {
	name: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Minimum ratio of games started to games to qualify as a starter */
const STARTER_QUALIFICATION_THRESHOLD = 0.3;

/** Maximum rotation size */
const MAX_ROTATION_SIZE = 5;

/** Quality score formula: gamesStarted * 2 + (5/era) + (2/whip) + (cgRate * 10) */
const QUALITY_GS_WEIGHT = 2;
const QUALITY_ERA_DIVISOR = 5;
const QUALITY_WHIP_DIVISOR = 2;
const QUALITY_CG_MULTIPLIER = 10;

/** Rest probability thresholds based on overage ratio */
const REST_THRESHOLDS = [
	{ overage: 0.25, probability: 0.90 },
	{ overage: 0.15, probability: 0.70 },
	{ overage: 0.10, probability: 0.50 },
	{ overage: 0.05, probability: 0.30 },
	{ overage: 0.0, probability: 0.10 }
];

/** Maximum boost for under-used players (as multiplier) */
const MAX_UNDERAGE_BOOST = 2.0;

/** Multiplier for underage boost calculation */
const UNDERAGE_BOOST_MULTIPLIER = 2;

// ============================================================================
// ROSTER MANAGER CLASS
// ============================================================================

/**
 * RosterManager - Manages starting rotations and player rest decisions
 *
 * This class is designed to be used during season replay to ensure
 * realistic player usage relative to historical targets.
 */
export class RosterManager {
	private rotations: Map<string, RotationSlot[]> = new Map();
	private rotationIndex: Map<string, number> = new Map();
	private usageContext: UsageContext;

	/**
	 * Create a new RosterManager
	 * @param usageContext - Context for querying player usage records
	 */
	constructor(usageContext: UsageContext) {
		this.usageContext = usageContext;
	}

	/**
	 * Build starting rotations for all teams
	 * @param pitchers - Map of pitcher ID to stats
	 * @param teams - Map of team ID to team info
	 */
	buildRotations(
		pitchers: Record<string, ExtendedPitcherStats>,
		teams: Record<string, TeamInfo>
	): void {
		// Group pitchers by team
		const pitchersByTeam = new Map<string, ExtendedPitcherStats[]>();
		for (const pitcher of Object.values(pitchers)) {
			const team = pitcher.teamId;
			if (!pitchersByTeam.has(team)) {
				pitchersByTeam.set(team, []);
			}
			pitchersByTeam.get(team)!.push(pitcher);
		}

		// Build rotation for each team
		for (const [teamId, teamPitchers] of pitchersByTeam.entries()) {
			const rotation = this.buildTeamRotation(teamPitchers);
			this.rotations.set(teamId, rotation);
			this.rotationIndex.set(teamId, 0);
		}

		// Initialize empty rotations for teams with no pitchers
		for (const teamId of Object.keys(teams)) {
			if (!this.rotations.has(teamId)) {
				this.rotations.set(teamId, []);
				this.rotationIndex.set(teamId, 0);
			}
		}
	}

	/**
	 * Build rotation for a single team
	 * @param pitchers - Array of pitchers for this team
	 * @returns Sorted rotation slots
	 */
	private buildTeamRotation(pitchers: ExtendedPitcherStats[]): RotationSlot[] {
		// Filter to qualified starters (gamesStarted/games >= 0.3)
		const qualified = pitchers.filter(
			(p) => p.games > 0 && p.gamesStarted / p.games >= STARTER_QUALIFICATION_THRESHOLD
		);

		// Calculate quality score for each
		const withScores = qualified.map((p, index) => {
			const qualityScore = this.calculateQualityScore(p);
			return {
				pitcherId: p.id,
				rotationIndex: index,
				qualityScore,
				avgBfpAsStarter: p.avgBfpAsStarter ?? 27
			};
		});

		// Sort by quality score (highest first)
		withScores.sort((a, b) => b.qualityScore - a.qualityScore);

		// Limit to max rotation size
		const rotationSize = Math.min(withScores.length, MAX_ROTATION_SIZE);

		// Update rotation indices after sorting
		const rotation = withScores.slice(0, rotationSize).map((slot, index) => ({
			...slot,
			rotationIndex: index
		}));

		return rotation;
	}

	/**
	 * Calculate quality score for a pitcher
	 * Formula: gamesStarted * 2 + (5/era) + (2/whip) + (cgRate * 10)
	 */
	private calculateQualityScore(pitcher: ExtendedPitcherStats): number {
		const gsScore = pitcher.gamesStarted * QUALITY_GS_WEIGHT;
		const eraScore = pitcher.era > 0 ? QUALITY_ERA_DIVISOR / pitcher.era : 0;
		const whipScore = pitcher.whip > 0 ? QUALITY_WHIP_DIVISOR / pitcher.whip : 0;
		const cgRate = pitcher.gamesStarted > 0 ? pitcher.completeGames / pitcher.gamesStarted : 0;
		const cgScore = cgRate * QUALITY_CG_MULTIPLIER;

		return gsScore + eraScore + whipScore + cgScore;
	}

	/**
	 * Select the starting pitcher for a team (advances rotation)
	 * @param teamId - Team ID
	 * @returns Pitcher ID of the selected starter
	 */
	selectStartingPitcher(teamId: string): string {
		const rotation = this.rotations.get(teamId);

		if (!rotation || rotation.length === 0) {
			// No rotation built - return empty string
			return '';
		}

		const currentIndex = this.rotationIndex.get(teamId) ?? 0;
		const starter = rotation[currentIndex];

		// Advance to next in rotation
		const nextIndex = (currentIndex + 1) % rotation.length;
		this.rotationIndex.set(teamId, nextIndex);

		return starter.pitcherId;
	}

	/**
	 * Decide whether to rest a batter based on usage
	 * @param batterId - Batter ID to check
	 * @param teamId - Team ID (unused, for API consistency)
	 * @param gameNumber - Current game number in season
	 * @param totalGames - Total games in season
	 * @returns Rest decision
	 */
	shouldRestBatter(
		batterId: string,
		teamId: string,
		gameNumber: number,
		totalGames: number
	): RestDecision {
		const usage = this.usageContext.getUsage(batterId);

		if (!usage) {
			// No usage data - don't rest
			return { shouldRest: false };
		}

		// Calculate expected target at this point in season
		const seasonProgress = gameNumber / totalGames;
		const targetPa = usage.actualSeasonTotal * seasonProgress;
		const currentPa = usage.replayCurrentTotal;

		// Calculate overage ratio (positive = over target, negative = under)
		const overageRatio = (currentPa - targetPa) / usage.actualSeasonTotal;

		// Find rest probability based on overage
		let restChance = 0;
		for (const threshold of REST_THRESHOLDS) {
			if (overageRatio >= threshold.overage) {
				restChance = threshold.probability;
				break;
			}
		}

		// Only rest if over target
		if (overageRatio <= 0) {
			return { shouldRest: false };
		}

		const shouldRest = Math.random() < restChance;

		return {
			shouldRest,
			reason: shouldRest ? `Over target by ${(overageRatio * 100).toFixed(0)}%` : undefined
		};
	}

	/**
	 * Find the best replacement player from candidates
	 * Applies under-usage boost to prioritize players who need more playing time
	 * @param restingPlayerId - Player being rested (excluded from candidates)
	 * @param candidates - Available replacement candidates
	 * @param gameNumber - Current game number
	 * @param totalGames - Total games in season
	 * @returns ID of best replacement candidate
	 */
	findReplacement(
		restingPlayerId: string,
		candidates: BatterStats[],
		gameNumber: number,
		totalGames: number
	): string {
		if (candidates.length === 0) {
			return '';
		}

		const seasonProgress = gameNumber / totalGames;

		// Score each candidate
		const scored = candidates
			.filter((c) => c.id !== restingPlayerId)
			.map((player) => {
				const usage = this.usageContext.getUsage(player.id);
				const baseScore = this.calculateHitterScore(player);
				let finalScore = baseScore;

				if (usage) {
					const target = usage.actualSeasonTotal * seasonProgress;
					const underage = (target - usage.replayCurrentTotal) / usage.actualSeasonTotal;

					// Apply boost for under-used players (up to 2x)
					if (underage > 0) {
						const boost = Math.min(underage * UNDERAGE_BOOST_MULTIPLIER, MAX_UNDERAGE_BOOST - 1);
						finalScore = baseScore * (1 + boost);
					}
				}

				return { player, score: finalScore };
			});

		// Sort by score and return best
		scored.sort((a, b) => b.score - a.score);

		return scored[0]?.player.id ?? '';
	}

	/**
	 * Calculate hitter quality score based on OBP
	 * Uses average of vsLeft and vsRight rates
	 */
	private calculateHitterScore(batter: BatterStats): number {
		const getOBP = (rates: typeof batter.rates.vsLeft) => {
			return (
				rates.single +
				rates.double +
				rates.triple +
				rates.homeRun +
				rates.walk +
				rates.hitByPitch
			);
		};

		const obpVsLeft = getOBP(batter.rates.vsLeft);
		const obpVsRight = getOBP(batter.rates.vsRight);

		return (obpVsLeft + obpVsRight) / 2;
	}

	/**
	 * Get the current rotation for a team
	 * @param teamId - Team ID
	 * @returns Rotation slots or undefined if not built
	 */
	getRotation(teamId: string): RotationSlot[] | undefined {
		return this.rotations.get(teamId);
	}
}
