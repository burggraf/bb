/**
 * Baseball game engine using the MatchupModel
 */

import {
	MatchupModel,
	type ProbabilityDistribution,
	generateLineup as generateManagerialLineup,
	type LineupSlot,
	shouldPullPitcher,
	shouldPinchHit,
	selectReliever,
	type PinchHitDecision,
	type BatterStats as ModelBatterStats,
	type PitcherStats as ModelPitcherStats
} from '@bb/model';
import type {
	GameState,
	LineupState,
	PlayEvent,
	Outcome,
	SeasonPackage,
	BatterStats,
	PitcherStats,
	LineupPlayer
} from './types.js';
import { transition, createBaserunningState } from './state-machine/index.js';
import { isHit } from './state-machine/outcome-types.js';
import type { PitcherRole, BullpenState } from '@bb/model';
import { buildLineup, usesDH } from './lineup-builder.js';
import { validateLineup, type LineupValidationResult } from './lineup-validator.js';

/**
 * Convert app BatterStats to model BatterStats
 */
function toModelBatter(batter: BatterStats): ModelBatterStats {
	return {
		id: batter.id,
		name: batter.name,
		handedness: batter.bats,
		rates: {
			vsLeft: batter.rates.vsLHP,
			vsRight: batter.rates.vsRHP
		}
	};
}

/**
 * Convert app PitcherStats to model PitcherStats
 */
function toModelPitcher(pitcher: PitcherStats): ModelPitcherStats {
	return {
		id: pitcher.id,
		name: pitcher.name,
		handedness: pitcher.throws,
		rates: {
			vsLeft: pitcher.rates.vsLHB,
			vsRight: pitcher.rates.vsRHB
		}
	};
}

/**
 * Options for managerial system integration
 */
export interface ManagerialOptions {
	/** Enable managerial decisions */
	enabled?: boolean;
	/** Randomness factor for decisions (0-1) */
	randomness?: number;
	/** Lineup generation method */
	lineupMethod?: 'obp' | 'sabermetric' | 'traditional';
}

/**
 * Convert app GameState to managerial GameState interface
 */
function toManagerialGameState(state: GameState) {
	// Calculate score difference from batting team's perspective
	let awayScore = 0;
	let homeScore = 0;
	for (const play of state.plays) {
		if (play.isTopInning) {
			awayScore += play.runsScored;
		} else {
			homeScore += play.runsScored;
		}
	}

	// Score diff from batting team's perspective
	const scoreDiff = state.isTopInning ? awayScore - homeScore : homeScore - awayScore;

	return {
		inning: state.inning,
		isTopInning: state.isTopInning,
		outs: state.outs,
		bases: state.bases,
		scoreDiff
	};
}

// Get next batter in lineup
function getNextBatter(lineup: LineupState, batters: Record<string, BatterStats>): string {
	const playerId = lineup.players[lineup.currentBatterIndex].playerId;
	if (!playerId) {
		// Use a random batter as fallback
		const batterList = Object.values(batters);
		return batterList[Math.floor(Math.random() * batterList.length)].id;
	}
	return playerId;
}

// Advance to next batter
function advanceBatter(lineup: LineupState): void {
	lineup.currentBatterIndex = (lineup.currentBatterIndex + 1) % 9;
}

// Check if bases are empty
function areBasesEmpty(bases: [string | null, string | null, string | null]): boolean {
	return !bases[0] && !bases[1] && !bases[2];
}

// Format name from "Last, First" to "First Last"
function formatName(name: string): string {
	const commaIndex = name.indexOf(',');
	if (commaIndex === -1) return name;
	return `${name.slice(commaIndex + 1).trim()} ${name.slice(0, commaIndex).trim()}`;
}

// Create play description
function describePlay(
	outcome: Outcome,
	batterName: string,
	pitcherName: string,
	runsScored: number,
	outRunnerName?: string,
	outBase?: string
): string {
	const batter = formatName(batterName);
	const pitcher = formatName(pitcherName);
	const runsText = runsScored > 0 ? ` (${runsScored} run${runsScored > 1 ? 's' : ''} scored)` : '';

	switch (outcome) {
		// Hits
		case 'single':
			return `${batter} singles off ${pitcher}${runsText}`;
		case 'double':
			return `${batter} doubles off ${pitcher}${runsText}`;
		case 'triple':
			return `${batter} triples off ${pitcher}${runsText}`;
		case 'homeRun':
			return `${batter} homers off ${pitcher}${runsText}`;

		// Walks
		case 'walk':
			return `${batter} walks${runsText}`;
		case 'hitByPitch':
			return `${batter} hit by pitch from ${pitcher}${runsText}`;

		// Strikeout
		case 'strikeout':
			return `${batter} strikes out against ${pitcher}`;

		// Ball-in-play outs
		case 'groundOut':
			return `${batter} grounds out${runsText}`;
		case 'flyOut':
			return `${batter} flies out${runsText}`;
		case 'lineOut':
			return `${batter} lines out`;
		case 'popOut':
			return `${batter} pops out`;

		// Sacrifices
		case 'sacrificeFly':
			return `${batter} hits a sacrifice fly${runsText}`;
		case 'sacrificeBunt':
			return `${batter} lays down a sacrifice bunt${runsText}`;

		// Other
		case 'fieldersChoice':
			if (outRunnerName && outBase) {
				return `${batter} reaches on fielder's choice (${formatName(outRunnerName)} out at ${outBase})${runsText}`;
			}
			return `${batter} reaches on fielder's choice${runsText}`;
		case 'reachedOnError':
			return `${batter} reaches on an error${runsText}`;
		case 'catcherInterference':
			return `${batter} reaches on catcher's interference`;

		default:
			const _exhaustive: never = outcome;
			return `${batter} - ${outcome}`;
	}
}

// Add half-inning summary to plays (uses current state values - may be wrong after inning change)
function addHalfInningSummary(state: GameState, season: SeasonPackage): void {
	const isTop = state.isTopInning;
	const inning = state.inning;
	addHalfInningSummaryWithInning(state, season, inning, isTop);
}

// Add half-inning summary with explicit inning values (correct even after state changes)
function addHalfInningSummaryWithInning(state: GameState, season: SeasonPackage, summaryInning: number, summaryIsTop: boolean): void {
	const isTop = summaryIsTop;
	const inning = summaryInning;

	// Calculate runs for this half-inning
	let runs = 0;
	let hits = 0;
	let atBats = 0;
	let errors = 0;

	for (const play of state.plays) {
		if (play.inning === inning && play.isTopInning === isTop) {
			runs += play.runsScored;
			atBats++;
			if (isHit(play.outcome)) hits++;
		}
	}

	// Calculate runners left on base
	let lob = 0;
	for (let i = 0; i < 3; i++) {
		if (state.bases[i]) lob++;
	}

	// Calculate current score
	let awayScore = 0;
	let homeScore = 0;
	for (const play of state.plays) {
		if (play.isTopInning) {
			awayScore += play.runsScored;
		} else {
			homeScore += play.runsScored;
		}
	}

	// Get team names
	const awayTeam = season.teams[state.meta.awayTeam];
	const homeTeam = season.teams[state.meta.homeTeam];
	const awayName = awayTeam ? `${awayTeam.city} ${awayTeam.nickname}` : state.meta.awayTeam;
	const homeName = homeTeam ? `${homeTeam.city} ${homeTeam.nickname}` : state.meta.homeTeam;

	// Build description with LOB if applicable
	let desc = `${isTop ? 'Top' : 'Bottom'} ${inning}${getInningSuffix(inning)}: ${runs} R, ${hits} H, ${errors} E`;
	if (lob > 0) {
		desc += `, ${lob} LOB`;
	}
	desc += ` — ${awayName} ${awayScore}, ${homeName} ${homeScore}`;

	// Create summary entry
	const summary: PlayEvent = {
		inning,
		isTopInning: isTop,
		outcome: 'out' as Outcome,
		batterId: '',
		batterName: '',
		pitcherId: '',
		pitcherName: '',
		description: desc,
	runsScored: 0,
		isSummary: true,
	};

	state.plays.unshift(summary);
}

// Get inning suffix (st, nd, rd, th)
function getInningSuffix(n: number): string {
	const s = n % 10;
	if (n >= 11 && n <= 13) return 'th';
	if (s === 1) return 'st';
	if (s === 2) return 'nd';
	if (s === 3) return 'rd';
	return 'th';
}

// Position names for lineup adjustments
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

// Apply baserunning using state machine
function applyBaserunning(
	state: GameState,
	outcome: Outcome,
	batterId: string
): {
	runs: number;
	newBases: [string | null, string | null, string | null];
	scorerIds: string[];
	newOuts: 0 | 1 | 2 | 3;
	outRunnerId?: string;
} {
	// Create baserunning state from game state
	const brState = createBaserunningState(state.outs, state.bases);

	// Use state machine transition
	const result = transition(brState, outcome, batterId);

	// Convert back to game state format
	const newBases: [string | null, string | null, string | null] = [
		result.nextState.runners.first,
		result.nextState.runners.second,
		result.nextState.runners.third,
	];

	return {
		runs: result.runsScored,
		newBases,
		scorerIds: result.scorerIds,
		newOuts: result.nextState.outs,
		outRunnerId: result.outRunnerId,
	};
}

export class GameEngine {
	private model: MatchupModel;
	private season: SeasonPackage;
	private state: GameState;
	private managerialOptions: ManagerialOptions;
	// Track pitcher stamina and bullpen state
	private pitcherStamina: Map<string, PitcherRole>;
	private bullpenStates: Map<string, BullpenState>;
	// Track used pinch hitters (so they don't enter multiple times)
	private usedPinchHitters: Set<string>;
	// Track removed players (cannot return to game)
	private removedPlayers: Set<string>;
	// Track relievers (pitchers who entered mid-game - should never bat in non-DH games)
	// Using ES2022 private field syntax for better tsx compatibility
	#relievers: Set<string> = new Set();

	constructor(
		season: SeasonPackage,
		awayTeam: string,
		homeTeam: string,
		managerial?: ManagerialOptions
	) {
		this.model = new MatchupModel();
		this.season = season;
		this.managerialOptions = { enabled: true, randomness: 0.1, ...managerial };

		// Get league info for DH rules
		const awayLeague = season.teams[awayTeam]?.league ?? 'NL';
		const homeLeague = season.teams[homeTeam]?.league ?? 'NL';
		const year = season.meta.year;

		// Generate lineups using the new lineup builder
		const awayResult = buildLineup(season.batters, season.pitchers, awayTeam, awayLeague, year);
		const homeResult = buildLineup(season.batters, season.pitchers, homeTeam, homeLeague, year);

		const awayLineup: LineupState = awayResult.lineup;
		const homeLineup: LineupState = homeResult.lineup;

		// Validate initial lineups
		const awayValidation = validateLineup(awayLineup.players, season.batters);
		const homeValidation = validateLineup(homeLineup.players, season.batters);

		if (!awayValidation.isValid) {
			throw new Error(`Invalid away lineup for ${awayTeam}: ${awayValidation.errors.join(', ')}`);
		}
		if (!homeValidation.isValid) {
			throw new Error(`Invalid home lineup for ${homeTeam}: ${homeValidation.errors.join(', ')}`);
		}

		this.state = {
			meta: {
				awayTeam,
				homeTeam,
				season: season.meta.year,
			},
			inning: 1,
			isTopInning: true,
			outs: 0,
			bases: [null, null, null],
			awayLineup,
			homeLineup,
			plays: [],
			homeTeamHasBattedInInning: false,
		};

		// Initialize bullpen tracking
		this.pitcherStamina = new Map();
		this.bullpenStates = new Map();
		this.usedPinchHitters = new Set();
		this.removedPlayers = new Set();
		this.initializeBullpen(awayTeam, awayLineup.pitcher!);
		this.initializeBullpen(homeTeam, homeLineup.pitcher!);

		// Record starting lineups
		this.recordStartingLineups();
	}

	/**
	 * Format name from "Last, First" to "First Last"
	 */
	private formatName(name: string): string {
		const commaIndex = name.indexOf(',');
		if (commaIndex === -1) return name;
		return `${name.slice(commaIndex + 1).trim()} ${name.slice(0, commaIndex).trim()}`;
	}

	/**
	 * Record starting lineups for both teams
	 */
	private recordStartingLineups(): void {
		const { state, season } = this;

		// Get team names
		const awayTeam = season.teams[state.meta.awayTeam];
		const homeTeam = season.teams[state.meta.homeTeam];
		const awayName = awayTeam ? `${awayTeam.city} ${awayTeam.nickname}` : state.meta.awayTeam;
		const homeName = homeTeam ? `${homeTeam.city} ${homeTeam.nickname}` : state.meta.homeTeam;

		// Record away lineup
		const awayLineupPlayers: LineupPlayer[] = [];
		for (let i = 0; i < 9; i++) {
			const slot = state.awayLineup.players[i];
			if (slot?.playerId) {
				const player = season.batters[slot.playerId];
				awayLineupPlayers.push({
					playerId: slot.playerId,
					playerName: this.formatName(player?.name ?? 'Unknown'),
					battingOrder: i + 1,
					fieldingPosition: slot.position
				});
			}
		}

		const awayPitcherId = state.awayLineup.pitcher;
		const awayPitcher = awayPitcherId ? season.pitchers[awayPitcherId] : null;

		state.plays.unshift({
			inning: 1,
			isTopInning: true,
			outcome: 'out' as Outcome,
			batterId: '',
			batterName: '',
			pitcherId: awayPitcherId ?? '',
			pitcherName: this.formatName(awayPitcher?.name ?? 'Unknown'),
			description: `${awayName} starting lineup: ${awayLineupPlayers.map((p) => `${p.playerName} (${this.getPositionName(p.fieldingPosition)})`).join(', ')}; SP: ${this.formatName(awayPitcher?.name ?? 'Unknown')}`,
			runsScored: 0,
			eventType: 'startingLineup',
			lineup: awayLineupPlayers,
			isSummary: true
		});

		// Record home lineup
		const homeLineupPlayers: LineupPlayer[] = [];
		for (let i = 0; i < 9; i++) {
			const slot = state.homeLineup.players[i];
			if (slot?.playerId) {
				const player = season.batters[slot.playerId];
				homeLineupPlayers.push({
					playerId: slot.playerId,
					playerName: this.formatName(player?.name ?? 'Unknown'),
					battingOrder: i + 1,
					fieldingPosition: slot.position
				});
			}
		}

		const homePitcherId = state.homeLineup.pitcher;
		const homePitcher = homePitcherId ? season.pitchers[homePitcherId] : null;

		state.plays.unshift({
			inning: 1,
			isTopInning: false,
			outcome: 'out' as Outcome,
			batterId: '',
			batterName: '',
			pitcherId: homePitcherId ?? '',
			pitcherName: this.formatName(homePitcher?.name ?? 'Unknown'),
			description: `${homeName} starting lineup: ${homeLineupPlayers.map((p) => `${p.playerName} (${this.getPositionName(p.fieldingPosition)})`).join(', ')}; SP: ${this.formatName(homePitcher?.name ?? 'Unknown')}`,
			runsScored: 0,
			eventType: 'startingLineup',
			lineup: homeLineupPlayers,
			isSummary: true
		});
	}

	/**
	 * Get position name from position number
	 */
	private getPositionName(position: number): string {
		const positionNames = [
			'', 'P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'PH', 'PR'
		];
		return positionNames[position] ?? `Pos${position}`;
	}

	/**
	 * Initialize bullpen state for a team
	 * Uses the starting pitcher already selected by the lineup builder
	 */
	private initializeBullpen(teamId: string, starterId: string): void {
		const teamPitchers = Object.values(this.season.pitchers).filter((p) => p.teamId === teamId && p.id !== starterId);

		const starterStats = this.season.pitchers[starterId];
		if (!starterStats) {
			console.warn(`Starter ${starterId} not found in season data for team ${teamId}`);
			return;
		}

		// Create pitcher role for starter with BFP data
		const starter: PitcherRole = {
			pitcherId: starterId,
			role: 'starter',
			stamina: 100,
			pitchesThrown: 0,
			battersFace: 0,
			avgBfpAsStarter: starterStats?.avgBfpAsStarter ?? null,
			avgBfpAsReliever: starterStats?.avgBfpAsReliever ?? null,
			hitsAllowed: 0,
			walksAllowed: 0,
			runsAllowed: 0
		};
		this.pitcherStamina.set(starterId, starter);

		// Remaining pitchers are bullpen
		const relievers: PitcherRole[] = teamPitchers.map((p) => {
			const stats = this.season.pitchers[p.id];
			return {
				pitcherId: p.id,
				role: p.id.includes('closer') ? 'closer' : 'reliever',
				stamina: 100,
				pitchesThrown: 0,
				battersFace: 0,
				avgBfpAsStarter: stats?.avgBfpAsStarter ?? null,
				avgBfpAsReliever: stats?.avgBfpAsReliever ?? null,
				hitsAllowed: 0,
				walksAllowed: 0,
				runsAllowed: 0
			};
		});

		this.bullpenStates.set(teamId, {
			starter,
			relievers,
			closer: relievers.find((r) => r.role === 'closer')
		});

		// Note: The starting pitcher is already set in the lineup by buildLineup
	}

	/**
	 * Check if a player can play a specific position
	 * Rules:
	 * - Pitchers (1) only play pitcher
	 * - Catchers (2) primarily catch, but can play 1B in emergencies
	 * - Infielders (3, 4, 5, 6) can play any infield position
	 * - Outfielders (7, 8, 9) can play any outfield position
	 * - Some players have multi-position eligibility from the data
	 */
	private canPlayPosition(playerId: string, position: number): boolean {
		const player = this.season.batters[playerId];
		if (!player) return false;

		// Check explicit position eligibility
		if (player.positionEligibility[position]) return true;

		const primary = player.primaryPosition;

		// Position group rules
		const isPitcher = primary === 1;
		const isCatcher = primary === 2;
		const isInfield = [3, 4, 5, 6].includes(primary);
		const isOutfield = [7, 8, 9].includes(primary);

		// Pitchers only pitch
		if (isPitcher) return position === 1;

		// Catchers primarily catch, can play 1B
		if (isCatcher) return position === 2 || position === 3;

		// Infielders can play any infield position
		if (isInfield && [3, 4, 5, 6].includes(position)) return true;

		// Outfielders can play any outfield position
		if (isOutfield && [7, 8, 9].includes(position)) return true;

		return false;
	}

	/**
	 * Find a suitable defensive replacement position for a pinch hitter
	 * Returns the position the pinch hitter should take
	 */
	private findDefensivePositionForPH(phPlayerId: string, replacedPlayerPosition: number): number | null {
		// If pinch hitter can play the position they're replacing, use that
		if (this.canPlayPosition(phPlayerId, replacedPlayerPosition)) {
			return replacedPlayerPosition;
		}

		// Otherwise, find a suitable position based on their eligibility
		const player = this.season.batters[phPlayerId];
		if (!player) return null;

		// Check their position eligibility in order of preference
		const positions = [7, 8, 9, 6, 5, 4, 3, 2]; // OF then IF
		for (const pos of positions) {
			if (player.positionEligibility[pos]) {
				return pos;
			}
		}

		// Fall back to primary position
		return player.primaryPosition;
	}

	getState(): Readonly<GameState> {
		return this.state;
	}

	/**
	 * Get the set of relievers (pitchers who entered mid-game)
	 * Used for testing and validation
	 */
	getRelievers(): Set<string> {
		return this.#relievers;
	}

	/**
	 * Validate a lineup after a substitution
	 * Returns true if the lineup is valid, false otherwise
	 */
	private validateCurrentLineup(lineup: LineupState): { isValid: boolean; errors: string[] } {
		const result = validateLineup(lineup.players, this.season.batters);
		return { isValid: result.isValid, errors: result.errors };
	}

	/**
	 * Position code for pinch hitters (temporary, not a real defensive position)
	 * Position numbers: 1-9 are standard positions, 10=DH, 11=PH (temporary), 12=PR (temporary)
	 */
	private readonly POSITION_PH = 11;
	/** Position code for pinch runners (temporary, for future use) */
	private readonly POSITION_PR = 12;

	/**
	 * Audit and fix the lineup at the end of a half-inning.
	 * Ensures that pinch hitters (position 11) are properly resolved.
	 *
	 * For non-DH games:
	 * - Scan for any players with position 11 (PH)
	 * - For each PH: either move them to a real defensive position (double switch)
	 *   or remove them and insert the appropriate player (e.g., new pitcher)
	 * - Ensure the current pitcher is in the batting order at position 1
	 * - Exactly 9 unique players with valid positions (no position 11)
	 *
	 * For DH games:
	 * - Same logic, but the pitcher doesn't need to be in the batting order
	 *
	 * @param lineup The lineup to audit and fix
	 * @param teamId The team ID for getting league/era info
	 */
	private auditLineupAtHalfInningEnd(lineup: LineupState, teamId: string): void {
		// Find all pinch hitters (position 11) in the batting order
		const phSlots: Array<{ index: number; playerId: string }> = [];
		for (let i = 0; i < lineup.players.length; i++) {
			if (lineup.players[i].position === this.POSITION_PH) {
				phSlots.push({ index: i, playerId: lineup.players[i].playerId! });
			}
		}

		if (phSlots.length === 0) {
			// No pinch hitters, nothing to do
			return;
		}

		const teamLeague = this.season.teams[teamId]?.league ?? 'NL';
		const year = this.season.meta.year;
		const gameUsesDH = usesDH(teamLeague, year);

		// Process each pinch hitter
		for (const phSlot of phSlots) {
			const phPlayerId = phSlot.playerId;
			if (!phPlayerId) continue; // Extra null check for type safety

			const phPlayer = this.season.batters[phPlayerId];
			if (!phPlayer) continue;

			// Check if this PH replaced a pitcher (look at who was removed)
			// If the current pitcher is different from the starting pitcher, this might be a double switch
			const currentPitcherId = lineup.pitcher;
			if (!currentPitcherId) continue; // Should never happen, but safety check

			if (!gameUsesDH) {
				// Non-DH game: PH needs to be resolved
				// Check if the current pitcher is already in the batting order
				// If yes, the PH replaced a position player, not the pitcher
				// If no, the PH replaced the pitcher, so new pitcher needs to be inserted
				const pitcherIndex = lineup.players.findIndex(p => p.playerId === currentPitcherId);
				const pitcherAlreadyInLineup = pitcherIndex !== -1;

				if (pitcherAlreadyInLineup) {
					// PH replaced a position player, and pitcher is already in lineup
					// This is NOT a pitcher-for-pitcher swap, so we need different logic
					// For now: find a bench player to replace the PH (they take the batting spot)
					// In a full double switch implementation, PH would take a defensive position instead

					// Mark the PH as removed
					this.removedPlayers.add(phPlayerId);

					// Find a bench player to replace them
					const currentLineupPlayerIds = lineup.players.map(p => p.playerId).filter((id): id is string => id !== null);
					const allTeamBatters = Object.values(this.season.batters)
						.filter(b => b.teamId === teamId);
					const availableBench = allTeamBatters.filter(b =>
						!currentLineupPlayerIds.includes(b.id) &&
						!this.usedPinchHitters.has(b.id) &&
						!this.removedPlayers.has(b.id)
					);

					if (availableBench.length > 0) {
						// Find a bench player and position that doesn't create conflicts
						// The pinch hitter temporarily occupies position 11, which is not a real position
						// We need to find a position for the replacement that is:
						// 1. Eligible for the bench player
						// 2. Not already occupied by another player
						let replacementFound = false;

						for (const replacement of availableBench) {
							// Build set of positions currently occupied (excluding PH slot at position 11)
							const occupiedPositions = new Set(
								lineup.players
									.filter(p => p.position !== this.POSITION_PH)
									.map(p => p.position)
							);

							// Find a valid position for this replacement player
							const validPosition = this.findValidSubstitution(replacement.id, lineup, occupiedPositions);

							if (validPosition !== null) {
								const battingOrder = phSlot.index + 1;
								const positionName = POSITION_NAMES[validPosition] ?? `Pos${validPosition}`;
								lineup.players[phSlot.index] = {
									playerId: replacement.id,
									position: validPosition
								};

								this.state.plays.unshift({
									inning: this.state.inning,
									isTopInning: this.state.isTopInning,
									outcome: 'out' as Outcome,
									batterId: '',
									batterName: '',
									pitcherId: '',
									pitcherName: '',
									description: `Lineup adjustment: ${this.formatName(replacement.name)} (${positionName}) replaces ${this.formatName(phPlayer.name)}, batting ${battingOrder}${getInningSuffix(battingOrder)}`,
									runsScored: 0,
									eventType: 'lineupAdjustment',
									substitutedPlayer: phPlayerId,
									isSummary: true
								});
								replacementFound = true;
								break;
							}
						}

						if (!replacementFound) {
							// No bench player can fit in any eligible position - this is an error condition
							// Leave the PH in place as a fallback
							console.warn(`No valid defensive position found for any bench player to replace PH ${phPlayer.name} at batting order ${phSlot.index + 1}`);
						}
					} else {
						// No bench player available - this is an error condition, but handle gracefully
						// by leaving the PH in place (they'll continue playing)
						console.warn(`No bench player available to replace PH ${phPlayer.name} at batting order ${phSlot.index + 1}`);
					}
				} else {
					// PH replaced a pitcher - new pitcher needs to be inserted at position 1
					// The PH is currently at the pitcher's old batting position, with position 11

					// Replace the PH with the new pitcher at position 1
					lineup.players[phSlot.index] = {
						playerId: currentPitcherId,
						position: 1
					};

					// Mark the PH as removed
					this.removedPlayers.add(phPlayerId);

					// Record the substitution - pitcher is now batting in the pitcher's spot
					const pitcher = this.season.pitchers[currentPitcherId];
					const battingOrder = phSlot.index + 1;
					this.state.plays.unshift({
						inning: this.state.inning,
						isTopInning: this.state.isTopInning,
						outcome: 'out' as Outcome,
						batterId: '',
						batterName: '',
						pitcherId: currentPitcherId,
						pitcherName: this.formatName(pitcher?.name ?? 'Unknown'),
						description: `Lineup adjustment: ${this.formatName(pitcher?.name ?? 'Unknown')} (${POSITION_NAMES[1]}) replaces ${this.formatName(phPlayer.name)}, batting ${battingOrder}${getInningSuffix(battingOrder)}`,
						runsScored: 0,
						eventType: 'lineupAdjustment',
						substitutedPlayer: phPlayerId,
						isSummary: true
					});
				}
			} else {
				// DH game: PH could stay in or be replaced
				// For now, mark them as removed (simpler case)
				this.removedPlayers.add(phPlayerId);

				// Find a bench player to replace them
				const currentLineupPlayerIds = lineup.players.map(p => p.playerId).filter((id): id is string => id !== null);
				const allTeamBatters = Object.values(this.season.batters)
					.filter(b => b.teamId === teamId);
				const availableBench = allTeamBatters.filter(b =>
					!currentLineupPlayerIds.includes(b.id) &&
					!this.usedPinchHitters.has(b.id) &&
					!this.removedPlayers.has(b.id)
				);

				if (availableBench.length > 0) {
					// Find a bench player and position that doesn't create conflicts
					let replacementFound = false;

					for (const replacement of availableBench) {
						// Build set of positions currently occupied (excluding PH slot at position 11)
						const occupiedPositions = new Set(
							lineup.players
								.filter(p => p.position !== this.POSITION_PH)
								.map(p => p.position)
						);

						// Find a valid position for this replacement player
						const validPosition = this.findValidSubstitution(replacement.id, lineup, occupiedPositions);

						if (validPosition !== null) {
							const battingOrder = phSlot.index + 1;
							const positionName = POSITION_NAMES[validPosition] ?? `Pos${validPosition}`;
							lineup.players[phSlot.index] = {
								playerId: replacement.id,
								position: validPosition
							};

							this.state.plays.unshift({
								inning: this.state.inning,
								isTopInning: this.state.isTopInning,
								outcome: 'out' as Outcome,
								batterId: '',
								batterName: '',
								pitcherId: '',
								pitcherName: '',
								description: `Lineup adjustment: ${this.formatName(replacement.name)} (${positionName}) replaces ${this.formatName(phPlayer.name)}, batting ${battingOrder}${getInningSuffix(battingOrder)}`,
								runsScored: 0,
								eventType: 'lineupAdjustment',
								substitutedPlayer: phPlayerId,
								isSummary: true
							});
							replacementFound = true;
							break;
						}
					}

					if (!replacementFound) {
						// No bench player can fit in any eligible position - leave PH in place as fallback
						console.warn(`No valid defensive position found for any bench player to replace PH ${phPlayer.name} at batting order ${phSlot.index + 1}`);
					}
				}
			}
		}
	}

	/**
	 * Find a valid position for a substitute that doesn't create conflicts
	 * Returns the position number or null if no valid position exists
	 */
	private findValidSubstitution(
		substitutePlayerId: string,
		currentLineup: LineupState,
		excludePositions: Set<number> = new Set()
	): number | null {
		const player = this.season.batters[substitutePlayerId];
		if (!player) return null;

		// Get positions the player is eligible for, sorted by most played (descending)
		const eligiblePositions = Object.entries(player.positionEligibility)
			.filter(([_, outs]) => outs > 0)
			.map(([pos, _]) => parseInt(pos))
			.sort((a, b) => (player.positionEligibility[b] ?? 0) - (player.positionEligibility[a] ?? 0));

		// Also include primary position if not already in list
		if (!eligiblePositions.includes(player.primaryPosition)) {
			eligiblePositions.push(player.primaryPosition);
		}

		// For each eligible position (most played first), check if it's available
		for (const position of eligiblePositions) {
			if (excludePositions.has(position)) continue;

			// Check if this position is already filled by someone else
			const existingSlot = currentLineup.players.find(p => p.position === position);
			if (!existingSlot) {
				// Position is empty, we can use it
				return position;
			}
		}

		return null;
	}

	/**
	 * Check for managerial decisions before a plate appearance
	 * Returns true if a substitution was made
	 */
	private checkForManagerialDecisions(): boolean {
		if (!this.managerialOptions.enabled) return false;

		const pitchingTeam = this.state.isTopInning ? this.state.homeLineup : this.state.awayLineup;
		const battingTeam = this.state.isTopInning ? this.state.awayLineup : this.state.homeLineup;

		// Get current pitcher
		const pitcherId = pitchingTeam.pitcher;
		if (!pitcherId) return false;

		const pitcher = this.season.pitchers[pitcherId];
		const pitcherRole = this.pitcherStamina.get(pitcherId);
		const bullpen = this.bullpenStates.get(pitchingTeam.teamId);

		if (!pitcher || !pitcherRole || !bullpen) return false;

		// Filter bullpen to exclude removed pitchers (they cannot re-enter the game)
		const filteredBullpen: BullpenState = {
			starter: bullpen.starter,
			closer: bullpen.closer && !this.removedPlayers.has(bullpen.closer.pitcherId) ? bullpen.closer : undefined,
			relievers: bullpen.relievers.filter(r => !this.removedPlayers.has(r.pitcherId))
		};

		// Check for pitching change
		const mgrState = toManagerialGameState(this.state);

		// Use season-specific BFP data for pull decisions
		// Get the pitching team's league for DH determination
		const pitchingTeamLeague = this.season.teams[pitchingTeam.teamId]?.league ?? 'NL';
		const pitchingTeamUsesDH = usesDH(pitchingTeamLeague, this.season.meta.year);

		const pullOptions = {
			seasonStarterBFP: this.season.norms.pitching.starterBFP,
			seasonRelieverBFP: this.season.norms.pitching.relieverBFP,
			seasonRelieverBFPOverall: this.season.norms.pitching.relieverBFPOverall,
			currentInning: this.state.inning,
			year: this.season.meta.year,
			usesDH: pitchingTeamUsesDH,
			pullThresholds: this.season.norms.pitching.pullThresholds,
			// Calculate era minimum reliever caps based on year (fallback if not in season data)
			eraMinRelieverCaps: (() => {
				const y = this.season.meta.year;
				if (y < 1940) {
					return { early: 18, middle: 14, late: 10 };
				} else if (y < 1973) {
					return { early: 16, middle: 12, late: 8 };
				} else if (y < 1995) {
					return { early: 12, middle: 8, late: 5 };
				} else {
					return { early: 9, middle: 6, late: 4 };
				}
			})()
		};

		const pitchingDecision = shouldPullPitcher(
			mgrState,
			pitcherRole,
			filteredBullpen,
			this.managerialOptions.randomness ?? 0.1,
			pullOptions
		);

		if (pitchingDecision.shouldChange && pitchingDecision.newPitcher) {
			// Sanity check: ensure we're not replacing a pitcher with themselves
			if (pitchingDecision.newPitcher === pitcherId) {
				// This shouldn't happen - log and skip the change
				console.warn(`Preventing self-replacement: ${pitcherId} replacing themselves`);
				return false;
			}
			// Sanity check: ensure the new pitcher hasn't already been removed from the game
			if (this.removedPlayers.has(pitchingDecision.newPitcher)) {
				// This shouldn't happen with filtered bullpen - log and skip the change
				console.warn(`Preventing re-entry: ${pitchingDecision.newPitcher} has already been removed`);
				return false;
			}

			// Store the old state in case we need to revert
			const oldPitcherId = pitchingTeam.pitcher;
			const oldPlayers = [...pitchingTeam.players];

			// Apply pitching change
			pitchingTeam.pitcher = pitchingDecision.newPitcher;

			// Update the batting order to replace the old pitcher with the new pitcher
			// Find the old pitcher in the batting order (position 1 = pitcher)
			const pitcherSlotIndex = pitchingTeam.players.findIndex(p => p.position === 1);
			if (pitcherSlotIndex !== -1) {
				pitchingTeam.players[pitcherSlotIndex] = {
					playerId: pitchingDecision.newPitcher,
					position: 1
				};
			}

			// Validate the lineup after the change
			const validation = this.validateCurrentLineup(pitchingTeam);
			if (!validation.isValid) {
				// Revert the change
				pitchingTeam.pitcher = oldPitcherId;
				pitchingTeam.players = oldPlayers;
				console.warn(`Pitching change would create invalid lineup: ${validation.errors.join(', ')}`);
				return false;
			}

			// Mark the old pitcher as removed so they can't return
			this.removedPlayers.add(pitcherId);

			// Mark the new pitcher as a reliever (entered mid-game, should never bat in non-DH games)
			this.#relievers.add(pitchingDecision.newPitcher);

			// Update stamina tracking - create role for new pitcher
			const newPitcherStats = this.season.pitchers[pitchingDecision.newPitcher];
			const newPitcherRole: PitcherRole = {
				pitcherId: pitchingDecision.newPitcher,
				role: 'reliever',
				stamina: 100,
				pitchesThrown: 0,
				battersFace: 0,
				avgBfpAsStarter: newPitcherStats?.avgBfpAsStarter ?? null,
				avgBfpAsReliever: newPitcherStats?.avgBfpAsReliever ?? null,
				hitsAllowed: 0,
				walksAllowed: 0,
				runsAllowed: 0
			};
			this.pitcherStamina.set(pitchingDecision.newPitcher, newPitcherRole);

			// Record the substitution as a summary entry
			const newPitcher = this.season.pitchers[pitchingDecision.newPitcher];
			this.state.plays.unshift({
				inning: this.state.inning,
				isTopInning: this.state.isTopInning,
				outcome: 'out' as Outcome,
				batterId: '',
				batterName: '',
				pitcherId: pitchingDecision.newPitcher,
				pitcherName: this.formatName(newPitcher ? newPitcher.name : 'Unknown'),
				description: `Pitching change: ${this.formatName(newPitcher?.name ?? 'Unknown')} replaces ${this.formatName(pitcher.name)}`,
				runsScored: 0,
				eventType: 'pitchingChange',
				substitutedPlayer: pitcherId,
				isSummary: true
			});

			return true;
		}

		// Check for pinch hit opportunity
		const currentBatterId = getNextBatter(battingTeam, this.season.batters);
		const currentBatter = this.season.batters[currentBatterId];
		if (!currentBatter) return false;

		// Check if current batter is a reliever who should never bat (non-DH games)
		const currentBatterSlot = battingTeam.players.find(p => p.playerId === currentBatterId);
		const battingTeamLeague = this.season.teams[battingTeam.teamId]?.league ?? 'NL';
		const gameUsesDH = usesDH(battingTeamLeague, this.season.meta.year);

		// Non-DH: Relievers should never bat - always pinch hit
		const mustPHForReliever = !gameUsesDH &&
			currentBatterSlot?.position === 1 &&
			this.#relievers.has(currentBatterId);

		// Season-based frequency control: target PH rate divided by total PAs per game
		// Skip this check if we MUST PH for a reliever (non-DH games)
		// Multiplier reduced from 10 to 6 for more realistic PH usage
		// 1910: (2 PH/game / 70 PAs) * 6 = ~17% should consider PH
		const phConsiderationRate = (this.season.norms.substitutions.pinchHitsPerGame / 70) * 6;
		const shouldConsiderPH = mustPHForReliever || Math.random() < phConsiderationRate;
		if (!shouldConsiderPH) return false;

		// Get available bench players
		const currentLineupPlayerIds = battingTeam.players.map(p => p.playerId).filter((id): id is string => id !== null);
		const allTeamBatters = Object.values(this.season.batters)
			.filter(b => b.teamId === battingTeam.teamId)
			.map(toModelBatter);
		const availableBench = allTeamBatters.filter(b =>
			!currentLineupPlayerIds.includes(b.id) &&
			!this.usedPinchHitters.has(b.id) &&
			!this.removedPlayers.has(b.id)
		);

		if (availableBench.length > 0) {
			const opposingPitcher = this.season.pitchers[pitchingTeam.pitcher!];
			if (opposingPitcher) {
				let phDecision: PinchHitDecision;

				// When we MUST PH for a reliever (non-DH games), skip the normal decision logic
				// and directly pick the best available batter
				if (mustPHForReliever) {
					// Find the best available PH by OPS
					// Model batters use vsLeft/vsRight, not vsLHP/vsRHP
					const getOPS = (b: ModelBatterStats) => {
						const rates = opposingPitcher.throws === 'L' ? b.rates.vsLeft : b.rates.vsRight;
						const obp = rates.walk + rates.hitByPitch + rates.single + rates.double + rates.triple + rates.homeRun;
						const slg = rates.single * 1 + rates.double * 2 + rates.triple * 3 + rates.homeRun * 4;
						return obp + slg;
					};

					// Sort by OPS descending
					const sortedBench = [...availableBench].sort((a, b) => getOPS(b) - getOPS(a));
					const bestPH = sortedBench[0];

					if (bestPH) {
						phDecision = {
							shouldPinchHit: true,
							pinchHitterId: bestPH.id,
							reason: `PH for reliever ${currentBatter.name}`
						};
					} else {
						phDecision = { shouldPinchHit: false };
					}
				} else {
					// Normal PH decision logic
					phDecision = shouldPinchHit(
						mgrState,
						toModelBatter(currentBatter),
						availableBench,
						toModelPitcher(opposingPitcher),
						{ randomness: this.managerialOptions.randomness ?? 0.15, useDH: gameUsesDH }
					);
				}

				if (phDecision.shouldPinchHit && phDecision.pinchHitterId) {
					// Find the batter's position in the lineup
					const batterIndex = battingTeam.players.findIndex(p => p.playerId === currentBatterId);
					if (batterIndex !== -1) {
						const replacedPosition = battingTeam.players[batterIndex].position;
						const pinchHitter = this.season.batters[phDecision.pinchHitterId];

						// Check if we're pinch hitting for a pitcher (position 1)
						const isPitcherPH = replacedPosition === 1;

						// Store old state for potential revert
						const oldPlayers = [...battingTeam.players];
						const oldPitcher = battingTeam.pitcher;
						const oldRemovedPlayers = new Set(this.removedPlayers);

						let description = `Pinch hit: ${this.formatName(pinchHitter?.name ?? 'Unknown')} pinch hits for ${this.formatName(currentBatter.name)}`;

						// Assign pinch hitter position 11 (PH) - temporary, will be resolved at end of inning
						battingTeam.players[batterIndex] = { playerId: phDecision.pinchHitterId, position: this.POSITION_PH };

						// If pinch hitting for pitcher, we also need a new pitcher
						if (isPitcherPH) {
							// Get a reliever from the bullpen (excluding the current pitcher being pinch hit for)
							const bullpen = this.bullpenStates.get(battingTeam.teamId);
							if (bullpen && bullpen.relievers.length > 0) {
								// Filter bullpen to exclude removed pitchers (they cannot re-enter the game)
								const filteredBullpen: BullpenState = {
									starter: bullpen.starter,
									closer: bullpen.closer && !this.removedPlayers.has(bullpen.closer.pitcherId) ? bullpen.closer : undefined,
									relievers: bullpen.relievers.filter(r => !this.removedPlayers.has(r.pitcherId))
								};

								// Use selectReliever to properly choose a reliever, excluding the current pitcher
								const mgrState = toManagerialGameState(this.state);
								const selectedPitcher = selectReliever(mgrState, filteredBullpen, currentBatterId);
								if (!selectedPitcher) {
									console.warn('No suitable reliever found for pinch hitting for pitcher, skipping PH');
									// Revert the PH assignment
									battingTeam.players = oldPlayers;
									return false;
								}
								const newPitcherId = selectedPitcher.pitcherId;

								// Sanity check: ensure the new pitcher hasn't already been removed from the game
								if (this.removedPlayers.has(newPitcherId)) {
									console.warn(`Preventing re-entry: ${newPitcherId} has already been removed`);
									// Revert the PH assignment
									battingTeam.players = oldPlayers;
									return false;
								}

								const newPitcher = this.season.pitchers[newPitcherId];

								// Bring in new pitcher to pitch (but NOT in batting order yet - will be resolved at end of inning)
								battingTeam.pitcher = newPitcherId;

								// Create pitcher role with BFP data
								const newPitcherStats = this.season.pitchers[newPitcherId];
								const newPitcherRole: PitcherRole = {
									pitcherId: newPitcherId,
									role: 'reliever',
									stamina: 100,
									pitchesThrown: 0,
									battersFace: 0,
									avgBfpAsStarter: newPitcherStats?.avgBfpAsStarter ?? null,
									avgBfpAsReliever: newPitcherStats?.avgBfpAsReliever ?? null,
									hitsAllowed: 0,
									walksAllowed: 0,
									runsAllowed: 0
								};
								this.pitcherStamina.set(newPitcherId, newPitcherRole);
								this.#relievers.add(newPitcherId);
							} else {
								// No relievers available - can't pinch hit for pitcher
								// Revert the PH assignment
								battingTeam.players = oldPlayers;
								return false;
							}
						}

						// Mark the replaced player as removed
						this.removedPlayers.add(currentBatterId);
						this.usedPinchHitters.add(phDecision.pinchHitterId);

						// Record the substitution as a summary entry
						this.state.plays.unshift({
							inning: this.state.inning,
							isTopInning: this.state.isTopInning,
							outcome: 'out' as Outcome,
							batterId: phDecision.pinchHitterId,
							batterName: this.formatName(pinchHitter?.name ?? 'Unknown'),
							pitcherId: '',
							pitcherName: '',
							description,
							runsScored: 0,
							eventType: 'pinchHit',
							substitutedPlayer: currentBatterId,
							isSummary: true
						});

						return true;
					}
				}
			}
		}

		return false;
	}

	simulatePlateAppearance(): PlayEvent {
		const { state, season } = this;

		// Reset flag at the start of a top half (after isComplete() has checked it)
		// This ensures the flag only represents whether home team batted in PREVIOUS inning
		if (state.isTopInning && state.inning > 9) {
			state.homeTeamHasBattedInInning = false;
		}

		// Check for managerial decisions (pitching changes, pinch-hitters)
		this.checkForManagerialDecisions();

		const battingTeam = state.isTopInning ? state.awayLineup : state.homeLineup;
		const pitchingTeam = state.isTopInning ? state.homeLineup : state.awayLineup;

		// Get batter and pitcher
		const batterId = getNextBatter(battingTeam, season.batters);
		let batter = season.batters[batterId];

		// If batter not found in batters, check if it's a pitcher batting
		// (e.g., reliever added to lineup during double switch, or pitcher batting in non-DH game)
		let isPitcherBatting = false;
		if (!batter) {
		 const pitcherBatter = season.pitchers[batterId];
		 if (pitcherBatter) {
			 // Create a synthetic batter entry for the pitcher using league pitcher-batter averages
			 // Pitchers with <5 PA use league averages as fallback
			 isPitcherBatting = true;
			 batter = {
				 id: pitcherBatter.id,
				 name: pitcherBatter.name,
				 teamId: pitcherBatter.teamId,
				 bats: pitcherBatter.throws, // Pitchers bat same side they throw
				 primaryPosition: 1,
				 positionEligibility: { 1: 1 },
				 rates: {
					 vsLHP: season.league.pitcherBatter.vsLHP,
					 vsRHP: season.league.pitcherBatter.vsRHP
				 }
			 };
		 }
		}

		// Use the current starting pitcher (V1: no bullpen changes yet)
		const pitcherId = pitchingTeam.pitcher;
		if (!pitcherId) {
			throw new Error(`No pitcher found for ${pitchingTeam.teamId}`);
		}
		const pitcher = season.pitchers[pitcherId];

		if (!batter || !pitcher) {
			throw new Error('Missing batter or pitcher data');
		}

		// Determine handedness matchup
		const batterHandedness =
			batter.bats === 'S' ? (pitcher.throws === 'L' ? 'R' : 'L') : batter.bats;
		const pitcherHandedness = pitcher.throws;

		// Get the correct rates
		const batterRates =
			pitcherHandedness === 'L' ? batter.rates.vsLHP : batter.rates.vsRHP;
		const pitcherRates =
			batterHandedness === 'L' ? pitcher.rates.vsLHB : pitcher.rates.vsRHB;
		const leagueRates =
			pitcherHandedness === 'L' ? season.league.vsLHP : season.league.vsRHP;

		// Create matchup
		const matchup = {
			batter: {
				id: batter.id,
				name: batter.name,
				handedness: batterHandedness,
				rates: {
					vsLeft: batter.rates.vsLHP,
					vsRight: batter.rates.vsRHP,
				},
			},
			pitcher: {
				id: pitcher.id,
				name: pitcher.name,
				handedness: pitcherHandedness,
				rates: {
					vsLeft: pitcher.rates.vsLHB,
					vsRight: pitcher.rates.vsRHB,
				},
			},
			league: {
				year: season.meta.year,
				rates: {
					vsLeft: season.league.vsLHP,
					vsRight: season.league.vsRHP,
				},
			},
		};

		// Get outcome from model, handling game state constraints
		let outcome: Outcome;

		// Collect impossible outcomes based on game state
		const impossibleOutcomes: (keyof ProbabilityDistribution)[] = [];

		// Fielder's choice and sacrifice bunt are impossible with empty bases
		if (areBasesEmpty(state.bases)) {
			impossibleOutcomes.push('fieldersChoice', 'sacrificeBunt');
		}

		// Sacrifice fly requires: runner on 3rd AND less than 2 outs
		// With 2 outs, a fly out that scores a runner ends the inning (not a sacrifice fly)
		if (!state.bases[2] || state.outs === 2) {
			impossibleOutcomes.push('sacrificeFly');
		}

		// Sacrifice bunt is impossible with 2 outs (can't advance runner with 2 outs)
		if (state.outs === 2) {
			impossibleOutcomes.push('sacrificeBunt');
		}

		if (impossibleOutcomes.length > 0) {
			// Get the distribution, exclude impossible outcomes, re-normalize, then sample
			const distribution = this.model.predict(matchup);
			let excludedProb = 0;
			for (const key of impossibleOutcomes) {
				excludedProb += distribution[key] || 0;
			}

			if (excludedProb > 0) {
				// Create adjusted distribution excluding impossible outcomes
				const adjusted = { ...distribution };
				for (const key of impossibleOutcomes) {
					delete (adjusted as any)[key];
				}

				// Re-normalize the remaining probabilities
				const totalProb = 1 - excludedProb;
				for (const key of Object.keys(adjusted) as (keyof ProbabilityDistribution)[]) {
					if (adjusted[key] !== undefined) {
						adjusted[key] = adjusted[key]! / totalProb;
					}
				}

				// Sample from adjusted distribution
				outcome = this.model.sample(adjusted) as Outcome;
			} else {
				// No impossible outcomes, just sample normally
				outcome = this.model.simulate(matchup) as Outcome;
			}
		} else {
			// Normal sampling
			outcome = this.model.simulate(matchup) as Outcome;
		}

		// Capture runners before the play
		const runnersBefore: [string | null, string | null, string | null] = [...state.bases];

		// Apply baserunning
		const { runs, newBases, scorerIds, newOuts, outRunnerId: smOutRunnerId } = applyBaserunning(state, outcome, batterId);

		// Check for walk-off situation and adjust if needed
		// In a walk-off (bottom of 9th+, home team takes lead), the game ends immediately
		// when the winning run scores. Non-home-run hits are reduced to singles.
		let adjustedOutcome = outcome;
		let adjustedRuns = runs;
		let adjustedBases = newBases;
		let adjustedScorerIds = scorerIds;

		// Calculate current score before this play
		let awayScoreBefore = 0;
		let homeScoreBefore = 0;
		for (const play of state.plays) {
			if (play.isTopInning) {
				awayScoreBefore += play.runsScored;
			} else {
				homeScoreBefore += play.runsScored;
			}
		}

		const isBottomExtraInnings = state.inning >= 9 && !state.isTopInning;
		const homeTeamTakesLead = homeScoreBefore + runs > awayScoreBefore;
		const isWalkOffHit = isBottomExtraInnings && homeTeamTakesLead && runs > 0;
		const isHit = ['single', 'double', 'triple'].includes(outcome);
		const notHomeRun = outcome !== 'homeRun';

		// Walk-off hit adjustment: game ends when winning run scores
		if (isWalkOffHit && isHit && notHomeRun) {
			// Only the winning run counts; all runners advance as far as possible
			// but the batter only reaches 1st (play stops when winning run scores)
			adjustedOutcome = 'single';
			adjustedRuns = 1; // Only the winning run counts

			// Adjust baserunning: batter stops at 1st, runners advance as forced
			// This is a simplified approximation - real scoring is more complex
			adjustedBases = [batterId, null, null] as [string | null, string | null, string | null];

			// Only the first scorer counts
			adjustedScorerIds = scorerIds.length > 0 ? [scorerIds[0]] : [];
		}

		// Check for inning change BEFORE updating state (so summary doesn't include this play)
		// We need to check what the outs WOULD be, not what they currently are
		const wouldBeThirdOut = newOuts >= 3;

		// Capture current inning state BEFORE any changes
		// This ensures the play is recorded with the correct inning information
		const playInning = state.inning;
		const playIsTop = state.isTopInning;

		let outRunnerName: string | undefined;
		let outBase: string | undefined;
		if (outcome === 'fieldersChoice' && smOutRunnerId) {
			// Use the out runner ID from the state machine
			outRunnerName = this.season.batters[smOutRunnerId]?.name;
			// Find which base the runner was on, then report the NEXT base (where they're out)
			// Runner on 1B → out at 2B, runner on 2B → out at 3B, runner on 3B → out at home
			const baseNames = ['1B', '2B', '3B'] as const;
			const outBaseNames = ['2B', '3B', 'home'];
			for (let i = 0; i < 3; i++) {
				if (runnersBefore[i] === smOutRunnerId) {
					outBase = outBaseNames[i];
					break;
				}
			}
		}

		// Create play event with CURRENT state (before inning changes)
		const play: PlayEvent = {
			inning: playInning,
			isTopInning: playIsTop,
			outcome: adjustedOutcome,
			batterId,
			batterName: formatName(batter.name),
			pitcherId: pitcher.id,
			pitcherName: formatName(pitcher.name),
			description: describePlay(adjustedOutcome, batter.name, pitcher.name, adjustedRuns, outRunnerName, outBase),
			runsScored: adjustedRuns,
			runnersAfter: adjustedBases,
			scorerIds: adjustedScorerIds,
			runnersBefore,
		};

		// Add the play BEFORE the summary when it's an inning-ending play
		// This ensures the summary appears after the 3rd out in reverse chronological display
		state.plays.unshift(play);

		// Mark that home team has batted in this inning (if bottom half)
		if (!state.isTopInning) {
			state.homeTeamHasBattedInInning = true;
		}

		// Update state bases and outs
		state.bases = adjustedBases;
		state.outs = newOuts;

		// Check for inning change AFTER updating state
		if (wouldBeThirdOut) {
			// Add half-inning summary with the CORRECT inning values (before state change)
			// The play we just added has the correct inning information
			addHalfInningSummaryWithInning(state, this.season, playInning, playIsTop);

			// Only audit lineup if the game is NOT complete
			// If the game is over (e.g., bottom of 11th, final out), we don't need to adjust lineups
			if (!this.isComplete()) {
				// Audit and fix the lineup for the team that just finished batting
				// This resolves any temporary pinch hitters (position 11) and ensures
				// the current pitcher is in the batting order for non-DH games
				this.auditLineupAtHalfInningEnd(battingTeam, battingTeam.teamId);
			}

			// Reset for the new inning
			state.bases = [null, null, null];
			state.outs = 0;

			if (state.isTopInning) {
				state.isTopInning = false;
			} else {
				// Mark that home team just batted (for extra innings ending logic)
				state.homeTeamHasBattedInInning = true;
				state.isTopInning = true;
				state.inning++;
			}
		} else if (!wouldBeThirdOut && this.isComplete()) {
			// Game ended without 3 outs (walk-off win)
			// Mark that home team has batted (walk-off happens in bottom half)
			state.homeTeamHasBattedInInning = true;
			// Add a summary for the final half-inning with correct inning values
			addHalfInningSummaryWithInning(state, this.season, playInning, playIsTop);
		}

		// Advance to next batter
		advanceBatter(battingTeam);

		// Track pitch count for stamina (managerial mode)
		if (pitcherId && this.managerialOptions.enabled) {
			this.trackPitchCount(pitcherId, adjustedOutcome, adjustedRuns);
		}

		return play;
	}

	/**
	 * Track batters faced and update pitcher stamina
	 * Each plate appearance counts as 1 batter faced (BFP)
	 * Also tracks hits, walks, and runs allowed for complete game logic
	 */
	private trackPitchCount(pitcherId: string, outcome: Outcome, runsAllowed: number): void {
		const pitcherRole = this.pitcherStamina.get(pitcherId);
		if (pitcherRole) {
			// Track batters faced (1 per PA)
			pitcherRole.battersFace += 1;

			// Track performance for complete game logic
			if (outcome === 'walk' || outcome === 'hitByPitch') {
				pitcherRole.walksAllowed += 1;
			} else if (
				outcome === 'single' ||
				outcome === 'double' ||
				outcome === 'triple' ||
				outcome === 'homeRun'
			) {
				pitcherRole.hitsAllowed += 1;
			}
			pitcherRole.runsAllowed += runsAllowed;

			// Also track pitch count for legacy compatibility (approximate 4 pitches per PA)
			pitcherRole.pitchesThrown += 4;

			// Reduce stamina based on BFP compared to pitcher's average
			// Each BFP reduces stamina proportionally to how close they are to their limit
			const avgBfp = pitcherRole.role === 'starter'
				? (pitcherRole.avgBfpAsStarter || 25)
				: (pitcherRole.avgBfpAsReliever || 12);

			// Stamina reduction: 100 / average BFP
			// So after average BFP, stamina reaches 0
			const staminaPerBfp = 100 / avgBfp;
			pitcherRole.stamina = Math.max(0, pitcherRole.stamina - staminaPerBfp);
		}
	}

	isComplete(): boolean {
		// Calculate current score
		let awayScore = 0;
		let homeScore = 0;
		for (const play of this.state.plays) {
			if (play.isTopInning) {
				awayScore += play.runsScored;
			} else {
				homeScore += play.runsScored;
			}
		}

		// Walk-off win: home team takes lead in bottom of 9th or later
		if (this.state.inning >= 9 && !this.state.isTopInning && homeScore > awayScore) {
			return true;
		}

		// Extra innings: if away team leads after top of an inning AND home team has already batted, game ends
		// (Home team had their chance and couldn't tie/win)
		if (this.state.inning > 9 && this.state.isTopInning && awayScore > homeScore && this.state.homeTeamHasBattedInInning) {
			return true;
		}

		// Continue playing
		return false;
	}

	private getCurrentBatter(): BatterStats {
		const battingTeam = this.state.isTopInning ? this.state.awayLineup : this.state.homeLineup;
		const batterId = getNextBatter(battingTeam, this.season.batters);
		const batter = this.season.batters[batterId];
		if (!batter) {
			throw new Error('Missing batter data');
		}
		return batter;
	}

	private getCurrentPitcher(): PitcherStats {
		// Use the current starting pitcher (same as simulatePlateAppearance)
		const pitchingTeam = this.state.isTopInning
			? this.state.homeLineup
			: this.state.awayLineup;
		const pitcherId = pitchingTeam.pitcher;
		if (!pitcherId) {
			throw new Error(`No pitcher found for ${pitchingTeam.teamId}`);
		}
		const pitcher = this.season.pitchers[pitcherId];
		if (!pitcher) {
			throw new Error(`Pitcher ${pitcherId} not found in season data`);
		}
		return pitcher;
	}

	private advanceBatter(): void {
		const battingTeam = this.state.isTopInning ? this.state.awayLineup : this.state.homeLineup;
		advanceBatter(battingTeam);
	}

	/**
	 * Execute an intentional walk (manager decision, not simulated).
	 */
	intentionalWalk(): PlayEvent {
		const batter = this.getCurrentBatter();
		const pitcher = this.getCurrentPitcher();

		// Capture runners before the play
		const runnersBefore: [string | null, string | null, string | null] = [...this.state.bases];

		// Use walk mechanics for baserunning
		const { runs, newBases, scorerIds, newOuts } = applyBaserunning(this.state, 'walk', batter.id);

		// Update state bases and outs (use outs from state machine)
		this.state.bases = newBases;
		this.state.outs = newOuts;

		const play: PlayEvent = {
			inning: this.state.inning,
			isTopInning: this.state.isTopInning,
			outcome: 'walk',
			batterId: batter.id,
			batterName: formatName(batter.name),
			pitcherId: pitcher.id,
			pitcherName: formatName(pitcher.name),
			description: `${formatName(batter.name)} intentionally walked`,
			runsScored: runs,
			runnersAfter: [...this.state.bases],
			scorerIds,
			runnersBefore,
		};

		this.state.plays.unshift(play);
		this.advanceBatter();

		return play;
	}

	// Serialize the current game state for persistence
	serialize(): string {
		return JSON.stringify(this.state);
	}

	// Create a new GameEngine from a serialized state
	static restore(
		serializedState: string,
		season: SeasonPackage,
		managerial?: ManagerialOptions
	): GameEngine {
		const state = JSON.parse(serializedState) as GameState;

		// Get league info for DH rules
		const awayLeague = season.teams[state.meta.awayTeam]?.league ?? 'NL';
		const homeLeague = season.teams[state.meta.homeTeam]?.league ?? 'NL';
		const year = season.meta.year;

		const engine = new GameEngine(
			season,
			state.meta.awayTeam,
			state.meta.homeTeam,
			managerial
		);

		// Regenerate lineups using buildLineup for consistent team filtering
		const awayLineup = buildLineup(season.batters, season.pitchers, state.meta.awayTeam, awayLeague, year).lineup;
		const homeLineup = buildLineup(season.batters, season.pitchers, state.meta.homeTeam, homeLeague, year).lineup;

		// Restore game state with fresh lineups
		engine.state = {
			...state,
			awayLineup,
			homeLineup,
			// Ensure flag exists for backward compatibility
			homeTeamHasBattedInInning: state.homeTeamHasBattedInInning ?? false,
		};
		return engine;
	}
}
