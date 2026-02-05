import { describe, it, expect } from 'vitest';

/**
 * Database module tests
 *
 * Note: Full integration tests require browser environment (sql.js WASM + IndexedDB).
 * These tests verify the module structure and type exports.
 * Manual browser testing is required for full functionality.
 */
describe('Game Results Database', () => {
  it('should be importable', () => {
    expect(() => import('./database.js')).not.toThrow();
  });

  it('should export all required functions', async () => {
    const module = await import('./database.js');

    // Check that all required functions are exported
    expect(module.getGameDatabase).toBeInstanceOf(Function);
    expect(module.closeGameDatabase).toBeInstanceOf(Function);
    expect(module.exportGameDatabase).toBeInstanceOf(Function);
    expect(module.importGameDatabase).toBeInstanceOf(Function);
    expect(module.clearGameDatabase).toBeInstanceOf(Function);
  });

  it('should have correct function signatures', async () => {
    const module = await import('./database.js');

    // getGameDatabase returns Promise<Database>
    const getGameDb = module.getGameDatabase;
    expect(getGameDb.length).toBe(0); // No parameters

    // closeGameDatabase returns Promise<void>
    const closeDb = module.closeGameDatabase;
    expect(closeDb.length).toBe(0); // No parameters

    // exportGameDatabase returns Promise<Blob>
    const exportDb = module.exportGameDatabase;
    expect(exportDb.length).toBe(0); // No parameters

    // importGameDatabase takes File parameter
    const importDb = module.importGameDatabase;
    expect(importDb.length).toBe(1); // One parameter (file: File)

    // clearGameDatabase returns Promise<void>
    const clearDb = module.clearGameDatabase;
    expect(clearDb.length).toBe(0); // No parameters
  });
});
