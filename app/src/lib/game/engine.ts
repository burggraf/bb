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
	type PitcherStats as ModelPitcherStats,
	type ExtendedPitcherStats,
	classifyPitchers,
	calculateLeagueNorms,
	type EnhancedBullpenState,
	type LeaguePitchingNorms
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
import type { PitcherRole } from '@bb/model';
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
 * Convert app PitcherStats to model ExtendedPitcherStats
 */
function toModelPitcher(pitcher: PitcherStats): ExtendedPitcherStats {
	return {
		id: pitcher.id,
		name: pitcher.name,
		handedness: pitcher.throws,
		throws: pitcher.throws,
		teamId: pitcher.teamId,
		games: pitcher.games,
		gamesStarted: pitcher.gamesStarted,
		completeGames: pitcher.completeGames,
		saves: pitcher.saves,
		inningsPitched: pitcher.inningsPitched,
		whip: pitcher.whip,
		era: pitcher.era,
		avgBfpAsStarter: pitcher.avgBfpAsStarter,
		avgBfpAsReliever: pitcher.avgBfpAsReliever,
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

// Helper function to safely get position name from a potentially null position
function getPositionName(position: number | null): string {
	if (position === null) return 'null';
	return POSITION_NAMES[position] ?? String(position);
}

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
	private bullpenStates: Map<string, EnhancedBullpenState>;
	// Track used pinch hitters (so they don't enter multiple times)
	private usedPinchHitters: Set<string>;
	// Track removed players (cannot return to game)
	private removedPlayers: Set<string>;
	// Track which position each pinch hitter replaced (for double-switch logic)
	// Maps PH playerId → the position of the player they replaced
	private phReplacedPositions: Map<string, number>;
	// Track which batting slot each PH-for-pitcher occupies
	// Maps PH playerId → batting index, so we can put the new pitcher there
	private phForPitcherBattingSlots: Map<string, number>;
	// Track relievers (pitchers who entered mid-game - should never bat in non-DH games)
	// Using ES2022 private field syntax for better tsx compatibility
	#relievers: Set<string> = new Set();
	// Track emergency roster mode per team (when bench is exhausted, allow position eligibility bypass)
	private emergencyRosterMode: Map<string, boolean> = new Map();

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
		// Create augmented batters record that includes pitchers for validation
		const augmentedBatters = this.createAugmentedBattersRecord();
		const awayValidation = validateLineup(awayLineup.players, augmentedBatters);
		const homeValidation = validateLineup(homeLineup.players, augmentedBatters);

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
		this.phReplacedPositions = new Map();
		this.phForPitcherBattingSlots = new Map();
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

		// Calculate league norms from all pitchers in season
		const allPitchers = Object.values(this.season.pitchers).map(toModelPitcher);
		const numTeams = Object.keys(this.season.teams).length;
		const leagueNorms: LeaguePitchingNorms = calculateLeagueNorms(
			allPitchers,
			this.season.meta.year,
			numTeams
		);

		// Use classifier to assign roles
		// Include the designated starter so classifier knows who's starting
		const allTeamPitchers = [...teamPitchers, starterStats].map(toModelPitcher);
		const classification = classifyPitchers(allTeamPitchers, leagueNorms);

		// Find the designated starter in the classification to get their isWorkhorse flag
		// The classifier may have selected a different pitcher as "the" starter
		const classifiedPitchers = [classification.starter, ...classification.relievers];
		const designatedStarterClassification = classifiedPitchers.find(p => p.pitcherId === starterId);
		const isWorkhorse = designatedStarterClassification?.isWorkhorse ?? false;

		// Override the starter to be the designated one, preserving isWorkhorse flag
		const starter: PitcherRole = {
			pitcherId: starterId,
			role: 'starter',
			stamina: 100,
			pitchesThrown: 0,
			battersFace: 0,
			avgBfpAsStarter: starterStats.avgBfpAsStarter ?? null,
			avgBfpAsReliever: starterStats.avgBfpAsReliever ?? null,
			hitsAllowed: 0,
			walksAllowed: 0,
			runsAllowed: 0,
			isWorkhorse
		};
		this.pitcherStamina.set(starterId, starter);

		// Store enhanced bullpen state
		this.bullpenStates.set(teamId, {
			starter,
			relievers: classification.relievers,
			closer: classification.closer,
			setup: classification.setup,
			longRelief: classification.longRelief
		});

		// Note: The starting pitcher is already set in the lineup by buildLineup
	}

	/**
	 * Check if a player can play a specific position.
	 * Uses position eligibility data from season stats.
	 * Falls back to primary position only if no explicit eligibility data exists.
	 *
	 * This must match the validation logic in lineup-validator.ts
	 */
	private canPlayPosition(playerId: string, position: number): boolean {
		const player = this.season.batters[playerId];
		if (!player) return false;

		// Any player can DH, PH, or PR (position 10, 11, 12)
		if (position === 10 || position === 11 || position === 12) {
			return true;
		}

		// Position 1 (pitcher) has special restrictions - only players whose primary position is pitcher
		if (position === 1) {
			return player.primaryPosition === 1;
		}

		// Check explicit position eligibility data (from actual stats)
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
			const isInfield = (pos: number) => pos >= 2 && pos <= 6;

			const playerIsOutfield = isOutfield(player.primaryPosition);
			const playerIsInfield = isInfield(player.primaryPosition);
			const targetIsOutfield = isOutfield(position);
			const targetIsInfield = isInfield(position);

			// Allow outfielders to play any OF position, infielders any IF position
			if ((playerIsOutfield && targetIsOutfield) || (playerIsInfield && targetIsInfield)) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Try to shuffle existing lineup players to accommodate a pinch hitter who can't play
	 * the position they replaced and no bench is available.
	 *
	 * This attempts to find a valid configuration by moving existing players to different
	 * positions based on their eligibility.
	 *
	 * @param lineup - The current lineup state
	 * @param phPlayerId - The pinch hitter's player ID
	 * @param phIndex - The batting order index of the PH
	 * @param openPosition - The position that needs to be filled (what the PH replaced)
	 * @returns Object indicating success and the new assignments if successful
	 */
	private tryShufflePlayersForPH(
		lineup: LineupState,
		phPlayerId: string,
		phIndex: number,
		openPosition: number
	): { success: boolean; assignments: Array<{ index: number; playerId: string; position: number }>; phPosition: number } {
		const phPlayer = this.season.batters[phPlayerId];
		if (!phPlayer) {
			return { success: false, assignments: [], phPosition: openPosition };
		}

		// Find all positions the PH can play (excluding pitcher which is special)
		const phPlayablePositions: number[] = [];
		for (let pos = 2; pos <= 9; pos++) {
			if (this.canPlayPosition(phPlayerId, pos)) {
				phPlayablePositions.push(pos);
			}
		}

		// For each position the PH can play, try to shuffle the existing player
		// at that position to the open position
		for (const phPos of phPlayablePositions) {
			// Find which batting index has this position
			const indexWithPhPos = lineup.players.findIndex(
				p => p !== null && p.position === phPos && p.playerId !== phPlayerId
			);

			if (indexWithPhPos === -1) continue;

			const playerToMove = lineup.players[indexWithPhPos];
			if (!playerToMove) continue;

			// Check if this player can play the open position
			if (playerToMove.playerId && this.canPlayPosition(playerToMove.playerId, openPosition)) {
				// Found a valid shuffle!
				// PH moves to phPos, player at phPos moves to openPosition
				return {
					success: true,
					assignments: [
						{ index: phIndex, playerId: phPlayerId, position: phPos },
						{ index: indexWithPhPos, playerId: playerToMove.playerId, position: openPosition }
					],
					phPosition: phPos
				};
			}
		}

		// No valid shuffle found
		return { success: false, assignments: [], phPosition: openPosition };
	}

	/**
	 * Resolve duplicate positions in the lineup (emergency mode only)
	 * When multiple PHs are assigned to the same position, we need to reassign them
	 * to ensure each position 1-9 has exactly one player
	 */
	private resolveDuplicatePositions(lineup: LineupState, suppressPlays = false): void {
		const positionCounts = new Map<number, number>();
		const positionIndices = new Map<number, number[]>(); // position -> array of indices

		// Count how many players are at each position (1-9)
		for (let i = 0; i < lineup.players.length; i++) {
			const player = lineup.players[i];
			if (player && player.position >= 1 && player.position <= 9) {
				positionCounts.set(player.position, (positionCounts.get(player.position) || 0) + 1);
				if (!positionIndices.has(player.position)) {
					positionIndices.set(player.position, []);
				}
				positionIndices.get(player.position)!.push(i);
			}
		}

		// Find duplicate positions (count > 1)
		const duplicatePositions: number[] = Array.from(positionCounts.entries())
			.filter(([_, count]) => count > 1)
			.map(([pos, _]) => pos as number);

		if (duplicatePositions.length === 0) {
			return; // No duplicates
		}

		console.warn(`Emergency mode: resolving duplicate positions ${duplicatePositions.map(p => POSITION_NAMES[p] ?? String(p)).join(', ')}`);

		// Find which positions are missing (0 players)
		const filledPositions = new Set(positionCounts.keys());
		const missingPositions: number[] = [];
		for (let pos = 1; pos <= 9; pos++) {
			if (!filledPositions.has(pos)) {
				missingPositions.push(pos);
			}
		}

		// Enable emergency mode for this team since we're doing emergency shuffling
		const teamId = this.state.homeLineup === lineup ? this.state.homeLineup.teamId : this.state.awayLineup.teamId;
		this.emergencyRosterMode.set(teamId, true);

		// For each duplicate position, reassign the extra players to missing positions
		// In emergency mode, we MUST assign ALL players to unique positions, even if they can't play them well
		for (const dupPos of duplicatePositions) {
			const indices = positionIndices.get(dupPos) || [];
			// Keep the first player at this position, move the rest
			for (let i = 1; i < indices.length && missingPositions.length > 0; i++) {
				const playerIndex = indices[i];
				const player = lineup.players[playerIndex];
				if (!player || !player.playerId) continue;

				// Try to find a missing position this player can actually play
				let assignedPosition: number | null = null;
				let assignmentIndex = -1;

				for (let j = 0; j < missingPositions.length; j++) {
					const targetPos = missingPositions[j];
					if (this.canPlayPosition(player.playerId, targetPos)) {
						assignedPosition = targetPos;
						assignmentIndex = j;
						break;
					}
				}

				// If no eligible position found, use ANY missing position (emergency mode - better than having duplicates)
				if (assignedPosition === null && missingPositions.length > 0) {
					assignedPosition = missingPositions[0];
					assignmentIndex = 0;
					const playerName = this.season.batters[player.playerId]?.name || player.playerId;
					console.warn(`Emergency: ${playerName} at ${getPositionName(dupPos)} cannot play ${getPositionName(assignedPosition)}, but assigning anyway to resolve duplicate`);
				}

				if (assignedPosition !== null) {
					// Assign the player to the position (eligibly or in emergency mode)
					const oldPosName = getPositionName(dupPos);
					const newPosName = getPositionName(assignedPosition);
					lineup.players[playerIndex] = {
						...player,
						position: assignedPosition
					};
					// Remove the assigned position from missingPositions
					missingPositions.splice(assignmentIndex, 1);

					if (!suppressPlays) {
						this.state.plays.unshift({
							inning: this.state.inning,
							isTopInning: this.state.isTopInning,
							outcome: 'groundOut' as Outcome,
							batterId: '',
							batterName: '',
							pitcherId: '',
							pitcherName: '',
							description: `Lineup adjustment: ${this.formatName(this.season.batters[player.playerId]?.name || player.playerId)} moved to ${newPosName} (emergency duplicate resolution)`,
							runsScored: 0,
							eventType: 'lineupAdjustment',
							substitutedPlayer: player.playerId ?? undefined,
							isSummary: true
						});
					}
				}
			}
		}
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
	private validateCurrentLineup(
		lineup: LineupState,
		options?: { allowEmergencyPositions?: boolean }
	): { isValid: boolean; errors: string[] } {
		const augmentedBatters = this.createAugmentedBattersRecord();
		const result = validateLineup(lineup.players, augmentedBatters, options);
		return { isValid: result.isValid, errors: result.errors };
	}

	/**
	 * Create an augmented batters record that includes pitchers who aren't in batters
	 * Some pitchers might not have batting stats, but they can still play position 1
	 * Also ensures that two-way players (pitchers with batting stats) have correct primaryPosition
	 */
	private createAugmentedBattersRecord(): Record<string, BatterStats> {
		const augmentedBatters: Record<string, BatterStats> = { ...this.season.batters };

		// Add or update pitchers - this handles both:
		// 1. Pitchers who aren't in batters at all
		// 2. Two-way players who are in batters but need primaryPosition=1 when pitching
		for (const [id, pitcher] of Object.entries(this.season.pitchers)) {
			const existing = augmentedBatters[id];
			if (!existing) {
				// Create a minimal BatterStats entry for this pitcher
				// Use league pitcher-batter averages as fallback rates
				augmentedBatters[id] = {
					id: pitcher.id,
					name: pitcher.name,
					bats: pitcher.throws === 'L' ? 'L' : 'R', // Assume same as throwing arm
					teamId: pitcher.teamId,
					primaryPosition: 1,
					positionEligibility: { 1: 1 }, // Can only pitch
					pa: 0,
					avg: 0,
					obp: 0,
					slg: 0,
					ops: 0,
					rates: {
						vsLHP: this.season.league.pitcherBatter.vsLHP,
						vsRHP: this.season.league.pitcherBatter.vsRHP
					}
				};
			} else if (existing.primaryPosition !== 1) {
				// Two-way player: override primaryPosition to 1 when they're pitching
				// Keep their original stats but mark them as a pitcher for validation purposes
				augmentedBatters[id] = {
					...existing,
					primaryPosition: 1,
					// Merge position eligibility - ensure they can pitch
					positionEligibility: {
						...existing.positionEligibility,
						1: (existing.positionEligibility[1] || 0) + 1 // Add/increment pitching eligibility
					}
				};
			}
		}

		return augmentedBatters;
	}

	/**
	 * Check if a team has available bench players (not in lineup, not used as PH, not removed)
	 */
	private hasAvailableBench(lineup: LineupState): boolean {
		const currentLineupPlayerIds = lineup.players
			.map(p => p.playerId)
			.filter((id): id is string => id !== null);
		const allTeamBatters = Object.values(this.season.batters).filter(
			b => b.teamId === lineup.teamId
		);
		const availableBench = allTeamBatters.filter(
			b =>
				!currentLineupPlayerIds.includes(b.id) &&
				!this.usedPinchHitters.has(b.id) &&
				!this.removedPlayers.has(b.id)
		);
		return availableBench.length > 0;
	}

	/**
	 * Check if a team has available relief pitchers (not current pitcher, not removed)
	 */
	private hasAvailableRelievers(teamId: string, currentPitcherId: string): boolean {
		const bullpen = this.bullpenStates.get(teamId);
		if (!bullpen) return false;

		// Collect all available relievers from all bullpen slots
		const allRelievers: PitcherRole[] = [
			...bullpen.relievers,
			...(bullpen.setup ?? []),
			...(bullpen.longRelief ?? [])
		];

		// Add closer if available
		if (bullpen.closer) {
			allRelievers.push(bullpen.closer);
		}

		// Check if any relievers are available (excluding removed and current pitcher)
		const availableRelievers = allRelievers.filter(
			r => !this.removedPlayers.has(r.pitcherId) && r.pitcherId !== currentPitcherId
		);

		return availableRelievers.length > 0;
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
	private auditLineupAtHalfInningEnd(lineup: LineupState, teamId: string, suppressPlays = false): void {
		// Helper to conditionally add lineup adjustment plays
		const maybeAddPlay = (play: PlayEvent) => {
			if (!suppressPlays) {
				this.state.plays.unshift(play);
			}
		};

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

		if (!gameUsesDH) {
			// Non-DH game: Need to resolve PHs using double-switch logic
			// Track if bench searches fail (will trigger emergency mode)
			let benchSearchFailed = false;

			// Step 1: Identify "open" positions - positions that were vacated by players who were PH'd for
			const openPositions = new Set<number>();
			const phForPitcher: Array<{ index: number; playerId: string; replacedPosition: number }> = [];
			const phForPositionPlayer: Array<{ index: number; playerId: string; replacedPosition: number }> = [];

			for (const phSlot of phSlots) {
				const replacedPosition = this.phReplacedPositions.get(phSlot.playerId);
				if (replacedPosition !== undefined) {
					openPositions.add(replacedPosition);
					if (replacedPosition === 1) {
						phForPitcher.push({ ...phSlot, replacedPosition });
					} else {
						phForPositionPlayer.push({ ...phSlot, replacedPosition });
					}
				}
			}

			// Step 2: Handle PH for pitchers specially - the current pitcher takes the old pitcher's batting slot
			// When a pitcher was PH'd for, we tracked the batting slot and need to put the new pitcher there
			const pitcherReplacedSlots: Array<{ pitcherId: string; battingIndex: number }> = [];
			for (const ph of phForPitcher) {
				const replacedPosition = this.phReplacedPositions.get(ph.playerId);
				if (replacedPosition === 1) {
					// This PH replaced a pitcher - get the batting slot from the map
					const battingIndex = this.phForPitcherBattingSlots.get(ph.playerId);
					if (battingIndex !== undefined) {
						// Place the current pitcher at this batting slot
						const currentPitcherId = lineup.pitcher;
						if (currentPitcherId) {
							pitcherReplacedSlots.push({ pitcherId: currentPitcherId, battingIndex });
							console.log(`DEBUG: PH for pitcher detected - PH ${ph.playerId} at batting index ${battingIndex}, will place pitcher ${currentPitcherId} there`);
						}
					}
				}
			}

			// Debug: log current lineup before pitcher placement
			if (pitcherReplacedSlots.length > 0) {
				console.log(`DEBUG: Lineup before pitcher placement: ${lineup.players.map(p => {
					const player = this.season.batters[p.playerId] || this.season.pitchers[p.playerId];
					return `${player?.name || p.playerId || 'null'} (${getPositionName(p.position)})`;
				}).join(', ')}`);
				console.log(`DEBUG: Current pitcher from lineup.pitcher: ${lineup.pitcher}`);
			}

			// Step 3: For each PH, check if they can play one of the open positions
			// This handles the double-switch case where a pitcher PH can take a field position
			// IMPORTANT: PHs for pitchers should NOT take field positions here - they will be
			// either replaced by the current pitcher or assigned later
			// IMPORTANT: Position 1 (pitcher) is NOT included in positionsToFill because only
			// the pitcher placement logic should place someone at position 1
			const positionsToFill = new Set(openPositions);
			positionsToFill.delete(1); // Remove position 1 - only pitcher placement logic handles this
			const phAssignments: Map<string, { index: number; position: number }> = new Map();

			// Only check PH for position players (they might be able to play pitcher or other open positions)
			// PH for pitchers are handled separately below
			for (const ph of phForPositionPlayer) {
				// Check if this PH can play any of the open positions
				for (const openPos of positionsToFill) {
					if (this.canPlayPosition(ph.playerId, openPos)) {
						// This PH stays in the lineup at their current batting order, playing the open position
						phAssignments.set(ph.playerId, { index: ph.index, position: openPos });
						positionsToFill.delete(openPos);
						break;
					}
				}
			}

			// NOTE: PH for pitchers are NOT assigned to field positions here
			// They will be either:
			// 1. Replaced by the current pitcher (in Step 4)
			// 2. Assigned to the position they replaced (in "Handle any remaining unassigned PHs")
			// 3. Replaced by a bench player (in Step 4)

			// Step 3: For remaining open positions, find bench players to fill them
			// Get available bench players
			const currentLineupPlayerIds = lineup.players.map(p => p.playerId).filter((id): id is string => id !== null);
			const allTeamBatters = Object.values(this.season.batters)
				.filter(b => b.teamId === teamId);
			const availableBench = allTeamBatters.filter(b =>
				!currentLineupPlayerIds.includes(b.id) &&
				!this.usedPinchHitters.has(b.id) &&
				!this.removedPlayers.has(b.id)
			);

			// For each remaining open position, find a bench player who can play it
			const benchAssignments: Array<{ index: number; playerId: string; position: number }> = [];
			const remainingPositions = Array.from(positionsToFill);

			for (const position of remainingPositions) {
				let found = false;
				for (const bench of availableBench) {
					if (!benchAssignments.some(a => a.playerId === bench.id) && this.canPlayPosition(bench.id, position)) {
						// Find which PH slot to fill (prefer slots of PHs who couldn't stay)
						const phSlotToFill = phSlots.find(ph => !phAssignments.has(ph.playerId));
						if (phSlotToFill) {
							benchAssignments.push({ index: phSlotToFill.index, playerId: bench.id, position });
							found = true;
							break;
						}
					}
				}
				if (!found) {
					console.warn(`No bench player available to fill open position ${POSITION_NAMES[position] ?? position}`);
					benchSearchFailed = true;
				}
			}

			// Step 4: Apply all assignments
			// First, place the current pitcher at the old pitcher's batting slot (PH for pitcher case)
			// Track which batting indices were filled by pitchers so we don't double-assign
			const pitcherFilledIndices = new Set<number>();

			// Track which PHs have been assigned (by PH assignments, bench assignments, or pitcher placements)
			// This needs to be defined before the assignment loops so we can add to it
			const assignedPlayerIds = new Set<string>();

			// Track the old pitcher slot that will become vacant when we move the pitcher
			// This needs to be filled by someone else
			const vacatedPitcherSlots: Array<{ index: number; position: number }> = [];
			const currentPitcherId = lineup.pitcher;
			if (currentPitcherId) {
				// Find and track ALL occurrences of the current pitcher in the lineup
				// (regardless of position - they could be at position 1, or at a field position from a double switch)
				for (let i = 0; i < lineup.players.length; i++) {
					if (lineup.players[i].playerId === currentPitcherId) {
						// This is the current pitcher - we'll need to fill this slot
						vacatedPitcherSlots.push({ index: i, position: lineup.players[i].position });
					}
				}

				// PRE-CHECK: Before making any changes, verify we have enough bench pitchers to fill all vacated slots
				// If we can't fill them, skip the PH insertion to avoid creating an invalid lineup
				const vacatedPitcherSlotsCount = vacatedPitcherSlots.filter(s => s.position === 1).length;
				if (vacatedPitcherSlotsCount > 0) {
					const currentLineupPlayerIds = lineup.players.map(p => p.playerId).filter((id): id is string => id !== null);
					const allTeamBatters = Object.values(this.season.batters)
						.filter(b => b.teamId === teamId);
					const availableBenchPitchers = allTeamBatters.filter(b =>
						!currentLineupPlayerIds.includes(b.id) &&
						!this.usedPinchHitters.has(b.id) &&
						!this.removedPlayers.has(b.id) &&
						b.primaryPosition === 1  // Only pitchers can play position 1
					);

					if (availableBenchPitchers.length < vacatedPitcherSlotsCount) {
						// Not enough bench pitchers - skip the PH insertion
						console.warn(`Cannot insert PH for pitcher: need ${vacatedPitcherSlotsCount} bench pitcher(s), but only ${availableBenchPitchers.length} available`);
						// Add the PH IDs to usedPinchHitters so they can be reused later
						for (const phId of phAssignments.keys()) {
							this.usedPinchHitters.add(phId);
						}
						return;
					}
				}

				// Now that we've verified availability, clear the pitcher slots
				for (const slot of vacatedPitcherSlots) {
					lineup.players[slot.index] = { playerId: null, position: 0 };
				}
			}

			// Now place the current pitcher at the PH's batting slots
			for (const { pitcherId, battingIndex } of pitcherReplacedSlots) {
				const pitcher = this.season.batters[pitcherId] || this.season.pitchers[pitcherId];
				lineup.players[battingIndex] = {
					playerId: pitcherId,
					position: 1
				};
				pitcherFilledIndices.add(battingIndex);

				const battingOrder = battingIndex + 1;
				maybeAddPlay({
					inning: this.state.inning,
					isTopInning: this.state.isTopInning,
					outcome: 'out' as Outcome,
					batterId: '',
					batterName: '',
					pitcherId: '',
					pitcherName: '',
					description: `Lineup adjustment: ${this.formatName(pitcher?.name || pitcherId)} (P) batting ${battingOrder}${getInningSuffix(battingOrder)}`,
					runsScored: 0,
					eventType: 'lineupAdjustment',
					substitutedPlayer: pitcherId,
					isSummary: true
				});
			}

			// If we vacated any pitcher slots, fill them directly with bench players
			// (can't rely on bench assignment logic because it looks for positions, not slots)
			// Collect bench player IDs that were already assigned in the earlier bench assignment loop
			// to avoid duplicate assignments
			const assignedBenchPlayerIds = new Set(benchAssignments.map(a => a.playerId));

			for (const vacatedSlot of vacatedPitcherSlots) {
				if (vacatedSlot.position === 1) {
					// Need to find a bench player who can play pitcher (position 1)
					// Only players with primaryPosition === 1 can pitch
					const currentLineupPlayerIds = lineup.players.map(p => p.playerId).filter((id): id is string => id !== null);
					const allTeamBatters = Object.values(this.season.batters)
						.filter(b => b.teamId === teamId);
					const availableBench = allTeamBatters.filter(b =>
						!currentLineupPlayerIds.includes(b.id) &&
						!this.usedPinchHitters.has(b.id) &&
						!this.removedPlayers.has(b.id) &&
						!assignedBenchPlayerIds.has(b.id) &&  // Exclude already-assigned bench players
						b.primaryPosition === 1  // Only pitchers can play position 1
					);

					if (availableBench.length > 0) {
						// Use the first available pitcher
						const benchPlayer = availableBench[0];
						lineup.players[vacatedSlot.index] = {
							playerId: benchPlayer.id,
							position: 1
						};

						const battingOrder = vacatedSlot.index + 1;
						maybeAddPlay({
							inning: this.state.inning,
							isTopInning: this.state.isTopInning,
							outcome: 'out' as Outcome,
							batterId: '',
							batterName: '',
							pitcherId: '',
							pitcherName: '',
							description: `Lineup adjustment: ${this.formatName(benchPlayer.name)} (P) replaces pitcher, batting ${battingOrder}${getInningSuffix(battingOrder)}`,
							runsScored: 0,
							eventType: 'lineupAdjustment',
							substitutedPlayer: benchPlayer.id,
							isSummary: true
						});
					} else {
						console.warn(`No bench pitcher available to fill vacated pitcher slot at batting order ${vacatedSlot.index + 1}`);
						benchSearchFailed = true;
						// Leave the slot empty - this will cause a validation error
					}
				} else {
					// Vacated slot is for a field position - find a bench player to fill it directly
					// We can't add to positionsToFill here because the bench assignment loop already ran
					const currentLineupPlayerIds = lineup.players.map(p => p.playerId).filter((id): id is string => id !== null);
					const allTeamBatters = Object.values(this.season.batters)
						.filter(b => b.teamId === teamId);
					const availableBench = allTeamBatters.filter(b =>
						!currentLineupPlayerIds.includes(b.id) &&
						!this.usedPinchHitters.has(b.id) &&
						!this.removedPlayers.has(b.id) &&
						!assignedBenchPlayerIds.has(b.id) &&  // Exclude already-assigned bench players
						this.canPlayPosition(b.id, vacatedSlot.position)
					);

					if (availableBench.length > 0) {
						// Use the first available bench player who can play this position
						const benchPlayer = availableBench[0];
						lineup.players[vacatedSlot.index] = {
							playerId: benchPlayer.id,
							position: vacatedSlot.position
						};

						const battingOrder = vacatedSlot.index + 1;
						const positionName = POSITION_NAMES[vacatedSlot.position] ?? `Pos${vacatedSlot.position}`;
						maybeAddPlay({
							inning: this.state.inning,
							isTopInning: this.state.isTopInning,
							outcome: 'out' as Outcome,
							batterId: '',
							batterName: '',
							pitcherId: '',
							pitcherName: '',
							description: `Lineup adjustment: ${this.formatName(benchPlayer.name)} (${positionName}) replaces pitcher at field position, batting ${battingOrder}${getInningSuffix(battingOrder)}`,
							runsScored: 0,
							eventType: 'lineupAdjustment',
							substitutedPlayer: benchPlayer.id,
							isSummary: true
						});
					} else {
						console.warn(`No bench player available to fill vacated field position ${POSITION_NAMES[vacatedSlot.position] ?? vacatedSlot.position} at batting order ${vacatedSlot.index + 1}`);
						benchSearchFailed = true;
						// Leave the slot empty - this will cause a validation error
					}
				}
			}

			// Second, apply PH assignments (PHs staying in at new positions)
			// Skip PHs that were replaced by pitchers
			for (const [phId, assignment] of phAssignments) {
				if (pitcherFilledIndices.has(assignment.index)) {
					// This PH slot was filled by a pitcher, skip
					continue;
				}
				const phPlayer = this.season.batters[phId];
				if (!phPlayer) continue;

				lineup.players[assignment.index] = {
					playerId: phId,
					position: assignment.position
				};

				const battingOrder = assignment.index + 1;
				const positionName = POSITION_NAMES[assignment.position] ?? `Pos${assignment.position}`;
				maybeAddPlay({
					inning: this.state.inning,
					isTopInning: this.state.isTopInning,
					outcome: 'out' as Outcome,
					batterId: '',
					batterName: '',
					pitcherId: '',
					pitcherName: '',
					description: `Lineup adjustment: ${this.formatName(phPlayer.name)} (${positionName}) remains in game, batting ${battingOrder}${getInningSuffix(battingOrder)}`,
					runsScored: 0,
					eventType: 'lineupAdjustment',
					substitutedPlayer: phId,
					isSummary: true
				});
			}

			// Then, apply bench assignments (new players coming in)
			for (const assignment of benchAssignments) {
				const benchPlayer = this.season.batters[assignment.playerId];
				if (!benchPlayer) continue;

				// Mark the PH as removed
				const originalPhId = lineup.players[assignment.index].playerId!;
				this.removedPlayers.add(originalPhId);

				lineup.players[assignment.index] = {
					playerId: assignment.playerId,
					position: assignment.position
				};

				// Track this PH as assigned so the "remaining PHs" logic skips it
				assignedPlayerIds.add(originalPhId);

				const battingOrder = assignment.index + 1;
				const positionName = POSITION_NAMES[assignment.position] ?? `Pos${assignment.position}`;
				maybeAddPlay({
					inning: this.state.inning,
					isTopInning: this.state.isTopInning,
					outcome: 'out' as Outcome,
					batterId: '',
					batterName: '',
					pitcherId: '',
					pitcherName: '',
					description: `Lineup adjustment: ${this.formatName(benchPlayer.name)} (${positionName}) replaces pinch hitter, batting ${battingOrder}${getInningSuffix(battingOrder)}`,
					runsScored: 0,
					eventType: 'lineupAdjustment',
					substitutedPlayer: originalPhId,
					isSummary: true
				});
			}

			// Handle any remaining unassigned PHs
			// These are PHs who couldn't stay in at a new position and weren't replaced by bench players
			// Try to assign them to the position they replaced, if they're eligible
			// Add PH assignment IDs to the tracking set
			for (const phId of phAssignments.keys()) {
				assignedPlayerIds.add(phId);
			}

			// Add bench assignment IDs to the tracking set
			for (const assignment of benchAssignments) {
				assignedPlayerIds.add(assignment.playerId);
			}

			// Also add the PH playerIds whose slots were filled by pitchers
			for (const ph of phForPitcher) {
				if (pitcherFilledIndices.has(ph.index)) {
					assignedPlayerIds.add(ph.playerId);
				}
			}

			console.log(`DEBUG: Processing remaining PHs - assignedPlayerIds: ${Array.from(assignedPlayerIds).join(', ')}`);
			for (const ph of phSlots) {
				if (assignedPlayerIds.has(ph.playerId)) {
					continue; // Already handled above
				}

				const replacedPosition = this.phReplacedPositions.get(ph.playerId);
				if (replacedPosition !== undefined && this.canPlayPosition(ph.playerId, replacedPosition)) {
					// PH can play the position they replaced - assign them there
					const phPlayer = this.season.batters[ph.playerId];
					if (phPlayer) {
						lineup.players[ph.index] = {
							playerId: ph.playerId,
							position: replacedPosition
						};

						const battingOrder = ph.index + 1;
						const positionName = POSITION_NAMES[replacedPosition] ?? `Pos${replacedPosition}`;
						maybeAddPlay({
							inning: this.state.inning,
							isTopInning: this.state.isTopInning,
							outcome: 'out' as Outcome,
							batterId: '',
							batterName: '',
							pitcherId: '',
							pitcherName: '',
							description: `Lineup adjustment: ${this.formatName(phPlayer.name)} (${positionName}) remains in game defensively, batting ${battingOrder}${getInningSuffix(battingOrder)}`,
							runsScored: 0,
							eventType: 'lineupAdjustment',
							substitutedPlayer: ph.playerId,
							isSummary: true
						});
					}
				} else {
					// PH can't play the position they replaced, and no bench player available
					// Try to "shuffle" existing players to accommodate the PH's actual position ratings
					const phPlayer = this.season.batters[ph.playerId];
					if (phPlayer && replacedPosition !== undefined) {
						const shuffleResult = this.tryShufflePlayersForPH(lineup, ph.playerId, ph.index, replacedPosition);
						if (shuffleResult.success) {
							// Shuffle succeeded - apply the new assignments
							for (const assignment of shuffleResult.assignments) {
								lineup.players[assignment.index] = {
									playerId: assignment.playerId,
									position: assignment.position
								};
							}
							const positionName = POSITION_NAMES[replacedPosition] ?? `Pos${replacedPosition}`;
							maybeAddPlay({
								inning: this.state.inning,
								isTopInning: this.state.isTopInning,
								outcome: 'out' as Outcome,
								batterId: '',
								batterName: '',
								pitcherId: '',
								pitcherName: '',
								description: `Lineup adjustment: ${this.formatName(phPlayer.name)} (${positionName}) remains in game at ${POSITION_NAMES[shuffleResult.phPosition] ?? shuffleResult.phPosition} after shuffle, batting ${ph.index + 1}${getInningSuffix(ph.index + 1)}`,
								runsScored: 0,
								eventType: 'lineupAdjustment',
								substitutedPlayer: ph.playerId,
								isSummary: true
							});
						} else {
							// Shuffle failed - emergency mode, assign PH to the open position anyway
							// First, check if the replaced position is actually available (not a duplicate)
							const positionOccupied = lineup.players.find((p, idx) =>
								idx !== ph.index && p !== null && p.position === replacedPosition
							);

							let finalPosition = replacedPosition;
							let emergencyMessage = `(emergency mode)`;

							if (positionOccupied) {
								// The replaced position is already occupied by another player
								// Find the actual open position by checking which positions are filled
								const filledPositions = new Set(
									lineup.players
										.filter(p => p !== null && p.position >= 1 && p.position <= 9)
										.map(p => p.position)
								);

								// Find the missing position (1-9)
								for (let pos = 1; pos <= 9; pos++) {
									if (!filledPositions.has(pos)) {
										finalPosition = pos;
										emergencyMessage = `(emergency mode - position ${POSITION_NAMES[replacedPosition] ?? replacedPosition} occupied, using ${POSITION_NAMES[pos] ?? pos})`;
										break;
									}
								}

								// If all positions 1-9 are filled (shouldn't happen), default to replaced position
								if (finalPosition === replacedPosition) {
									console.error(`All positions 1-9 are filled but PH still needs assignment - this should not happen!`);
								}
							}

							console.warn(`Pinch hitter ${phPlayer.name} cannot play position ${POSITION_NAMES[replacedPosition] ?? replacedPosition} defensively, no bench available, and shuffle failed - using emergency mode to assign to ${POSITION_NAMES[finalPosition] ?? finalPosition}${finalPosition !== replacedPosition ? ' (filled position workaround)' : ''}`);
							lineup.players[ph.index] = {
								playerId: ph.playerId,
								position: finalPosition
							};
							const positionName = POSITION_NAMES[finalPosition] ?? `Pos${finalPosition}`;
							maybeAddPlay({
								inning: this.state.inning,
								isTopInning: this.state.isTopInning,
								outcome: 'out' as Outcome,
								batterId: '',
								batterName: '',
								pitcherId: '',
								pitcherName: '',
								description: `Lineup adjustment: ${this.formatName(phPlayer.name)} (${positionName}) remains in game at ${positionName} ${emergencyMessage}, batting ${ph.index + 1}${getInningSuffix(ph.index + 1)}`,
								runsScored: 0,
								eventType: 'lineupAdjustment',
								substitutedPlayer: ph.playerId,
								isSummary: true
							});
							benchSearchFailed = true;
						}
					}
				}
			}

			// Set emergency mode if bench searches failed
			if (benchSearchFailed) {
				this.emergencyRosterMode.set(teamId, true);
			}

			// Final fix: resolve any remaining duplicate positions
			// This can happen when multiple PHs are assigned positions that conflict
			this.resolveDuplicatePositions(lineup, suppressPlays);

			// Validate the final lineup to ensure no issues
			const finalValidation = this.validateCurrentLineup(lineup, {
				allowEmergencyPositions: this.emergencyRosterMode.get(teamId) ?? false
			});
			if (!finalValidation.isValid) {
				console.error(`Lineup validation failed after PH resolution: ${finalValidation.errors.join(', ')}`);
				// This is a serious error - the lineup is invalid
				// Log the current state for debugging
				console.error(`Lineup: ${lineup.players.map(p => {
					const player = this.season.batters[p.playerId];
					return `${player?.name || p.playerId} (${getPositionName(p.position)})`;
				}).join(', ')}`);
			}

			// Clean up PH tracking
			for (const ph of phSlots) {
				this.phReplacedPositions.delete(ph.playerId);
			}

			// Clean up PH-for-pitcher batting slots tracking
			// Remove entries for PHs whose slots we filled with pitchers
			for (const ph of phForPitcher) {
				if (pitcherFilledIndices.has(ph.index)) {
					this.phForPitcherBattingSlots.delete(ph.playerId);
				}
			}
		} else {
			// DH game: PH could stay in or be replaced
			// Track if bench searches fail (will trigger emergency mode)
			let benchSearchFailed = false;

			// For now, simpler case - find bench players to replace PHs
			for (const phSlot of phSlots) {
				const phPlayerId = phSlot.playerId;
				if (!phPlayerId) continue;

				const phPlayer = this.season.batters[phPlayerId];
				if (!phPlayer) continue;

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

				if (availableBench.length === 0) {
					// No bench players available at all - try to shuffle or use emergency mode
					// In DH games, PH stays at their batting order position
					// Find what position they should take (try DH first, then shuffle)
					const replacedPosition = this.phReplacedPositions.get(phPlayerId);
					if (replacedPosition !== undefined) {
						if (this.canPlayPosition(phPlayerId, 10)) {
							// PH can DH - assign them there
							lineup.players[phSlot.index] = {
								playerId: phPlayerId,
								position: 10 // DH
							};
							maybeAddPlay({
								inning: this.state.inning,
								isTopInning: this.state.isTopInning,
								outcome: 'out' as Outcome,
								batterId: '',
								batterName: '',
								pitcherId: '',
								pitcherName: '',
								description: `Lineup adjustment: ${this.formatName(phPlayer.name)} (DH) remains in game as DH, batting ${phSlot.index + 1}${getInningSuffix(phSlot.index + 1)}`,
								runsScored: 0,
								eventType: 'lineupAdjustment',
								substitutedPlayer: phPlayerId,
								isSummary: true
							});
						} else {
							// PH can't DH either - try shuffle or emergency mode
							const shuffleResult = this.tryShufflePlayersForPH(lineup, phPlayerId, phSlot.index, replacedPosition);
							if (shuffleResult.success) {
								// Shuffle succeeded - apply the new assignments
								for (const assignment of shuffleResult.assignments) {
									lineup.players[assignment.index] = {
										playerId: assignment.playerId,
										position: assignment.position
									};
								}
								const positionName = POSITION_NAMES[replacedPosition] ?? `Pos${replacedPosition}`;
								maybeAddPlay({
									inning: this.state.inning,
									isTopInning: this.state.isTopInning,
									outcome: 'out' as Outcome,
									batterId: '',
									batterName: '',
									pitcherId: '',
									pitcherName: '',
									description: `Lineup adjustment: ${this.formatName(phPlayer.name)} (${positionName}) remains in game at ${POSITION_NAMES[shuffleResult.phPosition] ?? shuffleResult.phPosition} after shuffle, batting ${phSlot.index + 1}${getInningSuffix(phSlot.index + 1)}`,
									runsScored: 0,
									eventType: 'lineupAdjustment',
									substitutedPlayer: phPlayerId,
									isSummary: true
								});
							} else {
								// Emergency mode - assign to replaced position anyway
								console.warn(`Pinch hitter ${phPlayer.name} cannot play position ${POSITION_NAMES[replacedPosition] ?? replacedPosition} defensively, no bench available, and shuffle failed - using emergency mode to assign as DH`);
								lineup.players[phSlot.index] = {
									playerId: phPlayerId,
									position: 10 // DH - emergency mode allows any player to DH
								};
								maybeAddPlay({
									inning: this.state.inning,
									isTopInning: this.state.isTopInning,
									outcome: 'out' as Outcome,
									batterId: '',
									batterName: '',
									pitcherId: '',
									pitcherName: '',
									description: `Lineup adjustment: ${this.formatName(phPlayer.name)} (DH) remains in game as DH (emergency mode), batting ${phSlot.index + 1}${getInningSuffix(phSlot.index + 1)}`,
									runsScored: 0,
									eventType: 'lineupAdjustment',
									substitutedPlayer: phPlayerId,
									isSummary: true
								});
								benchSearchFailed = true;
							}
						}
					} else {
						// No replaced position info - assign as DH as fallback
						console.warn(`No bench players available for ${teamId} - PH ${phPlayer.name} assigned as DH (emergency mode)`);
						lineup.players[phSlot.index] = {
							playerId: phPlayerId,
							position: 10 // DH
						};
						benchSearchFailed = true;
					}
				}

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

							maybeAddPlay({
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
						// In DH games, assign as DH (any player can DH)
						console.warn(`No valid defensive position found for any bench player to replace PH ${phPlayer.name} at batting order ${phSlot.index + 1} - assigning as DH (emergency mode)`);
						lineup.players[phSlot.index] = {
							playerId: phPlayerId,
							position: 10 // DH - any player can DH in emergency
						};
						maybeAddPlay({
							inning: this.state.inning,
							isTopInning: this.state.isTopInning,
							outcome: 'out' as Outcome,
							batterId: '',
							batterName: '',
							pitcherId: '',
							pitcherName: '',
							description: `Lineup adjustment: ${this.formatName(phPlayer.name)} (DH) remains in game as DH (emergency mode), batting ${phSlot.index + 1}${getInningSuffix(phSlot.index + 1)}`,
							runsScored: 0,
							eventType: 'lineupAdjustment',
							substitutedPlayer: phPlayerId,
							isSummary: true
						});
						benchSearchFailed = true;
					}
				}
			}

			// Set emergency mode if bench searches failed
			if (benchSearchFailed) {
				this.emergencyRosterMode.set(teamId, true);
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
		const filteredBullpen: EnhancedBullpenState = {
			starter: bullpen.starter,
			closer: bullpen.closer && !this.removedPlayers.has(bullpen.closer.pitcherId) ? bullpen.closer : undefined,
			setup: bullpen.setup?.filter(r => !this.removedPlayers.has(r.pitcherId)),
			longRelief: bullpen.longRelief?.filter(r => !this.removedPlayers.has(r.pitcherId)),
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
			pullThresholds: this.season.norms.pitching.pullThresholds ?? { consider: 16, likely: 18, hardLimit: 21 },
			// Era minimum reliever caps removed - use season-specific data instead
			// The season data now contains accurate reliever BFP values from historical data
			eraMinRelieverCaps: undefined
		};

		const pitchingDecision = shouldPullPitcher(
			mgrState,
			pitcherRole,
			filteredBullpen,
			this.managerialOptions.randomness ?? 0.1,
			pullOptions
		);

		// Prevent pitching change if no relievers available
		if (pitchingDecision.shouldChange && pitchingDecision.newPitcher) {
			if (!this.hasAvailableRelievers(pitchingTeam.teamId, pitcherId)) {
				console.warn(`No relief pitchers available for ${pitchingTeam.teamId} - cannot make pitching change`);
				return false;
			}
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
			const validation = this.validateCurrentLineup(pitchingTeam, {
				allowEmergencyPositions: this.emergencyRosterMode.get(pitchingTeam.teamId) ?? false
			});
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

		// Prevent pinch hit if no bench players available
		if (availableBench.length === 0) {
			if (mustPHForReliever) {
				console.warn(`No bench players available for ${battingTeam.teamId} - reliever ${currentBatter.name} must bat`);
			}
			return false;
		}

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
						const oldPhReplacedPositions = new Map(this.phReplacedPositions);

						let description = `Pinch hit: ${this.formatName(pinchHitter?.name ?? 'Unknown')} pinch hits for ${this.formatName(currentBatter.name)}`;

						// Track which position this PH replaced (for double-switch resolution at inning end)
						this.phReplacedPositions.set(phDecision.pinchHitterId, replacedPosition);

						// Assign pinch hitter position 11 (PH) - temporary, will be resolved at end of inning
						battingTeam.players[batterIndex] = { playerId: phDecision.pinchHitterId, position: this.POSITION_PH };

						// If pinch hitting for pitcher, we also need a new pitcher
						if (isPitcherPH) {
							// Store which batting slot this PH occupies, so we can place the new pitcher there
							this.phForPitcherBattingSlots.set(phDecision.pinchHitterId, batterIndex);

							// Get a reliever from the bullpen (excluding the current pitcher being pinch hit for)
							const bullpen = this.bullpenStates.get(battingTeam.teamId);
							if (bullpen && bullpen.relievers.length > 0) {
								// Filter bullpen to exclude removed pitchers (they cannot re-enter the game)
								const filteredBullpen: EnhancedBullpenState = {
									starter: bullpen.starter,
									closer: bullpen.closer && !this.removedPlayers.has(bullpen.closer.pitcherId) ? bullpen.closer : undefined,
									setup: bullpen.setup?.filter(r => !this.removedPlayers.has(r.pitcherId)),
									longRelief: bullpen.longRelief?.filter(r => !this.removedPlayers.has(r.pitcherId)),
									relievers: bullpen.relievers.filter(r => !this.removedPlayers.has(r.pitcherId))
								};

								// Use selectReliever to properly choose a reliever, excluding the current pitcher
								const mgrState = toManagerialGameState(this.state);
								const selectedPitcher = selectReliever(mgrState, filteredBullpen, currentBatterId);
								if (!selectedPitcher) {
									console.warn('No suitable reliever found for pinch hitting for pitcher, skipping PH');
									// Revert the PH assignment
									battingTeam.players = oldPlayers;
									this.phReplacedPositions = oldPhReplacedPositions;
									this.phForPitcherBattingSlots.delete(phDecision.pinchHitterId);
									return false;
								}
								const newPitcherId = selectedPitcher.pitcherId;

								// Sanity check: ensure the new pitcher hasn't already been removed from the game
								if (this.removedPlayers.has(newPitcherId)) {
									console.warn(`Preventing re-entry: ${newPitcherId} has already been removed`);
									// Revert the PH assignment
									battingTeam.players = oldPlayers;
									this.phReplacedPositions = oldPhReplacedPositions;
									this.phForPitcherBattingSlots.delete(phDecision.pinchHitterId);
									return false;
								}

								const newPitcher = this.season.pitchers[newPitcherId];

								// Sanity check: ensure the new pitcher is actually a pitcher (primaryPosition === 1)
								const newPitcherBatter = this.season.batters[newPitcherId];
								if (newPitcherBatter && newPitcherBatter.primaryPosition !== 1) {
									console.warn(`Selected reliever ${newPitcherId} (${newPitcher?.name}) is not a pitcher (primaryPosition: ${newPitcherBatter.primaryPosition}), skipping PH`);
									// Revert the PH assignment
									battingTeam.players = oldPlayers;
									this.phReplacedPositions = oldPhReplacedPositions;
									this.phForPitcherBattingSlots.delete(phDecision.pinchHitterId);
									return false;
								}

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
								this.phReplacedPositions = oldPhReplacedPositions;
								this.phForPitcherBattingSlots.delete(phDecision.pinchHitterId);
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
				 pa: 0, // Pitchers typically have few PA
				 avg: 0,
				 obp: 0,
				 slg: 0,
				 ops: 0,
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

			// Always audit and fix the lineup for the team that just finished batting
			// This resolves any temporary pinch hitters (position 11) and ensures
			// the current pitcher is in the batting order for non-DH games
			// When the game is complete (or will be over without another turn), we suppress
			// the "Lineup adjustment" play messages but still normalize the lineup so final
			// lineups don't show position 11 (PH)
			const teamThatJustFinished = state.isTopInning ? 'away' : 'home';
			const suppressPlays = this.isComplete() || this.willGameBeOverAfterHalfInning(teamThatJustFinished);
			this.auditLineupAtHalfInningEnd(battingTeam, battingTeam.teamId, suppressPlays);

			// Only validate lineup if the game is NOT complete
			// If the game is over (e.g., bottom of 11th, final out), we don't need to validate
			if (!this.isComplete()) {
				// CRITICAL: Validate the lineup after all substitutions
				// This ensures: all 9 positions (1-9) are filled exactly once,
				// no player is at position 11 (PH), and each player is eligible for their position
				const augmentedBatters = this.createAugmentedBattersRecord();
				const validation = validateLineup(battingTeam.players, augmentedBatters, {
					allowEmergencyPositions: this.emergencyRosterMode.get(battingTeam.teamId) ?? false
				});
				if (!validation.isValid) {
					console.error(`CRITICAL: Invalid lineup after half-inning ${state.inning} (${state.isTopInning ? 'top' : 'bottom'}) for team ${battingTeam.teamId}:`);
					for (const err of validation.errors) {
						console.error(`  - ${err}`);
					}
					// Log the lineup for debugging
					console.error(`Lineup: ${battingTeam.players.map(p => {
						const player = augmentedBatters[p.playerId];
						const posName = p.position ? ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'PH', 'PR'][p.position - 1] || `Pos${p.position}` : 'null';
						return `${player?.name || p.playerId} (${posName})`;
					}).join(', ')}`);
					throw new Error(`Invalid lineup after half-inning: ${validation.errors.join(', ')}`);
				}
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

		// Standard 9-inning game: away team wins after home team has batted in bottom of 9th
		// and still trails (tied games go to extra innings)
		// This triggers when: inning is 10 (after bottom of 9th ended), top half, away leads, home batted in previous inning
		if (this.state.inning === 10 && this.state.isTopInning && awayScore > homeScore && this.state.homeTeamHasBattedInInning) {
			return true;
		}

		// Extra innings (11th+): if away team leads after top of an inning AND home team has already batted, game ends
		// (Home team had their chance and couldn't tie/win)
		if (this.state.inning > 10 && this.state.isTopInning && awayScore > homeScore && this.state.homeTeamHasBattedInInning) {
			return true;
		}

		// Continue playing
		return false;
	}

	/**
	 * Predict whether the game will be over after the current half-inning ends.
	 * This is used to suppress unnecessary lineup adjustment messages when the other
	 * team won't get another chance to bat.
	 */
	private willGameBeOverAfterHalfInning(teamThatJustFinished: 'home' | 'away'): boolean {
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

		if (teamThatJustFinished === 'home') {
			// Home team just finished batting in bottom of an inning
			// Game is over if: inning is 9+ and home team is trailing (away team wins without batting again)
			return this.state.inning >= 9 && awayScore > homeScore;
		} else {
			// Away team just finished batting in top of an inning
			// Game is NOT over yet - home team always gets their chance in the bottom half
			return false;
		}
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
