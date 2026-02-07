/**
 * Game results database initialization and IndexedDB storage
 * Handles sql.js database lifecycle for persistent game results storage
 */

import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { createGameResultsSchema, migrateSeriesMetadata } from './schema.js';

// Global SQL.js instance
let SQL: SqlJsStatic | null = null;

// In-memory database cache
let gameDb: Database | null = null;

// IndexedDB database name
const GAME_RESULTS_DB_NAME = 'bb-game-results';
const GAME_RESULTS_STORE_NAME = 'database';

/**
 * Initialize SQL.js
 */
async function initializeSQLJS(): Promise<void> {
  if (SQL) return;

  console.log('[GameResultsDB] Initializing sql.js...');
  SQL = await initSqlJs({
    locateFile: (file: string) => `https://sql.js.org/dist/${file}`
  });
  if (!SQL) {
    throw new Error('[GameResultsDB] Failed to initialize sql.js');
  }
  console.log('[GameResultsDB] sql.js initialized');
}

/**
 * Open IndexedDB for game results storage
 */
function openIndexedDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(GAME_RESULTS_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(GAME_RESULTS_STORE_NAME)) {
        db.createObjectStore(GAME_RESULTS_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Load database bytes from IndexedDB
 */
async function loadDatabaseBytes(): Promise<Uint8Array | null> {
  const db = await openIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GAME_RESULTS_STORE_NAME, 'readonly');
    const store = tx.objectStore(GAME_RESULTS_STORE_NAME);
    const request = store.get('game-results');

    request.onsuccess = () => {
      db.close();
      resolve(request.result || null);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

/**
 * Save database bytes to IndexedDB
 */
async function saveDatabaseBytes(data: Uint8Array): Promise<void> {
  const db = await openIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GAME_RESULTS_STORE_NAME, 'readwrite');
    const store = tx.objectStore(GAME_RESULTS_STORE_NAME);
    store.put(data, 'game-results');

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/**
 * Get or create the game results database
 *
 * Lazily initializes the database:
 * 1. First call: Creates new in-memory database with schema
 * 2. Subsequent calls: Returns cached instance
 *
 * @returns Promise<Database> sql.js Database instance
 */
export async function getGameDatabase(): Promise<Database> {
  if (gameDb) {
    return gameDb;
  }

  await initializeSQLJS();

  // Try to load from IndexedDB
  const savedData = await loadDatabaseBytes();

  if (savedData) {
    console.log('[GameResultsDB] Loading existing database from IndexedDB');
    gameDb = new SQL!.Database(savedData);
    // Run migrations on existing databases
    migrateSeriesMetadata(gameDb);
  } else {
    console.log('[GameResultsDB] Creating new game results database');
    gameDb = new SQL!.Database();
    createGameResultsSchema(gameDb);
    // Save initial empty database
    await saveDatabaseBytes(gameDb.export());
  }

  return gameDb;
}

/**
 * Close the game database and save to IndexedDB
 *
 * Call this before page unload to persist changes
 */
export async function closeGameDatabase(): Promise<void> {
  if (!gameDb) return;

  console.log('[GameResultsDB] Saving database to IndexedDB...');
  const data = gameDb.export();
  await saveDatabaseBytes(data);

  gameDb.close();
  gameDb = null;
  console.log('[GameResultsDB] Database saved and closed');
}

/**
 * Save the game database to IndexedDB without closing it
 *
 * Call this after important updates to ensure they're persisted
 */
export async function saveGameDatabase(): Promise<void> {
  if (!gameDb) return;

  console.log('[GameResultsDB] Saving database to IndexedDB (without closing)...');
  const data = gameDb.export();
  await saveDatabaseBytes(data);
  console.log('[GameResultsDB] Database saved to IndexedDB');
}

/**
 * Export the game database as a downloadable Blob
 *
 * Returns a .sqlite file that can be opened in external tools
 *
 * @returns Promise<Blob> SQLite database as blob
 */
export async function exportGameDatabase(): Promise<Blob> {
  const db = await getGameDatabase();
  const data = db.export();
  return new Blob([data as BlobPart], { type: 'application/x-sqlite3' });
}

/**
 * Import a game database from a file
 *
 * Replaces the current database with the imported one
 *
 * @param file - File object containing .sqlite database
 */
export async function importGameDatabase(file: File): Promise<void> {
  await initializeSQLJS();

  const buffer = await file.arrayBuffer();
  const data = new Uint8Array(buffer);

  // Close current database
  if (gameDb) {
    gameDb.close();
    gameDb = null;
  }

  // Load imported database
  gameDb = new SQL!.Database(data);

  // Verify it's a valid game results database
  const tables = gameDb.exec("SELECT name FROM sqlite_master WHERE type='table'");
  const tableNames = new Set(tables[0]?.values.map((row: any[]) => row[0]) || []);

  if (!tableNames.has('series') || !tableNames.has('games')) {
    throw new Error('Invalid game results database: missing required tables');
  }

  // Save to IndexedDB
  await saveDatabaseBytes(data);

  console.log('[GameResultsDB] Imported game results database');
}

/**
 * Clear all game results data
 *
 * Deletes the database from memory and IndexedDB
 */
export async function clearGameDatabase(): Promise<void> {
  // Close database
  if (gameDb) {
    gameDb.close();
    gameDb = null;
  }

  // Delete IndexedDB
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(GAME_RESULTS_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  console.log('[GameResultsDB] Cleared game results database');
}

// Auto-save before page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    closeGameDatabase().catch(console.error);
  });
}

// Expose to window for debugging
if (typeof window !== 'undefined') {
  (window as any).getGameDatabase = getGameDatabase;
  (window as any).closeGameDatabase = closeGameDatabase;
  (window as any).saveGameDatabase = saveGameDatabase;
  (window as any).exportGameDatabase = exportGameDatabase;
  (window as any).clearGameDatabase = clearGameDatabase;
}
