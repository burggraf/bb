#!/usr/bin/env tsx
/**
 * Test the resolveDuplicatePositions function to verify it fills position holes
 */

import { GameEngine } from './src/lib/game/engine.js';
import { loadSeason } from './src/lib/game/sqlite-season-loader.js';

async function testLineupHoles() {
  console.log('=== Testing Lineup Hole Filling ===\n');

  // Load season
  const season = await loadSeason(1976);

  // Create a game with teams that have position issues
  const teams = Object.keys(season.teams).slice(0, 2);
  const [awayTeam, homeTeam] = teams;

  console.log(`Teams: ${awayTeam} vs ${homeTeam}`);

  const engine = new GameEngine({
    awayTeam,
    homeTeam,
    season,
    awayLineup: null,
    homeLineup: null,
  });

  // Build initial lineups
  engine.buildLineups();

  console.log('\nInitial lineups built successfully');

  // Simulate a few plays to get the game started
  for (let i = 0; i < 10; i++) {
    if (!engine.isComplete()) {
      engine.simulatePlateAppearance();
    }
  }

  console.log('Simulated 10 plays\n');

  // Get current lineups
  const awayLineup = engine.getAwayLineup();
  const homeLineup = engine.getHomeLineup();

  console.log('Away lineup players:', awayLineup.players.length);
  console.log('Home lineup players:', homeLineup.players.length);

  // Check for position 11 (PH) which shouldn't exist after game starts
  const awayPH = awayLineup.players.filter(p => p.position === 11);
  const homePH = homeLineup.players.filter(p => p.position === 11);

  console.log('\nPosition 11 (PH) slots after game start:');
  console.log(`  Away: ${awayPH.length}`);
  console.log(`  Home: ${homePH.length}`);

  if (awayPH.length > 0 || homePH.length > 0) {
    console.log('✗ FAIL: Position 11 slots found after game start');
  } else {
    console.log('✓ PASS: No position 11 slots after game start');
  }

  // Check for null playerIds
  const awayNulls = awayLineup.players.filter(p => !p.playerId);
  const homeNulls = homeLineup.players.filter(p => !p.playerId);

  console.log('\nNull playerId slots:');
  console.log(`  Away: ${awayNulls.length}`);
  console.log(`  Home: ${homeNulls.length}`);

  if (awayNulls.length > 0 || homeNulls.length > 0) {
    console.log('✗ FAIL: Null playerIds found in lineup');
  } else {
    console.log('✓ PASS: No null playerIds in lineup');
  }

  // Check position coverage (positions 1-9 should each have exactly one player)
  const awayPositions = new Map<number, number>();
  const homePositions = new Map<number, number>();

  for (const p of awayLineup.players) {
    if (p.position >= 1 && p.position <= 9) {
      awayPositions.set(p.position, (awayPositions.get(p.position) || 0) + 1);
    }
  }

  for (const p of homeLineup.players) {
    if (p.position >= 1 && p.position <= 9) {
      homePositions.set(p.position, (homePositions.get(p.position) || 0) + 1);
    }
  }

  console.log('\nPosition coverage (1-9):');
  console.log('  Away:', Array.from(awayPositions.entries()).map(([pos, count]) => `${pos}:${count}`).join(', '));
  console.log('  Home:', Array.from(homePositions.entries()).map(([pos, count]) => `${pos}:${count}`).join(', '));

  // Check for holes (positions with 0 players)
  const awayHoles = [];
  const homeHoles = [];

  for (let pos = 1; pos <= 9; pos++) {
    if (!awayPositions.has(pos)) awayHoles.push(pos);
    if (!homePositions.has(pos)) homeHoles.push(pos);
  }

  if (awayHoles.length > 0 || homeHoles.length > 0) {
    console.log(`\n✗ FAIL: Position holes found!`);
    if (awayHoles.length > 0) console.log(`  Away holes: ${awayHoles.join(', ')}`);
    if (homeHoles.length > 0) console.log(`  Home holes: ${homeHoles.join(', ')}`);
  } else {
    console.log('\n✓ PASS: All positions 1-9 covered');
  }

  console.log('\n=== Test Complete ===');
}

testLineupHoles().catch(console.error);
