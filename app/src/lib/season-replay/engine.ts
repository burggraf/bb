import { getSeasonSchedule, loadSeason, loadSeasonForGame, getBattersForTeam, getPitchersForTeam, type ScheduledGame } from '$lib/game/sqlite-season-loader.js';
import { getSeriesMetadata, updateSeriesMetadata, updateSeries, saveGameFromState, saveGameDatabase, UsageTracker, type GameUsageStats } from '$lib/game-results/index.js';
import { GameEngine, type ManagerialOptions } from '$lib/game/engine.js';
import type { GameState, PlayEvent } from '$lib/game/types.js';
import type { ReplayOptions, ReplayProgress, ReplayStatus, GameResult } from './types.js';
import type { UsageContext } from '$lib/game/lineup-builder.js';

type EventCallback = (data: any) => void;

/**
 * Track pitcher rotation state for each team
 */
interface RotationState {
	/** Ordered list of starter IDs by gamesStarted (most starts first) */
	starterRotation: string[];
	/** Current index in rotation */
	rotationIndex: number;
	/** Map of pitcher ID to their position in rotation */
	rotationPosition: Map<string, number>;
}

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
  /** Track pitcher rotation state for each team */
  private rotationStates = new Map<string, RotationState>();
  /** Save database every N games (from metadata, default 20) */
  private saveInterval = 20;

  constructor(seriesId: string, seasonYear: number, options: ReplayOptions = { animated: false, simSpeed: 500 }) {
    this.seriesId = seriesId;
    this.seasonYear = seasonYear;
    this.options = options;
  }

  async initialize(): Promise<void> {
    console.log('[SeasonReplayEngine] initialize() starting');
    // Load season data
    console.log('[SeasonReplayEngine] Loading season data...');
    const season = await loadSeason(this.seasonYear);
    console.log('[SeasonReplayEngine] Season data loaded');

    // Initialize usage tracker
    console.log('[SeasonReplayEngine] Initializing usage tracker...');
    this.usageTracker = new UsageTracker(this.seriesId, this.seasonYear);
    console.log('[SeasonReplayEngine] Usage tracker created');

    // Load schedule
    console.log('[SeasonReplayEngine] Loading schedule...');
    this.schedule = await getSeasonSchedule(this.seasonYear);
    console.log('[SeasonReplayEngine] Schedule loaded, games:', this.schedule.length);

    // Check for existing replay state BEFORE seeding
    const metadata = await getSeriesMetadata(this.seriesId);

    // Check if usage targets have been seeded by querying the database
    // A new replay has seasonReplay metadata but NO usage records yet
    const db = await getGameDatabase();
    const usageCountStmt = db.prepare('SELECT COUNT(*) as count FROM player_usage WHERE series_id = ?');
    usageCountStmt.bind([this.seriesId]);
    let usageCount = 0;
    if (usageCountStmt.step()) {
      usageCount = usageCountStmt.getAsObject().count;
    }
    usageCountStmt.free();

    const needsSeeding = usageCount === 0;

    if (needsSeeding) {
      // Seed usage targets from season data (only for new replays or replays without usage data)
      console.log('[SeasonReplayEngine] Seeding usage targets for new replay...');
      await this.seedUsageTargets(season);
      console.log('[SeasonReplayEngine] Usage targets seeded');
      // Save the initial database state with seeded usage targets
      await saveGameDatabase();
      console.log('[SeasonReplayEngine] Saved initial database with usage targets');
    } else {
      console.log('[SeasonReplayEngine] Resuming existing replay, using existing usage data from database');
      if (metadata?.seasonReplay) {
        this.currentGameIndex = metadata.seasonReplay.currentGameIndex;
        this.status = metadata.seasonReplay.status;
        this.saveInterval = metadata.seasonReplay.saveInterval ?? 20;
        console.log('[SeasonReplayEngine] Save interval:', this.saveInterval);
      }
    }

    // For new replays, also read saveInterval from metadata if available
    if (metadata?.seasonReplay?.saveInterval) {
      this.saveInterval = metadata.seasonReplay.saveInterval;
      console.log('[SeasonReplayEngine] Save interval:', this.saveInterval);
    }

    console.log('[SeasonReplayEngine] initialize() complete, status:', this.status);
  }

  async start(): Promise<void> {
    if (this.schedule.length === 0) {
      throw new Error('Schedule not loaded. Call initialize() first.');
    }

    this.status = 'playing';
    this.emit('statusChange', { status: this.status });
    this.emit('progress', this.getProgress());
  }

  /**
   * Initialize rotation state for a team based on their pitchers' gamesStarted
   * This is called lazily when a team first plays a game
   */
  private async initializeRotationForTeam(teamId: string): Promise<void> {
    if (this.rotationStates.has(teamId)) {
      return; // Already initialized
    }

    console.log(`[SeasonReplay] Initializing rotation for team ${teamId}`);
    const teamPitchersRecord = await getPitchersForTeam(this.seasonYear, teamId);
    const teamPitchers = Object.values(teamPitchersRecord); // Convert to array

    // Filter to pitchers who are actual starters (start rate >= 30%)
    const starters = teamPitchers.filter(p => {
      const startRate = p.gamesStarted / p.games;
      return startRate >= 0.3 && p.gamesStarted >= 5; // At least 5 starts to qualify
    });

    if (starters.length === 0) {
      // Fallback: use pitchers with most gamesStarted
      const fallback = [...teamPitchers]
        .sort((a, b) => b.gamesStarted - a.gamesStarted)
        .slice(0, 5); // Top 5 by gamesStarted
      starters.push(...fallback);
    }

    // Sort by gamesStarted descending (most starts = ace = first in rotation)
    starters.sort((a, b) => b.gamesStarted - a.gamesStarted);

    const starterIds = starters.map(p => p.id);
    const rotationPosition = new Map<string, number>();
    starterIds.forEach((id, index) => {
      rotationPosition.set(id, index);
    });

    this.rotationStates.set(teamId, {
      starterRotation: starterIds,
      rotationIndex: 0,
      rotationPosition
    });

    console.log(`[SeasonReplay] Rotation initialized for ${teamId}:`, {
      starters: starterIds.length,
      rotation: starterIds.slice(0, 5).map(id => {
        const p = teamPitchersRecord[id];
        return p?.name ?? id;
      })
    });
  }

  /**
   * Select the next starting pitcher for a team based on rotation
   * Skips overused pitchers and advances rotation index
   * Uses the configured restThreshold instead of hardcoded 125%
   */
  private async selectNextStarter(teamId: string, allPitchers: Record<string, any>): Promise<string> {
    // Initialize rotation if not already done
    await this.initializeRotationForTeam(teamId);

    const rotation = this.rotationStates.get(teamId);
    if (!rotation || rotation.starterRotation.length === 0) {
      // Fallback: return pitcher with most gamesStarted
      const pitchers = Object.values(allPitchers).filter((p: any) => p.teamId === teamId);
      return pitchers.sort((a: any, b: any) => b.gamesStarted - a.gamesStarted)[0]?.id;
    }

    // Get usage data for this team
    const teamUsage = this.usageTracker
      ? await this.usageTracker.getTeamUsageForContext(teamId)
      : new Map<string, number>();

    // Use the configured restThreshold (from managerialOptions, default 1.0)
    // This was set to 1.0 (100%) in the season replay engine for tighter control
    const restThreshold = this.managerialOptions?.restThreshold ?? 1.0;

    // Find the next available starter in rotation
    // Start from current index and loop until we find someone not overused
    let attempts = 0;
    const maxAttempts = rotation.starterRotation.length;
    let selectedPitcherId: string | null = null;

    while (attempts < maxAttempts) {
      const pitcherId = rotation.starterRotation[rotation.rotationIndex];
      const usage = teamUsage.get(pitcherId) ?? 0;

      // Skip if overused (exceeds restThreshold), unless we've tried everyone
      if (usage <= restThreshold || attempts === maxAttempts - 1) {
        selectedPitcherId = pitcherId;
        break;
      }

      if (usage > restThreshold) {
        console.log(`[SeasonReplay] Skipping overused starter ${pitcherId} (${(usage * 100).toFixed(0)}% of actual, threshold: ${(restThreshold * 100).toFixed(0)}%)`);
      }
      rotation.rotationIndex = (rotation.rotationIndex + 1) % rotation.starterRotation.length;
      attempts++;
    }

    if (!selectedPitcherId) {
      // Last resort: use the first starter in rotation
      selectedPitcherId = rotation.starterRotation[0];
    }

    // Advance rotation for next game
    rotation.rotationIndex = (rotation.rotationIndex + 1) % rotation.starterRotation.length;

    const pitcher = allPitchers[selectedPitcherId];
    console.log(`[SeasonReplay] Selected starter ${pitcher?.name ?? selectedPitcherId} for ${teamId}`);

    return selectedPitcherId;
  }

  async pause(): Promise<void> {
    if (this.status !== 'playing') return;

    this.status = 'paused';
    this.emit('statusChange', { status: this.status });

    // Save database to persist all progress when paused
    await saveGameDatabase();

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
    const gameStart = performance.now();
    try {
      console.log('[SeasonReplay] simulateGame() starting for', game.awayTeam, 'vs', game.homeTeam);
      // Get series metadata
      const metadata = await getSeriesMetadata(this.seriesId);

      // Load season data with players for both teams (loadSeasonForGame loads batters/pitchers)
      console.log('[SeasonReplay] Loading season data for game...');
      const season = await loadSeasonForGame(this.seasonYear, game.awayTeam, game.homeTeam);
      console.log('[SeasonReplay] Season data loaded');

      // Get usage context for batter rest decisions and pitcher usage (if usage tracker is available)
      let awayUsageContext: UsageContext | undefined;
      let homeUsageContext: UsageContext | undefined;
      let allPlayerUsage = new Map<string, number>(); // Combined usage for ALL players (batters + pitchers)

      if (this.usageTracker) {
        const usageContextStart = performance.now();
        try {
          const awayUsage = await this.usageTracker.getTeamUsageForContext(game.awayTeam);
          const homeUsage = await this.usageTracker.getTeamUsageForContext(game.homeTeam);
          awayUsageContext = { playerUsage: awayUsage, restThreshold: 1.25 };
          homeUsageContext = { playerUsage: homeUsage, restThreshold: 1.25 };

          // Combine ALL player usage (both batters and pitchers) for usage-aware decisions
          // This map will be used for:
          // - Bullpen filtering (pitchers)
          // - Pinch hitter selection (batters)
          // - Other usage-aware managerial decisions
          for (const [playerId, usage] of awayUsage) {
            allPlayerUsage.set(playerId, usage);
          }
          for (const [playerId, usage] of homeUsage) {
            allPlayerUsage.set(playerId, usage);
          }

          const awayPitcherCount = Array.from(awayUsage.keys()).filter(id => season.pitchers[id]).length;
          const homePitcherCount = Array.from(homeUsage.keys()).filter(id => season.pitchers[id]).length;
          const usageContextMs = performance.now() - usageContextStart;

          console.log('[SeasonReplay] Usage context loaded:', {
            awayPlayers: awayUsage.size,
            homePlayers: homeUsage.size,
            awayPitchers: awayPitcherCount,
            homePitchers: homePitcherCount,
            total: allPlayerUsage.size,
            loadTimeMs: usageContextMs.toFixed(1)
          });
        } catch (error) {
          console.warn('[SeasonReplay] Could not load usage context:', error);
          // Continue without usage context - better than failing
        }
      }

      // Create and run game engine with usage context for batter rest and pitcher usage decisions
      console.log('[SeasonReplay] Creating GameEngine...');
      const managerial: ManagerialOptions = {
        enabled: true,
        randomness: 0.1,
        pitcherUsage: allPlayerUsage, // Using combined map for all players
        restThreshold: 0.90 // Stricter threshold for pitchers (90% instead of 100%) to prevent overuse
      };
      this.gameEngine = GameEngine.create(
        season,
        game.awayTeam,
        game.homeTeam,
        managerial,
        awayUsageContext,
        homeUsageContext
      );
      console.log('[SeasonReplay] GameEngine created');

      // Apply rotation-based starter selection
      console.log('[SeasonReplay] Applying rotation-based starter selection...');
      try {
        // Get all pitchers from season data for this game
        const allPitchers = { ...season.pitchers };

        // Select starters based on rotation
        const awayStarterId = await this.selectNextStarter(game.awayTeam, allPitchers);
        const homeStarterId = await this.selectNextStarter(game.homeTeam, allPitchers);

        // Update the starting pitchers in the engine (this also reinitializes bullpens)
        this.gameEngine.setStartingPitcher(game.awayTeam, awayStarterId);
        this.gameEngine.setStartingPitcher(game.homeTeam, homeStarterId);

        console.log('[SeasonReplay] Starters applied via rotation:', {
          away: awayStarterId,
          home: homeStarterId
        });
      } catch (error) {
        console.warn('[SeasonReplay] Could not apply rotation selection:', error);
        // Continue with auto-selected starters - better than failing
      }

      // Simulate the full game with event emission for animated mode
      let paCount = 0;
      console.log('[SeasonReplay] Starting game simulation loop...');
      while (!this.gameEngine.isComplete()) {
        // Check if we've been paused or stopped mid-game
        if (this.status !== 'playing') {
          // Emit a paused event so UI can update
          this.emit('statusChange', { status: this.status });
          console.log('[SeasonReplay] Game paused/stopped mid-game');
          return null; // Return null to indicate game was not completed
        }

        // Safety check: prevent infinite loops (500 PAs is way more than any real game)
        if (paCount > 500) {
          console.error('[SeasonReplay] Game exceeded 500 plate appearances - likely infinite loop!');
          const currentState = this.gameEngine.getState();
          console.error('[SeasonReplay] Game state:', {
            inning: currentState.inning,
            isTop: currentState.isTopInning,
            outs: currentState.outs,
            playsCount: currentState.plays.length
          });
          return null;
        }

        this.gameEngine.simulatePlateAppearance();
        paCount++;

        // Emit event for animated mode listeners
        const currentState = this.gameEngine.getState();
        this.emit('plateAppearance', {
          gameState: currentState,
          playEvent: currentState.plays[0]
        });

        // Yield to browser every 10 plate appearances in non-animated mode
        // to prevent main thread blocking
        if (!this.options.animated && paCount % 10 === 0) {
          console.log(`[SeasonReplay] Yielding after ${paCount} PAs, inning: ${currentState.inning}, ${currentState.isTopInning ? 'top' : 'bottom'}`);
          await new Promise(resolve => setTimeout(resolve, 0));
        }

        // Delay if in animated mode
        if (this.options.animated) {
          await this.delay(this.options.simSpeed);
        }
      }
      console.log('[SeasonReplay] Game simulation complete, PA count:', paCount);

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
        const usageStart = performance.now();
        const gameStats = this.extractGameStats(finalState);
        await this.usageTracker.updateGameUsage(gameStats);
        const usageUpdateMs = performance.now() - usageStart;

        // Save database to persist usage data across page refreshes
        // Batch saves: only save every saveInterval games to reduce I/O overhead
        const shouldSave = (this.currentGameIndex + 1) % this.saveInterval === 0 || (this.currentGameIndex + 1) === this.schedule.length;
        if (shouldSave) {
          const saveStart = performance.now();
          await saveGameDatabase();
          const saveMs = performance.now() - saveStart;
          console.log(`[SeasonReplay] Usage timings: update=${usageUpdateMs.toFixed(1)}ms, save=${saveMs.toFixed(1)}ms`);
        } else {
          console.log(`[SeasonReplay] Usage update: ${usageUpdateMs.toFixed(1)}ms (skipping save)`);
        }
      }

      // Update series metadata
      await this.updateMetadataStatus(this.seriesId, finalState, metadata);

      const gameTotalMs = performance.now() - gameStart;
      console.log(`[SeasonReplay] Game ${this.currentGameIndex + 1} completed in ${gameTotalMs.toFixed(1)}ms (${(1000/gameTotalMs).toFixed(1)} games/sec)`);

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

  setSaveInterval(interval: number): void {
    this.saveInterval = Math.max(1, Math.min(9999, interval));
    console.log('[SeasonReplayEngine] Save interval updated to:', this.saveInterval);
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

    console.log('[SeasonReplayEngine] seedUsageTargets() starting');
    // Collect all batters and pitchers from the season
    const allBatters: Record<string, any> = {};
    const allPitchers: Record<string, any> = {};

    // Load batters and pitchers for each team in the season
    const teamIds = Object.keys(season.teams);
    console.log('[SeasonReplayEngine] Loading data for', teamIds.length, 'teams');

    for (let i = 0; i < teamIds.length; i++) {
      const teamId = teamIds[i];
      console.log(`[SeasonReplayEngine] Loading team ${i + 1}/${teamIds.length}: ${teamId}`);
      const teamBatters = await getBattersForTeam(this.seasonYear, teamId);
      const teamPitchers = await getPitchersForTeam(this.seasonYear, teamId);

      Object.assign(allBatters, teamBatters);
      Object.assign(allPitchers, teamPitchers);
      console.log(`[SeasonReplayEngine] Loaded team ${teamId}: ${Object.keys(teamBatters).length} batters, ${Object.keys(teamPitchers).length} pitchers`);
    }

    console.log('[SeasonReplayEngine] Calling usageTracker.seedUsageTargets...');
    await this.usageTracker.seedUsageTargets(allBatters, allPitchers);
    console.log('[SeasonReplayEngine] seedUsageTargets() complete');
  }

  private extractGameStats(gameState: GameState): GameUsageStats {
    const batterPa = new Map<string, number>();
    const pitcherBf = new Map<string, number>(); // Batters Faced

    for (const play of gameState.plays) {
      // Skip summary events and non-plate-appearance events
      if (play.isSummary || play.eventType !== 'plateAppearance') continue;

      // Count PA for each batter
      const currentPa = batterPa.get(play.batterId) || 0;
      batterPa.set(play.batterId, currentPa + 1);

      // Count batters faced for each pitcher (every PA counts as 1 BF)
      // This is more accurate than just counting outs because pitchers face
      // all batters, not just those who make outs
      const currentBf = pitcherBf.get(play.pitcherId) || 0;
      pitcherBf.set(play.pitcherId, currentBf + 1);
    }

    // Convert batters faced to outs
    // On average, pitchers record ~0.75 outs per batter faced
    // (27 outs per 9 innings with ~36 BF per 9 innings = 27/36 = 0.75)
    const pitcherIp = new Map<string, number>();
    for (const [pitcherId, bf] of pitcherBf.entries()) {
      // Convert BF to outs: multiply by 0.75 to get outs equivalent
      pitcherIp.set(pitcherId, Math.round(bf * 0.75));
    }

    return { batterPa, pitcherIp };
  }
}
