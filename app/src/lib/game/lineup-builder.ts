/**
 * MLB Lineup Builder Algorithm
 *
 * Creates valid baseball lineups following traditional MLB patterns:
 * - Position assignment prioritizes "up the middle" positions (C → SS → 2B → CF → 3B → 1B → LF/RF)
 * - Traditional batting order construction (leadoff high OBP, cleanup power, etc.)
 * - Historical DH rules (AL 1973+, NL 2022+)
 * - Starting pitcher selection by quality score (ERA, WHIP, CG rate)
 */

import type {
	BatterStats,
	PitcherStats,
	LineupState,
	LineupSlot
} from './types.js';

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
	players: BatterStats[]
): Map<string, number> {
	const assigned = new Map<string, number>();
	const usedPlayers = new Set<string>();
	const warnings: string[] = [];

	// Track which players are eligible at which positions
	const playerPool = new Map<string, BatterStats>(
		players.map(p => [p.id, p])
	);

	// Fill positions in priority order
	for (const position of POSITION_PRIORITY) {
		// First priority: Find someone whose PRIMARY position is this position
		// When multiple players have the same primary position, select the best one
		const primaryCandidates = players.filter(p =>
			!usedPlayers.has(p.id) && p.primaryPosition === position
		);

		let primaryPlayer: BatterStats | undefined;
		if (primaryCandidates.length > 0) {
			// Sort by PA (primary starter had more playing time), then by OBP
			primaryCandidates.sort((a, b) => b.pa - a.pa || calculateOBP(b) - calculateOBP(a));
			primaryPlayer = primaryCandidates[0];
		}

		if (primaryPlayer) {
			assigned.set(primaryPlayer.id, position);
			usedPlayers.add(primaryPlayer.id);
			playerPool.delete(primaryPlayer.id);
			continue;
		}

		// Second priority: Find someone with secondary eligibility at this position
		// Sort by outs played at this position (descending) to get most experienced
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
			// Sort by most outs at this position, then by OBP
			secondaryPlayers.sort((a, b) => b.outs - a.outs || b.score - a.score);
			const best = secondaryPlayers[0];
			assigned.set(best.player.id, position);
			usedPlayers.add(best.player.id);
			playerPool.delete(best.player.id);
		}

		if (!assigned.has(Array.from(assigned.keys()).find(id => assigned.get(id) === position) ?? '')) {
			// Still couldn't fill - will fail validation later
			warnings.push(`WARNING: Unable to fill ${getPositionName(position)} position`);
		}
	}

	// Validate we filled all 8 positions
	if (assigned.size < 8) {
		throw new Error(`Only able to assign ${assigned.size} positions, need 8. Team may have incomplete roster data.`);
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
 * Internal implementation of lineup building
 */
function buildLineupImpl(
	batters: Record<string, BatterStats>,
	pitchers: Record<string, PitcherStats>,
	teamId: string,
	league: string,
	year: number,
	usageContext?: UsageContext
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
	const positionPlayers = teamBatters.filter(b => b.primaryPosition !== POSITIONS.PITCHER);

	if (positionPlayers.length < 8) {
		throw new Error(`Team ${teamId} has only ${positionPlayers.length} position players (excluding pitchers), need at least 8`);
	}

	// Select starting pitcher
	const startingPitcher = selectStartingPitcher(teamPitchers);

	// Check if this game uses DH
	const dhGame = usesDH(league, year);

	// Assign fielding positions
	const positionAssignments = assignPositions(positionPlayers);

	// Build list of assigned players
	const assignedPlayers: Array<{ player: BatterStats; position: number }> = [];
	for (const [playerId, position] of positionAssignments) {
		const player = batters[playerId];
		if (player) {
			assignedPlayers.push({ player, position });
		}
	}

	// Build batting order for position players
	let battingOrder = buildBattingOrder(assignedPlayers, dhGame);

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
		warnings
	};
}

/**
 * Build a complete valid lineup for a team
 *
 * @param batters - All batters in the season
 * @param pitchers - All pitchers in the season
 * @param teamId - ID of the team to build lineup for
 * @param league - 'AL' or 'NL'
 * @param year - Season year (for DH rules)
 * @param usageContext - Optional context for player usage tracking
 * @returns LineupBuildResult with lineup, starting pitcher, and any warnings
 */
export function buildLineup(
	batters: Record<string, BatterStats>,
	pitchers: Record<string, PitcherStats>,
	teamId: string,
	league: string,
	year: number,
	usageContext?: UsageContext
): LineupBuildResult {
	return buildLineupImpl(batters, pitchers, teamId, league, year, usageContext);
}

/**
 * Internal implementation of lineup building
 */
export { buildLineupImpl };
