/**
 * Types for the baseball game engine
 */

// Re-export era types from model package
export type { EraStrategy, EraDetection, PlayerAvailability, LineupBuildResult, EraLineupOptions } from '@bb/model';

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
	/** Primary position (1=P, 2=C, 3=1B, 4=2B, 5=3B, 6=SS, 7=LF, 8=CF, 9=RF, 10=DH, 11=PH, 12=PR) */
	primaryPosition: number;
	/** All positions player can play, with appearance counts */
	positionEligibility: Record<number, number>;
	/** Traditional stats from lahman_batting_season_agg */
	pa: number;
	avg: number;
	obp: number;
	slg: number;
	ops: number;
	rates: SplitRates;
}

export interface PitcherStats {
	id: string;
	name: string;
	throws: 'L' | 'R';
	teamId: string;
	/** Average batters faced when starting (for fatigue modeling) */
	avgBfpAsStarter: number | null;
	/** Average batters faced when relieving (for fatigue modeling) */
	avgBfpAsReliever: number | null;
	/** Traditional stats from lahman_pitching and lahman_pitching_season_agg */
	games: number;
	gamesStarted: number;
	completeGames: number;
	saves: number;
	inningsPitched: number;
	whip: number;
	era: number;
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
		/** Pull decision thresholds for starting pitchers */
		pullThresholds?: {
			/** BFP multiplier at which to consider pulling starter */
			consider: number;
			/** BFP multiplier at which to likely pull starter */
			likely: number;
			/** BFP multiplier hard limit */
			hardLimit: number;
		};
		/** Average batters faced by starters (based on era data) */
		starterBFP: number;
		/** Average batters faced by relievers by inning group */
		relieverBFP: {
			/** Early game (innings 1-3): long men, spot starters */
			early: number;
			/** Middle game (innings 4-6): middle relievers */
			middle: number;
			/** Late game (innings 7+): closers, specialists */
			late: number;
		};
		/** Overall average batters faced by relievers */
		relieverBFPOverall: number;
		/** Average number of relievers used per game (both teams combined) */
		relieversPerGame: number;
		/** 90th percentile BFP for starters - deep outing ceiling for this season */
		starterDeepOutingBFP: number;
	};
	/** How often pinch hitters are used per game (both teams combined) */
	substitutions: {
		/** Average pinch hit appearances per game */
		pinchHitsPerGame: number;
		/** Average defensive substitution appearances per game */
		defensiveReplacementsPerGame: number;
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
	/** Batter stats including traditional metrics from lahman tables */
	batters: Record<string, BatterStats>;
	/** Pitcher stats including traditional metrics from lahman tables */
	pitchers: Record<string, PitcherStats>;
	league: {
		vsLHP: EventRates;
		vsRHP: EventRates;
		/** League-average batting stats for pitchers (for pitchers with few/no at-bats) */
		pitcherBatter: {
			vsLHP: EventRates;
			vsRHP: EventRates;
		};
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
	eventType?: 'plateAppearance' | 'startingLineup' | 'pitchingChange' | 'pinchHit' | 'defensiveSub' | 'lineupAdjustment';
	// Additional data for managerial events
	lineup?: LineupPlayer[]; // For starting lineup events
	substitutedPlayer?: string; // For PH/defensive sub - who was replaced
	position?: number; // For defensive sub - new position
}

export type GameMode = 'pitch-by-pitch' | 'auto-play' | 'quick-sim';
