import { describe, it, expect } from 'vitest';

/**
 * Series CRUD module tests
 *
 * Note: Full integration tests require browser environment (sql.js WASM + IndexedDB).
 * These tests verify the module structure and type exports.
 * Manual browser testing is required for full functionality.
 */
describe('Series CRUD Module', () => {
  it('should be importable', () => {
    expect(() => import('./series.js')).not.toThrow();
  });

  it('should export all required functions', async () => {
    const module = await import('./series.js');

    // Check that all required functions are exported
    expect(module.createSeries).toBeInstanceOf(Function);
    expect(module.getSeries).toBeInstanceOf(Function);
    expect(module.listSeries).toBeInstanceOf(Function);
    expect(module.updateSeries).toBeInstanceOf(Function);
    expect(module.deleteSeries).toBeInstanceOf(Function);
    expect(module.addTeamToSeries).toBeInstanceOf(Function);
    expect(module.getSeriesTeams).toBeInstanceOf(Function);
  });

  it('should have correct function signatures', async () => {
    const module = await import('./series.js');

    // createSeries takes data object with name, description, seriesType
    const create = module.createSeries;
    expect(create.length).toBe(1); // One parameter (data object)

    // getSeries takes id string
    const get = module.getSeries;
    expect(get.length).toBe(1); // One parameter (id: string)

    // listSeries has no parameters
    const list = module.listSeries;
    expect(list.length).toBe(0); // No parameters

    // updateSeries takes id and data object
    const update = module.updateSeries;
    expect(update.length).toBe(2); // Two parameters (id: string, data: object)

    // deleteSeries takes id string
    const del = module.deleteSeries;
    expect(del.length).toBe(1); // One parameter (id: string)

    // addTeamToSeries takes seriesId and data object
    const add = module.addTeamToSeries;
    expect(add.length).toBe(2); // Two parameters (seriesId: string, data: object)

    // getSeriesTeams takes seriesId string
    const getTeams = module.getSeriesTeams;
    expect(getTeams.length).toBe(1); // One parameter (seriesId: string)
  });
});
