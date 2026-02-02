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
	/** Primary position (1=P, 2=C, 3=1B, 4=2B, 5=3B, 6=SS, 7=LF, 8=CF, 9=RF, 10=DH) */
	primaryPosition: number;
	/** All positions player can play, with appearance counts */
	positionEligibility: Record<number, number>;
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

/**
 * Season-wide norms for era-appropriate managerial decisions.
 * These norms evolve over baseball history.
 */
export interface SeasonNorms {
	year: number;
	era: string;
	pitching: {
		/** Typical pitch count range for starting pitchers */
		starterPitches: {
			/** Pitch count where starters typically begin to get fatigued */
			fatigueThreshold: number;
			/** Typical pitch count limit for starters */
			typicalLimit: number;
			/** Absolute upper limit for starting pitchers */
			hardLimit: number;
		};
		/** Typical pitch count range for relief pitchers */
		relieverPitches: {
			/** Maximum pitches for a reliever in a single appearance */
			maxPitches: number;
			/** Typical pitches for a one-inning reliever */
			typicalPitches: number;
		};
	};
}

export interface SeasonPackage {
	meta: {
		year: number;
		generatedAt: string;
		version: string;
	};
	/** Season-wide norms for era-appropriate managerial decisions */
	norms: SeasonNorms;
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

/**
 * Extended lineup slot with player name for display
 */
export interface LineupPlayer {
	playerId: string;
	playerName: string;
	battingOrder: number;
	fieldingPosition: number;
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
	homeTeamHasBattedInInning: boolean; // Track if home team has batted in current extra inning
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
	// Managerial event types
	eventType?: 'plateAppearance' | 'startingLineup' | 'pitchingChange' | 'pinchHit' | 'defensiveSub';
	// Additional data for managerial events
	lineup?: LineupPlayer[]; // For starting lineup events
	substitutedPlayer?: string; // For PH/defensive sub - who was replaced
	position?: number; // For defensive sub - new position
}

export type GameMode = 'pitch-by-pitch' | 'auto-play' | 'quick-sim';
