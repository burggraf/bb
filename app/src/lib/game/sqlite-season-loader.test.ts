import { describe, it, expect, afterEach } from 'vitest';
import { clearSeasonCache } from './sqlite-season-loader.js';

describe('sqlite-season-loader', () => {
  afterEach(() => {
    clearSeasonCache();
  });

  it('should be importable', () => {
    expect(() => import('./sqlite-season-loader.js')).not.toThrow();
  });
});
