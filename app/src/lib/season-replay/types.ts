export interface ReplayOptions {
  playbackSpeed: 'instant' | 'animated';
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
