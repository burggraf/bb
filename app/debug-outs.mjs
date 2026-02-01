// Debug script to trace wouldBeThirdOut
import { GameEngine } from './src/lib/game/engine.ts';
import seasonData from './static/seasons/1976.json' with { type: 'json' };

const engine = new GameEngine(seasonData, 'CIN', 'HOU');

let playCount = 0;
console.log('=== SIMULATING TOP 1ST ===\n');

while (engine.getState().isTopInning && playCount < 15) {
  const stateBefore = engine.getState();
  const outsBefore = stateBefore.outs;

  const play = engine.simulatePlateAppearance();
  const stateAfter = engine.getState();
  const outsAfter = stateAfter.outs;

  playCount++;

  const isSummary = play.isSummary;
  const inningChanged = !stateAfter.isTopInning;

  console.log(`Play ${playCount}: ${play.description.substring(0, 40)}...`);
  console.log(`  Outs: ${outsBefore} → ${outsAfter}`);
  console.log(`  Is Summary: ${isSummary ? 'YES' : 'NO'}`);
  console.log(`  Inning: ${stateAfter.inning}, Top: ${stateAfter.isTopInning}`);
  console.log(`  Play.isTopInning: ${play.isTopInning}`);
  console.log(`  Inning changed: ${inningChanged ? 'YES' : 'NO'}`);
  console.log('');

  if (inningChanged) {
    console.log('--- INNING CHANGED ---');
    break;
  }
}

console.log(`\n=== FINAL STATE ===`);
console.log(`Total plays: ${playCount}`);
console.log(`Final outs: ${engine.getState().outs}`);
console.log(`Final inning: ${engine.getState().inning}, Top: ${engine.getState().isTopInning}`);
