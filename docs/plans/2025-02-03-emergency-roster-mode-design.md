# Emergency Roster Mode Design

## Problem

When teams exhaust their available bench players during lineup adjustments (e.g., after pinch hitting substitutions), the validation system correctly detects that players are being placed at positions they're not rated for. However, this is a legitimate edge case that should be allowed - when rosters are exhausted, players must stay in the game at whatever positions are available, even if they're not rated for those positions.

## Solution

Two-part approach:
1. **Preventative:** Don't make substitutions (pinch hitters, pitching changes) when no replacements are available
2. **Fallback:** If a team still ends up with an exhausted roster, allow position eligibility bypass in validation

## Changes

### 1. Lineup Validator (`app/src/lib/game/lineup-validator.ts`)

Add an options parameter to `validateLineup()`:

```typescript
export interface ValidateLineupOptions {
  /** Allow players at positions they're not rated for (emergency roster exhaustion) */
  allowEmergencyPositions?: boolean;
}

export function validateLineup(
  lineupSlots: Array<{ playerId: string | null; position: number }>,
  batters: Record<string, BatterStats>,
  options?: ValidateLineupOptions
): LineupValidationResult
```

When `allowEmergencyPositions` is true, skip the position eligibility check at lines 132-137. All other validations remain enforced:
- No null players in any slot
- No duplicate players in lineup
- Position 1 must be a pitcher
- No duplicate positions (e.g., two players at 2B)

### 2. Game Engine (`app/src/lib/game/engine.ts`)

**Track emergency mode per team:**
```typescript
private emergencyRosterMode = new Map<string, boolean>(); // teamId -> emergency mode
```

**Set emergency mode** in `auditLineupAtHalfInningEnd()` when bench players cannot be found to fill open positions (after the `!found` cases at lines 798, 896, 1025).

**Use emergency mode** when validating:
```typescript
const finalValidation = this.validateCurrentLineup(lineup, {
  allowEmergencyPositions: this.emergencyRosterMode.get(teamId) ?? false
});
```

Apply to both:
- Line 1034: After PH resolution validation
- Line 1265: Before allowing pitching changes

**Persistence:** Emergency mode persists for the remainder of the game once set. No reset between innings.

## Behavior

- **Preventative:**
  - Don't pinch hit when only 9 players remain (no bench available)
  - Don't substitute pitchers when no relief pitchers available
- **Emergency mode:** Players can be placed at any position (except position 1 which still requires a pitcher), but all other rules still apply
- **Pitching changes:** Can proceed in emergency mode even if the new pitcher isn't rated for a field position in double-switch scenarios
