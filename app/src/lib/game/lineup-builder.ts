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
 * Select players to rest based on prorated usage threshold
 *
 * Logic:
 * 1. Find all players over 105% prorated usage
 * 2. Order them by usage % (highest first)
 * 3. Try to rest each one, but only if a valid lineup can still be formed
 * 4. Never rest more than 3 players
 *
 * @param positionPlayers - All available position players
 * @param usageContext - Current usage tracking data
 * @param restThreshold - Usage threshold for resting (default 1.05 = 105%)
 * @returns Set of player IDs to rest
 */
function selectPlayersToRest(
	positionPlayers: BatterStats[],
	usageContext?: UsageContext,
	restThreshold: number = 1.05
): Set<string> {
	const restedPlayers = new Set<string>();

	if (!usageContext) {
		console.log('[selectPlayersToRest] No usageContext provided, skipping resting logic');
		return restedPlayers; // No usage context, no resting
	}

	console.log(`[selectPlayersToRest] Threshold: ${(restThreshold * 100).toFixed(0)}%, playerUsage map size: ${usageContext.playerUsage.size}`);

	// Debug: log all players' usage to understand what's happening
	console.log('[selectPlayersToRest] All position players usage:', positionPlayers.map(
		p => `${p.name} (${p.id.slice(0, 12)}...): usage=${((usageContext.playerUsage.get(p.id) ?? 0) * 100).toFixed(0)}%`
	));

	// Find all players over the threshold and order by usage % (highest first)
	const overusedPlayers = positionPlayers
		.map(p => ({ player: p, usage: usageContext.playerUsage.get(p.id) ?? 0 }))
		.filter(({ usage }) => usage > restThreshold)
		.sort((a, b) => b.usage - a.usage); // Highest usage first

	if (overusedPlayers.length === 0) {
		console.log(`[selectPlayersToRest] No players over threshold (${(restThreshold * 100).toFixed(0)}%)`);
		return restedPlayers;
	}

	console.log('[selectPlayersToRest] Found overused players:', overusedPlayers.map(
		({ player, usage }) => `${player.name}: ${(usage * 100).toFixed(0)}%`
	));

	// Helper to check if a valid lineup can be formed with remaining players
	// This simulates the actual position assignment logic to ensure we can fill all 8 positions
	// Uses the SAME logic as assignPositions() to ensure consistency
	function canFormValidLineup(availablePlayers: BatterStats[]): boolean {
		// Need at least 8 unique position players for non-DH
		if (availablePlayers.length < 8) {
			console.log(`[canFormValidLineup] FAIL: Only ${availablePlayers.length} players available, need 8`);
			return false;
		}

		// Use the SAME position priority order and logic as assignPositions()
		const usedPlayers = new Set<string>();

		console.log(`[canFormValidLineup] Checking with ${availablePlayers.length} players:`, availablePlayers.map(p => `${p.name} (${p.primaryPosition})`));

		for (const position of POSITION_PRIORITY) {
			const positionName = getPositionName(position);

			// First priority: Find ALL players whose PRIMARY position is this position
			// This matches assignPositions() which gets all primary candidates and sorts by PA
			const primaryCandidates = availablePlayers.filter(p =>
				!usedPlayers.has(p.id) && p.primaryPosition === position
			);

			if (primaryCandidates.length > 0) {
				// Pick the one with most PA (same as assignPositions())
				const selected = primaryCandidates.sort((a, b) => b.pa - a.pa)[0]!;
				usedPlayers.add(selected.id);
				console.log(`[canFormValidLineup] ${positionName}: ${selected.name} (primary, PA: ${selected.pa})`);
				continue;
			}

			// Second priority: Find ALL players with secondary eligibility
			// This matches assignPositions() which collects all secondary candidates and sorts by experience
			const secondaryCandidates: Array<{ player: BatterStats; outs: number; score: number }> = [];

			for (const player of availablePlayers) {
				if (usedPlayers.has(player.id)) continue;

				const outsAtPosition = player.positionEligibility[position];
				if (outsAtPosition && outsAtPosition > 0) {
					secondaryCandidates.push({
						player,
						outs: outsAtPosition,
						score: calculateOBP(player)
					});
				}
			}

			if (secondaryCandidates.length > 0) {
				// Sort by experience (outs), then by OBP (same as assignPositions())
				secondaryCandidates.sort((a, b) => {
					if (Math.abs(b.outs - a.outs) > 100) {
						return b.outs - a.outs;
					}
					return b.score - a.score;
				});

				const selected = secondaryCandidates[0]!;
				usedPlayers.add(selected.player.id);
				console.log(`[canFormValidLineup] ${positionName}: ${selected.player.name} (secondary, outs: ${selected.outs})`);
				continue;
			}

			// Can't fill this position
			console.log(`[canFormValidLineup] FAIL: Cannot fill ${positionName}`);
			return false;
		}

		console.log(`[canFormValidLineup] SUCCESS: Can fill all 8 positions`);
		return true;
	}

	// Try to rest each overused player
	// Rest ALL overused players that can be rested while still forming a valid lineup
	// No hard limit - if a team has 10 overused players and enough depth, rest all 10
	for (const { player, usage } of overusedPlayers) {
		// Check if we can form a valid lineup without this player (and without already-rested players)
		const availableWithoutThis = positionPlayers.filter(p =>
			p.id !== player.id && !restedPlayers.has(p.id)
		);

		if (canFormValidLineup(availableWithoutThis)) {
			restedPlayers.add(player.id);
			console.log(`[selectPlayersToRest] Resting ${player.name} at ${(usage * 100).toFixed(0)}% usage (${restedPlayers.size} rested)`);
		} else {
			console.log(`[selectPlayersToRest] Cannot rest ${player.name} at ${(usage * 100).toFixed(0)}% usage - would leave invalid lineup, continuing to next player`);
			// Continue to next player instead of breaking
		}
	}

	return restedPlayers;
}

/**
 * Player with weight for position selection
 */
interface WeightedPlayer {
	player: BatterStats;
	weight: number; // Selection probability (0-1)
	innings: number; // Innings played at this position
}

/**
 * Build position pools with innings-based weights
 * For each position, calculate each player's weight based on their innings at that position
 * Minimum 50 outs (innings * 3) to be considered eligible for a position
 */
function buildPositionPools(
	players: BatterStats[]
): Map<number, Array<WeightedPlayer>> {
	const MIN_OUTS = 50; // Minimum outs to be considered eligible
	const pools = new Map<number, Array<WeightedPlayer>>();

	// Initialize pools for all 8 fielding positions
	for (const position of POSITION_PRIORITY) {
		pools.set(position, []);
	}

	// For each player, add them to each position they're eligible for
	for (const player of players) {
		// Check each position for eligibility
		for (const position of POSITION_PRIORITY) {
			const outsAtPosition = player.positionEligibility[position] || 0;

			// Skip if insufficient experience (less than MIN_OUTS)
			if (outsAtPosition < MIN_OUTS) {
				continue;
			}

			const pool = pools.get(position);
			if (pool) {
				pool.push({
					player,
					weight: 0, // Will be calculated after all players are added
					innings: outsAtPosition / 3 // Convert outs to innings
				});
			}
		}
	}

	// Calculate weights for each position pool
	for (const [position, pool] of pools) {
		const totalInnings = pool.reduce((sum, wp) => sum + wp.innings, 0);

		if (totalInnings === 0) {
			// No eligible players for this position
			pools.set(position, []);
			continue;
		}

		// Set weight = player's innings / total innings at position
		for (const wp of pool) {
			wp.weight = wp.innings / totalInnings;
		}

		console.log(`[buildPositionPools] ${getPositionName(position)}: ${pool.length} players, ${totalInnings.toFixed(0)} total innings`);
		for (const wp of pool) {
			console.log(`  - ${wp.player.name}: ${wp.innings.toFixed(0)} innings (${(wp.weight * 100).toFixed(1)}% weight)`);
		}
	}

	return pools;
}

/**
 * Get positions ordered by scarcity (fewest eligible players first)
 */
function getPositionScarcityOrder(
	pools: Map<number, Array<WeightedPlayer>>
): number[] {
	const positionCounts = POSITION_PRIORITY.map(position => ({
		position,
		count: (pools.get(position) || []).length
	}));

	// Sort by count (fewest players first), then by POSITION_PRIORITY as tiebreaker
	positionCounts.sort((a, b) => {
		if (a.count !== b.count) {
			return a.count - b.count; // Fewest players first
		}
		// Tiebreaker: use original POSITION_PRIORITY order
		return POSITION_PRIORITY.indexOf(a.position) - POSITION_PRIORITY.indexOf(b.position);
	});

	console.log(`[getPositionScarcityOrder] Scarcity order:`, positionCounts.map(pc => `${getPositionName(pc.position)} (${pc.count} players)`));

	return positionCounts.map(pc => pc.position);
}

/**
 * Try to assign players to remaining positions using backtracking
 * Returns true if successful, false otherwise
 */
function tryAssignRemaining(
	positionIndex: number,
	positions: number[],
	pools: Map<number, Array<WeightedPlayer>>,
	assigned: Map<string, number>,
	assignedPlayers: Set<string>
): boolean {
	// Base case: all positions filled
	if (positionIndex >= positions.length) {
		return true;
	}

	const position = positions[positionIndex];
	const pool = pools.get(position) || [];

	// Filter out already-assigned players
	const availablePool = pool.filter(wp => !assignedPlayers.has(wp.player.id));

	// Try each available player
	for (const wp of availablePool) {
		// Assign this player
		assigned.set(wp.player.id, position);
		assignedPlayers.add(wp.player.id);

		// Recurse to next position
		if (tryAssignRemaining(positionIndex + 1, positions, pools, assigned, assignedPlayers)) {
			return true;
		}

		// Backtrack: remove assignment
		assigned.delete(wp.player.id);
		assignedPlayers.delete(wp.player.id);
	}

	// No valid assignment found
	return false;
}

/**
 * Assign fielding positions using innings-weighted random selection with backtracking
 *
 * NEW APPROACH:
 * 1. Build position pools with innings-based weights
 * 2. Use backtracking to ensure all 8 positions can be filled
 * 3. For each position, randomly select from pool based on innings weight
 *
 * This naturally distributes playing time based on actual season usage patterns.
 * A player with 50% of innings at 1B gets selected ~50% of the time for 1B.
 */
function assignPositions(
	players: BatterStats[],
	usageContext?: UsageContext
): Map<string, number> {
	console.log(`[assignPositions] Assigning positions for ${players.length} players using innings-weighted selection`);

	// Quick check: if we have fewer than 8 players, we can't fill all positions
	if (players.length < 8) {
		console.error(`[assignPositions] FAIL: Only ${players.length} players available, need at least 8`);
		throw new Error(`Only ${players.length} players available for position assignment, need at least 8. Check roster data or resting logic.`);
	}

	// Build position pools
	const pools = buildPositionPools(players);

	// Get positions ordered by scarcity (fewest players first)
	const scarcityOrder = getPositionScarcityOrder(pools);

	// Try to assign using backtracking (shuffle for randomness)
	const maxAttempts = 10;
	let bestAssignment: Map<string, number> | null = null;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const assigned = new Map<string, number>();
		const assignedPlayers = new Set<string>();

		// Shuffle the positions slightly for randomness (but keep scarcity order)
		const positions = [...scarcityOrder];
		if (attempt > 0) {
			// Small random swap to introduce variety
			const idx1 = Math.floor(Math.random() * Math.min(4, positions.length));
			const idx2 = Math.floor(Math.random() * positions.length);
			[positions[idx1], positions[idx2]] = [positions[idx2], positions[idx1]];
		}

		if (tryAssignRemaining(0, positions, pools, assigned, assignedPlayers)) {
			// Success! Use this assignment
			console.log(`[assignPositions] SUCCESS: Assigned all 8 positions (attempt ${attempt + 1})`);

			// Log the assignment
			for (const [playerId, position] of assigned) {
				const player = players.find(p => p.id === playerId);
				if (player) {
					console.log(`[assignPositions] ${getPositionName(position)}: ${player.name}`);
				}
			}

			return assigned;
		}

		// Keep track of best partial assignment
		if (assigned.size > (bestAssignment?.size || 0)) {
			bestAssignment = assigned;
		}
	}

	// If backtracking failed, try a simpler fallback approach
	console.warn(`[assignPositions] Backtracking failed after ${maxAttempts} attempts, trying fallback...`);

	// Fallback: Use a simpler greedy approach
	const assigned = new Map<string, number>();
	const assignedPlayers = new Set<string>();

	// First, assign players to their primary positions
	for (const position of POSITION_PRIORITY) {
		const primaryPlayers = players.filter(p =>
			p.primaryPosition === position && !assignedPlayers.has(p.id)
		);

		if (primaryPlayers.length > 0) {
			// Sort by PA (prefer higher-quality players)
			primaryPlayers.sort((a, b) => b.pa - a.pa);
			const selected = primaryPlayers[0];
			assigned.set(selected.id, position);
			assignedPlayers.add(selected.id);
			console.log(`[assignPositions] Fallback: ${getPositionName(position)}: ${selected.name} (primary)`);
			continue;
		}

		// No primary player, look for secondary eligibility
		const secondaryPlayers: Array<{ player: BatterStats; innings: number }> = [];
		for (const player of players) {
			if (assignedPlayers.has(player.id)) continue;

			const inningsAtPosition = (player.positionEligibility[position] || 0) / 3;
			if (inningsAtPosition > 0) {
				secondaryPlayers.push({ player, innings: inningsAtPosition });
			}
		}

		if (secondaryPlayers.length > 0) {
			// Sort by innings (most experienced first)
			secondaryPlayers.sort((a, b) => b.innings - a.innings);
			const selected = secondaryPlayers[0];
			assigned.set(selected.player.id, position);
			assignedPlayers.add(selected.player.id);
			console.log(`[assignPositions] Fallback: ${getPositionName(position)}: ${selected.player.name} (secondary, ${selected.innings.toFixed(0)} innings)`);
			continue;
		}

		// Last resort: any remaining player (even without eligibility)
		const remainingPlayer = players.find(p => !assignedPlayers.has(p.id));
		if (remainingPlayer) {
			assigned.set(remainingPlayer.id, position);
			assignedPlayers.add(remainingPlayer.id);
			console.log(`[assignPositions] Fallback: ${getPositionName(position)}: ${remainingPlayer.name} (EMERGENCY - no eligibility)`);
		}
	}

	// Validate we filled all 8 positions
	if (assigned.size < 8) {
		console.error(`[assignPositions] FAIL: Even fallback only assigned ${assigned.size}/8 positions`);
		console.error(`[assignPositions] Player count: ${players.length}`);
		throw new Error(`Only able to assign ${assigned.size} positions, need 8. Team may have incomplete roster data or missing position eligibility data.`);
	}

	console.log(`[assignPositions] SUCCESS: Fallback assigned all 8 positions`);
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
	// IMPORTANT: Filter by BOTH primaryPosition AND pitchers table
	// Some players are in batters table but are actually pitchers (have pitcher data)
	console.log(`[buildLineupImpl] Filter: teamBatters=${teamBatters.length}, pitchers=${Object.keys(pitchers).length}`);
	let positionPlayers = teamBatters.filter(b => {
		const isPitcherByPrimary = b.primaryPosition === POSITIONS.PITCHER;
		const isPitcherInTable = !!pitchers[b.id];
		const excluded = isPitcherByPrimary || isPitcherInTable;
		if (excluded) {
			console.log(`[buildLineupImpl] Excluding pitcher ${b.name} (${b.id}): primaryPosition=${b.primaryPosition}, inPitchersTable=${isPitcherInTable}`);
		}
		return !excluded;
	});
	console.log(`[buildLineupImpl] After filter: positionPlayers=${positionPlayers.length}`);

	if (positionPlayers.length < 8) {
		throw new Error(`Team ${teamId} has only ${positionPlayers.length} position players (excluding pitchers), need at least 8`);
	}

	// Usage-aware lineup building: prefer players with lower current usage
	// This distributes playing time across the roster and prevents overuse
	if (usageContext) {
		const restThreshold = usageContext.restThreshold ?? 1.05; // Default 105%
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
			restThreshold: (restThreshold * 100).toFixed(0) + '%',
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

	// Select players to rest based on usage (before position assignment)
	const restThreshold = usageContext?.restThreshold ?? 1.05; // Default 105%
	const restedPlayerIds = selectPlayersToRest(positionPlayers, usageContext, restThreshold);

	// Filter out rested players from position assignment pool
	const availablePlayers = positionPlayers.filter(p => !restedPlayerIds.has(p.id));

	console.log(`[buildLineupImpl] After resting: ${availablePlayers.length} players available from ${positionPlayers.length} total (rested: ${restedPlayerIds.size})`);
	console.log(`[buildLineupImpl] Available players:`, availablePlayers.map(p => `${p.name} (${p.primaryPosition})`));

	// Assign fielding positions to available (non-rested) players
	const positionAssignments = assignPositions(availablePlayers, usageContext);

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
