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

// Add half-inning summary to plays
function addHalfInningSummary(state: GameState, season: SeasonPackage): void {
	const isTop = state.isTopInning;
	const inning = state.inning;

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
			// Fielder's choice is impossible with empty bases
			// Get the distribution, exclude fieldersChoice, re-normalize, then sample
			const distribution = this.model.predict(matchup);
			const fcProb = distribution.fieldersChoice || 0;

			if (fcProb > 0) {
				// Create adjusted distribution without fieldersChoice
				// We need to use Partial to exclude the required field
				const { fieldersChoice: _fc, ...remaining } = distribution;
				const adjusted = remaining as Partial<ProbabilityDistribution>;

				// Re-normalize the remaining probabilities
				const totalProb = 1 - fcProb;
				for (const key of Object.keys(adjusted) as (keyof ProbabilityDistribution)[]) {
					if (key !== 'fieldersChoice' && adjusted[key] !== undefined) {
						adjusted[key] = adjusted[key]! / totalProb;
					}
				}

				// Sample from adjusted distribution (cast to full type since we know it's valid)
				outcome = this.model.sample(adjusted as ProbabilityDistribution) as Outcome;
			} else {
				// No fieldersChoice probability, just sample normally
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

		// Update state bases and outs (use outs from state machine)
		state.bases = newBases;
		state.outs = newOuts;

		// Check for inning change (do this BEFORE any capping)
		if (state.outs >= 3) {
			// Add half-inning summary before changing
			addHalfInningSummary(state, this.season);

			state.outs = 0;
			state.bases = [null, null, null];

			if (state.isTopInning) {
				state.isTopInning = false;
			} else {
				state.isTopInning = true;
				state.inning++;
			}
		}

		// Safety cap to prevent runaway outs (shouldn't happen with correct logic)
		state.outs = Math.min(state.outs, 2) as 0 | 1 | 2;
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

		// Create play event (store formatted names)
		const play: PlayEvent = {
			inning: state.inning,
			isTopInning: state.isTopInning,
			outcome,
			batterId,
			batterName: formatName(batter.name),
			pitcherId: pitcher.id,
			pitcherName: formatName(pitcher.name),
			description: describePlay(outcome, batter.name, pitcher.name, runs, outRunnerName, outBase),
			runsScored: runs,
			runnersAfter: [...state.bases],
			scorerIds,
			runnersBefore,
		};

		// Update state
		state.plays.unshift(play);

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

		// Top of 9th or later: game ends if home team is ahead (home team wins without batting)
		if (this.state.inning >= 9 && this.state.isTopInning && homeScore > awayScore) {
			return true;
		}

		// Bottom of 9th or later: game ends if home team is ahead (home team wins)
		// If tied or trailing, game continues (tied = extra innings, trailing = away leads)
		if (this.state.inning >= 9 && !this.state.isTopInning && homeScore > awayScore) {
			return true;
		}

		// Extra innings (10th+): if home team lost after their at-bat, game ends
		// This triggers when inning incremented to 10+ and top is about to start with home team trailing
		if (this.state.inning > 9 && this.state.isTopInning && awayScore > homeScore) {
			return true;
		}

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
		this.state.outs = Math.min(newOuts, 2) as 0 | 1 | 2; // Cap at 2 after engine checks for inning end

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
