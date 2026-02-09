/**
 * MLB Lineup Builder Algorithm
 *
 * Creates valid baseball lineups following era-appropriate patterns:
 * - Pre-1980: Traditional archetype-based lineups
 * - 1980-1989: Transition from traditional to composite
 * - 1990-1999: Transition from composite to early analytics
 * - 2000-2009: Transition from early analytics to modern
 * - 2010+: Modern analytics-based lineups
 * - Position assignment prioritizes "up the middle" positions (C → SS → 2B → CF → 3B → 1B → LF/RF)
 * - Historical DH rules (AL 1973+, NL 2022+)
 * - Starting pitcher selection by quality score (ERA, WHIP, CG rate)
 */

import type {
	BatterStats,
	PitcherStats,
	LineupState,
	LineupSlot
} from './types.js';
import {
	getEraStrategy,
	getStrategyFunction,
	blendLineups,
	type EraStrategy,
	type EraDetection,
	type EraLineupOptions
} from '@bb/model';

/**
 * Context for player usage tracking during lineup building
 */
export interface UsageContext {
	/** Map of player ID to current usage percentage (0.0-1.0) of actual season totals */
	playerUsage: Map<string, number>;
	/** Usage percentage threshold above which a player should be rested (default 1.25 = 125%) */
	restThreshold?: number;
}

/**
 * Result of lineup building operation
 */
export interface LineupBuildResult {
	lineup: LineupState;
	startingPitcher: PitcherStats;
	warnings: string[];
	era?: EraDetection;
}

// Position numbers (standard MLB scoring)
// 1-9 are standard defensive positions, 10=DH, 11=PH (temporary), 12=PR (temporary)
const POSITIONS = {
	PITCHER: 1,
	CATCHER: 2,
	FIRST_BASE: 3,
	SECOND_BASE: 4,
	THIRD_BASE: 5,
	SHORTSTOP: 6,
	LEFT_FIELD: 7,
	CENTER_FIELD: 8,
	RIGHT_FIELD: 9,
	DH: 10,
	PH: 11,  // Pinch hitter (temporary)
	PR: 12   // Pinch runner (temporary)
} as const;

/**
 * Position priority order - "up the middle first"
 * C, SS, 2B get filled first (defensive priority)
 * CF, 3B, 1B next ( athleticism then corners)
 * LF/RF filled last (least demanding)
 */
const POSITION_PRIORITY: number[] = [
	POSITIONS.CATCHER,
	POSITIONS.SHORTSTOP,
	POSITIONS.SECOND_BASE,
	POSITIONS.CENTER_FIELD,
	POSITIONS.THIRD_BASE,
	POSITIONS.FIRST_BASE,
	POSITIONS.LEFT_FIELD,
	POSITIONS.RIGHT_FIELD
];

/**
 * Get position name from position number
 */
function getPositionName(position: number): string {
	const names: Record<number, string> = {
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
	return names[position] ?? `Pos${position}`;
}

/**
 * Determine if DH is used based on league and year
 * - AL: DH from 1973 to present
 * - NL: DH from 2022 to present
 */
export function usesDH(league: string, year: number): boolean {
	if (league === 'AL') {
		return year >= 1973;
	}
	if (league === 'NL') {
		return year >= 2022;
	}
	// Default to no DH for other leagues
	return false;
}

/**
 * Select the starting pitcher based on quality score
 * Considers gamesStarted, ERA, WHIP, and complete game rate
 */
export function selectStartingPitcher(pitchers: PitcherStats[]): PitcherStats {
	if (pitchers.length === 0) {
		throw new Error('No pitchers available for selection');
	}

	// Filter to pitchers who actually started games (start rate > 30%)
	const starters = pitchers.filter(p => {
		const startRate = p.gamesStarted / p.games;
		return startRate >= 0.3;
	});

	if (starters.length === 0) {
		// Fallback: use pitcher with most gamesStarted
		return pitchers.sort((a, b) => b.gamesStarted - a.gamesStarted)[0]!;
	}

	// Calculate quality score for each starter
	// Quality = (gamesStarted weight) + (era inverse) + (whip inverse) + (cg bonus)
	const scored = starters.map(p => {
		const eraScore = 5 / p.era; // Lower ERA = higher score
		const whipScore = 2 / p.whip; // Lower WHIP = higher score
		const cgRate = p.gamesStarted > 0 ? p.completeGames / p.gamesStarted : 0;
		const cgBonus = cgRate * 10; // Complete games add value

		return {
			pitcher: p,
			score: p.gamesStarted * 2 + eraScore + whipScore + cgBonus
		};
	});

	// Sort by score descending
	scored.sort((a, b) => b.score - a.score);

	return scored[0]!.pitcher;
}

/**
 * Calculate hitter score using sabermetric formula
 * OBP * 1.8 + SLG * 0.9 emphasizes on-base ability
 */
function calculateHitterScore(batter: BatterStats): number {
	const rates = batter.rates.vsRHP; // Use vsRHP as baseline

	// Calculate OBP: (H + BB + HBP) / (AB + BB + HBP)
	// Simplified: sum of on-base events
	const onBaseEvents = rates.walk + rates.hitByPitch + rates.single + rates.double + rates.triple + rates.homeRun;

	// Calculate SLG: (1B + 2B*2 + 3B*3 + HR*4) / AB
	const totalBases = rates.single + rates.double * 2 + rates.triple * 3 + rates.homeRun * 4;

	// All events sum to approximately 1 (probabilities)
	const obp = onBaseEvents;
	const slg = totalBases;

	// Sabermetric weight: OBP * 1.8 + SLG * 0.9
	return obp * 1.8 + slg * 0.9;
}

/**
 * Calculate pure OBP for position assignment sorting
 */
function calculateOBP(batter: BatterStats): number {
	const rates = batter.rates.vsRHP;
	return rates.walk + rates.hitByPitch + rates.single + rates.double + rates.triple + rates.homeRun;
}

/**
 * Assign fielding positions to position players
 * Prioritizes primary positions, then uses secondary eligibility only when needed
 * When multiple players have the same primary position, selects based on quality (PA, then OBP)
 */
function assignPositions(
	players: BatterStats[],
	usageContext?: UsageContext
): Map<string, number> {
	const assigned = new Map<string, number>();
	const usedPlayers = new Set<string>();
	const warnings: string[] = [];

	// Usage thresholds for tiered selection
	const SEVERELY_OVERUSED = 1.40; // 140% - filter out from initial consideration
	const OVERUSED = 1.25; // 125% - use only as fallback
	const UNDERUSED = 0.75; // 75% - prefer these players

	// Track which players are eligible at which positions
	const playerPool = new Map<string, BatterStats>(
		players.map(p => [p.id, p])
	);

	// Helper to get usage bucket for sorting
	function getUsageBucket(playerId: string): number {
		const usage = usageContext?.playerUsage.get(playerId) ?? 0;
		// Bucket 0: Underused (< 75%) - highest priority
		// Bucket 1: In range (75-100%) - second priority
		// Bucket 2: Normal (100-125%) - third priority
		// Bucket 3: Overused (125-140%) - fourth priority
		// Bucket 4: Severely overused (>140%) - last resort
		if (usage < UNDERUSED) return 0;
		if (usage < 1.0) return 1;
		if (usage < OVERUSED) return 2;
		if (usage < SEVERELY_OVERUSED) return 3;
		return 4;
	}

	// Helper to calculate "need score" - how badly does this player need to play?
	// Higher score = more need to play. Balances being underused with being a quality player.
	function getNeedScore(playerId: string): number {
		const usage = usageContext?.playerUsage.get(playerId) ?? 0;
		const player = playerPool.get(playerId);
		if (!player) return 0;

		// Base need: (1 - usage) * 100
		// At 0% usage: need = 100
		// At 50% usage: need = 50
		// At 100% usage: need = 0
		let need = (1 - usage) * 100;

		// Only apply backup boost when we have usage context
		// Without usage context, we want to prefer star players (higher PA)
		if (usageContext && usage < 1.0) {
			// Backup boost: players with LOWER actual PA need more playing time
			// This ensures backups get priority when they're underused
			// Invert the PA scale: lower PA = higher boost
			const backupBoost = Math.max(0, 20 - Math.min(20, Math.log(player.pa + 1) * 2));
			need += backupBoost;
		}

		return need;
	}

	// Fill positions in priority order
	for (const position of POSITION_PRIORITY) {
		// First priority: Find someone whose PRIMARY position is this position
		let primaryCandidates = players.filter(p =>
			!usedPlayers.has(p.id) && p.primaryPosition === position
		);

		let primaryPlayer: BatterStats | undefined;
		if (primaryCandidates.length > 0) {
			// Filter out severely overused players from initial consideration
			const availableCandidates = usageContext
				? primaryCandidates.filter(p => {
					const usage = usageContext.playerUsage.get(p.id) ?? 0;
					return usage < SEVERELY_OVERUSED;
				})
				: primaryCandidates;

			// Sort by need score (higher need = should play), with usage bucket as tiebreaker
			availableCandidates.sort((a, b) => {
				const bucketA = getUsageBucket(a.id);
				const bucketB = getUsageBucket(b.id);
				if (bucketA !== bucketB) {
					return bucketA - bucketB; // Lower bucket first (underused > overused)
				}
				// Within same bucket, prefer higher need score
				const needA = getNeedScore(a.id);
				const needB = getNeedScore(b.id);
				if (Math.abs(needA - needB) > 1) {
					return needB - needA; // Higher need first
				}
				// When need scores are similar (e.g., no usage context), prefer higher PA
				// This ensures star players start over backups
				return b.pa - a.pa;
			});

			primaryPlayer = availableCandidates[0];

			// Fallback: if no non-severely-overused players available, use the least overused
			if (!primaryPlayer && primaryCandidates.length > 0 && usageContext) {
				primaryCandidates.sort((a, b) => {
					const usageA = usageContext.playerUsage.get(a.id) ?? 0;
					const usageB = usageContext.playerUsage.get(b.id) ?? 0;
					return usageA - usageB; // Use the least overused
				});
				primaryPlayer = primaryCandidates[0];
				const usage = usageContext.playerUsage.get(primaryPlayer.id) ?? 0;
				warnings.push(`Forced to use overused player ${primaryPlayer.name} at ${getPositionName(position)} (${(usage * 100).toFixed(0)}% usage)`);
			}
		}

		if (primaryPlayer) {
			assigned.set(primaryPlayer.id, position);
			usedPlayers.add(primaryPlayer.id);
			playerPool.delete(primaryPlayer.id);
			continue;
		}

		// Second priority: Find someone with secondary eligibility at this position
		const secondaryPlayers: Array<{ player: BatterStats; outs: number; score: number }> = [];

		for (const player of players) {
			if (usedPlayers.has(player.id)) continue;

			// Check explicit position eligibility
			const outsAtPosition = player.positionEligibility[position];
			if (outsAtPosition && outsAtPosition > 0) {
				secondaryPlayers.push({
					player,
					outs: outsAtPosition,
					score: calculateOBP(player)
				});
			}
		}

		if (secondaryPlayers.length > 0) {
			// Filter out severely overused players from initial consideration
			const availableCandidates = usageContext
				? secondaryPlayers.filter(s => {
					const usage = usageContext.playerUsage.get(s.player.id) ?? 0;
					return usage < SEVERELY_OVERUSED;
				})
				: secondaryPlayers;

			// Sort by need score (higher need = should play), then by experience at this position
			availableCandidates.sort((a, b) => {
				const bucketA = getUsageBucket(a.player.id);
				const bucketB = getUsageBucket(b.player.id);
				if (bucketA !== bucketB) {
					return bucketA - bucketB;
				}
				// Within same bucket, prefer higher need score
				const needA = getNeedScore(a.player.id);
				const needB = getNeedScore(b.player.id);
				if (Math.abs(needA - needB) > 1) {
					return needB - needA;
				}
				// Second preference: more experienced at this position
				if (Math.abs(b.outs - a.outs) > 100) {
					return b.outs - a.outs;
				}
				// When experience is similar, prefer higher PA (star players)
				return b.player.pa - a.player.pa;
			});

			let best = availableCandidates[0];

			// Fallback: if no available candidates, use the least overused
			if (!best && secondaryPlayers.length > 0 && usageContext) {
				secondaryPlayers.sort((a, b) => {
					const usageA = usageContext.playerUsage.get(a.player.id) ?? 0;
					const usageB = usageContext.playerUsage.get(b.player.id) ?? 0;
					return usageA - usageB;
				});
				best = secondaryPlayers[0];
				const usage = usageContext.playerUsage.get(best.player.id) ?? 0;
				warnings.push(`Forced to use overused player ${best.player.name} at ${getPositionName(position)} (${(usage * 100).toFixed(0)}% usage)`);
			}

			if (best) {
				assigned.set(best.player.id, position);
				usedPlayers.add(best.player.id);
				playerPool.delete(best.player.id);
			}
		}

		// If we still couldn't fill this position, add a warning
		if (!assigned.has(Array.from(assigned.keys()).find(id => assigned.get(id) === position) ?? '')) {
			warnings.push(`WARNING: Unable to fill ${getPositionName(position)} position - no eligible players found`);
		}
	}

	// Validate we filled all 8 positions
	if (assigned.size < 8) {
		throw new Error(`Only able to assign ${assigned.size} positions, need 8. Team may have incomplete roster data or missing position eligibility data.`);
	}

	return assigned;
}

/**
 * Build batting order using traditional baseball heuristics
 *
 * Traditional lineup structure:
 * 1: Leadoff - high OBP, speed (CF, 2B, SS)
 * 2: Contact, advance runners (2B, SS, 3B)
 * 3: Best overall hitter (1B, RF, CF)
 * 4: Cleanup, power (1B, LF, RF)
 * 5: Protect cleanup (LF, 3B, 1B)
 * 6: Secondary power (RF, 3B, LF)
 * 7: Defense/contact (C, 2B, SS)
 * 8: Weakest position player (C, SS)
 * 9: Pitcher or DH
 */
function buildBattingOrder(
	positionPlayers: Array<{ player: BatterStats; position: number }>,
	usesDH: boolean
): Array<{ player: BatterStats; battingOrder: number; position: number }> {
	// Sort all players by sabermetric score
	const ranked = positionPlayers.map(p => ({
		...p,
		score: calculateHitterScore(p.player)
	})).sort((a, b) => b.score - a.score);

	const lineup: Array<{ player: BatterStats; battingOrder: number; position: number }> = [];
	const used = new Set<string>();

	// Helper to find best unused player at preferred position(s)
	const assignToSlot = (
		slot: number,
		preferredPositions: number[],
		fallbackPositions: number[]
	) => {
		// Try preferred positions first
		for (const pos of preferredPositions) {
			const candidate = ranked.find(r =>
				r.position === pos && !used.has(r.player.id)
			);
			if (candidate) {
				lineup.push({
					player: candidate.player,
					battingOrder: slot,
					position: candidate.position
				});
				used.add(candidate.player.id);
				return true;
			}
		}

		// Try fallback positions
		for (const pos of fallbackPositions) {
			const candidate = ranked.find(r =>
				r.position === pos && !used.has(r.player.id)
			);
			if (candidate) {
				lineup.push({
					player: candidate.player,
					battingOrder: slot,
					position: candidate.position
				});
				used.add(candidate.player.id);
				return true;
			}
		}

		// Last resort: any unused player
		const anyUnused = ranked.find(r => !used.has(r.player.id));
		if (anyUnused) {
			lineup.push({
				player: anyUnused.player,
				battingOrder: slot,
				position: anyUnused.position
			});
			used.add(anyUnused.player.id);
			return true;
		}

		return false;
	};

	// Slot 1: Leadoff (high OBP, speed) - CF, 2B, SS preferred
	assignToSlot(1, [8, 4, 6], [7, 9]);

	// Slot 2: Contact, avoid DP - 2B, SS, 3B
	assignToSlot(2, [4, 6, 5], [3, 8]);

	// Slot 3: Best overall hitter - 1B, RF, CF
	assignToSlot(3, [3, 9, 8], [7, 4]);

	// Slot 4: Cleanup, power - 1B, LF, RF
	assignToSlot(4, [3, 7, 9], [5, 8]);

	// Slot 5: Protect cleanup - LF, 3B, 1B
	assignToSlot(5, [7, 5, 3], [9, 4]);

	// Slot 6: Secondary power - RF, 3B, LF
	assignToSlot(6, [9, 5, 7], [3, 8]);

	// Slot 7: Defense/contact - C, 2B, SS
	assignToSlot(7, [2, 4, 6], [5, 3]);

	// Slot 8: Weakest position player - C, SS
	assignToSlot(8, [2, 6], [4, 5]);

	return lineup;
}

/**
 * Filter available players based on usage context
 * @param batters - All batters to filter
 * @param usageContext - Optional usage tracking context
 * @returns Available players (below threshold) and rested players (above threshold)
 */
function filterAvailablePlayers(
	batters: BatterStats[],
	usageContext?: UsageContext
): { available: BatterStats[]; rested: BatterStats[]; warnings: string[] } {
	const warnings: string[] = [];
	const restThreshold = usageContext?.restThreshold ?? 1.25;

	const available: BatterStats[] = [];
	const rested: BatterStats[] = [];

	for (const batter of batters) {
		const usage = usageContext?.playerUsage.get(batter.id) ?? 0;
		if (usage > restThreshold) {
			rested.push(batter);
			warnings.push(`Resting ${batter.name} (${(usage * 100).toFixed(0)}% of actual usage)`);
		} else {
			available.push(batter);
		}
	}

	return { available, rested, warnings };
}

/**
 * Apply randomness to a lineup by swapping adjacent players
 * @param lineup - The lineup slots to randomize
 * @param randomness - Randomness factor (0-1)
 * @returns Lineup with random swaps applied
 */
function applyRandomness(lineup: LineupSlot[], randomness: number): LineupSlot[] {
	if (randomness <= 0) return lineup;

	const result = [...lineup];
	const numSwaps = Math.floor(randomness * 3) + 1; // 1-3 swaps based on randomness

	for (let i = 0; i < numSwaps; i++) {
		if (Math.random() < randomness) {
			const idx = Math.floor(Math.random() * (result.length - 1)); // 0 to length-2
			const temp = result[idx];
			result[idx] = result[idx + 1]!;
			result[idx + 1] = temp!;
		}
	}

	return result;
}

/**
 * Insert pitcher into batting order
 * @param lineup - Current lineup slots
 * @param pitcherId - Starting pitcher ID
 * @param usesDH - Whether this game uses DH
 * @returns Lineup with pitcher added
 */
function insertPitcher(lineup: LineupSlot[], pitcherId: string, usesDH: boolean): LineupSlot[] {
	if (usesDH) {
		// With DH, pitcher is not in batting order
		return lineup;
	}
	// Without DH, pitcher bats 9th
	return [...lineup, { playerId: pitcherId, position: POSITIONS.PITCHER }];
}

/**
 * Handle position scarcity by using rested players or emergency assignments
 * @param lineup - Current lineup
 * @param rested - Players who were rested (can be used in emergency)
 * @param allBatters - All available batters
 * @param allowEmergency - Whether to allow emergency starts from rested players
 * @param warnings - Array to collect warnings
 * @returns Lineup with positions filled
 */
function handlePositionScarcity(
	lineup: LineupSlot[],
	rested: BatterStats[],
	allBatters: BatterStats[],
	allowEmergency: boolean,
	warnings: string[]
): LineupSlot[] {
	const positionCounts = new Map<number, number>();
	for (const slot of lineup) {
		positionCounts.set(slot.position, (positionCounts.get(slot.position) ?? 0) + 1);
	}

	// Check if all positions are filled (8 positions for non-DH, 9 for DH)
	const positionsNeeded = new Set(POSITION_PRIORITY);
	const filledPositions = new Set(lineup.map(s => s.position).filter(p => positionsNeeded.has(p)));

	if (filledPositions.size >= 8) {
		return lineup; // All positions filled
	}

	// Try to fill missing positions with rested players
	if (allowEmergency && rested.length > 0) {
		for (const position of POSITION_PRIORITY) {
			if (filledPositions.has(position)) continue;

			// Find rested player who can play this position
			const emergency = rested.find(b =>
				b.primaryPosition === position ||
				(b.positionEligibility[position] ?? 0) > 0
			);

			if (emergency) {
				lineup.push({ playerId: emergency.id, position });
				filledPositions.add(position);
				warnings.push(`Emergency start: ${emergency.name} at ${getPositionName(position)} (was rested)`);
			}
		}
	}

	return lineup;
}

/**
 * Convert strategy output slots to app LineupSlot format
 * The model package uses battingOrder/fieldingPosition, app uses position
 */
function convertToAppLineupSlot(strategySlot: import('@bb/model').LineupSlot): LineupSlot {
	return {
		playerId: strategySlot.playerId,
		position: strategySlot.fieldingPosition
	};
}

/**
 * Build batting order using era-specific strategy
 * @param assignedPlayers - Players with assigned positions
 * @param strategy - Era strategy to use
 * @param usesDH - Whether DH is used
 * @returns Batting order with positions
 */
function buildEraAwareBattingOrder(
	assignedPlayers: Array<{ player: BatterStats; position: number }>,
	strategy: EraStrategy,
	usesDH: boolean
): Array<{ player: BatterStats; battingOrder: number; position: number }> {
	// Convert to model package format for strategy function
	const batters = assignedPlayers.map(ap => ({
		...ap.player,
		// Convert vsLHP/vsRHP to vsLeft/vsRight for model package
		rates: {
			vsLeft: ap.player.rates.vsLHP,
			vsRight: ap.player.rates.vsRHP
		}
	}));

	// Get strategy function and generate lineup
	const strategyFn = getStrategyFunction(strategy);
	const strategyLineup = strategyFn(batters);

	// Map strategy output back to our format
	return strategyLineup.map((slot, i) => {
		const player = assignedPlayers.find(ap => ap.player.id === slot.playerId);
		if (!player) {
			throw new Error(`Player ${slot.playerId} not found in assigned players`);
		}
		return {
			player: player.player,
			battingOrder: i + 1,
			position: player.position // Use the assigned position, not the strategy's position
		};
	});
}

/**
 * Internal implementation of lineup building with era awareness
 */
function buildLineupImpl(
	batters: Record<string, BatterStats>,
	pitchers: Record<string, PitcherStats>,
	teamId: string,
	league: string,
	year: number,
	usageContext?: UsageContext,
	options?: EraLineupOptions
): LineupBuildResult {
	const warnings: string[] = [];

	// Filter players for this team
	const teamBatters = Object.values(batters).filter(b => b.teamId === teamId);
	const teamPitchers = Object.values(pitchers).filter(p => p.teamId === teamId);

	// Validate roster
	if (teamBatters.length < 9) {
		throw new Error(`Team ${teamId} has only ${teamBatters.length} batters, need at least 9 position players`);
	}
	if (teamPitchers.length === 0) {
		throw new Error(`Team ${teamId} has no pitchers available`);
	}

	// Exclude pitchers from position players
	let positionPlayers = teamBatters.filter(b => b.primaryPosition !== POSITIONS.PITCHER);

	if (positionPlayers.length < 8) {
		throw new Error(`Team ${teamId} has only ${positionPlayers.length} position players (excluding pitchers), need at least 8`);
	}

	// Usage-aware lineup building: prefer players with lower current usage
	// This distributes playing time across the roster and prevents overuse
	if (usageContext) {
		const restThreshold = usageContext.restThreshold ?? 1.25;
		let overusedCount = 0;
		let underusedCount = 0;
		for (const player of positionPlayers) {
			const usage = usageContext.playerUsage.get(player.id) ?? 0;
			if (usage > restThreshold) {
				overusedCount++;
			} else if (usage < 0.75) {
				underusedCount++;
			}
		}

		console.log('[buildLineup] Usage-aware lineup building:', {
			teamId,
			totalPositionPlayers: positionPlayers.length,
			underusedCount,
			overusedCount,
			note: 'Prefer selecting underused players to distribute playing time'
		});
	}

	// Select starting pitcher
	const startingPitcher = selectStartingPitcher(teamPitchers);

	// Check if this game uses DH
	const dhGame = options?.useDH ?? usesDH(league, year);

	// Detect era strategy
	const era: EraDetection = options?.strategy
		? { primary: options.strategy, secondary: null, blendFactor: 1 }
		: getEraStrategy(year);

	console.log('[buildLineup] Era detection:', {
		year,
		teamId,
		primary: era.primary,
		secondary: era.secondary,
		blendFactor: era.blendFactor
	});

	// Assign fielding positions with usage awareness
	const positionAssignments = assignPositions(positionPlayers, usageContext);

	// Build list of assigned players
	const assignedPlayers: Array<{ player: BatterStats; position: number }> = [];
	for (const [playerId, position] of positionAssignments) {
		const player = batters[playerId];
		if (player) {
			assignedPlayers.push({ player, position });
		}
	}

	// Build batting order using era-specific strategy
	let battingOrder = buildEraAwareBattingOrder(assignedPlayers, era.primary, dhGame);

	// If in transition era, generate secondary lineup and blend
	if (era.secondary && era.blendFactor < 1) {
		const secondaryBattingOrder = buildEraAwareBattingOrder(assignedPlayers, era.secondary, dhGame);

		// Convert to model package LineupSlot format for blending
		const primarySlots: import('@bb/model').LineupSlot[] = battingOrder.map((slot, i) => ({
			playerId: slot.player.id,
			battingOrder: i + 1,
			fieldingPosition: slot.position
		}));
		const secondarySlots: import('@bb/model').LineupSlot[] = secondaryBattingOrder.map((slot, i) => ({
			playerId: slot.player.id,
			battingOrder: i + 1,
			fieldingPosition: slot.position
		}));

		// Use imported blendLineups function from model package
		const blendedSlots = blendLineups(primarySlots, secondarySlots, era.blendFactor);

		// Convert back to app's batting order format
		battingOrder = blendedSlots.map((slot) => {
			const player = assignedPlayers.find(ap => ap.player.id === slot.playerId);
			if (!player) {
				throw new Error(`Player ${slot.playerId} not found in assigned players after blending`);
			}
			return {
				player: player.player,
				battingOrder: slot.battingOrder,
				position: slot.fieldingPosition
			};
		});

		console.log('[buildLineup] Blended strategies:', {
			primary: era.primary,
			secondary: era.secondary,
			blendFactor: era.blendFactor
		});
	}

	// Apply randomness if specified
	if (options?.randomness && options.randomness > 0) {
		battingOrder = battingOrder.map((slot, i) => ({
			...slot,
			battingOrder: i + 1
		}));
		// Apply randomness by shuffling
		const numSwaps = Math.floor(options.randomness * 3);
		for (let i = 0; i < numSwaps; i++) {
			const idx1 = Math.floor(Math.random() * battingOrder.length);
			const idx2 = Math.floor(Math.random() * battingOrder.length);
			if (idx1 !== idx2) {
				const temp = battingOrder[idx1]!.battingOrder;
				battingOrder[idx1]!.battingOrder = battingOrder[idx2]!.battingOrder;
				battingOrder[idx2]!.battingOrder = temp;
			}
		}
	}

	// Apply rest checks if usage context is provided
	if (usageContext) {
		const restThreshold = usageContext.restThreshold ?? 1.25; // Default 125%
		const usedIds = new Set(battingOrder.map(b => b.player.id));

		// Build bench from team batters not in current lineup
		const bench = positionPlayers.filter(p => !usedIds.has(p.id));

		// Debug: Log usage context
		console.log('[buildLineup] Usage context provided:', {
			teamId,
			restThreshold,
			playerCount: usageContext.playerUsage.size,
			overusedPlayers: Array.from(usageContext.playerUsage.entries())
				.filter(([_, usage]) => usage > restThreshold)
				.map(([id, usage]) => ({ id, usage: (usage * 100).toFixed(0) + '%' }))
		});

		// Check each batter in the lineup for overuse
		let restCount = 0;
		for (let i = 0; i < battingOrder.length; i++) {
			const slot = battingOrder[i]!;
			const usage = usageContext.playerUsage.get(slot.player.id);

			// If player is over the threshold, find a replacement
			if (usage !== undefined && usage > restThreshold) {
				console.log(`[buildLineup] Player ${slot.player.name} is overused: ${(usage * 100).toFixed(0)}% > ${restThreshold * 100}%`);
				// Find first available bench player who can play this position
				const replacement = bench.find(b =>
					b.id !== slot.player.id &&
					(b.primaryPosition === slot.position ||
						(b.positionEligibility[slot.position] ?? 0) > 0)
				);

				if (replacement) {
					restCount++;
					warnings.push(`Resting ${slot.player.name} (${(usage * 100).toFixed(0)}% of actual), replacing with ${replacement.name}`);
					// Replace in batting order
					battingOrder = [
						...battingOrder.slice(0, i),
						{ ...slot, player: replacement },
						...battingOrder.slice(i + 1)
					];
					// Remove replacement from bench
					const benchIndex = bench.indexOf(replacement);
					if (benchIndex > -1) {
						bench.splice(benchIndex, 1);
					}
				} else {
					warnings.push(`WARNING: ${slot.player.name} is overused at ${(usage * 100).toFixed(0)}% of actual but no replacement available`);
				}
			}
		}

		if (restCount > 0) {
			console.log(`[buildLineup] Rested ${restCount} overused players for ${teamId}`);
		}
	}

	// Build final lineup slots
	const lineupSlots: LineupSlot[] = [];

	if (dhGame) {
		// With DH: Need 9 position players
		// If we have more than 8 position players, the best remaining hitter becomes DH
		const usedIds = new Set(battingOrder.map(b => b.player.id));
		const remainingHitters = positionPlayers
			.filter(p => !usedIds.has(p.id))
			.map(p => ({ player: p, position: POSITIONS.DH, score: calculateHitterScore(p) }))
			.sort((a, b) => b.score - a.score);

		// Add the 8 position players to lineup
		for (const slot of battingOrder) {
			lineupSlots.push({
				playerId: slot.player.id,
				position: slot.position
			});
		}

		// Add DH in 9th spot
		if (remainingHitters.length > 0) {
			const dh = remainingHitters[0]!;
			lineupSlots.push({
				playerId: dh.player.id,
				position: POSITIONS.DH
			});
		} else {
			// No DH available - this is an error state
			throw new Error(`Team ${teamId} is using DH but has no available DH batter`);
		}
	} else {
		// Without DH: Pitcher bats 9th
		// Add 8 position players
		for (const slot of battingOrder) {
			lineupSlots.push({
				playerId: slot.player.id,
				position: slot.position
			});
		}

		// Add pitcher in 9th spot
		lineupSlots.push({
			playerId: startingPitcher.id,
			position: POSITIONS.PITCHER
		});
	}

	// Create LineupState
	const lineup: LineupState = {
		teamId,
		players: lineupSlots,
		currentBatterIndex: 0,
		pitcher: startingPitcher.id
	};

	return {
		lineup,
		startingPitcher,
		warnings,
		era
	};
}

/**
 * Build a complete valid lineup for a team with era-aware strategy
 *
 * @param batters - All batters in the season
 * @param pitchers - All pitchers in the season
 * @param teamId - ID of the team to build lineup for
 * @param league - 'AL' or 'NL'
 * @param year - Season year (for DH rules and era detection)
 * @param usageContext - Optional context for player usage tracking
 * @param options - Optional era lineup options (strategy override, randomness, etc.)
 * @returns LineupBuildResult with lineup, starting pitcher, warnings, and era info
 */
export function buildLineup(
	batters: Record<string, BatterStats>,
	pitchers: Record<string, PitcherStats>,
	teamId: string,
	league: string,
	year: number,
	usageContext?: UsageContext,
	options?: EraLineupOptions
): LineupBuildResult {
	return buildLineupImpl(batters, pitchers, teamId, league, year, usageContext, options);
}

/**
 * Internal implementation of lineup building
 */
export { buildLineupImpl };

// Re-export era detection and strategy functions from model package for convenience
export {
	getEraStrategy,
	isTransitionYear,
	getPureEraStrategy,
	getStrategyFunction,
	blendLineups
} from '@bb/model';
