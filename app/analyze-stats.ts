import { GameEngine } from './src/lib/game/engine.js';
import { readFileSync } from 'fs';
import type { SeasonPackage } from './src/lib/game/types.js';

async function runAnalysis(year: number, numGames: number) {
  // Read season data directly from file
  const seasonPath = `./static/seasons/${year}.json`;
  const seasonData = readFileSync(seasonPath, 'utf-8');
  const season = JSON.parse(seasonData) as SeasonPackage;

  let totalPhAppearances = 0;
  let totalPitcherChanges = 0;
  const pitchersPerGame: number[] = [];

  for (let i = 0; i < numGames; i++) {
    const validTeams = Object.keys(season.teams).filter(teamId => {
      const hasBatters = Object.values(season.batters).some(b => b.teamId === teamId);
      const hasPitchers = Object.values(season.pitchers).some(p => p.teamId === teamId);
      return hasBatters && hasPitchers;
    });

    const awayTeam = validTeams[Math.floor(Math.random() * validTeams.length)];
    let homeTeam = validTeams[Math.floor(Math.random() * validTeams.length)];
    while (homeTeam === awayTeam) {
      homeTeam = validTeams[Math.floor(Math.random() * validTeams.length)];
    }

    const engine = new GameEngine(season, awayTeam, homeTeam);

    // Simulate full game
    while (!engine.isComplete()) {
      engine.simulatePlateAppearance();
    }

    // Count PH and pitching changes from final state
    const state = engine.getState();
    const pitchersUsed = new Set<string>();

    for (const play of state.plays) {
      // Track pitchers
      if (!play.isSummary) {
        pitchersUsed.add(play.pitcherId);
      }

      // Count PH appearances
      if (play.eventType === 'pinchHit') {
        totalPhAppearances++;
      }

      // Count pitching changes
      if (play.eventType === 'pitchingChange') {
        totalPitcherChanges++;
      }
    }

    pitchersPerGame.push(pitchersUsed.size);
  }

  const avgPitchersPerGame = pitchersPerGame.reduce((a, b) => a + b, 0) / numGames;
  const phPerGame = totalPhAppearances / numGames;

  console.log('');
  console.log('='.repeat(60));
  console.log(`STATISTICAL ANALYSIS - ${year} SEASON`);
  console.log('='.repeat(60));
  console.log(`Games simulated: ${numGames}`);
  console.log('');
  console.log('📊 Pinch Hit Frequency:');
  console.log(`  Total PH appearances: ${totalPhAppearances}`);
  console.log(`  PH per game: ${phPerGame.toFixed(2)}`);
  console.log(`  Target (season norm): ${season.norms.substitutions.pinchHitsPerGame}`);
  const phDiff = phPerGame - season.norms.substitutions.pinchHitsPerGame;
  console.log(`  Difference: ${phDiff > 0 ? '+' : ''}${phDiff.toFixed(2)}`);

  console.log('');
  console.log('📊 Pitcher Usage:');
  console.log(`  Total pitcher changes: ${totalPitcherChanges}`);
  console.log(`  Pitchers per game: ${avgPitchersPerGame.toFixed(2)}`);
  // Type-safe access to relieversPerGame
  const relieversPerGame = (season as any).norms?.pitching?.relieversPerGame ?? 3;
  const targetPitchers = relieversPerGame + 2; // 2 starters + relievers
  console.log(`  Target (season norm): ${targetPitchers} (2 starters + relievers)`);
  const pitcherDiff = avgPitchersPerGame - targetPitchers;
  console.log(`  Difference: ${pitcherDiff > 0 ? '+' : ''}${pitcherDiff.toFixed(2)}`);
  console.log('');
  console.log('='.repeat(60));
  console.log('');
}

const years = process.argv.slice(2).map(Number).filter(n => !isNaN(n));
const numGames = 100; // Fixed games per season

async function runAllTests() {
  for (const year of years) {
    try {
      await runAnalysis(year, numGames);
    } catch (err) {
      console.error(`Error testing ${year}:`, err);
    }
  }

  // Print summary
  console.log('');
  console.log('='.repeat(60));
  console.log('SUMMARY - ALL SEASONS');
  console.log('='.repeat(60));
  console.log('');
}

runAllTests().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
