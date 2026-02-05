import { describe, it, expect } from 'vitest';
import type {
  Series,
  GameEvent,
  SeriesType,
  GameEventType,
  Outcome
} from './types.js';

describe('Game Results Types', () => {
  it('should create a valid Series object', () => {
    const series: Series = {
      id: 'test-series-1',
      name: '1976 Season Replay',
      description: 'Full season replay',
      seriesType: 'season_replay',
      createdAt: '2026-02-05T12:00:00Z',
      updatedAt: '2026-02-05T12:00:00Z',
      status: 'active'
    };

    expect(series.seriesType).toBe('season_replay');
    expect(series.status).toBe('active');
  });

  it('should create a valid GameEvent for plate appearance', () => {
    const event: GameEvent = {
      id: 1,
      gameId: 'game-1',
      sequence: 1,
      inning: 1,
      isTopInning: true,
      outs: 0,
      eventType: 'plateAppearance',
      outcome: 'single',
      batterId: 'batter-1',
      batterName: 'Smith, John',
      pitcherId: 'pitcher-1',
      pitcherName: 'Jones, Tom',
      runsScored: 0,
      earnedRuns: 0,
      unearnedRuns: 0,
      runner1bBefore: null,
      runner2bBefore: null,
      runner3bBefore: null,
      runner1bAfter: 'batter-1',
      runner2bAfter: null,
      runner3bAfter: null,
      description: 'Smith singles to center',
      lineupJson: null,
      substitutedPlayer: null,
      position: null,
      isSummary: false
    };

    expect(event.eventType).toBe('plateAppearance');
    expect(event.outcome).toBe('single');
    expect(event.runner1bAfter).toBe('batter-1');
  });

  it('should accept all valid SeriesType values', () => {
    const types: SeriesType[] = ['season_replay', 'tournament', 'exhibition', 'custom'];
    expect(types).toHaveLength(4);
  });

  it('should accept all valid GameEventType values', () => {
    const types: GameEventType[] = [
      'plateAppearance',
      'startingLineup',
      'pitchingChange',
      'pinchHit',
      'defensiveSub',
      'lineupAdjustment'
    ];
    expect(types).toHaveLength(6);
  });

  it('should allow nullable outcome for non-PA events', () => {
    const event: GameEvent = {
      id: 1,
      gameId: 'game-1',
      sequence: 0,
      inning: 1,
      isTopInning: true,
      outs: 0,
      eventType: 'startingLineup',
      outcome: null,
      batterId: null,
      batterName: null,
      pitcherId: null,
      pitcherName: null,
      runsScored: 0,
      earnedRuns: 0,
      unearnedRuns: 0,
      runner1bBefore: null,
      runner2bBefore: null,
      runner3bBefore: null,
      runner1bAfter: null,
      runner2bAfter: null,
      runner3bAfter: null,
      description: 'Starting lineups',
      lineupJson: '[{"playerId":"p1","playerName":"Player 1","battingOrder":1,"fieldingPosition":1}]',
      substitutedPlayer: null,
      position: null,
      isSummary: false
    };

    expect(event.eventType).toBe('startingLineup');
    expect(event.outcome).toBeNull();
  });
});
