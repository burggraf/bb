/**
 * Export and import functions for game results database
 * Handles browser downloads and file imports
 */

import { exportGameDatabase as exportDb, importGameDatabase as importDb, getGameDatabase } from './database.js';

/**
 * Default filename for exported database
 */
const DEFAULT_FILENAME = 'bb-game-results.sqlite';

/**
 * Generate a timestamped filename
 *
 * @param baseName - Base filename (without extension)
 * @returns Filename with timestamp
 */
function generateTimestampedFilename(baseName: string = DEFAULT_FILENAME): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const extension = baseName.includes('.') ? baseName.split('.').pop() : 'sqlite';
  const name = baseName.includes('.') ? baseName.split('.').slice(0, -1).join('.') : baseName;
  return `${name}-${timestamp}.${extension}`;
}

/**
 * Trigger browser download of the game database
 *
 * Creates a download link and triggers it to save the database as a .sqlite file
 *
 * @param filename - Optional filename (default: timestamped bb-game-results.sqlite)
 * @returns Promise<void> Resolves when download is triggered
 *
 * @example
 * ```ts
 * // Download with default filename
 * await downloadGameDatabase();
 *
 * // Download with custom filename
 * await downloadGameDatabase('my-season.sqlite');
 * ```
 */
export async function downloadGameDatabase(filename?: string): Promise<void> {
  const blob = await exportDb();
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename || generateTimestampedFilename();
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
  console.log('[GameResults] Database download triggered:', link.download);
}

/**
 * Import a game database from a file
 *
 * Reads the file and imports it into the application, replacing the current database
 *
 * @param file - File object containing .sqlite database
 * @returns Promise<void> Resolves when import is complete
 * @throws Error if file is invalid or database is malformed
 *
 * @example
 * ```ts
 * // From file input
 * const fileInput = document.getElementById('file-input') as HTMLInputElement;
 * const file = fileInput.files?.[0];
 * if (file) {
 *   await importGameDatabase(file);
 * }
 * ```
 */
export async function importGameDatabase(file: File): Promise<void> {
  // Validate file type
  if (!file.name.endsWith('.sqlite') && !file.name.endsWith('.db')) {
    throw new Error('Invalid file type: must be .sqlite or .db file');
  }

  // Validate file size (warn if > 50MB)
  const MAX_RECOMMENDED_SIZE = 50 * 1024 * 1024; // 50MB
  if (file.size > MAX_RECOMMENDED_SIZE) {
    console.warn(
      `[GameResults] Large file detected: ${(file.size / 1024 / 1024).toFixed(2)}MB. Import may take a while.`
    );
  }

  await importDb(file);
  console.log('[GameResults] Database imported successfully:', file.name);
}

/**
 * Get information about the current game database size
 *
 * Returns size metrics for the in-memory database and estimates storage size
 *
 * @returns Promise with size information in bytes
 *
 * @example
 * ```ts
 * const sizeInfo = await getGameDatabaseSize();
 * console.log(`Database: ${(sizeInfo.totalBytes / 1024).toFixed(2)} KB`);
 * console.log(`Approximate rows: ${sizeInfo.estimatedRows}`);
 * ```
 */
export async function getGameDatabaseSize(): Promise<{
  totalBytes: number;
  formattedSize: string;
  estimatedGames: number;
  estimatedEvents: number;
}> {
  const db = await getGameDatabase();
  const data = db.export();
  const totalBytes = data.length;

  // Format as human-readable string
  const formattedSize =
    totalBytes < 1024
      ? `${totalBytes} B`
      : totalBytes < 1024 * 1024
        ? `${(totalBytes / 1024).toFixed(2)} KB`
        : `${(totalBytes / 1024 / 1024).toFixed(2)} MB`;

  // Get row counts for estimation
  const gamesResult = db.exec('SELECT COUNT(*) as count FROM games');
  const eventsResult = db.exec('SELECT COUNT(*) as count FROM game_events');

  const estimatedGames = gamesResult[0]?.values[0][0] as number || 0;
  const estimatedEvents = eventsResult[0]?.values[0][0] as number || 0;

  return {
    totalBytes,
    formattedSize,
    estimatedGames,
    estimatedEvents
  };
}

/**
 * Validate a file before importing
 *
 * Checks file type and size without reading the entire file
 *
 * @param file - File to validate
 * @returns Object with isValid flag and error message if invalid
 *
 * @example
 * ```ts
 * const validation = validateDatabaseFile(file);
 * if (!validation.isValid) {
 *   console.error(validation.error);
 * }
 * ```
 */
export function validateDatabaseFile(file: File): {
  isValid: boolean;
  error?: string;
} {
  // Check file extension
  if (!file.name.endsWith('.sqlite') && !file.name.endsWith('.db')) {
    return {
      isValid: false,
      error: 'Invalid file type: must be .sqlite or .db file'
    };
  }

  // Check file size (warn if > 100MB)
  const MAX_SIZE = 100 * 1024 * 1024; // 100MB
  if (file.size > MAX_SIZE) {
    return {
      isValid: false,
      error: `File too large: ${(file.size / 1024 / 1024).toFixed(2)}MB exceeds 100MB limit`
    };
  }

  // Check if file is empty
  if (file.size === 0) {
    return {
      isValid: false,
      error: 'File is empty'
    };
  }

  return { isValid: true };
}
