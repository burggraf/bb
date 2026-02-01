/**
 * Baseball game engine using the MatchupModel
 */

import { MatchupModel, type ProbabilityDistribution } from '@bb/model';
import type {
	GameState,
	LineupState,
	PlayEvent,
	Outcome,
	SeasonPackage,
	BatterStats,
	PitcherStats,
} from './types.js';
import { transition, createBaserunningState } from './state-machine/index.js';
import { isHit } from './state-machine/outcome-types.js';

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
	};
}

export class GameEngine {
	private model: MatchupModel;
	private season: SeasonPackage;
	private state: GameState;

	constructor(season: SeasonPackage, awayTeam: string, homeTeam: string) {
		this.model = new MatchupModel();
		this.season = season;

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
			awayLineup: generateLineup(season.batters, season.pitchers, awayTeam),
			homeLineup: generateLineup(season.batters, season.pitchers, homeTeam),
			plays: [],
		};
	}

	getState(): Readonly<GameState> {
		return this.state;
	}

	simulatePlateAppearance(): PlayEvent {
		const { state, season } = this;
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
		if (areBasesEmpty(state.bases)) {
			// Fielder's choice, sacrifice fly, and sacrifice bunt are impossible with empty bases
			// Get the distribution, exclude impossible outcomes, re-normalize, then sample
			const distribution = this.model.predict(matchup);
			const fcProb = distribution.fieldersChoice || 0;
			const sfProb = distribution.sacrificeFly || 0;
			const sbProb = distribution.sacrificeBunt || 0;
			const excludedProb = fcProb + sfProb + sbProb;

			if (excludedProb > 0) {
				// Create adjusted distribution excluding impossible outcomes
				const { fieldersChoice: _fc, sacrificeFly: _sf, sacrificeBunt: _sb, ...remaining } = distribution;
				const adjusted = remaining as Partial<ProbabilityDistribution>;

				// Re-normalize the remaining probabilities
				const totalProb = 1 - excludedProb;
				for (const key of Object.keys(adjusted) as (keyof ProbabilityDistribution)[]) {
					if (key !== 'fieldersChoice' && key !== 'sacrificeFly' && key !== 'sacrificeBunt' && adjusted[key] !== undefined) {
						adjusted[key] = adjusted[key]! / totalProb;
					}
				}

				// Sample from adjusted distribution (cast to full type since we know it's valid)
				outcome = this.model.sample(adjusted as ProbabilityDistribution) as Outcome;
			} else {
				// No impossible outcomes, just sample normally
				outcome = this.model.simulate(matchup) as Outcome;
			}
		} else {
			// Normal sampling with runners on base
			outcome = this.model.simulate(matchup) as Outcome;
		}

		// Capture runners before the play
		const runnersBefore: [string | null, string | null, string | null] = [...state.bases];

		// Apply baserunning
		const { runs, newBases, scorerIds, newOuts } = applyBaserunning(state, outcome, batterId);

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
		if (outcome === 'fieldersChoice') {
			// Find which runner was removed (comparing runnersBefore to newBases)
			// Check from furthest base to nearest (3B -> 2B -> 1B)
			const bases = ['third', 'second', 'first'] as const;
			const baseNames = ['3B', '2B', '1B'] as const;
			for (let i = 0; i < 3; i++) {
				if (runnersBefore[i] && !newBases[i]) {
					// Runner was here before, now gone - they're the out
					outRunnerName = this.season.batters[runnersBefore[i]!]?.name;
					outBase = baseNames[i];
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
				state.isTopInning = true;
				state.inning++;
			}
		} else if (!wouldBeThirdOut && this.isComplete()) {
			// Game ended without 3 outs (walk-off win)
			// Add a summary for the final half-inning with correct inning values
			addHalfInningSummaryWithInning(state, this.season, playInning, playIsTop);
		}

		// Advance to next batter
		advanceBatter(battingTeam);

		return play;
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

		// Extra innings: if away team leads after top of an inning, game ends
		// (Home team had their chance and couldn't tie/win)
		if (this.state.inning > 9 && this.state.isTopInning && awayScore > homeScore) {
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
	static restore(serializedState: string, season: SeasonPackage): GameEngine {
		const state = JSON.parse(serializedState) as GameState;
		const engine = new GameEngine(season, state.meta.awayTeam, state.meta.homeTeam);
		// Restore game state but regenerate lineups from season data
		// This ensures lineups use correct team filtering even after data updates
		engine.state = {
			...state,
			awayLineup: generateLineup(season.batters, season.pitchers, state.meta.awayTeam),
			homeLineup: generateLineup(season.batters, season.pitchers, state.meta.homeTeam),
		};
		return engine;
	}
}
