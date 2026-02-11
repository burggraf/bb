# Fix Log - Engine Scout

## Task: Investigate and fix bugs in `app/src/lib/game`

### 1. Bug Investigation
Found 9 bugs across engine, lineup builder, and state machine:
- Logic error in `engine.ts` emergency PH resolution.
- Broken `randomness` logic in `lineup-builder.ts`.
- Dead code in `lineup-builder.ts`.
- Redundant helper functions (`formatName`, `getPositionName`).
- Incorrect run wiping on 3rd out in `transitions.ts`.
- Lenient eligibility rules too restrictive for skill infielders.

### 2. Fixes Applied
- **Lineup Builder**: Fixed randomness by shuffling array elements instead of just properties. Removed dead functions. Improved starting pitcher selection using quality scores.
- **Engine**: Fixed `positionOccupied === undefined` check. Cleaned up redundant helpers by moving them to module level.
- **State Machine**: Reverted unconditional run wiping on 3rd out.
- **Validation**: Added `isSkillInfield` interchangeable eligibility for 2B/3B/SS.

### 3. Verification
- Ran `pnpm -C app test`.
- Fixed test failures in `engine.test.ts` related to game completion logic and history tracking.
- Fixed test failures in `lineup-validator.test.ts` related to name reporting.
- All 85 unit tests passed.

### 4. Integration
- Committed changes: `ae47186`.
- Pushed to `pi-teams/42334e0c-9bf/engine-scout`.
- Created PR #11.
- Merged PR #11 to `main`.
