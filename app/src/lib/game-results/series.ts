import { getGameDatabase } from './database.js';
import type { Series, SeriesTeam, SeriesType } from './types.js';

/**
 * Generate a UUID v4
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Create a new series
 */
export async function createSeries(data: {
  name: string;
  description: string | null;
  seriesType: SeriesType;
}): Promise<Series> {
  try {
    const db = await getGameDatabase();

    const id = generateUUID();
    const now = new Date().toISOString();

    db.run(
      `INSERT INTO series (id, name, description, series_type, created_at, updated_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, data.name, data.description, data.seriesType, now, now, 'active']
    );

    return {
      id,
      name: data.name,
      description: data.description,
      seriesType: data.seriesType,
      createdAt: now,
      updatedAt: now,
      status: 'active'
    };
  } catch (error) {
    console.error('[Series] Failed to create series:', error);
    throw new Error(`Failed to create series: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get a series by id
 */
export async function getSeries(id: string): Promise<Series | null> {
  try {
    const db = await getGameDatabase();

    const stmt = db.prepare('SELECT * FROM series WHERE id = ?');
    stmt.bind([id]);

    if (!stmt.step()) {
      stmt.free();
      return null;
    }

    const row = stmt.getAsObject() as any;
    stmt.free();

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      seriesType: row.series_type,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: row.status
    };
  } catch (error) {
    console.error('[Series] Failed to get series:', error);
    throw new Error(`Failed to get series: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * List all series, ordered by created_at DESC
 */
export async function listSeries(): Promise<Series[]> {
  try {
    const db = await getGameDatabase();

    const stmt = db.prepare('SELECT * FROM series ORDER BY created_at DESC');
    const series: Series[] = [];

    while (stmt.step()) {
      const row = stmt.getAsObject() as any;
      series.push({
        id: row.id,
        name: row.name,
        description: row.description,
        seriesType: row.series_type,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        status: row.status
      });
    }

    stmt.free();
    return series;
  } catch (error) {
    console.error('[Series] Failed to list series:', error);
    throw new Error(`Failed to list series: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Update a series
 */
export async function updateSeries(
  id: string,
  data: {
    name?: string;
    description?: string | null;
    status?: 'active' | 'completed' | 'archived';
  }
): Promise<Series | null> {
  try {
    const db = await getGameDatabase();

    const updates: string[] = [];
    const values: any[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.description !== undefined) {
      updates.push('description = ?');
      values.push(data.description);
    }
    if (data.status !== undefined) {
      updates.push('status = ?');
      values.push(data.status);
    }

    if (updates.length === 0) {
      return getSeries(id);
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    db.run(`UPDATE series SET ${updates.join(', ')} WHERE id = ?`, values);

    return getSeries(id);
  } catch (error) {
    console.error('[Series] Failed to update series:', error);
    throw new Error(`Failed to update series: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Delete a series and all associated games
 * @returns true if the series was deleted, false if it was not found
 */
export async function deleteSeries(id: string): Promise<boolean> {
  try {
    const db = await getGameDatabase();

    // First check if the series exists
    const existing = await getSeries(id);
    if (!existing) {
      return false;
    }

    db.run('DELETE FROM series WHERE id = ?', [id]);
    return true;
  } catch (error) {
    console.error('[Series] Failed to delete series:', error);
    throw new Error(`Failed to delete series: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Add a team to a series
 */
export async function addTeamToSeries(
  seriesId: string,
  data: {
    teamId: string;
    seasonYear: number;
    league: string | null;
    division: string | null;
  }
): Promise<void> {
  try {
    // First check if the series exists
    const existing = await getSeries(seriesId);
    if (!existing) {
      throw new Error(`Series with id '${seriesId}' not found`);
    }

    const db = await getGameDatabase();

    db.run(
      `INSERT OR REPLACE INTO series_teams (series_id, team_id, season_year, league, division)
       VALUES (?, ?, ?, ?, ?)`,
      [seriesId, data.teamId, data.seasonYear, data.league, data.division]
    );
  } catch (error) {
    console.error('[Series] Failed to add team to series:', error);
    throw new Error(`Failed to add team to series: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get all teams in a series
 */
export async function getSeriesTeams(seriesId: string): Promise<SeriesTeam[]> {
  try {
    const db = await getGameDatabase();

    const stmt = db.prepare('SELECT * FROM series_teams WHERE series_id = ? ORDER BY team_id');
    stmt.bind([seriesId]);

    const teams: SeriesTeam[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as any;
      teams.push({
        seriesId: row.series_id,
        teamId: row.team_id,
        seasonYear: row.season_year,
        league: row.league,
        division: row.division
      });
    }

    stmt.free();
    return teams;
  } catch (error) {
    console.error('[Series] Failed to get series teams:', error);
    throw new Error(`Failed to get series teams: ${error instanceof Error ? error.message : String(error)}`);
  }
}
