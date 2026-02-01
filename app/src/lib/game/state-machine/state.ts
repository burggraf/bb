/**
 * Baseball game state machine - state types and utilities
 * Models all 24 possible game states (0/1/2 outs × 8 base configurations)
 */

/**
 * Base configuration as a 3-bit bitmap for efficient representation
 * bit 0 = 1B, bit 1 = 2B, bit 2 = 3B
 */
export type BaseConfig = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const BaseConfigNames: Record<BaseConfig, string> = {
	0: 'empty',
	1: '1B',
	2: '2B',
	3: '1B&2B',
	4: '3B',
	5: '1B&3B',
	6: '2B&3B',
	7: 'loaded',
};

/**
 * Full game state for baserunning transitions
 * Note: This is a subset of the full GameState in types.ts,
 * focused only on the aspects needed for state transitions.
 */
export interface BaserunningState {
	outs: 0 | 1 | 2 | 3;  // 3 signals inning end (handled by engine)
	bases: BaseConfig;
	runners: {
		first: string | null; // player ID
		second: string | null;
		third: string | null;
	};
}

/**
 * Individual baserunning event for tracking runner movement
 */
export interface BaserunningEvent {
	runnerId: string;
	from: 'bench' | 'first' | 'second' | 'third' | 'home';
	to: 'first' | 'second' | 'third' | 'home' | 'dugout';
}

/**
 * Convert BaseConfig bitmap to runners object
 */
export function baseConfigToRunners(
	config: BaseConfig,
	existing: BaserunningState['runners']
): BaserunningState['runners'] {
	return {
		first: config & 1 ? existing.first : null,
		second: config & 2 ? existing.second : null,
		third: config & 4 ? existing.third : null,
	};
}

/**
 * Convert runners object to BaseConfig bitmap
 */
export function runnersToBaseConfig(runners: BaserunningState['runners']): BaseConfig {
	let config = 0;
	if (runners.first) config |= 1;
	if (runners.second) config |= 2;
	if (runners.third) config |= 4;
	return config as BaseConfig;
}

/**
 * Get runner ID at a specific base
 */
export function getRunnerAtBase(
	state: BaserunningState,
	base: 'first' | 'second' | 'third'
): string | null {
	return state.runners[base];
}

/**
 * Set runner at a specific base
 */
export function setRunnerAtBase(
	state: BaserunningState,
	base: 'first' | 'second' | 'third',
	runnerId: string | null
): void {
	state.runners[base] = runnerId;
	state.bases = runnersToBaseConfig(state.runners);
}

/**
 * Clear all runners (end of inning)
 */
export function clearRunners(state: BaserunningState): void {
	state.runners = { first: null, second: null, third: null };
	state.bases = 0;
}

/**
 * Create a baserunning state from the full game state
 */
export function createBaserunningState(
	outs: number,
	bases: [string | null, string | null, string | null]
): BaserunningState {
	const runners = {
		first: bases[0],
		second: bases[1],
		third: bases[2],
	};
	return {
		outs: Math.min(outs, 3) as 0 | 1 | 2 | 3,
		bases: runnersToBaseConfig(runners),
		runners,
	};
}

/**
 * Check if a specific base is occupied
 */
export function isBaseOccupied(state: BaserunningState, base: 'first' | 'second' | 'third'): boolean {
	return state.runners[base] !== null;
}

/**
 * Check if bases are loaded
 */
export function isBasesLoaded(state: BaserunningState): boolean {
	return state.bases === 7;
}

/**
 * Check if bases are empty
 */
export function isBasesEmpty(state: BaserunningState): boolean {
	return state.bases === 0;
}

/**
 * Count runners on base
 */
export function countRunners(state: BaserunningState): number {
	let count = 0;
	if (state.runners.first) count++;
	if (state.runners.second) count++;
	if (state.runners.third) count++;
	return count;
}
