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

// Generate lineup from batters on the specified team
function generateLineup(
	batters: Record<string, BatterStats>,
	pitchers: Record<string, PitcherStats>,
	teamId: string
): LineupState {
	// Filter batters by teamId
	const teamBatters = Object.values(batters)
		.filter((b) => b.teamId === teamId)
		.sort((a, b) => {
			// Sort by OBP (simplified)
			const aOBP =
				a.rates.vsRHP.walk +
				a.rates.vsRHP.single +
				a.rates.vsRHP.double +
				a.rates.vsRHP.triple +
				a.rates.vsRHP.homeRun;
			const bOBP =
				b.rates.vsRHP.walk +
				b.rates.vsRHP.single +
				b.rates.vsRHP.double +
				b.rates.vsRHP.triple +
				b.rates.vsRHP.homeRun;
			return bOBP - aOBP;
		})
		.slice(0, 9);

	// Select a starting pitcher (pick first pitcher for team - V1 simplification)
	// V2 will implement proper rotation ordering
	const teamPitchers = Object.values(pitchers).filter((p) => p.teamId === teamId);
	const startingPitcher = teamPitchers[0]?.id ?? null;

	return {
		teamId,
		players: teamBatters.map((b, i) => ({ playerId: b.id, position: i + 1 })),
		currentBatterIndex: 0,
		pitcher: startingPitcher,
	};
}

// Get next batter in lineup
function getNextBatter(lineup: LineupState, season: SeasonPackage): string {
	const playerId = lineup.players[lineup.currentBatterIndex].playerId;
	if (!playerId) {
		// Use a random batter as fallback
		const batters = Object.values(season.batters);
		return batters[Math.floor(Math.random() * batters.length)].id;
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

	constructor(
		season: SeasonPackage,
		awayTeam: string,
		homeTeam: string,
		managerial?: ManagerialOptions
	) {
		this.model = new MatchupModel();
		this.season = season;
		this.managerialOptions = { enabled: true, randomness: 0.1, ...managerial };

		// Generate lineups
		let awayLineup: LineupState;
		let homeLineup: LineupState;

		if (this.managerialOptions.enabled) {
			// Use managerial system for lineups
			const awayBatters = Object.values(season.batters)
				.filter((b) => b.teamId === awayTeam)
				.map(toModelBatter);
			const homeBatters = Object.values(season.batters)
				.filter((b) => b.teamId === homeTeam)
				.map(toModelBatter);

			const awaySlots = generateManagerialLineup(awayBatters, {
				method: this.managerialOptions.lineupMethod,
				randomness: this.managerialOptions.randomness
			});
			const homeSlots = generateManagerialLineup(homeBatters, {
				method: this.managerialOptions.lineupMethod,
				randomness: this.managerialOptions.randomness
			});

			awayLineup = {
				teamId: awayTeam,
				players: awaySlots.map((s: LineupSlot) => ({
					playerId: s.playerId,
					position: s.fieldingPosition
				})),
				currentBatterIndex: 0,
				pitcher: null // Will be set in initializeBullpen
			};

			homeLineup = {
				teamId: homeTeam,
				players: homeSlots.map((s: LineupSlot) => ({
					playerId: s.playerId,
					position: s.fieldingPosition
				})),
				currentBatterIndex: 0,
				pitcher: null // Will be set in initializeBullpen
			};
		} else {
			// Use default lineup generation
			awayLineup = generateLineup(season.batters, season.pitchers, awayTeam);
			homeLineup = generateLineup(season.batters, season.pitchers, homeTeam);
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
		this.initializeBullpen(awayTeam);
		this.initializeBullpen(homeTeam);

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
			'P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'
		];
		return positionNames[position] ?? `Pos${position}`;
	}

	/**
	 * Initialize bullpen state for a team
	 */
	private initializeBullpen(teamId: string): void {
		const teamPitchers = Object.values(this.season.pitchers).filter((p) => p.teamId === teamId);

		if (teamPitchers.length === 0) return;

		// First pitcher is the starter
		const starterId = teamPitchers[0]!.id;
		const starterStats = this.season.pitchers[starterId];

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
		const relievers: PitcherRole[] = teamPitchers.slice(1).map((p) => {
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

		// Set the starting pitcher in the appropriate lineup
		if (this.state.awayLineup.teamId === teamId) {
			this.state.awayLineup.pitcher = starterId;
		} else {
			this.state.homeLineup.pitcher = starterId;
		}
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

		// Check for pitching change
		const mgrState = toManagerialGameState(this.state);

		// Use season-specific BFP data for pull decisions
		const pullOptions = {
			seasonStarterBFP: this.season.norms.pitching.starterBFP,
			seasonRelieverBFP: this.season.norms.pitching.relieverBFP,
			currentInning: this.state.inning
		};

		const pitchingDecision = shouldPullPitcher(
			mgrState,
			pitcherRole,
			bullpen,
			this.managerialOptions.randomness ?? 0.1,
			pullOptions
		);

		if (pitchingDecision.shouldChange && pitchingDecision.newPitcher) {
			// Apply pitching change
			pitchingTeam.pitcher = pitchingDecision.newPitcher;

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

		// Season-based frequency control: target PH rate divided by total PAs per game
		// Multiplied by 10 to account for shouldPinchHit rejecting ~90% of candidates
		// 1976: (2.8 PH/game / 70 PAs) * 10 = ~40% should consider PH
		const phConsiderationRate = (this.season.norms.substitutions.pinchHitsPerGame / 70) * 10;
		const shouldConsiderPH = Math.random() < phConsiderationRate;
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
				const phDecision = shouldPinchHit(
					mgrState,
					toModelBatter(currentBatter),
					availableBench,
					toModelPitcher(opposingPitcher),
					this.managerialOptions.randomness ?? 0.15
				);

				if (phDecision.shouldPinchHit && phDecision.pinchHitterId) {
					// Find the batter's position in the lineup
					const batterIndex = battingTeam.players.findIndex(p => p.playerId === currentBatterId);
					if (batterIndex !== -1) {
						const replacedPosition = battingTeam.players[batterIndex].position;
						const pinchHitter = this.season.batters[phDecision.pinchHitterId];

						// Mark replaced player as removed (can't return)
						this.removedPlayers.add(currentBatterId);
						this.usedPinchHitters.add(phDecision.pinchHitterId);

						// Check if we're pinch hitting for a pitcher (position 1)
						const isPitcherPH = replacedPosition === 1;

						// Find what position the pinch hitter will play defensively
						const defensivePosition = this.findDefensivePositionForPH(phDecision.pinchHitterId, replacedPosition);

						if (defensivePosition === null) {
							// Pinch hitter can't play any position - skip this substitution
							return false;
						}

						let description = `Pinch hit: ${this.formatName(pinchHitter?.name ?? 'Unknown')} pinch hits for ${this.formatName(currentBatter.name)}`;

						// If pinch hitting for pitcher, we also need a new pitcher (double switch)
						if (isPitcherPH) {
							// Get a reliever from the bullpen
							const bullpen = this.bullpenStates.get(battingTeam.teamId);
							if (bullpen && bullpen.relievers.length > 0) {
								const newPitcherId = bullpen.relievers[0].pitcherId;
								const newPitcher = this.season.pitchers[newPitcherId];

								// Mark old pitcher as removed
								this.removedPlayers.add(currentBatterId);

								// Update lineup with pinch hitter at their defensive position
								battingTeam.players[batterIndex] = { playerId: phDecision.pinchHitterId, position: defensivePosition };

								// Bring in new pitcher
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

								description += `; ${this.formatName(newPitcher?.name ?? 'Unknown')} pitches`;
							} else {
								// No relievers available - can't pinch hit for pitcher
								return false;
							}
						} else {
							// Pinch hitting for position player
							// Pinch hitter stays in at their defensive position
							battingTeam.players[batterIndex] = { playerId: phDecision.pinchHitterId, position: defensivePosition };

							// Always show defensive position for clarity
							description += ` (stays in as ${this.getPositionName(defensivePosition)})`;
						}

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
		const batterId = getNextBatter(battingTeam, season);
		const batter = season.batters[batterId];
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

		// Fielder's choice, sacrifice fly, and sacrifice bunt are impossible with empty bases
		if (areBasesEmpty(state.bases)) {
			impossibleOutcomes.push('fieldersChoice', 'sacrificeFly', 'sacrificeBunt');
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
		const batterId = getNextBatter(battingTeam, this.season);
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
		const engine = new GameEngine(
			season,
			state.meta.awayTeam,
			state.meta.homeTeam,
			managerial
		);
		// Restore game state but regenerate lineups from season data
		// This ensures lineups use correct team filtering even after data updates
		engine.state = {
			...state,
			awayLineup: managerial?.enabled
				? engine.state.awayLineup // Keep the generated lineup from constructor
				: generateLineup(season.batters, season.pitchers, state.meta.awayTeam),
			homeLineup: managerial?.enabled
				? engine.state.homeLineup // Keep the generated lineup from constructor
				: generateLineup(season.batters, season.pitchers, state.meta.homeTeam),
			// Ensure flag exists for backward compatibility
			homeTeamHasBattedInInning: state.homeTeamHasBattedInInning ?? false,
		};
		return engine;
	}
}
