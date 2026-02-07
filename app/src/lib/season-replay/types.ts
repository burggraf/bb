import type { GameState, PlayEvent } from '$lib/game/types';

export interface PlateAppearanceEvent {
	gameState: GameState;
	playEvent: PlayEvent;
}

export interface ReplayOptions {
	animated: boolean;
	simSpeed: number; // Delay in milliseconds between PAs (50-2000)
	gamesPerBatch?: number;
}

export interface ReplayProgress {
	currentGameIndex: number;
	totalGames: number;
	percent: number;
	currentDate: string;
}

export type ReplayStatus = 'idle' | 'playing' | 'paused' | 'completed';

export interface GameResult {
	gameId: string;
	awayTeam: string;
	homeTeam: string;
	awayScore: number;
	homeScore: number;
	date: string;
}
