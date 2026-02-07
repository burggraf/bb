import { getSeasonSchedule, type ScheduledGame } from '$lib/game/sqlite-season-loader.js';
import { getSeriesMetadata, updateSeriesMetadata, saveGameFromState } from '$lib/game-results/index.js';
import { GameEngine } from '$lib/game/engine.js';
import { loadSeason } from '$lib/game/sqlite-season-loader.js';
import type { ReplayOptions, ReplayProgress, ReplayStatus, GameResult } from './types.js';

type EventCallback = (data: any) => void;

export class SeasonReplayEngine {
  private seriesId: string;
  private seasonYear: number;
  private options: ReplayOptions;
  private schedule: ScheduledGame[] = [];
  private currentGameIndex = 0;
  private status: ReplayStatus = 'idle';
  private gameEngine: GameEngine | null = null;
  private eventListeners: Map<string, Set<EventCallback>> = new Map();

  constructor(seriesId: string, seasonYear: number, options: ReplayOptions = { playbackSpeed: 'instant' }) {
    this.seriesId = seriesId;
    this.seasonYear = seasonYear;
    this.options = options;
  }

  async initialize(): Promise<void> {
    // Load season data
    await loadSeason(this.seasonYear);

    // Load schedule
    this.schedule = await getSeasonSchedule(this.seasonYear);
    this.currentGameIndex = 0;
    this.status = 'idle';
  }

  async start(): Promise<void> {
    if (this.schedule.length === 0) {
      throw new Error('Schedule not loaded. Call initialize() first.');
    }

    this.status = 'playing';
    this.emit('statusChange', { status: this.status });
    this.emit('progress', this.getProgress());
  }

  pause(): void {
    if (this.status !== 'playing') return;

    this.status = 'paused';
    this.emit('statusChange', { status: this.status });
  }

  resume(): void {
    if (this.status !== 'paused') return;

    this.status = 'playing';
    this.emit('statusChange', { status: this.status });
  }

  async playNextGame(): Promise<GameResult | null> {
    if (this.currentGameIndex >= this.schedule.length) {
      this.status = 'completed';
      this.emit('statusChange', { status: this.status });
      return null;
    }

    const game = this.schedule[this.currentGameIndex];
    const result = await this.simulateGame(game);
    this.currentGameIndex++;

    this.emit('progress', this.getProgress());

    if (this.currentGameIndex >= this.schedule.length) {
      this.status = 'completed';
      this.emit('statusChange', { status: this.status });
    }

    return result;
  }

  async playNextDay(): Promise<GameResult[]> {
    if (this.currentGameIndex >= this.schedule.length) {
      this.status = 'completed';
      this.emit('statusChange', { status: this.status });
      return [];
    }

    const currentDate = this.schedule[this.currentGameIndex].date;
    const results: GameResult[] = [];

    while (
      this.currentGameIndex < this.schedule.length &&
      this.schedule[this.currentGameIndex].date === currentDate
    ) {
      const game = this.schedule[this.currentGameIndex];
      const result = await this.simulateGame(game);
      if (result) {
        results.push(result);
      }
      this.currentGameIndex++;
    }

    this.emit('progress', this.getProgress());

    if (this.currentGameIndex >= this.schedule.length) {
      this.status = 'completed';
      this.emit('statusChange', { status: this.status });
    }

    return results;
  }

  private async simulateGame(game: ScheduledGame): Promise<GameResult | null> {
    // Get series metadata
    const metadata = await getSeriesMetadata(this.seriesId);

    // Create and run game engine
    this.gameEngine = new GameEngine(game.awayTeam, game.homeTeam, this.seasonYear);
    this.gameEngine.initializeLineups();
    const finalState = this.gameEngine.playFullGame();

    // Save game to database
    await saveGameFromState(finalState, this.seriesId, undefined, game.date);

    // Update series metadata
    await this.updateMetadataStatus(this.seriesId, finalState, metadata);

    return {
      gameId: finalState.gameId,
      awayTeam: game.awayTeam,
      homeTeam: game.homeTeam,
      awayScore: finalState.awayScore,
      homeScore: finalState.homeScore,
      date: game.date
    };
  }

  getProgress(): ReplayProgress {
    return {
      currentGameIndex: this.currentGameIndex,
      totalGames: this.schedule.length,
      percent: this.schedule.length > 0
        ? Math.round((this.currentGameIndex / this.schedule.length) * 100)
        : 0,
      currentDate: this.schedule[this.currentGameIndex]?.date || ''
    };
  }

  getStatus(): ReplayStatus {
    return this.status;
  }

  on(event: string, callback: EventCallback): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  off(event: string, callback: EventCallback): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  private emit(event: string, data: any): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(callback => callback(data));
    }
  }

  private async updateMetadataStatus(
    seriesId: string,
    finalState: any,
    metadata: any
  ): Promise<void> {
    const homeWins = finalState.homeScore > finalState.awayScore;
    const awayWins = finalState.awayScore > finalState.homeScore;

    await updateSeriesMetadata(seriesId, {
      homeWins: metadata.homeWins + (homeWins ? 1 : 0),
      awayWins: metadata.awayWins + (awayWins ? 1 : 0),
      gamesPlayed: metadata.gamesPlayed + 1,
      lastPlayedDate: finalState.date
    });
  }
}
