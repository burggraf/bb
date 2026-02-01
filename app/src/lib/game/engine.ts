/**
 * Baseball game engine using the MatchupModel
 */

import { MatchupModel } from '@bb/model';
import type {
	GameState,
	LineupState,
	PlayEvent,
	Outcome,
	SeasonPackage,
	BatterStats,
	PitcherStats,
} from './types.js';

// Generate lineup from batters on the specified team
function generateLineup(
	batters: Record<string, BatterStats>,
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

	return {
		teamId,
		players: teamBatters.map((b, i) => ({ playerId: b.id, position: i + 1 })),
		currentBatterIndex: 0,
		pitcher: null,
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
	pitcherName: string
): string {
	const batter = formatName(batterName);
	const pitcher = formatName(pitcherName);
	switch (outcome) {
		case 'out':
			return `${batter} grounded out to ${pitcher}.`;
		case 'single':
			return `${batter} singled to center.`;
		case 'double':
			return `${batter} doubled to left-center.`;
		case 'triple':
			return `${batter} tripled to the gap.`;
		case 'homeRun':
			return `${batter} homered to deep center!`;
		case 'walk':
			return `${batter} drew a walk.`;
		case 'hitByPitch':
			return `${batter} hit by pitch.`;
		default:
			return `${batter} vs ${pitcher}.`;
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
			const isHit = ['single', 'double', 'triple', 'homeRun'].includes(play.outcome);
			if (isHit) hits++;
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

// Apply baserunning (V1: static rules)
function applyBaserunning(
	state: GameState,
	outcome: Outcome,
	batterId: string
): {
	runs: number;
	newBases: [string | null, string | null, string | null];
	scorerIds: string[];
} {
	let runs = 0;
	let scorerIds: string[] = [];
	let newBases: [string | null, string | null, string | null] = [null, null, null];

	// V1: Static baserunning advancement
	switch (outcome) {
		case 'out':
			// Ground out: runners advance depending on outs
			const outsBefore = state.outs;

			if (outsBefore >= 2) {
				// With 2 outs, runners run with pitch
				// Runner on 3B scores
				if (state.bases[2]) {
					runs++;
					scorerIds.push(state.bases[2]!);
				}
				// Runner on 2B advances to 3B
				newBases[2] = state.bases[1];
				// Runner on 1B advances to 2B
				newBases[1] = state.bases[0];
				// Batter out, nobody reaches
				newBases[0] = null;
			} else {
				// With 0-1 outs, more limited advancement
				// Runner on 3B: scores with 1 out, holds with 0 outs
				if (state.bases[2]) {
					if (outsBefore === 1) {
						runs++;
						scorerIds.push(state.bases[2]!);
					} else {
						newBases[2] = state.bases[2];
					}
				}
				// Runner on 2B: may advance to 3B or hold
				if (state.bases[1]) {
					// Usually holds on ground out, could advance
					newBases[2] = state.bases[1];
				}
				// Runner on 1B: forced out or advances to 2B (fielder's choice)
				if (state.bases[0]) {
					newBases[1] = state.bases[0];
				}
				newBases[0] = null; // Batter out
			}
			break;
		case 'walk':
		case 'hitByPitch':
			// Runners advance only if forced
			if (state.bases[0]) {
				// Runners on 1B and 2B advance
				newBases[1] = state.bases[0];
				newBases[2] = state.bases[1];
			}
			// If bases loaded, runner from 2B scores
			if (state.bases[2] && state.bases[1] && state.bases[0]) {
				runs++;
				scorerIds.push(state.bases[2]!);
			}
			newBases[0] = batterId;
			break;
		case 'single':
			// Runners advance 1 base, score from 2B
			if (state.bases[2]) {
				runs++;
				scorerIds.push(state.bases[2]!);
			}
			newBases[0] = batterId;
			newBases[1] = state.bases[0];
			newBases[2] = null;
			break;
		case 'double':
			// Runners advance 2 bases, score from 1B and 2B
			if (state.bases[0]) {
				runs++;
				scorerIds.push(state.bases[0]!);
			}
			if (state.bases[1]) {
				runs++;
				scorerIds.push(state.bases[1]!);
			}
			newBases[0] = null;
			newBases[1] = batterId;
			newBases[2] = state.bases[0];
			break;
		case 'triple':
			// All runners score
			if (state.bases[0]) {
				runs++;
				scorerIds.push(state.bases[0]!);
			}
			if (state.bases[1]) {
				runs++;
				scorerIds.push(state.bases[1]!);
			}
			if (state.bases[2]) {
				runs++;
				scorerIds.push(state.bases[2]!);
			}
			newBases = [null, null, batterId];
			break;
		case 'homeRun':
			// Everyone scores (including batter)
			if (state.bases[0]) {
				runs++;
				scorerIds.push(state.bases[0]!);
			}
			if (state.bases[1]) {
				runs++;
				scorerIds.push(state.bases[1]!);
			}
			if (state.bases[2]) {
				runs++;
				scorerIds.push(state.bases[2]!);
			}
			runs++;
			scorerIds.push(batterId);
			newBases = [null, null, null];
			break;
	}

	return { runs, newBases, scorerIds };
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
			awayLineup: generateLineup(season.batters, awayTeam),
			homeLineup: generateLineup(season.batters, homeTeam),
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
		// Use a random pitcher for now
		const pitchers = Object.values(season.pitchers);
		const pitcher = pitchers[Math.floor(Math.random() * pitchers.length)];

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

		// Get outcome from model
		const outcome = this.model.simulate(matchup) as Outcome;

		// Capture runners before the play
		const runnersBefore: [string | null, string | null, string | null] = [...state.bases];

		// Apply baserunning
		const { runs, newBases, scorerIds } = applyBaserunning(state, outcome, batterId);

		// Update state bases
		if (outcome === 'out') {
			state.outs++;
		} else {
			state.bases = newBases;
		}

		// Create play event
		const play: PlayEvent = {
			inning: state.inning,
			isTopInning: state.isTopInning,
			outcome,
			batterId,
			batterName: batter.name,
			pitcherId: pitcher.id,
			pitcherName: pitcher.name,
			description: describePlay(outcome, batter.name, pitcher.name),
			runsScored: runs,
			runnersAfter: [...state.bases],
			scorerIds,
			runnersBefore,
		};

		// Update state
		state.plays.unshift(play);

		// Advance to next batter
		advanceBatter(battingTeam);

		// Check for inning change
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

		// Bottom of 9th or later: game ends if home team is ahead or if away team is ahead (away team wins)
		// If tied, game continues to extra innings
		if (this.state.inning >= 9 && !this.state.isTopInning && homeScore !== awayScore) {
			return true;
		}

		return false;
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
			awayLineup: generateLineup(season.batters, state.meta.awayTeam),
			homeLineup: generateLineup(season.batters, state.meta.homeTeam),
		};
		return engine;
	}
}
