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

// Simple lineup generation (top of order)
function generateLineup(
	batters: Record<string, BatterStats>,
	teamId: string
): LineupState {
	const teamBatters = Object.values(batters)
		.filter((b) => {
			// For now, just take batters - in real app, filter by team
			return true;
		})
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

// Create play description
function describePlay(
	outcome: Outcome,
	batterName: string,
	pitcherName: string
): string {
	switch (outcome) {
		case 'out':
			return `${batterName} grounded out to ${pitcherName}.`;
		case 'single':
			return `${batterName} singled to center.`;
		case 'double':
			return `${batterName} doubled to left-center.`;
		case 'triple':
			return `${batterName} tripled to the gap.`;
		case 'homeRun':
			return `${batterName} homered to deep center!`;
		case 'walk':
			return `${batterName} drew a walk.`;
		case 'hitByPitch':
			return `${batterName} hit by pitch.`;
		default:
			return `${batterName} vs ${pitcherName}.`;
	}
}

// Apply baserunning (V1: static rules)
function applyBaserunning(
	state: GameState,
	outcome: Outcome,
	batterId: string
): { runs: number; newBases: [string | null, string | null, string | null] } {
	let runs = 0;
	let newBases: [string | null, string | null, string | null] = [null, null, null];

	// V1: Static baserunning advancement
	switch (outcome) {
		case 'out':
			// Runners hold
			newBases = [...state.bases];
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
			}
			newBases[0] = batterId;
			break;
		case 'single':
			// Runners advance 1 base, score from 2B
			if (state.bases[2]) runs++;
			newBases[0] = batterId;
			newBases[1] = state.bases[0];
			newBases[2] = null;
			break;
		case 'double':
			// Runners advance 2 bases, score from 1B and 2B
			if (state.bases[0]) runs++;
			if (state.bases[1]) runs++;
			newBases[0] = null;
			newBases[1] = batterId;
			newBases[2] = state.bases[0];
			break;
		case 'triple':
			// All runners score
			if (state.bases[0]) runs++;
			if (state.bases[1]) runs++;
			if (state.bases[2]) runs++;
			newBases = [null, null, batterId];
			break;
		case 'homeRun':
			// Everyone scores (including batter)
			if (state.bases[0]) runs++;
			if (state.bases[1]) runs++;
			if (state.bases[2]) runs++;
			runs++;
			newBases = [null, null, null];
			break;
	}

	return { runs, newBases };
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
			balls: 0,
			strikes: 0,
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

		// Apply baserunning
		const { runs, newBases } = applyBaserunning(state, outcome, batterId);

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
		};

		// Update state
		state.plays.unshift(play);
		state.balls = 0;
		state.strikes = 0;

		if (outcome === 'out') {
			state.outs++;
		} else {
			state.bases = newBases;
		}

		// Advance to next batter
		advanceBatter(battingTeam);

		// Check for inning change
		if (state.outs >= 3) {
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
		// Game is complete after 9 innings (or home team ahead after 8.5)
		return this.state.inning > 9 ||
			(this.state.inning === 9 && !this.state.isTopInning);
	}
}
