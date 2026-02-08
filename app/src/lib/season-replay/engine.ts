import { getSeasonSchedule, loadSeason, loadSeasonForGame, getBattersForTeam, getPitchersForTeam, type ScheduledGame } from '$lib/game/sqlite-season-loader.js';
import { getSeriesMetadata, updateSeriesMetadata, updateSeries, saveGameFromState, saveGameDatabase, UsageTracker, type GameUsageStats } from '$lib/game-results/index.js';
import { GameEngine } from '$lib/game/engine.js';
import type { GameState, PlayEvent } from '$lib/game/types.js';
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
  private usageTracker: UsageTracker | null = null;

  constructor(seriesId: string, seasonYear: number, options: ReplayOptions = { animated: false, simSpeed: 500 }) {
    this.seriesId = seriesId;
    this.seasonYear = seasonYear;
    this.options = options;
  }

  async initialize(): Promise<void> {
    // Load season data
    const season = await loadSeason(this.seasonYear);

    // Initialize usage tracker
    this.usageTracker = new UsageTracker(this.seriesId);

    // Seed usage targets from season data
    await this.seedUsageTargets(season);

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

    // Only increment index and save progress if game was completed (not paused or errored)
    if (result) {
      this.currentGameIndex++;
      this.emit('progress', this.getProgress());

      if (this.currentGameIndex >= this.schedule.length) {
        this.status = 'completed';
        this.emit('statusChange', { status: this.status });
        // Update series status to 'completed' in database
        const metadata = await getSeriesMetadata(this.seriesId);
        if (metadata?.seasonReplay) {
          await updateSeries(this.seriesId, { status: 'completed' });
          // Save the database to IndexedDB to persist the change
          await saveGameDatabase();
        }
      }
    } else if (this.status === 'playing') {
      // Game returned null but we're still in 'playing' status - this means an error occurred
      // Skip the errored game and continue
      console.warn(`[SeasonReplay] Skipping game ${this.currentGameIndex + 1} (${game.awayTeam} vs ${game.homeTeam}) due to error`);
      this.currentGameIndex++;
      this.emit('progress', this.getProgress());
    }
    // If status is not 'playing' (e.g., 'paused'), don't increment index so game can be resumed

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

      // Check if we were paused mid-day
      if (this.status !== 'playing') {
        // Exit the loop early - game can be resumed later
        break;
      }

      if (result) {
        results.push(result);
      }
      // Always increment index for playNextDay (errors are skipped, pause is handled above)
      this.currentGameIndex++;
    }

    this.emit('progress', this.getProgress());

    if (this.currentGameIndex >= this.schedule.length) {
      this.status = 'completed';
      this.emit('statusChange', { status: this.status });
      // Update series status to 'completed' in database
      const metadata = await getSeriesMetadata(this.seriesId);
      if (metadata?.seasonReplay) {
        await updateSeries(this.seriesId, { status: 'completed' });
        // Save the database to IndexedDB to persist the change
        await saveGameDatabase();
      }
    }

    return results;
  }

  skipToNextGame(): void {
    // Skip the current game by incrementing the index
    this.currentGameIndex++;
    this.emit('progress', this.getProgress());

    if (this.currentGameIndex >= this.schedule.length) {
      this.status = 'completed';
      this.emit('statusChange', { status: this.status });
    }
  }

  private async simulateGame(game: ScheduledGame): Promise<GameResult | null> {
    try {
      // Get series metadata
      const metadata = await getSeriesMetadata(this.seriesId);

      // Load season data with players for both teams (loadSeasonForGame loads batters/pitchers)
      const season = await loadSeasonForGame(this.seasonYear, game.awayTeam, game.homeTeam);

      // Create and run game engine
      this.gameEngine = new GameEngine(season, game.awayTeam, game.homeTeam);

      // Simulate the full game with event emission for animated mode
      while (!this.gameEngine.isComplete()) {
        // Check if we've been paused or stopped mid-game
        if (this.status !== 'playing') {
          // Emit a paused event so UI can update
          this.emit('statusChange', { status: this.status });
          return null; // Return null to indicate game was not completed
        }

        this.gameEngine.simulatePlateAppearance();

        // Emit event for animated mode listeners
        const currentState = this.gameEngine.getState();
        this.emit('plateAppearance', {
          gameState: currentState,
          playEvent: currentState.plays[0]
        });

        // Delay if in animated mode
        if (this.options.animated) {
          await this.delay(this.options.simSpeed);
        }
      }

      const finalState = this.gameEngine.getState();

      // Calculate scores from plays (top inning = away team, bottom inning = home team)
      const awayScore = finalState.plays.filter(p => p.isTopInning).reduce((sum, p) => sum + p.runsScored, 0);
      const homeScore = finalState.plays.filter(p => !p.isTopInning).reduce((sum, p) => sum + p.runsScored, 0);

      // Save game to database
      console.log('[SeasonReplay] Saving game to database...', { awayTeam: game.awayTeam, homeTeam: game.homeTeam, awayScore, homeScore });
      const gameId = await saveGameFromState(finalState, this.seriesId, this.currentGameIndex + 1, game.date);
      console.log('[SeasonReplay] Game saved successfully:', gameId);

      // Update usage tracking
      if (this.usageTracker) {
        const gameStats = this.extractGameStats(finalState);
        await this.usageTracker.updateGameUsage(gameStats);

        // Check for threshold violations (log but don't fail)
        try {
          const violations = await this.usageTracker.checkThresholds();
          if (violations.length > 0) {
            console.log(`[SeasonReplay] Found ${violations.length} usage violations after game ${this.currentGameIndex + 1}`);
          }
        } catch (error) {
          console.error('[SeasonReplay] Error checking usage thresholds:', error);
          // Continue anyway - don't let threshold checking break the replay
        }
      }

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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      this.emit('gameError', {
        game,
        error: errorMessage,
        gameIndex: this.currentGameIndex
      });
      // Don't re-throw - continue to next game instead of stopping the entire replay
      // Games with missing roster data (e.g., team has 0 batters) will be skipped
      return null;
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

  getCurrentGameState(): GameState | null {
    return this.gameEngine?.getState() || null;
  }

  setOptions(options: Partial<ReplayOptions>): void {
    this.options = { ...this.options, ...options };
  }

  getOptions(): ReplayOptions {
    return this.options;
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

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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

  private async seedUsageTargets(season: any): Promise<void> {
    if (!this.usageTracker) return;

    // Collect all batters and pitchers from the season
    const allBatters: Record<string, any> = {};
    const allPitchers: Record<string, any> = {};

    // Load batters and pitchers for each team in the season
    for (const teamId of Object.keys(season.teams)) {
      const teamBatters = await getBattersForTeam(this.seasonYear, teamId);
      const teamPitchers = await getPitchersForTeam(this.seasonYear, teamId);

      Object.assign(allBatters, teamBatters);
      Object.assign(allPitchers, teamPitchers);
    }

    await this.usageTracker.seedUsageTargets(allBatters, allPitchers);
  }

  private extractGameStats(gameState: GameState): GameUsageStats {
    const batterPa = new Map<string, number>();
    const pitcherIp = new Map<string, number>();

    for (const play of gameState.plays) {
      // Skip summary events and non-plate-appearance events
      if (play.isSummary || play.eventType !== 'plateAppearance') continue;

      // Count PA for each batter
      const currentPa = batterPa.get(play.batterId) || 0;
      batterPa.set(play.batterId, currentPa + 1);

      // Count outs for each pitcher (1 out = 1/3 inning)
      // Only count outs (strikeout, groundOut, flyOut, lineOut, popOut)
      const outcome = play.outcome;
      if (
        outcome === 'strikeout' ||
        outcome === 'groundOut' ||
        outcome === 'flyOut' ||
        outcome === 'lineOut' ||
        outcome === 'popOut'
      ) {
        const currentIp = pitcherIp.get(play.pitcherId) || 0;
        pitcherIp.set(play.pitcherId, currentIp + 1);
      }
    }

    return { batterPa, pitcherIp };
  }
}
