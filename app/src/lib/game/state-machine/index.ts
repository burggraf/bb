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
export { handleLineOut } from './rules/line-out.js';
export { handlePopOut } from './rules/pop-out.js';
export { handleSacrificeFly } from './rules/sacrifice-fly.js';
export { handleSacrificeBunt } from './rules/sacrifice-bunt.js';
export { handleFieldersChoice } from './rules/fielders-choice.js';
export { handleReachedOnError } from './rules/reached-on-error.js';
export { handleCatcherInterference } from './rules/interference.js';

// Export outcome type helpers
export {
	HIT_OUTCOMES,
	REACH_BASE_OUTCOMES,
	OUT_OUTCOMES,
	BALL_IN_PLAY_OUTS,
	SACRIFICE_OUTCOMES,
	isHit,
	isOut,
	isBallInPlayOut,
	batterReachesBase,
	isSacrifice,
} from './outcome-types.js';
