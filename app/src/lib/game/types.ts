/**
 * Types for the baseball game engine
 */

/**
 * The 17 detailed plate appearance outcomes.
 */
export type Outcome =
  // Hits
  | 'single'
  | 'double'
  | 'triple'
  | 'homeRun'
  // Walks
  | 'walk'
  | 'hitByPitch'
  // Strikeout
  | 'strikeout'
  // Ball-in-play outs
  | 'groundOut'
  | 'flyOut'
  | 'lineOut'
  | 'popOut'
  // Sacrifices
  | 'sacrificeFly'
  | 'sacrificeBunt'
  // Other
  | 'fieldersChoice'
  | 'reachedOnError'
  | 'catcherInterference';

/**
 * Probability rates for each of the 17 plate appearance outcomes.
 */
export interface EventRates {
  single: number;
  double: number;
  triple: number;
  homeRun: number;
  walk: number;
  hitByPitch: number;
  strikeout: number;
  groundOut: number;
  flyOut: number;
  lineOut: number;
  popOut: number;
  sacrificeFly: number;
  sacrificeBunt: number;
  fieldersChoice: number;
  reachedOnError: number;
  catcherInterference: number;
}

export interface SplitRates {
	vsLHP: EventRates;
	vsRHP: EventRates;
}

export interface BatterStats {
	id: string;
	name: string;
	bats: 'L' | 'R' | 'S';
	teamId: string;
	rates: SplitRates;
}

export interface PitcherStats {
	id: string;
	name: string;
	throws: 'L' | 'R';
	teamId: string;
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
	isSummary?: boolean; // true for half-inning summaries
	runnersAfter?: [string | null, string | null, string | null]; // runners on base after the play (1B, 2B, 3B)
	scorerIds?: string[]; // players who scored on this play
	runnersBefore?: [string | null, string | null, string | null]; // runners on base before the play
}

export type GameMode = 'pitch-by-pitch' | 'auto-play' | 'quick-sim';
