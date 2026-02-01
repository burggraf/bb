/**
 * Baseball game state machine
 *
 * Models all 24 possible game states (0/1/2 outs × 8 base configurations)
 * and defines valid state transitions for each outcome type.
 */

// Export core types
export type {
	BaseConfig,
	BaserunningState,
	BaserunningEvent,
} from './state.js';

// Export utilities
export {
	BaseConfigNames,
	baseConfigToRunners,
	runnersToBaseConfig,
	getRunnerAtBase,
	setRunnerAtBase,
	clearRunners,
	createBaserunningState,
	isBaseOccupied,
	isBasesLoaded,
	isBasesEmpty,
	countRunners,
} from './state.js';

// Export transition types
export type { TransitionResult } from './transitions.js';

// Export main transition function
export { transition, recordAdvancement, advanceRunner, scoreRunner } from './transitions.js';

// Export rule handlers (for testing)
export { handleGroundOut } from './rules/ground-out.js';
export { handleWalkOrHBP } from './rules/walk.js';
export { handleHit } from './rules/hit.js';
export { handleStrikeout } from './rules/strikeout.js';
export { handleFlyOut } from './rules/fly-out.js';
