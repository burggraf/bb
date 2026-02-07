import { getSeasonSchedule, loadSeason, loadSeasonForGame, type ScheduledGame } from '$lib/game/sqlite-season-loader.js';
import { getSeriesMetadata, updateSeriesMetadata, updateSeries, saveGameFromState } from '$lib/game-results/index.js';
import { GameEngine } from '$lib/game/engine.js';
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

    // Restore state from metadata
    const metadata = await getSeriesMetadata(this.seriesId);
    if (metadata?.seasonReplay) {
      this.currentGameIndex = metadata.seasonReplay.currentGameIndex;
      this.status = metadata.seasonReplay.status;
    } else {
      this.currentGameIndex = 0;
      this.status = 'idle';
    }
  }

  async start(): Promise<void> {
    if (this.schedule.length === 0) {
      throw new Error('Schedule not loaded. Call initialize() first.');
    }

    this.status = 'playing';
    this.emit('statusChange', { status: this.status });
    this.emit('progress', this.getProgress());
  }

  async pause(): Promise<void> {
    if (this.status !== 'playing') return;

    this.status = 'paused';
    this.emit('statusChange', { status: this.status });

    // Save status to metadata
    const metadata = await getSeriesMetadata(this.seriesId);
    if (metadata?.seasonReplay) {
      await updateSeriesMetadata(this.seriesId, {
        seasonReplay: {
          ...metadata.seasonReplay,
          currentGameIndex: this.currentGameIndex,
          status: this.status
        }
      });
    }
  }

  async resume(): Promise<void> {
    if (this.status !== 'paused') return;

    this.status = 'playing';
    this.emit('statusChange', { status: this.status });

    // Save status to metadata
    const metadata = await getSeriesMetadata(this.seriesId);
    if (metadata?.seasonReplay) {
      await updateSeriesMetadata(this.seriesId, {
        seasonReplay: {
          ...metadata.seasonReplay,
          currentGameIndex: this.currentGameIndex,
          status: this.status
        }
      });
    }
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
      // Update series status to 'completed' in database
      console.log('[SeasonReplay] Replay completed, updating series status to completed for seriesId:', this.seriesId);
      const metadata = await getSeriesMetadata(this.seriesId);
      if (metadata?.seasonReplay) {
        console.log('[SeasonReplay] Calling updateSeries with status: completed');
        await updateSeries(this.seriesId, { status: 'completed' });
      } else {
        console.error('[SeasonReplay] No seasonReplay metadata found for series:', this.seriesId);
      }
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
      // Update series status to 'completed' in database
      console.log('[SeasonReplay] Replay completed, updating series status to completed for seriesId:', this.seriesId);
      const metadata = await getSeriesMetadata(this.seriesId);
      if (metadata?.seasonReplay) {
        console.log('[SeasonReplay] Calling updateSeries with status: completed');
        await updateSeries(this.seriesId, { status: 'completed' });
      } else {
        console.error('[SeasonReplay] No seasonReplay metadata found for series:', this.seriesId);
      }
    }

    return results;
  }

  private async simulateGame(game: ScheduledGame): Promise<GameResult | null> {
    try {
      // Get series metadata
      const metadata = await getSeriesMetadata(this.seriesId);

      // Load season data with players for both teams (loadSeasonForGame loads batters/pitchers)
      const season = await loadSeasonForGame(this.seasonYear, game.awayTeam, game.homeTeam);

      // Create and run game engine
      this.gameEngine = new GameEngine(season, game.awayTeam, game.homeTeam);

      // Simulate the full game
      while (!this.gameEngine.isComplete()) {
        this.gameEngine.simulatePlateAppearance();
      }

      const finalState = this.gameEngine.getState();

      // Calculate scores from plays (top inning = away team, bottom inning = home team)
      const awayScore = finalState.plays.filter(p => p.isTopInning).reduce((sum, p) => sum + p.runsScored, 0);
      const homeScore = finalState.plays.filter(p => !p.isTopInning).reduce((sum, p) => sum + p.runsScored, 0);

      // Save game to database
      console.log('[SeasonReplay] Saving game to database...', { awayTeam: game.awayTeam, homeTeam: game.homeTeam, awayScore, homeScore });
      const gameId = await saveGameFromState(finalState, this.seriesId, this.currentGameIndex + 1, game.date);
      console.log('[SeasonReplay] Game saved successfully:', gameId);

      // Update series metadata
      await this.updateMetadataStatus(this.seriesId, finalState, metadata);

      return {
        gameId,
        awayTeam: game.awayTeam,
        homeTeam: game.homeTeam,
        awayScore,
        homeScore,
        date: game.date
      };
    } catch (error) {
      console.error('[SeasonReplay] Error simulating game:', error);
      throw error;
    }
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
    // Update season replay metadata with current game index and status
    // Save currentGameIndex + 1 as the next game to play
    await updateSeriesMetadata(seriesId, {
      seasonReplay: {
        ...metadata.seasonReplay,
        currentGameIndex: this.currentGameIndex + 1,
        status: this.status,
        lastPlayedDate: this.schedule[this.currentGameIndex]?.date
      }
    });
  }
}
