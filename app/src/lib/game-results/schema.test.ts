import { describe, it, expect } from 'vitest';
import { GAME_RESULTS_SCHEMA } from './schema.js';

describe('Game Results Schema', () => {
  it('should include player_usage table definition', () => {
    expect(GAME_RESULTS_SCHEMA).toContain('CREATE TABLE IF NOT EXISTS player_usage');
  });

  it('should have all required columns in player_usage table', () => {
    expect(GAME_RESULTS_SCHEMA).toContain('series_id TEXT NOT NULL');
    expect(GAME_RESULTS_SCHEMA).toContain('player_id TEXT NOT NULL');
    expect(GAME_RESULTS_SCHEMA).toContain('team_id TEXT NOT NULL');
    expect(GAME_RESULTS_SCHEMA).toContain('is_pitcher INTEGER NOT NULL');
    expect(GAME_RESULTS_SCHEMA).toContain('actual_season_total INTEGER NOT NULL');
    expect(GAME_RESULTS_SCHEMA).toContain('games_played_actual INTEGER NOT NULL');
    expect(GAME_RESULTS_SCHEMA).toContain('replay_current_total INTEGER NOT NULL DEFAULT 0');
    expect(GAME_RESULTS_SCHEMA).toContain('replay_games_played INTEGER NOT NULL DEFAULT 0');
    expect(GAME_RESULTS_SCHEMA).toContain('percentage_of_actual REAL NOT NULL DEFAULT 0');
    expect(GAME_RESULTS_SCHEMA).toContain("status TEXT NOT NULL DEFAULT 'inRange'");
  });

  it('should have primary key on player_usage table', () => {
    expect(GAME_RESULTS_SCHEMA).toContain('PRIMARY KEY (series_id, player_id)');
  });

  it('should have foreign key constraint to series table', () => {
    expect(GAME_RESULTS_SCHEMA).toContain('FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE');
  });

  it('should include indexes for player_usage table', () => {
    expect(GAME_RESULTS_SCHEMA).toContain('CREATE INDEX IF NOT EXISTS idx_player_usage_series_pitcher');
    expect(GAME_RESULTS_SCHEMA).toContain('CREATE INDEX IF NOT EXISTS idx_player_usage_team');
    expect(GAME_RESULTS_SCHEMA).toContain('CREATE INDEX IF NOT EXISTS idx_player_usage_status');
  });

  it('should place indexes in correct locations', () => {
    // Check that player_usage indexes come after the table definition
    const tableIndex = GAME_RESULTS_SCHEMA.indexOf('CREATE TABLE IF NOT EXISTS player_usage');
    const firstIndex = GAME_RESULTS_SCHEMA.indexOf('CREATE INDEX IF NOT EXISTS idx_player_usage_series_pitcher');
    expect(tableIndex).toBeGreaterThanOrEqual(0);
    expect(firstIndex).toBeGreaterThan(tableIndex);
  });
});
