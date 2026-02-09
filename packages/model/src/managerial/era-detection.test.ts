// era-detection.test.ts
import { describe, it, expect } from 'vitest';
import { getEraStrategy } from './era-detection.js';

describe('getEraStrategy', () => {
	it('returns traditional for pre-1980 (e.g., 1950)', () => {
		const result = getEraStrategy(1950);
		expect(result.primary).toBe('traditional');
		expect(result.secondary).toBeNull();
		expect(result.blendFactor).toBe(1);
	});

	it('returns modern for post-2010 (e.g., 2020)', () => {
		const result = getEraStrategy(2020);
		expect(result.primary).toBe('modern');
		expect(result.secondary).toBeNull();
		expect(result.blendFactor).toBe(1);
	});

	it('returns composite with traditional blend for 1985 (blendFactor ~0.5)', () => {
		const result = getEraStrategy(1985);
		expect(result.primary).toBe('composite');
		expect(result.secondary).toBe('traditional');
		expect(result.blendFactor).toBeCloseTo(0.5, 1);
	});

	it('returns early-analytics with composite blend for 1995 (blendFactor ~0.5)', () => {
		const result = getEraStrategy(1995);
		expect(result.primary).toBe('early-analytics');
		expect(result.secondary).toBe('composite');
		expect(result.blendFactor).toBeCloseTo(0.5, 1);
	});

	it('returns modern with early-analytics blend for 2005 (blendFactor ~0.5)', () => {
		const result = getEraStrategy(2005);
		expect(result.primary).toBe('modern');
		expect(result.secondary).toBe('early-analytics');
		expect(result.blendFactor).toBeCloseTo(0.5, 1);
	});

	it('blends correctly at transition boundaries (1980 = blendFactor 0)', () => {
		const result = getEraStrategy(1980);
		expect(result.primary).toBe('composite');
		expect(result.secondary).toBe('traditional');
		expect(result.blendFactor).toBe(0);
	});

	it('blends correctly at transition boundaries (1990 = blendFactor 0)', () => {
		const result = getEraStrategy(1990);
		expect(result.primary).toBe('early-analytics');
		expect(result.secondary).toBe('composite');
		expect(result.blendFactor).toBe(0);
	});

	it('blends correctly at transition boundaries (2000 = blendFactor 0)', () => {
		const result = getEraStrategy(2000);
		expect(result.primary).toBe('modern');
		expect(result.secondary).toBe('early-analytics');
		expect(result.blendFactor).toBe(0);
	});

	it('handles edge case at 1979 (last traditional year)', () => {
		const result = getEraStrategy(1979);
		expect(result.primary).toBe('traditional');
		expect(result.secondary).toBeNull();
		expect(result.blendFactor).toBe(1);
	});

	it('handles edge case at 2011 (first modern year)', () => {
		const result = getEraStrategy(2011);
		expect(result.primary).toBe('modern');
		expect(result.secondary).toBeNull();
		expect(result.blendFactor).toBe(1);
	});

	it('handles early baseball (e.g., 1920)', () => {
		const result = getEraStrategy(1920);
		expect(result.primary).toBe('traditional');
		expect(result.secondary).toBeNull();
		expect(result.blendFactor).toBe(1);
	});

	it('handles end of first transition window (1990 = blendFactor 1 for composite, switching to early-analytics)', () => {
		const result = getEraStrategy(1990);
		expect(result.primary).toBe('early-analytics');
		expect(result.secondary).toBe('composite');
		expect(result.blendFactor).toBe(0);
	});

	it('handles mid-transition years correctly', () => {
		// 1982 should be 0.2 blend
		const result1982 = getEraStrategy(1982);
		expect(result1982.blendFactor).toBeCloseTo(0.2, 1);

		// 1997 should be 0.7 blend
		const result1997 = getEraStrategy(1997);
		expect(result1997.blendFactor).toBeCloseTo(0.7, 1);

		// 2003 should be 0.3 blend
		const result2003 = getEraStrategy(2003);
		expect(result2003.blendFactor).toBeCloseTo(0.3, 1);
	});
});
