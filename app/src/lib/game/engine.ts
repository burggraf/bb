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
import { buildLineup, usesDH, type UsageContext } from './lineup-builder.js';
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
	/** Usage context for pitcher selection - Map of pitcher ID to usage percentage (0.0-1.0 of actual) */
	pitcherUsage?: Map<string, number>;
	/** Usage threshold above which a pitcher should be rested (default 1.25 = 125%) */
	restThreshold?: number;
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

	// Score diff from pitching team's perspective
	const scoreDiff = state.isTopInning ? homeScore - awayScore : awayScore - homeScore;

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
		case 'intentionalWalk':
			return `${batter} is intentionally walked${runsText}`;
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
	// Track games played per player (for usage-aware substitutions)
	// Map of player_id → games played in this replay series
	private playerGamesPlayed: Map<string, number> = new Map();

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

		// Generate lineups using the new lineup builder (sync, no usage context)
		const awayResult = buildLineup(season.batters, season.pitchers, awayTeam, awayLeague, year);
		const homeResult = buildLineup(season.batters, season.pitchers, homeTeam, homeLeague, year);

		const awayLineup: LineupState = awayResult.lineup;
		const homeLineup: LineupState = homeResult.lineup;

		// Validate initial lineups
		// Create augmented batters record that includes pitchers for validation
		const augmentedBatters = this.createAugmentedBattersRecord();
		const awayValidation = validateLineup(awayLineup.players, augmentedBatters, { year: season.meta.year });
		const homeValidation = validateLineup(homeLineup.players, augmentedBatters, { year: season.meta.year });

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
		this.playerGamesPlayed = new Map();
		this.initializeBullpen(awayTeam, awayLineup.pitcher!);
		this.initializeBullpen(homeTeam, homeLineup.pitcher!);

		// Record starting lineups
		this.recordStartingLineups();
	}

	/**
	 * Static factory method for lineup creation with usage context
	 *
	 * Use this when you need to pass usage context for batter rest decisions.
	 * For simple cases without usage tracking, use the constructor directly.
	 *
	 * @param season - Season package with team and player data
	 * @param awayTeam - Away team ID
	 * @param homeTeam - Home team ID
	 * @param managerial - Optional managerial settings
	 * @param awayUsageContext - Optional usage context for away team batters
	 * @param homeUsageContext - Optional usage context for home team batters
	 * @returns GameEngine - Initialized game engine
	 */
	static create(
		season: SeasonPackage,
		awayTeam: string,
		homeTeam: string,
		managerial?: ManagerialOptions,
		awayUsageContext?: UsageContext,
		homeUsageContext?: UsageContext
	): GameEngine {
		// Get league info for DH rules
		const awayLeague = season.teams[awayTeam]?.league ?? 'NL';
		const homeLeague = season.teams[homeTeam]?.league ?? 'NL';
		const year = season.meta.year;

		// Build lineups with usage context if provided
		const awayResult = buildLineup(season.batters, season.pitchers, awayTeam, awayLeague, year, awayUsageContext);
		const homeResult = buildLineup(season.batters, season.pitchers, homeTeam, homeLeague, year, homeUsageContext);

		// Create engine with pre-built lineups by storing results temporarily
		// and calling the regular constructor
		const engine = new GameEngine(season, awayTeam, homeTeam, managerial);

		// Replace the lineups with the ones built with usage context
		engine.state.awayLineup = awayResult.lineup;
		engine.state.homeLineup = homeResult.lineup;

		// Reinitialize bullpens with the correct pitchers
		engine.initializeBullpen(awayTeam, awayResult.lineup.pitcher!);
		engine.initializeBullpen(homeTeam, homeResult.lineup.pitcher!);

		// Record starting lineups
		engine.recordStartingLineups();

		return engine;
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
					playerName: formatName(player?.name ?? 'Unknown'),
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
			pitcherName: formatName(awayPitcher?.name ?? 'Unknown'),
			description: `${awayName} starting lineup: ${awayLineupPlayers.map((p) => `${p.playerName} (${getPositionName(p.fieldingPosition)})`).join(', ')}; SP: ${formatName(awayPitcher?.name ?? 'Unknown')}`,
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
					playerName: formatName(player?.name ?? 'Unknown'),
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
			pitcherName: formatName(homePitcher?.name ?? 'Unknown'),
			description: `${homeName} starting lineup: ${homeLineupPlayers.map((p) => `${p.playerName} (${getPositionName(p.fieldingPosition)})`).join(', ')}; SP: ${formatName(homePitcher?.name ?? 'Unknown')}`,
			runsScored: 0,
			eventType: 'startingLineup',
			lineup: homeLineupPlayers,
			isSummary: true
		});
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

		return false;
	}

	/**
	 * Find the best position for a player to fill, given the set of already-filled positions.
	 * Prioritizes: 1) primary position, 2) position with most eligibility innings, 3) any open position
	 * CRITICAL: Never assigns position 1 (pitcher) to non-pitchers
	 */
	private findBestPositionForPlayer(playerId: string, filledPositions: Set<number>): number {
		const player = this.season.batters[playerId];
		if (!player) {
			return 2; // Default to catcher if player not found (not pitcher!)
		}

		const isPitcher = player.primaryPosition === 1;

		// Try primary position first
		if (player.primaryPosition >= 1 && player.primaryPosition <= 9 && !filledPositions.has(player.primaryPosition)) {
			return player.primaryPosition;
		}

		// Define available positions based on whether player is a pitcher
		const availablePositions = isPitcher
			? [1, 2, 3, 4, 5, 6, 7, 8, 9] // Pitchers can play any position (in emergency)
			: [2, 3, 4, 5, 6, 7, 8, 9]; // Non-pitchers CANNOT play position 1

		// Try positions with most eligibility innings
		let bestPosition = isPitcher ? 1 : 2; // Default based on player type
		let maxInnings = 0;
		for (const pos of availablePositions) {
			if (filledPositions.has(pos)) continue;

			const innings = (player.positionEligibility[pos] || 0) / 3;
			if (innings > maxInnings) {
				maxInnings = innings;
				bestPosition = pos;
			}
		}

		return bestPosition;
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

		// Find which positions are missing (0 players) - HOLES
		const filledPositions = new Set(positionCounts.keys());
		const missingPositions: number[] = [];
		for (let pos = 1; pos <= 9; pos++) {
			if (!filledPositions.has(pos)) {
				missingPositions.push(pos);
			}
		}

		// Find duplicate positions (count > 1)
		const duplicatePositions: number[] = Array.from(positionCounts.entries())
			.filter(([_, count]) => count > 1)
			.map(([pos, _]) => pos as number);

		// If no issues, return
		if (duplicatePositions.length === 0 && missingPositions.length === 0) {
			return;
		}

		console.warn(`Emergency mode: resolving duplicate positions ${duplicatePositions.map(p => POSITION_NAMES[p] ?? String(p)).join(', ')}`);

		// Enable emergency mode for this team since we're doing emergency shuffling
		const teamId = this.state.homeLineup === lineup ? this.state.homeLineup.teamId : this.state.awayLineup.teamId;
		this.emergencyRosterMode.set(teamId, true);

		// For each duplicate position, reassign the extra players to missing positions
		// ONLY assign if player can actually play the position - no emergency assignments
		for (const dupPos of duplicatePositions) {
			const indices = positionIndices.get(dupPos) || [];

			// SPECIAL HANDLING FOR PITCHER POSITION (1)
			// Ensure the first player at position 1 is actually a pitcher
			if (dupPos === 1) {
				// Find the first actual pitcher at this position
				let pitcherIndex = -1;
				for (let i = 0; i < indices.length; i++) {
					const idx = indices[i];
				 const player = lineup.players[idx];
					if (player && player.playerId && this.canPlayPosition(player.playerId, 1)) {
						pitcherIndex = i;
						break;
					}
				}

				if (pitcherIndex === -1) {
					// No pitcher found at position 1 - this is a critical error
					console.error(`[resolveDuplicatePositions] CRITICAL: No pitcher found among ${indices.length} players at position 1`);
					// Try to find any pitcher on the team to fill this role
					const teamId = this.state.homeLineup === lineup ? this.state.homeLineup.teamId : this.state.awayLineup.teamId;
					const allTeamBatters = Object.values(this.season.batters).filter(b => b.teamId === teamId);
					const teamPitchers = allTeamBatters.filter(b => b.primaryPosition === 1);

					if (teamPitchers.length > 0) {
						// Find a pitcher who isn't currently in the lineup
						for (const pitcher of teamPitchers) {
							const inLineup = lineup.players.some(p => p.playerId === pitcher.id);
							if (!inLineup) {
								// Put this pitcher at position 1, replacing the first non-pitcher
								const replaceIndex = indices[0];
								const removedPlayer = lineup.players[replaceIndex];
								console.warn(`[resolveDuplicatePositions] Replacing non-pitcher ${removedPlayer.playerId} with pitcher ${pitcher.name} at position 1`);
								lineup.players[replaceIndex] = { playerId: pitcher.id, position: 1 };
								break;
							}
						}
					}
				} else if (pitcherIndex !== 0) {
					// The first player at position 1 is not a pitcher, swap with the first pitcher
					const nonPitcherIndex = indices[0];
					const actualPitcherIndex = indices[pitcherIndex];
					const nonPitcher = lineup.players[nonPitcherIndex];
					const actualPitcher = lineup.players[actualPitcherIndex];

					console.warn(`[resolveDuplicatePositions] Position 1 had non-pitcher first, swapping ${nonPitcher?.playerId} with pitcher ${actualPitcher?.playerId}`);
					// CRITICAL: Actually swap the players in the lineup, not just the indices
					// The pitcher stays at their current batting order slot
					// The non-pitcher keeps their position 1 assignment but will be moved to a different position below
					// Swap the indices so the loop below moves the non-pitcher to a different position
					const temp = indices[0];
					indices[0] = indices[pitcherIndex];
					indices[pitcherIndex] = temp;
				}
				// Now the first player in indices[0] is guaranteed to be a pitcher (or we did our best)
			}

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

				// If no eligible position found, try to find least-bad position
				// Instead of skipping, assign to position with most eligibility innings
				if (assignedPosition === null) {
					// Find position with most innings (best available option)
					let bestPos: number | null = null;
					let maxInnings = 0;
					for (const pos of missingPositions) {
						const playerData = this.season.batters[player.playerId];
						if (!playerData) continue;
						const innings = (playerData.positionEligibility[pos] || 0) / 3;
						if (innings > maxInnings) {
							maxInnings = innings;
							bestPos = pos;
						}
					}

					if (bestPos !== null) {
						// Found best available position (even if not ideal)
						assignedPosition = bestPos;
						assignmentIndex = missingPositions.indexOf(bestPos);
						const playerName = this.season.batters[player.playerId]?.name || player.playerId;
						console.warn(`Emergency: ${playerName} assigned to ${getPositionName(bestPos)} (not primary position, ${maxInnings.toFixed(0)} innings)`);
					} else {
						// This is truly hopeless - assign to any unassigned position to avoid hole
						const anyUnassigned = missingPositions[0];
						if (anyUnassigned) {
							assignedPosition = anyUnassigned;
							assignmentIndex = 0;
							const playerName = this.season.batters[player.playerId]?.name || player.playerId;
							console.warn(`CRITICAL Emergency: ${playerName} forced to ${getPositionName(anyUnassigned)} (no eligibility, filling lineup hole)`);
						} else {
							// No missing positions left - need to swap with someone at a different position
							// Find a player who is at a different position and can swap positions
							const playerName = this.season.batters[player.playerId]?.name || player.playerId;
							console.warn(`Emergency mode: ${playerName} at position ${getPositionName(dupPos)} but no open positions - attempting player swap`);

							// Try to find a player at a non-duplicate position who can play a different position
							let swapped = false;
							for (let swapIdx = 0; swapIdx < lineup.players.length; swapIdx++) {
								if (swapIdx === playerIndex) continue; // Don't swap with self

								const swapPlayer = lineup.players[swapIdx];
								if (!swapPlayer || !swapPlayer.playerId) continue;
								if (swapPlayer.position === dupPos) continue; // Skip other players at same duplicate position

								// Check if current player can play swap player's position
								if (this.canPlayPosition(player.playerId, swapPlayer.position)) {
									// Swap positions
									console.warn(`Emergency mode: Swapping ${playerName} (position ${dupPos}) with ${this.season.batters[swapPlayer.playerId]?.name || swapPlayer.playerId} (position ${getPositionName(swapPlayer.position)})`);
									lineup.players[playerIndex] = {
										...player,
										position: swapPlayer.position
									};
									lineup.players[swapIdx] = {
										...swapPlayer,
										position: dupPos
									};
									swapped = true;
									break;
								}
							}

							if (!swapped) {
								// ULTIMATE EMERGENCY: No compatible swap found
								// As a last resort, swap with ANY player at a different position (ignoring eligibility)
								// This is better than having duplicate positions
								console.error(`Emergency mode: Could not find compatible swap for ${playerName}, using ultimate emergency swap`);

								for (let swapIdx = 0; swapIdx < lineup.players.length; swapIdx++) {
									if (swapIdx === playerIndex) continue;

									const swapPlayer = lineup.players[swapIdx];
									if (!swapPlayer || !swapPlayer.playerId) continue;
									if (swapPlayer.position === dupPos) continue; // Skip other players at same duplicate position

									// Just swap positions regardless of eligibility
									const targetPosition = swapPlayer.position;
									const swapPlayerName = this.season.batters[swapPlayer.playerId]?.name || swapPlayer.playerId;

									console.warn(`EMERGENCY: Forcing swap of ${playerName} (position ${dupPos}) with ${swapPlayerName} (position ${getPositionName(targetPosition)}) - ignoring eligibility`);

									lineup.players[playerIndex] = {
										...player,
										position: targetPosition
									};
									lineup.players[swapIdx] = {
										...swapPlayer,
										position: dupPos
									};
									swapped = true;
									break;
								}

								// If even that fails (shouldn't happen), remove the duplicate player
								if (!swapped) {
									console.error(`CRITICAL: Could not resolve duplicate ${playerName} at position ${dupPos} - removing from lineup (will create hole)`);
									lineup.players[playerIndex] = {
										playerId: null,
										position: 0
									};
								}

								// Skip the normal assignment since we handled the swap here
								continue;
							}
						}
					}
				}

				// Assign the player to the eligible position
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
						description: `Lineup adjustment: ${formatName(this.season.batters[player.playerId]?.name || player.playerId)} moved to ${getPositionName(assignedPosition)} (emergency duplicate resolution)`,
						runsScored: 0,
						eventType: 'lineupAdjustment',
						substitutedPlayer: player.playerId ?? undefined,
						isSummary: true
					});
				}
			}
		}

		// Handle remaining holes (missing positions with no duplicates to fill them)
		// This happens when PH resolution leaves empty slots but no duplicate players to move
		if (missingPositions.length > 0) {
			console.warn(`Emergency mode: filling ${missingPositions.length} remaining position holes: ${missingPositions.map(p => POSITION_NAMES[p] ?? String(p)).join(', ')}`);

			// Find empty slots in the lineup (playerId = null or position 0)
			const emptySlots: Array<{ index: number; position: number }> = [];
			for (let i = 0; i < lineup.players.length; i++) {
				const player = lineup.players[i];
				if (!player || !player.playerId || player.position === 0) {
					emptySlots.push({ index: i, position: player?.position || 0 });
				}
			}

			// Enable emergency mode for this team since we're doing emergency shuffling
			const teamId = this.state.homeLineup === lineup ? this.state.homeLineup.teamId : this.state.awayLineup.teamId;
			this.emergencyRosterMode.set(teamId, true);

			// Get all available players (bench + those not in lineup)
			const currentLineupPlayerIds = new Set(
				lineup.players
					.map(p => p.playerId)
					.filter((id): id is string => id !== null)
			);
			const allTeamBatters = Object.values(this.season.batters)
				.filter(b => b.teamId === teamId && b.primaryPosition !== 1); // Exclude pitchers

			// For each empty slot, find a player to fill it
			for (const emptySlot of emptySlots) {
				if (missingPositions.length === 0) break;

				const targetPos = missingPositions[0];
				let assignedPlayer: string | null = null;

				// First, try to find a bench player who can play this position
				for (const batter of allTeamBatters) {
					if (!currentLineupPlayerIds.has(batter.id) &&
						!this.usedPinchHitters.has(batter.id) &&
						!this.removedPlayers.has(batter.id) &&
						this.canPlayPosition(batter.id, targetPos)) {
						assignedPlayer = batter.id;
						break;
					}
				}

				// If no bench player, try ANY player who can play this position
				if (!assignedPlayer) {
					for (const batter of allTeamBatters) {
						if (this.canPlayPosition(batter.id, targetPos)) {
							assignedPlayer = batter.id;
							console.warn(`CRITICAL: Using ${batter.name} from roster to fill hole at ${getPositionName(targetPos)} (no bench available)`);
							break;
						}
					}
				}

				// If still no player, try ANY player even if not eligible
				if (!assignedPlayer && allTeamBatters.length > 0) {
					const anyPlayer = allTeamBatters[0];
					assignedPlayer = anyPlayer.id;
					console.warn(`ULTRA CRITICAL: Forcing ${anyPlayer.name} to ${getPositionName(targetPos)} (no eligible player)`);
				}

				// Assign the player to the empty slot
				if (assignedPlayer) {
					lineup.players[emptySlot.index] = {
						playerId: assignedPlayer,
						position: targetPos
					};
					missingPositions.shift(); // Remove this position from missing list

					if (!suppressPlays) {
						this.state.plays.unshift({
							inning: this.state.inning,
							isTopInning: this.state.isTopInning,
							outcome: 'out' as Outcome,
							batterId: '',
							batterName: '',
							pitcherId: '',
							pitcherName: '',
							description: `Lineup adjustment: ${formatName(this.season.batters[assignedPlayer]?.name || assignedPlayer)} assigned to ${getPositionName(targetPos)} (filling lineup hole)`,
							runsScored: 0,
							eventType: 'lineupAdjustment',
							substitutedPlayer: assignedPlayer,
							isSummary: true
						});
					}
				}
			}
		}
	}

	/**
	 * Fill any holes (null playerIds) in the lineup BEFORE validation
	 * This prevents "Position X has no player assigned" errors
	 */
	private fillLineupHoles(lineup: LineupState, suppressPlays = false): void {
		// Find null slots in the batting order
		const nullSlots: Array<{ index: number; position: number }> = [];
		for (let i = 0; i < lineup.players.length; i++) {
			const player = lineup.players[i];
			if (!player || !player.playerId) {
				nullSlots.push({ index: i, position: player?.position || 0 });
			}
		}

		if (nullSlots.length === 0) {
			return; // No holes to fill
		}

		console.warn(`[fillLineupHoles] Found ${nullSlots.length} null slots in lineup, filling...`);

		// Enable emergency mode for this team
		const teamId = this.state.homeLineup === lineup ? this.state.homeLineup.teamId : this.state.awayLineup.teamId;
		this.emergencyRosterMode.set(teamId, true);

		// Get all available players - separate batters and pitchers
		const currentLineupPlayerIds = new Set(
			lineup.players
				.map(p => p.playerId)
				.filter((id): id is string => id !== null)
		);

		// Get batters (position 2-10) excluding pitchers (position 1)
		const allTeamBatters = Object.values(this.season.batters)
			.filter(b => b.teamId === teamId && b.primaryPosition !== 1);

		// Get pitchers (position 1 only)
		const allTeamPitchers = Object.values(this.season.pitchers)
			.filter(p => p.teamId === teamId);

		// CRITICAL: Track which positions are already taken to avoid duplicates
		// Build this once at the start, not inside the loop
		const takenPositions = new Set(
			lineup.players
				.filter(p => p.playerId && p.position >= 1 && p.position <= 9)
				.map(p => p.position)
		);

		// For each null slot, find a player to fill it
		for (const nullSlot of nullSlots) {
			let assignedPlayer: string | null = null;
			let targetPosition = nullSlot.position || 1;

			// If position is 0 (unknown), or if the desired position is already taken, find an open position
			if (targetPosition === 0 || takenPositions.has(targetPosition)) {
				// Find which positions 1-9 are not already taken
				for (let pos = 1; pos <= 9; pos++) {
					if (!takenPositions.has(pos)) {
						targetPosition = pos;
						break;
					}
				}
			}

			// CRITICAL: Position 1 (P) must be a pitcher
			if (targetPosition === 1) {
				// Only assign pitchers to position 1
				// Try to find a pitcher not already in the lineup
				for (const pitcher of allTeamPitchers) {
					if (!currentLineupPlayerIds.has(pitcher.id) &&
						!this.usedPinchHitters.has(pitcher.id) &&
						!this.removedPlayers.has(pitcher.id)) {
						assignedPlayer = pitcher.id;
						break;
					}
				}

				// If no available pitcher, try any pitcher even if used
				if (!assignedPlayer && allTeamPitchers.length > 0) {
					assignedPlayer = allTeamPitchers[0].id;
					console.warn(`CRITICAL: Using used pitcher ${this.season.pitchers[assignedPlayer]?.name || assignedPlayer} at P (no other option)`);
				}

				if (assignedPlayer) {
					lineup.players[nullSlot.index] = {
						playerId: assignedPlayer,
						position: 1
					};
					currentLineupPlayerIds.add(assignedPlayer);
					takenPositions.add(1); // Mark position 1 as taken

					if (!suppressPlays) {
						this.state.plays.unshift({
							inning: this.state.inning,
							isTopInning: this.state.isTopInning,
							outcome: 'out' as Outcome,
							batterId: '',
							batterName: '',
							pitcherId: '',
							pitcherName: '',
							description: `Lineup adjustment: ${formatName(this.season.pitchers[assignedPlayer]?.name || assignedPlayer)} assigned to P (filling null slot)`,
							runsScored: 0,
							eventType: 'lineupAdjustment',
							substitutedPlayer: assignedPlayer,
							isSummary: true
						});
					}
					continue; // Skip to next null slot
				} else {
					console.error(`[fillLineupHoles] CRITICAL: Could not fill null slot at index ${nullSlot.index} (position 1) - no pitchers available!`);
					continue;
				}
			}

			// For positions 2-9, use batters (not pitchers)
			// First, try to find a bench batter who can play this position
			for (const batter of allTeamBatters) {
				if (!currentLineupPlayerIds.has(batter.id) &&
					!this.usedPinchHitters.has(batter.id) &&
					!this.removedPlayers.has(batter.id) &&
					this.canPlayPosition(batter.id, targetPosition)) {
					assignedPlayer = batter.id;
					break;
				}
			}

			// If no bench batter, try ANY batter who can play this position
			if (!assignedPlayer) {
				for (const batter of allTeamBatters) {
					if (!currentLineupPlayerIds.has(batter.id) &&
						this.canPlayPosition(batter.id, targetPosition)) {
						assignedPlayer = batter.id;
						console.warn(`CRITICAL: Using batter ${batter.name} from roster to fill null slot at ${getPositionName(targetPosition)} (no bench available)`);
						break;
					}
				}
			}

			// If still no batter, try using a pitcher as a last resort (position eligibility check will fail but we have to fill the slot)
			if (!assignedPlayer && allTeamPitchers.length > 0) {
				const pitcher = allTeamPitchers.find(p => !currentLineupPlayerIds.has(p.id)) || allTeamPitchers[0];
				assignedPlayer = pitcher.id;
				console.warn(`ULTRA CRITICAL: Forcing pitcher ${this.season.pitchers[assignedPlayer]?.name || assignedPlayer} to ${getPositionName(targetPosition)} (no eligible batter, filling null slot)`);
			}

			// Assign the player to the null slot
			if (assignedPlayer) {
				lineup.players[nullSlot.index] = {
					playerId: assignedPlayer,
					position: targetPosition
				};
				currentLineupPlayerIds.add(assignedPlayer);
				takenPositions.add(targetPosition); // Mark position as taken

				if (!suppressPlays) {
					this.state.plays.unshift({
						inning: this.state.inning,
						isTopInning: this.state.isTopInning,
						outcome: 'out' as Outcome,
						batterId: '',
						batterName: '',
						pitcherId: '',
						pitcherName: '',
						description: `Lineup adjustment: ${formatName(this.season.batters[assignedPlayer]?.name || assignedPlayer)} assigned to ${getPositionName(targetPosition)} (filling null slot)`,
						runsScored: 0,
						eventType: 'lineupAdjustment',
						substitutedPlayer: assignedPlayer,
						isSummary: true
					});
				}
			} else {
				console.error(`[fillLineupHoles] CRITICAL: Could not fill null slot at index ${nullSlot.index} - no players available!`);
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
		const result = validateLineup(lineup.players, augmentedBatters, {
			...options,
			year: this.season.meta.year
		});
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
				!this.removedPlayers.has(b.id) &&
				!this.season.pitchers[b.id] // Exclude pitchers
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
					const player = p.playerId ? (this.season.batters[p.playerId] || this.season.pitchers[p.playerId]) : null;
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
			// CRITICAL: Filter out pitchers from bench - pitchers cannot play defensive positions
			const availableBench = allTeamBatters.filter(b =>
				!currentLineupPlayerIds.includes(b.id) &&
				!this.usedPinchHitters.has(b.id) &&
				!this.removedPlayers.has(b.id) &&
				!this.season.pitchers[b.id] // Exclude pitchers!
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
				// IMPORTANT: Keep the original position so validation knows which position needs filling
				for (const slot of vacatedPitcherSlots) {
					lineup.players[slot.index] = { playerId: null, position: slot.position };
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
					description: `Lineup adjustment: ${formatName(pitcher?.name || pitcherId)} (P) batting ${battingOrder}${getInningSuffix(battingOrder)}`,
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
						// Track this bench player as assigned so they won't be selected for another vacated slot
						assignedBenchPlayerIds.add(benchPlayer.id);

						const battingOrder = vacatedSlot.index + 1;
						maybeAddPlay({
							inning: this.state.inning,
							isTopInning: this.state.isTopInning,
							outcome: 'out' as Outcome,
							batterId: '',
							batterName: '',
							pitcherId: '',
							pitcherName: '',
							description: `Lineup adjustment: ${formatName(benchPlayer.name)} (P) replaces pitcher, batting ${battingOrder}${getInningSuffix(battingOrder)}`,
							runsScored: 0,
							eventType: 'lineupAdjustment',
							substitutedPlayer: benchPlayer.id,
							isSummary: true
						});
					} else {
						// EMERGENCY: No bench pitcher available - try any pitcher on roster (even if in lineup)
						console.warn(`No bench pitcher available to fill vacated pitcher slot at batting order ${vacatedSlot.index + 1} - trying emergency fallback`);

						// Find ANY pitcher on the team (primaryPosition === 1) - even if they're already in the lineup
						// Filter out pitchers who have already been assigned to other vacated slots
						const allTeamPitchers = Object.values(this.season.batters)
							.filter(b => b.teamId === teamId && b.primaryPosition === 1)
							.filter(p => !assignedBenchPlayerIds.has(p.id));

						if (allTeamPitchers.length > 0) {
							// Use the first available pitcher - may require shuffling if they're already in the lineup
							const emergencyPitcher = allTeamPitchers[0];
							const existingIndex = lineup.players.findIndex(p => p.playerId === emergencyPitcher.id);

							if (existingIndex !== -1 && existingIndex !== vacatedSlot.index) {
								// Pitcher is already in lineup - swap them
								// Move the player currently at vacatedSlot to the pitcher's current slot
								const playerAtVacatedSlot = lineup.players[vacatedSlot.index]; // Should be null at this point
								lineup.players[existingIndex] = { playerId: null, position: lineup.players[existingIndex].position };
								lineup.players[vacatedSlot.index] = { playerId: emergencyPitcher.id, position: 1 };

								const battingOrder = vacatedSlot.index + 1;
								maybeAddPlay({
									inning: this.state.inning,
									isTopInning: this.state.isTopInning,
									outcome: 'out' as Outcome,
									batterId: '',
									batterName: '',
									pitcherId: '',
									pitcherName: '',
									description: `Lineup adjustment: ${formatName(emergencyPitcher.name)} (P) moves to fill pitcher slot at batting ${battingOrder}${getInningSuffix(battingOrder)} (emergency)`,
									runsScored: 0,
										eventType: 'lineupAdjustment',
									substitutedPlayer: emergencyPitcher.id,
									isSummary: true
								});

								// The slot the pitcher vacated still needs filling - will be handled below
							} else {
								// Pitcher not in lineup or already at this slot - just assign them
								lineup.players[vacatedSlot.index] = { playerId: emergencyPitcher.id, position: 1 };
								const battingOrder = vacatedSlot.index + 1;
								maybeAddPlay({
									inning: this.state.inning,
									isTopInning: this.state.isTopInning,
									outcome: 'out' as Outcome,
									batterId: '',
									batterName: '',
									pitcherId: '',
									pitcherName: '',
									description: `Lineup adjustment: ${formatName(emergencyPitcher.name)} (P) fills pitcher slot at batting ${battingOrder}${getInningSuffix(battingOrder)} (emergency)`,
								runsScored: 0,
									eventType: 'lineupAdjustment',
									substitutedPlayer: emergencyPitcher.id,
									isSummary: true
								});
							}

							// CRITICAL: Mark this emergency pitcher as assigned so they won't be used again
							assignedBenchPlayerIds.add(emergencyPitcher.id);
						} else {
							// ULTIMATE EMERGENCY: No pitchers at all - this should be extremely rare
							// As a last resort, find any player on the team to put at pitcher
							// Filter out players who have already been assigned
							const availablePlayers = allTeamBatters.filter(p => !assignedBenchPlayerIds.has(p.id));
							const anyPlayer = availablePlayers[0];
							if (anyPlayer) {
								lineup.players[vacatedSlot.index] = { playerId: anyPlayer.id, position: 1 };
								const battingOrder = vacatedSlot.index + 1;
								maybeAddPlay({
									inning: this.state.inning,
									isTopInning: this.state.isTopInning,
									outcome: 'out' as Outcome,
									batterId: '',
									batterName: '',
									pitcherId: '',
									pitcherName: '',
									description: `Lineup adjustment: ${formatName(anyPlayer.name)} forced to pitch at batting ${battingOrder}${getInningSuffix(battingOrder)} (ultimate emergency)`,
								runsScored: 0,
									eventType: 'lineupAdjustment',
									substitutedPlayer: anyPlayer.id,
									isSummary: true
								});

								// Mark as assigned to prevent duplicates
								assignedBenchPlayerIds.add(anyPlayer.id);
							} else {
								// This should be impossible - team must have players
								console.error(`CRITICAL: No players available for team ${teamId} to fill pitcher slot`);
								benchSearchFailed = true;
							}
						}
						benchSearchFailed = true; // Enable emergency mode for position eligibility
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
						!this.season.pitchers[b.id] &&  // Exclude pitchers
						this.canPlayPosition(b.id, vacatedSlot.position)
					);

					if (availableBench.length > 0) {
						// Use the first available bench player who can play this position
						const benchPlayer = availableBench[0];
						lineup.players[vacatedSlot.index] = {
							playerId: benchPlayer.id,
							position: vacatedSlot.position
						};
						// Track this bench player as assigned so they won't be selected for another vacated slot
						assignedBenchPlayerIds.add(benchPlayer.id);

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
							description: `Lineup adjustment: ${formatName(benchPlayer.name)} (${positionName}) replaces pitcher at field position, batting ${battingOrder}${getInningSuffix(battingOrder)}`,
							runsScored: 0,
							eventType: 'lineupAdjustment',
							substitutedPlayer: benchPlayer.id,
							isSummary: true
						});
					} else {
						// EMERGENCY: No eligible bench player - try ANY bench player who can actually play this position
						console.warn(`No eligible bench player for position ${POSITION_NAMES[vacatedSlot.position] ?? vacatedSlot.position} at batting order ${vacatedSlot.index + 1} - trying emergency fallback`);

						// Find ANY bench player who CAN PLAY THIS POSITION (critical fix - don't assign pitchers to field positions)
						const availableBenchAny = allTeamBatters.filter(b =>
							!currentLineupPlayerIds.includes(b.id) &&
							!this.usedPinchHitters.has(b.id) &&
							!this.removedPlayers.has(b.id) &&
							!assignedBenchPlayerIds.has(b.id) &&
							!this.season.pitchers[b.id] &&  // CRITICAL: Exclude pitchers from field positions
							this.canPlayPosition(b.id, vacatedSlot.position)  // CRITICAL: Even in emergency, must check eligibility
						);

						if (availableBenchAny.length > 0) {
							// Use any available bench player who can play this position
							const emergencyPlayer = availableBenchAny[0];
							lineup.players[vacatedSlot.index] = {
								playerId: emergencyPlayer.id,
								position: vacatedSlot.position
							};
							assignedBenchPlayerIds.add(emergencyPlayer.id);

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
								description: `Lineup adjustment: ${formatName(emergencyPlayer.name)} (${positionName}) fills position at batting ${battingOrder}${getInningSuffix(battingOrder)} (emergency)`,
								runsScored: 0,
								eventType: 'lineupAdjustment',
								substitutedPlayer: emergencyPlayer.id,
								isSummary: true
							});
						} else {
							// ULTIMATE EMERGENCY: Try to find any player on the team (even if in lineup)
							// CRITICAL: Only shuffle players who CAN PLAY the target position
							// This prevents pitchers from being assigned to field positions they're not eligible for
							console.warn(`No bench players at all - trying roster shuffle for position ${POSITION_NAMES[vacatedSlot.position] ?? vacatedSlot.position}`);

							// Find any player who isn't currently at this exact batting order position
							// AND who can play the target position
							// CRITICAL FIX: Check that player only appears once in the lineup
							// If they appear twice (e.g., as PH and as defensive player), swapping will create duplicates
							for (const player of allTeamBatters) {
								// Count how many times this player appears in the lineup
								const occurrences = lineup.players.filter(p => p.playerId === player.id).length;
								if (occurrences !== 1) {
									// Skip players who appear 0 times (not in lineup) or multiple times (would create duplicate)
									continue;
								}

								const existingIndex = lineup.players.findIndex(p => p.playerId === player.id);
								if (existingIndex !== -1 && existingIndex !== vacatedSlot.index &&
									this.canPlayPosition(player.id, vacatedSlot.position)) {  // CRITICAL: Check position eligibility
									// Swap: move this player to the vacated slot, move null to their slot
									lineup.players[existingIndex] = { playerId: null, position: lineup.players[existingIndex].position };
									lineup.players[vacatedSlot.index] = { playerId: player.id, position: vacatedSlot.position };

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
										description: `Lineup adjustment: ${formatName(player.name)} (${positionName}) moves to fill position at batting ${battingOrder}${getInningSuffix(battingOrder)} (ultimate emergency shuffle)`,
										runsScored: 0,
										eventType: 'lineupAdjustment',
										substitutedPlayer: player.id,
										isSummary: true
									});

									// Successfully filled - exit loop
									break;
								}
							}

							// After shuffle attempt, check if slot is still null
							if (!lineup.players[vacatedSlot.index].playerId) {
								console.error(`CRITICAL: Failed to fill vacated field position ${POSITION_NAMES[vacatedSlot.position] ?? vacatedSlot.position} at batting order ${vacatedSlot.index + 1} - no eligible player available`);
							}
						}
						benchSearchFailed = true; // Enable emergency mode for position eligibility
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
					description: `Lineup adjustment: ${formatName(phPlayer.name)} (${positionName}) remains in game, batting ${battingOrder}${getInningSuffix(battingOrder)}`,
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
					description: `Lineup adjustment: ${formatName(benchPlayer.name)} (${positionName}) replaces pinch hitter, batting ${battingOrder}${getInningSuffix(battingOrder)}`,
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

				// CRITICAL FIX: Check if this PH is already playing ANY defensive position in the lineup
				// This prevents "appears multiple times" errors when a PH was already a defensive replacement
				const existingDefensiveSlot = lineup.players.findIndex(p =>
					p.playerId === ph.playerId && p.position >= 1 && p.position <= 9
				);

				if (existingDefensiveSlot !== -1) {
					// PH is already playing a defensive position - just update the batting slot position from PH to that position
					// This is the KEY fix for "Player appears multiple times" errors
					const existingPosition = lineup.players[existingDefensiveSlot].position;
					console.log(`[PH Resolution] PH ${ph.playerId} already playing position ${existingPosition}, updating batting slot from PH to ${existingPosition}`);
					lineup.players[ph.index] = {
						playerId: ph.playerId,
						position: existingPosition
					};
					continue;
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
							description: `Lineup adjustment: ${formatName(phPlayer.name)} (${positionName}) remains in game defensively, batting ${battingOrder}${getInningSuffix(battingOrder)}`,
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
								description: `Lineup adjustment: ${formatName(phPlayer.name)} (${positionName}) remains in game at ${POSITION_NAMES[shuffleResult.phPosition] ?? shuffleResult.phPosition} after shuffle, batting ${ph.index + 1}${getInningSuffix(ph.index + 1)}`,
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
								// Instead of creating a duplicate, we'll REPLACE that player with the PH
								// This is necessary when bench is exhausted (all players over 150% usage)

								// Find the player currently occupying the position
								const occupyingIndex = lineup.players.findIndex((p, idx) =>
									idx !== ph.index && p !== null && p.position === replacedPosition
								);

								if (occupyingIndex !== -1) {
									// Replace the occupying player with the PH
									const removedPlayerId = lineup.players[occupyingIndex].playerId;
									console.log(`[PH Resolution] All positions filled - replacing ${removedPlayerId} at position ${replacedPosition} with PH ${ph.playerId}`);

									// Mark the removed player as removed (only if not null)
									if (removedPlayerId) {
										this.removedPlayers.add(removedPlayerId);
									}

									// Assign PH to this position
									lineup.players[occupyingIndex] = {
										playerId: ph.playerId,
										position: replacedPosition
									};

									// Clear the PH's original batting slot (they're now at the defensive position)
									lineup.players[ph.index] = {
										playerId: null,
										position: 0 // Empty slot
									};

									const positionName = POSITION_NAMES[replacedPosition] ?? `Pos${replacedPosition}`;
									maybeAddPlay({
										inning: this.state.inning,
										isTopInning: this.state.isTopInning,
										outcome: 'out' as Outcome,
										batterId: '',
										batterName: '',
										pitcherId: '',
										pitcherName: '',
										description: `Lineup adjustment: ${formatName(phPlayer.name)} (${positionName}) replaces ${removedPlayerId || 'unknown'} (bench exhausted), batting ${ph.index + 1}${getInningSuffix(ph.index + 1)}`,
										runsScored: 0,
										eventType: 'lineupAdjustment',
										substitutedPlayer: removedPlayerId ?? undefined,
										isSummary: true
									});

									// Skip the rest of the emergency assignment logic
									continue;
								} else {
									// Shouldn't happen - positionOccupied was true but we couldn't find the occupier
									console.error(`[PH Resolution] Position ${replacedPosition} marked occupied but no occupier found - falling back to emergency mode`);
								}
							} else if (positionOccupied === undefined) {
								// Original emergency mode logic for when position is available
								console.warn(`Pinch hitter ${phPlayer.name} cannot play position ${POSITION_NAMES[replacedPosition] ?? replacedPosition} defensively, no bench available, and shuffle failed - using emergency mode to assign to ${POSITION_NAMES[finalPosition] ?? finalPosition}`);
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
									description: `Lineup adjustment: ${formatName(phPlayer.name)} (${positionName}) remains in game at ${positionName} ${emergencyMessage}, batting ${ph.index + 1}${getInningSuffix(ph.index + 1)}`,
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
			}

			// Set emergency mode if bench searches failed
			if (benchSearchFailed) {
				this.emergencyRosterMode.set(teamId, true);
			}

			// Final fix: resolve any remaining duplicate positions
			// This can happen when multiple PHs are assigned positions that conflict
			this.resolveDuplicatePositions(lineup, suppressPlays);

			// CRITICAL FIX: Remove any duplicate players before validation
			// This can happen when PH resolution creates duplicate entries
			const seenPlayerIds = new Map<string, number>(); // playerId -> first index seen
			const duplicateIndices: number[] = [];

			for (let i = 0; i < lineup.players.length; i++) {
				const playerId = lineup.players[i].playerId;
				if (!playerId) continue;

				if (seenPlayerIds.has(playerId)) {
					// Duplicate found - mark for removal
					duplicateIndices.push(i);
					const firstIndex = seenPlayerIds.get(playerId)!;
					const playerName = this.season.batters[playerId]?.name || playerId;
					console.warn(`[PH Resolution] Duplicate player ${playerName} found at index ${i} (first occurrence at ${firstIndex}), removing duplicate`);
				} else {
					seenPlayerIds.set(playerId, i);
				}
			}

			// Remove duplicate entries by setting them to null
			for (const dupIndex of duplicateIndices) {
				const removedPlayer = lineup.players[dupIndex];
				if (removedPlayer.playerId) {
					console.log(`[PH Resolution] Removing duplicate player ${removedPlayer.playerId} at batting order ${dupIndex + 1}`);
					lineup.players[dupIndex] = { playerId: null, position: 0 };
				}
			}

			// After removing duplicates, we may have holes - try to fill them with bench players
			if (duplicateIndices.length > 0) {
				console.log(`[PH Resolution] Removed ${duplicateIndices.length} duplicate(s), attempting to fill resulting lineup holes`);
				const currentLineupPlayerIds = lineup.players.map(p => p.playerId).filter((id): id is string => id !== null);
				const allTeamBatters = Object.values(this.season.batters)
					.filter(b => b.teamId === teamId);

				for (const holeIndex of duplicateIndices) {
					if (lineup.players[holeIndex].playerId === null) {
						// Find any bench player who can fill this hole
						let availableBench = allTeamBatters.filter(b =>
							!currentLineupPlayerIds.includes(b.id) &&
							!this.usedPinchHitters.has(b.id) &&
							!this.removedPlayers.has(b.id) &&
							!this.season.pitchers[b.id]
						);

						// FALLBACK 1: Include pitchers if no non-pitchers available
						if (availableBench.length === 0) {
							availableBench = allTeamBatters.filter(b =>
								!currentLineupPlayerIds.includes(b.id) &&
								!this.usedPinchHitters.has(b.id) &&
								!this.removedPlayers.has(b.id)
							);
							if (availableBench.length > 0) {
								console.log(`[PH Resolution] No non-pitcher bench available, using pitcher to fill hole at batting order ${holeIndex + 1}`);
							}
						}

						if (availableBench.length > 0) {
							const benchPlayer = availableBench[0];
							// Find a position that needs filling
							const filledPositions = new Set(lineup.players.filter(p => p.playerId).map(p => p.position));
							const targetPosition = this.findBestPositionForPlayer(benchPlayer.id, filledPositions);

							lineup.players[holeIndex] = {
								playerId: benchPlayer.id,
								position: targetPosition
							};
							console.log(`[PH Resolution] Filled hole at batting order ${holeIndex + 1} with ${benchPlayer.name} at position ${targetPosition}`);
						} else {
							// FALLBACK 2: No bench players at all - try to find a player already in the lineup
							// who appears multiple times and remove one instance to fill the hole
							console.warn(`[PH Resolution] No bench players available for hole at batting order ${holeIndex + 1}, trying emergency shuffle`);

							// Count player occurrences in lineup
							const playerOccurrences = new Map<string, number[]>();
							for (let i = 0; i < lineup.players.length; i++) {
								const playerId = lineup.players[i].playerId;
								if (playerId && i !== holeIndex) {
									if (!playerOccurrences.has(playerId)) {
										playerOccurrences.set(playerId, []);
									}
									playerOccurrences.get(playerId)!.push(i);
								}
							}

							// Find a player who appears multiple times
							let duplicateFound = false;
							for (const [playerId, indices] of playerOccurrences) {
								if (indices.length > 1) {
									// Found a duplicate - use one instance to fill the hole
									const sourceIndex = indices[0];
									const player = this.season.batters[playerId];
									const position = lineup.players[sourceIndex].position;

									lineup.players[holeIndex] = {
										playerId: playerId,
										position: position
									};
									lineup.players[sourceIndex] = {
										playerId: null,
										position: position
									};

									console.log(`[PH Resolution] Emergency shuffle: moved ${player?.name || playerId} from batting order ${sourceIndex + 1} to fill hole at batting order ${holeIndex + 1}`);
									duplicateFound = true;
									break;
								}
							}

							if (!duplicateFound) {
								// FALLBACK 3: Ultimate emergency - find any player not currently at this batting order
								// and move them here, creating a new hole elsewhere (preferably at a less critical position)
								const allLineupPlayers = lineup.players.map(p => p.playerId).filter((id): id is string => id !== null);
								for (const batter of allTeamBatters) {
									if (allLineupPlayers.includes(batter.id)) {
										// This player is in the lineup, find them
										const sourceIndex = lineup.players.findIndex(p => p.playerId === batter.id);
										if (sourceIndex !== -1 && sourceIndex !== holeIndex) {
											const position = lineup.players[sourceIndex].position;

											lineup.players[holeIndex] = {
												playerId: batter.id,
												position: position
											};
											lineup.players[sourceIndex] = {
												playerId: null,
												position: position
											};

											console.log(`[PH Resolution] Ultimate emergency: moved ${batter.name} from batting order ${sourceIndex + 1} to fill hole at batting order ${holeIndex + 1} (created new hole at ${sourceIndex + 1})`);
											duplicateFound = true;
											break;
										}
									}
								}
							}

							if (!duplicateFound) {
								// ABSOLUTE LAST RESORT: Keep the hole and mark as emergency mode
								// The validation will catch this, but at least we won't crash
								console.error(`[PH Resolution] Could not fill hole at batting order ${holeIndex + 1} - no options available, leaving hole (will cause validation error)`);
								this.emergencyRosterMode.set(teamId, true);
							}
						}
					}
				}
			}

			// Validate the final lineup to ensure no issues
			const finalValidation = this.validateCurrentLineup(lineup, {
				allowEmergencyPositions: this.emergencyRosterMode.get(teamId) ?? false
			});
			if (!finalValidation.isValid) {
				console.error(`Lineup validation failed after PH resolution: ${finalValidation.errors.join(', ')}`);
				// This is a serious error - the lineup is invalid
				// Log the current state for debugging
				console.error(`Lineup: ${lineup.players.map(p => {
					const player = p.playerId ? this.season.batters[p.playerId] : null;
					return `${player?.name || p.playerId || 'null'} (${getPositionName(p.position)})`;
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
								description: `Lineup adjustment: ${formatName(phPlayer.name)} (DH) remains in game as DH, batting ${phSlot.index + 1}${getInningSuffix(phSlot.index + 1)}`,
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
									description: `Lineup adjustment: ${formatName(phPlayer.name)} (${positionName}) remains in game at ${POSITION_NAMES[shuffleResult.phPosition] ?? shuffleResult.phPosition} after shuffle, batting ${phSlot.index + 1}${getInningSuffix(phSlot.index + 1)}`,
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
									description: `Lineup adjustment: ${formatName(phPlayer.name)} (DH) remains in game as DH (emergency mode), batting ${phSlot.index + 1}${getInningSuffix(phSlot.index + 1)}`,
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
					// Find a bench player to replace the PH
					// The bench player should take the position that the PH replaced (if known)
					// Otherwise, find any position the bench player can play
					let replacementFound = false;

					// Get the position that the PH replaced (if tracked)
					const replacedPosition = this.phReplacedPositions.get(phPlayerId);

					// First, try to find a bench player who can play the replaced position
					if (replacedPosition !== undefined) {
						for (const replacement of availableBench) {
							// Check if this bench player can play the replaced position
							if (this.canPlayPosition(replacement.id, replacedPosition)) {
								const battingOrder = phSlot.index + 1;
								const positionName = POSITION_NAMES[replacedPosition] ?? `Pos${replacedPosition}`;
								lineup.players[phSlot.index] = {
									playerId: replacement.id,
									position: replacedPosition
								};

								maybeAddPlay({
									inning: this.state.inning,
									isTopInning: this.state.isTopInning,
									outcome: 'out' as Outcome,
									batterId: '',
									batterName: '',
									pitcherId: '',
									pitcherName: '',
									description: `Lineup adjustment: ${formatName(replacement.name)} (${positionName}) replaces ${formatName(phPlayer.name)}, batting ${battingOrder}${getInningSuffix(battingOrder)}`,
									runsScored: 0,
									eventType: 'lineupAdjustment',
									substitutedPlayer: phPlayerId,
									isSummary: true
								});
								replacementFound = true;
								break;
							}
						}
					}

					// If we didn't find a replacement for the replaced position, try any eligible position
					if (!replacementFound) {
						// Build set of positions currently occupied (excluding PH slot at position 11)
						const occupiedPositions = new Set(
							lineup.players
								.filter(p => p.position !== this.POSITION_PH)
								.map(p => p.position)
						);

						for (const replacement of availableBench) {
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
									description: `Lineup adjustment: ${formatName(replacement.name)} (${positionName}) replaces ${formatName(phPlayer.name)}, batting ${battingOrder}${getInningSuffix(battingOrder)}`,
									runsScored: 0,
									eventType: 'lineupAdjustment',
									substitutedPlayer: phPlayerId,
									isSummary: true
								});
								replacementFound = true;
								break;
							}
						}
					}

					if (!replacementFound) {
						// EMERGENCY SWAP: Try to swap a bench player with someone at a position they can play
						// This happens when no empty positions exist and bench players can't play the replaced position
						for (const benchPlayer of availableBench) {
							// Try to find any position this bench player can play
							const player = this.season.batters[benchPlayer.id];
							if (!player) continue;

							// Get all positions this player is eligible for
							const eligiblePositions = Object.entries(player.positionEligibility)
								.filter(([_, outs]) => outs > 0)
								.map(([pos, _]) => parseInt(pos));

							if (eligiblePositions.length === 0) {
								eligiblePositions.push(player.primaryPosition);
							}

							// For each eligible position, check if someone is there and can be swapped
							for (const pos of eligiblePositions) {
								const occupantIndex = lineup.players.findIndex(p => p.position === pos && p.index !== phSlot.index);
								if (occupantIndex !== -1 && occupantIndex !== phSlot.index) {
									const occupantId = lineup.players[occupantIndex].playerId;
									if (!occupantId) continue;

									const battingOrder = phSlot.index + 1;
									const positionName = POSITION_NAMES[pos] ?? `Pos${pos}`;

									// Perform the swap
									lineup.players[phSlot.index] = {
										playerId: benchPlayer.id,
										position: pos
									};
									// Move the occupant out of the lineup (to bench)
									lineup.players[occupantIndex] = {
										playerId: null,
										position: pos
									};

									maybeAddPlay({
										inning: this.state.inning,
										isTopInning: this.state.isTopInning,
										outcome: 'out' as Outcome,
										batterId: '',
										batterName: '',
										pitcherId: '',
										pitcherName: '',
										description: `Lineup adjustment: ${formatName(benchPlayer.name)} (${positionName}) replaces ${formatName(phPlayer.name)} at batting ${battingOrder}${getInningSuffix(battingOrder)} (emergency swap - occupant removed)`,
										runsScored: 0,
										eventType: 'lineupAdjustment',
										substitutedPlayer: phPlayerId,
										isSummary: true
									});
									replacementFound = true;
									break;
								}
							}
							if (replacementFound) break;
						}
					}

					if (!replacementFound) {
						// ULTIMATE EMERGENCY: Assign first bench player to replaced position regardless of eligibility
						// This is better than having a hole in the lineup
						const firstBench = availableBench[0];
						if (firstBench) {
							// Use replacedPosition if available, otherwise use player's primary position
							const targetPosition = replacedPosition ?? this.season.batters[firstBench.id]?.primaryPosition ?? 2;
							const battingOrder = phSlot.index + 1;
							const positionName = POSITION_NAMES[targetPosition] ?? `Pos${targetPosition}`;

							// Find who is currently at that position and remove them
							const occupantIndex = lineup.players.findIndex(p => p.position === targetPosition && p.index !== phSlot.index);
							if (occupantIndex !== -1 && occupantIndex !== phSlot.index) {
								lineup.players[occupantIndex] = {
									playerId: null,
									position: targetPosition
								};
							}

							lineup.players[phSlot.index] = {
								playerId: firstBench.id,
								position: targetPosition
							};

							maybeAddPlay({
								inning: this.state.inning,
								isTopInning: this.state.isTopInning,
								outcome: 'out' as Outcome,
								batterId: '',
								batterName: '',
								pitcherId: '',
								pitcherName: '',
								description: `Lineup adjustment: ${formatName(firstBench.name)} (${positionName}) replaces ${formatName(phPlayer.name)} at batting ${battingOrder}${getInningSuffix(battingOrder)} (ultimate emergency - position ineligible)`,
								runsScored: 0,
								eventType: 'lineupAdjustment',
								substitutedPlayer: phPlayerId,
								isSummary: true
							});
							replacementFound = true;
							benchSearchFailed = true; // Enable emergency mode
						}
					}

					if (!replacementFound) {
						// ABSOLUTE LAST RESORT: Keep the PH in the game at any position they can play (or DH)
						// This is better than having a hole
						const phPlayer = this.season.batters[phPlayerId];
						if (phPlayer) {
							// Try DH first (position 10), then primary position
							const targetPosition = 10; // DH
							const battingOrder = phSlot.index + 1;
							const positionName = POSITION_NAMES[targetPosition] ?? `Pos${targetPosition}`;

							lineup.players[phSlot.index] = {
								playerId: phPlayerId,
								position: targetPosition
							};

							maybeAddPlay({
								inning: this.state.inning,
								isTopInning: this.state.isTopInning,
								outcome: 'out' as Outcome,
								batterId: '',
								batterName: '',
								pitcherId: '',
								pitcherName: '',
								description: `Lineup adjustment: ${formatName(phPlayer.name)} (${positionName}) remains in game (absolute last resort)`,
								runsScored: 0,
								eventType: 'lineupAdjustment',
								substitutedPlayer: phPlayerId,
								isSummary: true
							});
							replacementFound = true;
							benchSearchFailed = true;
						}
					}

					if (!replacementFound) {
						// This should never happen now - but if it does, log it
						console.error(`CRITICAL: Unable to resolve PH replacement for ${phPlayer.name} at batting order ${phSlot.index + 1} - all fallbacks failed`);
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
		// and overused pitchers (exceeding their usage threshold)
		const restThreshold = this.managerialOptions.restThreshold ?? 0.90; // Use 90% as fallback
		const pitcherUsage = this.managerialOptions.pitcherUsage;

		// Helper to check if a pitcher is available (not removed and not overused)
		// For relievers, also check if they're approaching the threshold (>80%) and prefer less-used pitchers
		const isPitcherAvailable = (pitcherId: string): boolean => {
			if (this.removedPlayers.has(pitcherId)) return false;
			if (pitcherUsage) {
				const usage = pitcherUsage.get(pitcherId) ?? 0;
				if (usage > restThreshold) {
					// Pitcher is overused - log and skip
					const pitcher = this.season.pitchers[pitcherId];
					console.log(`[GameEngine] Skipping overused reliever ${pitcher?.name ?? pitcherId} (${(usage * 100).toFixed(0)}% of actual)`);
					return false;
				}
				// For relievers (non-starters), prefer those with lower usage when above 80%
				const pitcherRole = this.pitcherStamina.get(pitcherId);
				if (pitcherRole && pitcherRole.role !== 'starter' && usage > 0.80) {
					// This reliever is at 80%+ usage - they're available but should be lower priority
					// We'll handle this in the selection logic
				}
			}
			return true;
		};

		// Sort relievers by usage (lower usage = higher priority)
		const sortByUsage = (a: PitcherRole, b: PitcherRole): number => {
			const usageA = pitcherUsage?.get(a.pitcherId) ?? 0;
			const usageB = pitcherUsage?.get(b.pitcherId) ?? 0;
			return usageA - usageB; // Lower usage first
		};

		const filteredBullpen: EnhancedBullpenState = {
			starter: bullpen.starter && isPitcherAvailable(bullpen.starter.pitcherId) ? bullpen.starter : undefined,
			closer: bullpen.closer && isPitcherAvailable(bullpen.closer.pitcherId) ? bullpen.closer : undefined,
			// Sort setup and relievers by usage to prefer less-used pitchers
			setup: bullpen.setup?.filter(r => isPitcherAvailable(r.pitcherId)).sort(sortByUsage),
			longRelief: bullpen.longRelief?.filter(r => isPitcherAvailable(r.pitcherId)).sort(sortByUsage),
			relievers: bullpen.relievers.filter(r => isPitcherAvailable(r.pitcherId)).sort(sortByUsage)
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
				pitcherName: formatName(newPitcher ? newPitcher.name : 'Unknown'),
				description: `Pitching change: ${formatName(newPitcher?.name ?? 'Unknown')} replaces ${formatName(pitcher.name)}`,
				runsScored: 0,
				eventType: 'pitchingChange',
				substitutedPlayer: pitcherId,
				isSummary: true
			});

			return true;
		}

		// Check for pinch hit opportunity
		// Helper: Calculate usage-aware weights for player selection
		// Target range: 75-125% usage. Strongly penalize players outside this range.
		const calculateUsageAwareWeights = (players: ModelBatterStats[]): Map<string, number> => {
			const weights = new Map<string, number>();
			const playerUsage = this.managerialOptions.pitcherUsage; // Contains all player usage (batters + pitchers)

			// NEW: Calculate usage-based weights for pinch-hitter selection
			// The goal is to get all players to 100% usage
			// Players who are underused get higher weights
			let totalWeight = 0;

			for (const player of players) {
				const currentUsage = playerUsage?.get(player.id) ?? 0;
				const usagePct = currentUsage * 100;
				
				let weight: number;
				
				// If player is over 125% usage, they should rarely play (soft cap)
				if (usagePct > 125) {
					// Exponential penalty for overuse
					const overuseFactor = Math.pow(0.5, (usagePct - 125) / 25);
					weight = Math.max(0.01, overuseFactor * 0.1);
				} else if (usagePct >= 100) {
					// Linear reduction from 100% to 125%
					weight = Math.max(0.1, 1.0 - ((usagePct - 100) / 25) * 0.9);
				} else {
					// Player is underused - boost based on need
					const needFactor = 1.0 - currentUsage;
					if (usagePct < 75) {
						weight = 2.0 + needFactor * 2.0; // 2x to 4x boost
					} else {
						weight = 1.0 + needFactor; // 1x to 2x boost
					}
				}
				
				weights.set(player.id, weight);
				totalWeight += weight;
			}

			// Normalize to get probabilities that sum to 1
			if (totalWeight > 0) {
				for (const player of players) {
					const weight = weights.get(player.id) ?? 1;
					weights.set(player.id, weight / totalWeight);
				}
			}

			return weights;
		};

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
		// CRITICAL: Check current lineup for players who are already in defensively (positions 1-9)
		// This prevents selecting a player as PH who is already playing a defensive position
		const currentLineupPlayerIds = battingTeam.players.map(p => p.playerId).filter((id): id is string => id !== null);
		const currentDefensivePlayers = new Set<string>();
		for (const p of battingTeam.players) {
			if (p.playerId && p.position >= 1 && p.position <= 9) {
				currentDefensivePlayers.add(p.playerId);
			}
		}

		const allTeamBatters = Object.values(this.season.batters)
			.filter(b => b.teamId === battingTeam.teamId)
			.map(toModelBatter);

		// Get current usage for all players
		const playerUsage = this.managerialOptions.pitcherUsage; // Contains all player usage (batters + pitchers)

		// Available bench = not in current lineup, not already used as PH, not removed from game
		// NO position filtering - PHs can be selected regardless of position they play
		// NO hard usage filtering - usage-based weighting will handle overuse
		const availableBench = allTeamBatters.filter(b => {
			const notInLineup = !currentLineupPlayerIds.includes(b.id);
			const notDefensive = !currentDefensivePlayers.has(b.id);
			const notUsedPH = !this.usedPinchHitters.has(b.id);
			const notRemoved = !this.removedPlayers.has(b.id);

			return notInLineup && notDefensive && notUsedPH && notRemoved;
		});

		// Soft cap: Only exclude players at extreme overuse (>300%)
		// The usage-aware weighting will naturally prefer players in the 75-125% range
		const EXTREME_USAGE_CAP = 3.0; // 300% - only exclude extreme outliers
		const eligibleBench = availableBench.filter(b => {
			const usage = playerUsage?.get(b.id) ?? 0;
			return usage < EXTREME_USAGE_CAP;
		});

		const benchForSelection = eligibleBench.length > 0 ? eligibleBench : availableBench;

		// Log if anyone was excluded due to extreme usage
		if (eligibleBench.length < availableBench.length) {
			const excludedCount = availableBench.length - eligibleBench.length;
			console.log(`[PH] Excluded ${excludedCount} players at ${EXTREME_USAGE_CAP * 100}%+ usage (extreme outliers)`);
		}

		// Prevent pinch hit if no bench players available
		if (benchForSelection.length === 0) {
			if (mustPHForReliever) {
				console.warn(`No bench players available for ${battingTeam.teamId} - reliever ${currentBatter.name} must bat`);
			}
			return false;
		}

		if (benchForSelection.length > 0) {
			const opposingPitcher = this.season.pitchers[pitchingTeam.pitcher!];
			if (opposingPitcher) {
				let phDecision: PinchHitDecision;

				// When we MUST PH for a reliever (non-DH games), skip the normal decision logic
				// and directly pick the best available batter
				if (mustPHForReliever) {
					// NEW APPROACH: Use weighted random selection based on TWO factors:
					// 1. Actual season PA (players with more PA should be selected more often)
					// 2. Current usage (players who have appeared less should be preferred)
					// This prevents overuse while still following actual season patterns
					const getOPS = (b: ModelBatterStats) => {
						const rates = opposingPitcher.throws === 'L' ? b.rates.vsLeft : b.rates.vsRight;
						const obp = rates.walk + rates.hitByPitch + rates.single + rates.double + rates.triple + rates.homeRun;
						const slg = rates.single * 1 + rates.double * 2 + rates.triple * 3 + rates.homeRun * 4;
						return obp + slg;
					};

					// Get usage-aware weights (prefer players with lower current usage)
					const usageWeights = calculateUsageAwareWeights(availableBench);

					// Build weighted pool based on actual season PA AND current usage
					// Players with more PA should be selected more often, BUT players with lower
					// usage should get a boost to prevent overuse
					const totalBenchPA = availableBench.reduce((sum, b) => {
						const batter = this.season.batters[b.id];
						return sum + (batter?.pa || 0);
					}, 0);

					if (totalBenchPA === 0) {
						// Fallback to OPS-based selection if no PA data
						console.warn('[PH] No PA data available, using OPS fallback');
						const sortedBench = [...availableBench].sort((a, b) => getOPS(b) - getOPS(a));
						const bestPH = sortedBench[0];
						if (bestPH) {
							phDecision = {
								shouldPinchHit: true,
								pinchHitterId: bestPH.id,
								reason: `PH for reliever ${currentBatter.name} (OPS fallback)`
							};
						} else {
							phDecision = { shouldPinchHit: false };
						}
					} else {
						// Build weighted pool with PA-based weights MODIFIED by usage
						const weightedPool = availableBench.map(b => {
							const batter = this.season.batters[b.id];
							const actualPA = batter?.pa || 1;
							const paWeight = actualPA / totalBenchPA;
							const usageWeight = usageWeights.get(b.id) ?? 1;

							// Combine PA weight with usage weight
							// Players with high PA but low usage get balanced selection
							// Players with low PA but high usage get reduced selection
							const combinedWeight = paWeight * usageWeight;

							// Log for debugging (first few selections only)
							if (Math.random() < 0.01) {
								const playerUsage = this.managerialOptions.pitcherUsage?.get(b.id) ?? 0;
								console.log(`[PH] Pool: ${b.name} (${actualPA} PA, ${(playerUsage * 100).toFixed(0)}% usage, PA ${(paWeight * 100).toFixed(1)}% × usage ${(usageWeight * 100).toFixed(1)}% = ${(combinedWeight * 100).toFixed(1)}% weight)`);
							}

							return { batter, weight: combinedWeight, pa: actualPA, ops: getOPS(b), usage: usageWeight };
						});

						// Normalize weights to sum to 1
						const totalWeight = weightedPool.reduce((sum, wp) => sum + wp.weight, 0);
						const normalizedPool = weightedPool.map(wp => ({ ...wp, weight: wp.weight / totalWeight }));

						// Select pinch hitter using weighted random selection
						let selectedPH: typeof normalizedPool[0] | null = null;
						let cumulativeWeight = 0;
						const random = Math.random();

						for (const wp of normalizedPool) {
							cumulativeWeight += wp.weight;
							if (random <= cumulativeWeight) {
								selectedPH = wp;
								break;
							}
						}

						// Fallback: select first available if selection failed
						if (!selectedPH) {
							selectedPH = normalizedPool[0];
						}

						if (selectedPH) {
							phDecision = {
								shouldPinchHit: true,
								pinchHitterId: selectedPH.batter.id,
								reason: `PH for reliever ${currentBatter.name}`
							};
						} else {
							phDecision = { shouldPinchHit: false };
						}
					}
				} else {
					// Normal PH decision logic
					// PRE-FILTER: Down-weight or exclude significantly overused players before model decides
					const batterUsage = this.managerialOptions.pitcherUsage;
					const restThreshold = this.managerialOptions.restThreshold ?? 1.25;

					// Create usage-filtered bench for the model
					// Players over 150% usage are excluded entirely
					// Players over 125% usage are kept but will be down-weighted later
					const filteredBench = availableBench.filter(b => {
						const usage = batterUsage?.get(b.id) ?? 0;
						return usage < 1.5; // Exclude players at 150%+ usage
					});

					if (filteredBench.length === 0) {
						// All bench players are over 150% - use available bench anyway
						console.warn('[PH] All bench players over 150% usage, using available pool');
					} else if (filteredBench.length < availableBench.length) {
						// Some players were filtered out
						const excluded = availableBench.length - filteredBench.length;
						console.log(`[PH] Excluded ${excluded} players at 150%+ usage from ${availableBench.length} total`);
					}

					// Use filtered bench (or original if all filtered out)
					const benchForModel = filteredBench.length > 0 ? filteredBench : availableBench;

					phDecision = shouldPinchHit(
						mgrState,
						toModelBatter(currentBatter),
						benchForModel,
						toModelPitcher(opposingPitcher),
						{ randomness: this.managerialOptions.randomness ?? 0.15, useDH: gameUsesDH }
					);

					// NEW APPROACH: Apply usage-aware weighting to ALL PH selections
					// This prevents overuse by preferring players who have appeared less
					if (phDecision.shouldPinchHit && phDecision.pinchHitterId) {
						// Always apply usage-aware weighting, not just for overused players
						const usageWeights = calculateUsageAwareWeights(availableBench);

						// Build weighted pool based on actual season PA AND current usage
						const totalBenchPA = availableBench.reduce((sum, b) => {
							const batter = this.season.batters[b.id];
							return sum + (batter?.pa || 0);
						}, 0);

						if (totalBenchPA > 0) {
							const weightedPool = availableBench.map(b => {
								const batter = this.season.batters[b.id];
								const actualPA = batter?.pa || 1;
								const paWeight = actualPA / totalBenchPA;
								const usageWeight = usageWeights.get(b.id) ?? 1;
								const combinedWeight = paWeight * usageWeight;
								return { batter, weight: combinedWeight };
							});

							// Normalize weights
							const totalWeight = weightedPool.reduce((sum, wp) => sum + wp.weight, 0);
							const normalizedPool = weightedPool.map(wp => ({ ...wp, weight: wp.weight / totalWeight }));

							// Select using weighted random
							let selectedPH: typeof normalizedPool[0] | null = null;
							let cumulativeWeight = 0;
							const random = Math.random();

							for (const wp of normalizedPool) {
								cumulativeWeight += wp.weight;
								if (random <= cumulativeWeight) {
									selectedPH = wp;
									break;
								}
							}

							if (selectedPH) {
								const originalPHId = phDecision.pinchHitterId;
								phDecision.pinchHitterId = selectedPH.batter.id;
								phDecision.reason += ` (usage-aware selection)`;
								if (originalPHId !== selectedPH.batter.id) {
									phDecision.reason += ` [was: ${originalPHId}]`;
								}
							}
						}
					}
				}

				if (phDecision.shouldPinchHit && phDecision.pinchHitterId) {
					// CRITICAL: Check if the selected PH is already in the lineup
					// This prevents players from appearing multiple times (e.g., when a pitcher
					// is already playing a defensive position via emergency mode)
					const currentLineupPlayerIds = battingTeam.players.map(p => p.playerId).filter((id): id is string => id !== null);
					if (currentLineupPlayerIds.includes(phDecision.pinchHitterId)) {
						// PH is already in the lineup - skip this PH
						console.warn(`[PH] Skipping PH for ${phDecision.pinchHitterId}: already in current lineup`);
						return false;
					}

					// Find the batter's position in the lineup
					const batterIndex = battingTeam.players.findIndex(p => p.playerId === currentBatterId);
					if (batterIndex !== -1) {
						const replacedPosition = battingTeam.players[batterIndex].position;
						const pinchHitter = this.season.batters[phDecision.pinchHitterId];

						// CRITICAL: Validate that the position can be filled at end of half-inning
						// Rule: PH can be used if either:
						// 1. PH CAN play the position they're replacing (they'll stay in defensively)
						// 2. There's another bench player who CAN play that position
						const phCanPlayPosition = pinchHitter && this.canPlayPosition(phDecision.pinchHitterId, replacedPosition);

						if (!phCanPlayPosition) {
							// PH cannot play this position - need to find a bench player who can
							const allTeamBatters = Object.values(this.season.batters)
								.filter(b => b.teamId === battingTeam.teamId);
							const otherBenchPlayers = allTeamBatters.filter(b =>
								b.id !== phDecision.pinchHitterId && // Not the PH
								!currentLineupPlayerIds.includes(b.id) && // Not in current lineup
								!this.usedPinchHitters.has(b.id) && // Not already used as PH
								!this.removedPlayers.has(b.id) && // Not removed from game
								!this.season.pitchers[b.id] && // Not a pitcher
								this.canPlayPosition(b.id, replacedPosition) // Can play the position
							);

							if (otherBenchPlayers.length === 0) {
								// No one available to play this position - cancel the PH
								console.warn(`[PH] Canceling PH for ${phDecision.pinchHitterId}: cannot play position ${getPositionName(replacedPosition)} and no bench player available to fill it`);
								return false;
							}
							// Otherwise, PH is valid - bench player will come in at end of inning
						}

						// Check if we're pinch hitting for a pitcher (position 1)
						const isPitcherPH = replacedPosition === 1;

						// Store old state for potential revert
						const oldPlayers = [...battingTeam.players];
						const oldPitcher = battingTeam.pitcher;
						const oldRemovedPlayers = new Set(this.removedPlayers);
						const oldPhReplacedPositions = new Map(this.phReplacedPositions);

						let description = `Pinch hit: ${formatName(pinchHitter?.name ?? 'Unknown')} pinch hits for ${formatName(currentBatter.name)}`;

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
								// Filter bullpen to exclude removed pitchers AND overused pitchers
								const restThreshold = this.managerialOptions.restThreshold ?? 1.0;
								const pitcherUsage = this.managerialOptions.pitcherUsage;

								const isPitcherAvailable = (pitcherId: string): boolean => {
									if (this.removedPlayers.has(pitcherId)) return false;
									if (pitcherUsage) {
										const usage = pitcherUsage.get(pitcherId) ?? 0;
										if (usage > restThreshold) {
											const pitcher = this.season.pitchers[pitcherId];
											console.log(`[GameEngine] Skipping overused reliever for PH: ${pitcher?.name ?? pitcherId} (${(usage * 100).toFixed(0)}% of actual)`);
											return false;
										}
									}
									return true;
								};

								// Sort relievers by usage (lower usage = higher priority)
								const sortByUsage = (a: PitcherRole, b: PitcherRole): number => {
									const usageA = pitcherUsage?.get(a.pitcherId) ?? 0;
									const usageB = pitcherUsage?.get(b.pitcherId) ?? 0;
									return usageA - usageB; // Lower usage first
								};

								const filteredBullpen: EnhancedBullpenState = {
									starter: bullpen.starter,
									closer: bullpen.closer && isPitcherAvailable(bullpen.closer.pitcherId) ? bullpen.closer : undefined,
									// Sort setup and relievers by usage to prefer less-used pitchers
									setup: bullpen.setup?.filter(r => isPitcherAvailable(r.pitcherId)).sort(sortByUsage),
									longRelief: bullpen.longRelief?.filter(r => isPitcherAvailable(r.pitcherId)).sort(sortByUsage),
									relievers: bullpen.relievers.filter(r => isPitcherAvailable(r.pitcherId)).sort(sortByUsage)
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
							batterName: formatName(pinchHitter?.name ?? 'Unknown'),
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

		// Safety check: if we have too many plays in this inning, something is wrong
		const playsThisInning = state.plays.filter(p =>
			p.inning === state.inning && p.isTopInning === state.isTopInning && !p.isSummary
		).length;

		if (playsThisInning > 50) {
			console.error(`[GameEngine] CRITICAL: ${playsThisInning} plays in inning ${state.inning} (${state.isTopInning ? 'top' : 'bottom'}), likely infinite loop`);
			console.error(`[GameEngine] Current state: outs=${state.outs}, bases=${state.bases}, inning=${state.inning}`);
			throw new Error(`Game appears to be in infinite loop - ${playsThisInning} plays in single inning. State: outs=${state.outs}, bases=${state.bases}`);
		}

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
		// The state machine resets outs to 0 when it reaches 3, so we need to detect
		// the third out by checking if we go from 2 outs to 0 outs (2 + 1 = 3rd out, then reset)
		// OR if newOuts is already 3 (in case the state machine doesn't reset)
		const wouldBeThirdOut = (state.outs === 2 && newOuts === 0) || newOuts >= 3;

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
			eventType: 'plateAppearance',
		};

		// Add the play BEFORE the summary when it's an inning-ending play
		// This ensures the summary appears after the 3rd out in reverse chronological display
		state.plays.unshift(play);

		// Mark that home team has batted in this inning (if bottom half)
		if (!state.isTopInning) {
			state.homeTeamHasBattedInInning = true;
		}

		// Debug logging for out transitions (before state update)
		if (newOuts > state.outs) {
			console.log(`[GameEngine] Out recorded: ${adjustedOutcome}, outs: ${state.outs} -> ${newOuts}, inning: ${state.inning}`);
		}
		if (newOuts >= 3 && state.outs < 3) {
			console.log(`[GameEngine] Third out reached! inning: ${state.inning}, isTop: ${state.isTopInning}`);
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

			// CRITICAL: Fill any remaining holes in the lineup BEFORE validation
			// This ensures null playerIds (from PH removal) are filled with available players
			this.fillLineupHoles(battingTeam, suppressPlays);

			// Only validate lineup if the game is NOT complete
			// If the game is over (e.g., bottom of 11th, final out), we don't need to validate
			if (!this.isComplete()) {
				// CRITICAL FIX: Resolve any duplicate positions BEFORE validation
				// This can happen when PHs or other substitutions create duplicate position assignments
				this.resolveDuplicatePositions(battingTeam, false);

				// CRITICAL: Validate the lineup after all substitutions
				// This ensures: all 9 positions (1-9) are filled exactly once,
				// no player is at position 11 (PH), and each player is eligible for their position
				const augmentedBatters = this.createAugmentedBattersRecord();
				const validation = validateLineup(battingTeam.players, augmentedBatters, {
					allowEmergencyPositions: this.emergencyRosterMode.get(battingTeam.teamId) ?? false,
					year: this.season.meta.year
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

	/**
	 * Update the starting pitcher for a team and reinitialize the bullpen
	 * Useful for season replay engine to apply rotation-based starter selection
	 *
	 * @param teamId - Team ID to update starter for
	 * @param newStarterId - New starting pitcher ID
	 */
	setStartingPitcher(teamId: string, newStarterId: string): void {
		const isAwayTeam = teamId === this.state.meta.awayTeam;
		const lineup = isAwayTeam ? this.state.awayLineup : this.state.homeLineup;

		// Update the starting pitcher in the lineup
		const oldStarterId = lineup.pitcher;
		lineup.pitcher = newStarterId;

		// Reinitialize the bullpen for this team with the new starter
		this.initializeBullpen(teamId, newStarterId);

		console.log(`[GameEngine] Updated starting pitcher for ${teamId}: ${oldStarterId} -> ${newStarterId}`);
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
