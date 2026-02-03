# Position Eligibility & Lineup Validation Design

**Date:** 2025-02-02
**Author:** Claude
**Status:** Approved

## Overview

Ensure that every player on the field is actually eligible to play their assigned position. Currently, players may be placed at positions they never played in real life. This design adds validation using the new `defensive_stats` table which includes games, innings, and outs_played for each player-position-season combination.

## Problem Statement

When creating lineups and making substitutions (pinch hits, double switches, pitching changes), the current system does not validate that:
1. Each player is eligible at their assigned position
2. No player appears twice in the field
3. The pitcher is always at position 1

This leads to unrealistic defensive arrangements where, for example, a catcher might be placed at shortstop.

## Design Approach

**Philosophy:** Keep the existing lineup building algorithm (it's already using position eligibility data) but add validation after every substitution to catch invalid states.

**Eligibility Threshold:** Any appearance counts - if a player has even 1 inning at a position in the defensive_stats table, they're eligible.

**Double Switch Behavior:** Traditional - new pitcher bats in the replaced pitcher's spot, PH bats in replaced position player's spot.

## Data Model Changes

### Update `data-prep/src/export-season.ts`

**Change the data source from `game_fielding_appearances` to `defensive_stats`:**

```sql
-- OLD query (game_fielding_appearances)
SELECT
  gfa.player_id,
  gfa.fielding_position,
  COUNT(*) AS appearances
FROM game.game_fielding_appearances gfa
JOIN game.games g ON gfa.game_id = g.game_id
WHERE EXTRACT(YEAR FROM g.date) = {year}
GROUP BY gfa.player_id, gfa.fielding_position
ORDER BY gfa.player_id, appearances DESC;

-- NEW query (defensive_stats)
SELECT
  ds.player_id,
  ds.fielding_position,
  SUM(ds.outs_played) AS outs_played
FROM defensive_stats ds
WHERE ds.season = {year}
GROUP BY ds.player_id, ds.fielding_position
ORDER BY ds.player_id, outs_played DESC;
```

**Output format remains the same:**
```typescript
positionEligibility: Record<number, number>  // position -> outs_played
```

No changes to `SeasonPackage` type - the structure already supports this.

## New Module: Lineup Validator

**File:** `app/src/lib/game/lineup-validator.ts`

```typescript
export interface LineupValidationResult {
  isValid: boolean;
  errors: string[];   // e.g., "Position 2 (C) has no eligible player"
  warnings: string[]; // e.g., "Player X at 3B but primary position is 1B"
}

export function validateLineup(
  lineupSlots: Array<{ playerId: string | null; position: number }>,
  batters: Record<string, BatterStats>
): LineupValidationResult
```

### Validation Rules

1. **Position Coverage:** All 9 positions (1-9) must have a non-null player ID
2. **Eligibility:** Each player must be eligible at their assigned position:
   - Check `player.positionEligibility[position]` exists and > 0
   - OR the position matches their `primaryPosition`
3. **Uniqueness:** No player can appear twice in the field
4. **Pitcher Rule:** Position 1 must always be a pitcher (`primaryPosition === 1`)

## Engine Substitution Updates

**File:** `app/src/lib/game/engine.ts`

### After Every Substitution

Call `validateLineup()` to check the result. If validation fails, apply fallback strategies.

### Fallback Strategy Hierarchy

1. **Try Alternative Position for Substitute**
   - If the PH can't play the position they're replacing, check their other eligible positions
   - Example: PH for C can't catch, but can play 1B → move them to 1B

2. **Choose Different Substitute**
   - If the proposed substitute creates conflicts, pick the next best option from the bench
   - Example: Best PH option can only play 1B, but 1B is occupied → try next-best PH

3. **Cascade Substitution (Limited)**
   - Move the displaced player to another position they're eligible for
   - Constraint: Limit to 1 level of cascading to avoid chain reactions

4. **Reject Substitution**
   - If no valid configuration exists, skip the substitution entirely
   - Log a warning: "Unable to pinch hit - no valid defensive arrangement"
   - **Never crash or throw** - always degrade gracefully

### Specific Changes

**Pitching Changes (around line 656):**
- After replacing pitcher in lineup slot, validate the lineup
- If invalid, try the next best reliever option

**Pinch Hitting for Position Players (around line 834):**
- Current `findDefensivePositionForPH()` doesn't check for conflicts
- Update: Validate full lineup after substitution
- Use `findValidSubstitution()` helper to find conflict-free position

**Double Switch (around line 767):**
- Already close to correct, but needs validation
- Ensure PH's defensive position doesn't create a conflict

### New Helper Function

```typescript
private findValidSubstitution(
  currentPlayerId: string,
  substitutionPlayerId: string,
  lineup: LineupState
): { position: number } | null
```

Finds a valid position for the substitute that doesn't create conflicts.

## Testing Strategy

### Unit Tests (`app/src/lib/game/lineup-validator.test.ts`)
- Test `validateLineup()` with various valid/invalid configurations
- Edge cases: null players, duplicate players, ineligible positions
- Test primary position fallback

### Integration Tests (`app/src/lib/game/engine.test.ts`)
- Mock a season with specific position eligibility data
- Test initial lineup creation is always valid
- Test each substitution type:
  - Pitching change (non-DH and DH games)
  - Pinch hit for position player
  - Double switch (PH for pitcher)
  - Edge case: Pinch hit when only 1 eligible sub exists

### Data Validation
- After rebuilding seasons, spot-check `positionEligibility` values
- Verify at least 8 position players per team have multi-position eligibility
- Check that pitchers have position 1 as their primary

## Implementation Steps

1. **Update data export** (`data-prep/src/export-season.ts`)
   - Change `getBatterPositionsSQL()` to query `defensive_stats`
   - Use `outs_played` as the eligibility metric

2. **Create validator module** (`app/src/lib/game/lineup-validator.ts`)
   - Implement `validateLineup()` with 4 validation rules
   - Export `LineupValidationResult` type

3. **Update engine** (`app/src/lib/game/engine.ts`)
   - Import and call `validateLineup()` after each substitution
   - Implement `findValidSubstitution()` helper
   - Update pinch hit logic to handle validation failures
   - Update double switch logic to ensure validity

4. **Rebuild all season data**
   - Run `pnpm exec tsx scripts/build-seasons-data.ts`
   - Verify output files are generated for all years

5. **Add tests**
   - Unit tests for `validateLineup()`
   - Integration tests for substitution scenarios

6. **Manual testing**
   - Play a full game, check lineup display shows correct positions
   - Verify substitutions produce valid lineups

## Breaking Changes

None. The data format stays the same, we just improve accuracy by using `outs_played` from `defensive_stats` instead of game counts from `game_fielding_appearances`.

## Performance Impact

Minimal. Validation is O(9) = O(1) per substitution. A typical game has 2-3 substitutions per team, so total validation cost is negligible.
