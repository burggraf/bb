/**
 * Types for the baseball game engine
 */

export type Outcome =
	| 'out'
	| 'single'
	| 'double'
	| 'triple'
	| 'homeRun'
	| 'walk'
	| 'hitByPitch';

export interface EventRates {
	out: number;
	single: number;
	double: number;
	triple: number;
	homeRun: number;
	walk: number;
	hitByPitch: number;
}

export interface SplitRates {
	vsLHP: EventRates;
	vsRHP: EventRates;
}

export interface BatterStats {
	id: string;
	name: string;
	bats: 'L' | 'R' | 'S';
	rates: SplitRates;
}

export interface PitcherStats {
	id: string;
	name: string;
	throws: 'L' | 'R';
	rates: {
		vsLHB: EventRates;
		vsRHB: EventRates;
	};
}

export interface LeagueAverages {
	vsLHP: EventRates;
	vsRHP: EventRates;
}

export interface Team {
	id: string;
	league: string;
	city: string;
	nickname: string;
}

export interface Game {
	id: string;
	date: string;
	awayTeam: string;
	homeTeam: string;
	useDH: boolean;
}

export interface SeasonPackage {
	meta: {
		year: number;
		generatedAt: string;
		version: string;
	};
	batters: Record<string, BatterStats>;
	pitchers: Record<string, PitcherStats>;
	league: {
		vsLHP: EventRates;
		vsRHP: EventRates;
	};
	teams: Record<string, Team>;
	games: Game[];
}

export interface LineupSlot {
	playerId: string | null;
	position: number;
}

export interface LineupState {
	teamId: string;
	players: LineupSlot[];
	currentBatterIndex: number;
	pitcher: string | null;
}

export interface GameState {
	meta: {
		awayTeam: string;
		homeTeam: string;
		season: number;
	};
	inning: number;
	isTopInning: boolean;
	outs: number;
	bases: [string | null, string | null, string | null]; // 1B, 2B, 3B runner IDs
	awayLineup: LineupState;
	homeLineup: LineupState;
	balls: number;
	strikes: number;
	plays: PlayEvent[];
}

export interface PlayEvent {
	inning: number;
	isTopInning: boolean;
	outcome: Outcome;
	batterId: string;
	batterName: string;
	pitcherId: string;
	pitcherName: string;
	description: string;
	runsScored: number;
}

export type GameMode = 'pitch-by-pitch' | 'auto-play' | 'quick-sim';
