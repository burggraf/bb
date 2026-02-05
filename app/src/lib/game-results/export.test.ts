/**
 * Tests for export.ts - database export/import functions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { exportGameDatabase, importGameDatabase as importDb, getGameDatabase, clearGameDatabase } from './database.js';
import {
  downloadGameDatabase,
  importGameDatabase,
  getGameDatabaseSize,
  validateDatabaseFile
} from './export.js';

// Mock the database module
vi.mock('./database.js', () => ({
  exportGameDatabase: vi.fn(),
  importGameDatabase: vi.fn(),
  getGameDatabase: vi.fn(),
  clearGameDatabase: vi.fn()
}));

// Mock document methods for download
const mockCreateElement = vi.fn();
const mockAppendChild = vi.fn();
const mockRemoveChild = vi.fn();
const mockClick = vi.fn();
const mockRevokeObjectURL = vi.fn();

const originalDocument = global.document;

describe('export.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.document = {
      ...originalDocument,
      createElement: mockCreateElement,
      body: {
        appendChild: mockAppendChild,
        removeChild: mockRemoveChild
      }
    } as any;
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = mockRevokeObjectURL;
  });

  afterEach(() => {
    global.document = originalDocument;
  });

  describe('downloadGameDatabase', () => {
    it('should trigger download with default timestamped filename', async () => {
      const mockBlob = new Blob(['test data'], { type: 'application/x-sqlite3' });
      vi.mocked(exportGameDatabase).mockResolvedValue(mockBlob);

      mockCreateElement.mockReturnValue({
        href: '',
        download: '',
        click: mockClick
      });

      await downloadGameDatabase();

      expect(exportGameDatabase).toHaveBeenCalled();
      expect(mockCreateElement).toHaveBeenCalledWith('a');
      expect(mockClick).toHaveBeenCalled();
      expect(mockRevokeObjectURL).toHaveBeenCalled();
    });

    it('should trigger download with custom filename', async () => {
      const mockBlob = new Blob(['test data'], { type: 'application/x-sqlite3' });
      vi.mocked(exportGameDatabase).mockResolvedValue(mockBlob);

      mockCreateElement.mockReturnValue({
        href: '',
        download: '',
        click: mockClick
      });

      await downloadGameDatabase('my-season.sqlite');

      const link = mockCreateElement.mock.results[0].value;
      expect(link.download).toBe('my-season.sqlite');
    });

    it('should clean up DOM elements after download', async () => {
      const mockBlob = new Blob(['test data'], { type: 'application/x-sqlite3' });
      vi.mocked(exportGameDatabase).mockResolvedValue(mockBlob);

      mockCreateElement.mockReturnValue({
        href: '',
        download: '',
        click: mockClick
      });

      await downloadGameDatabase();

      expect(mockAppendChild).toHaveBeenCalled();
      expect(mockRemoveChild).toHaveBeenCalled();
    });
  });

  describe('importGameDatabase', () => {
    it('should import valid .sqlite file', async () => {
      const mockFile = new File(['test data'], 'game-results.sqlite', {
        type: 'application/x-sqlite3'
      });
      vi.mocked(importDb).mockResolvedValue(undefined);

      await expect(importGameDatabase(mockFile)).resolves.not.toThrow();
      expect(importDb).toHaveBeenCalledWith(mockFile);
    });

    it('should import valid .db file', async () => {
      const mockFile = new File(['test data'], 'game-results.db', {
        type: 'application/x-sqlite3'
      });
      vi.mocked(importDb).mockResolvedValue(undefined);

      await expect(importGameDatabase(mockFile)).resolves.not.toThrow();
    });

    it('should reject invalid file type', async () => {
      const mockFile = new File(['test data'], 'game-results.txt', {
        type: 'text/plain'
      });

      await expect(importGameDatabase(mockFile)).rejects.toThrow(
        'Invalid file type: must be .sqlite or .db file'
      );
    });

    it('should warn for large files', async () => {
      // Create a file that exceeds 50MB without actually allocating that much memory
      const mockFile = {
        name: 'large.sqlite',
        size: 60 * 1024 * 1024, // 60MB
        arrayBuffer: vi.fn(() => Promise.resolve(new ArrayBuffer(100)))
      } as unknown as File;

      vi.mocked(importDb).mockResolvedValue(undefined);

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(importGameDatabase(mockFile)).resolves.not.toThrow();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Large file detected')
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('getGameDatabaseSize', () => {
    it('should return size information', async () => {
      const mockDb = {
        export: vi.fn(() => new Uint8Array([1, 2, 3, 4, 5])),
        exec: vi.fn((query: string) => {
          if (query.includes('games')) {
            return [{ values: [[10]] }];
          }
          if (query.includes('game_events')) {
            return [{ values: [[500]] }];
          }
          return [];
        })
      };
      vi.mocked(getGameDatabase).mockResolvedValue(mockDb as any);

      const sizeInfo = await getGameDatabaseSize();

      expect(sizeInfo).toEqual({
        totalBytes: 5,
        formattedSize: '5 B',
        estimatedGames: 10,
        estimatedEvents: 500
      });
    });

    it('should format KB size correctly', async () => {
      const mockDb = {
        export: vi.fn(() => new Uint8Array(new Array(5 * 1024).fill(0))),
        exec: vi.fn(() => [{ values: [[0]] }])
      };
      vi.mocked(getGameDatabase).mockResolvedValue(mockDb as any);

      const sizeInfo = await getGameDatabaseSize();

      expect(sizeInfo.formattedSize).toBe('5.00 KB');
    });

    it('should format MB size correctly', async () => {
      const mockDb = {
        export: vi.fn(() => new Uint8Array(new Array(5 * 1024 * 1024).fill(0))),
        exec: vi.fn(() => [{ values: [[0]] }])
      };
      vi.mocked(getGameDatabase).mockResolvedValue(mockDb as any);

      const sizeInfo = await getGameDatabaseSize();

      expect(sizeInfo.formattedSize).toBe('5.00 MB');
    });

    it('should handle empty database', async () => {
      const mockDb = {
        export: vi.fn(() => new Uint8Array([])),
        exec: vi.fn(() => [])
      };
      vi.mocked(getGameDatabase).mockResolvedValue(mockDb as any);

      const sizeInfo = await getGameDatabaseSize();

      expect(sizeInfo.estimatedGames).toBe(0);
      expect(sizeInfo.estimatedEvents).toBe(0);
    });
  });

  describe('validateDatabaseFile', () => {
    it('should accept valid .sqlite file', () => {
      const file = new File(['data'], 'test.sqlite');
      const result = validateDatabaseFile(file);

      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should accept valid .db file', () => {
      const file = new File(['data'], 'test.db');
      const result = validateDatabaseFile(file);

      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject non-sqlite file', () => {
      const file = new File(['data'], 'test.txt');
      const result = validateDatabaseFile(file);

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Invalid file type: must be .sqlite or .db file');
    });

    it('should reject empty file', () => {
      const file = new File([], 'test.sqlite');
      const result = validateDatabaseFile(file);

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('File is empty');
    });

    it('should reject oversized file', () => {
      // Mock file with size without allocating memory
      const file = {
        name: 'test.sqlite',
        size: 101 * 1024 * 1024 // 101MB
      } as File;

      const result = validateDatabaseFile(file);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('File too large');
    });
  });

  describe('filename generation (internal)', () => {
    it('should generate timestamped filename with default', async () => {
      const mockBlob = new Blob(['test data'], { type: 'application/x-sqlite3' });
      vi.mocked(exportGameDatabase).mockResolvedValue(mockBlob);

      mockCreateElement.mockReturnValue({
        href: '',
        download: '',
        click: mockClick
      });

      await downloadGameDatabase();

      const link = mockCreateElement.mock.results[0].value;
      expect(link.download).toMatch(/^bb-game-results-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.sqlite$/);
    });
  });
});
