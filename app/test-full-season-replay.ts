#!/usr/bin/env tsx
/**
 * Full season replay using the actual GameEngine
 * This tests the real lineup builder and pinch-hitting logic
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, unlinkSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const YEAR = 1976;
const SEASON_FILE = join(__dirname, `static/seasons/${YEAR}.sqlite`);
const RESULTS_DB = join(__dirname, `../tmp/full-replay-${YEAR}-${Date.now()}.sqlite`);

console.log(`= Full Season Replay with GameEngine for ${YEAR} =`);
console.log(`Season file: ${SEASON_FILE}`);
console.log(`Results DB: ${RESULTS_DB}`);

// Type definitions
interface ScheduledGame {
  id: string;
  date: string;
  awayTeam: string;
  homeTeam: string;
}

// Load season data
async function loadSeasonData() {
  console.log(`\n[1/4] Loading ${YEAR} season data...`);
  
  const seasonDb = new Database(SEASON_FILE, { readonly: true });
  
  // Load schedule
  const scheduleStmt = seasonDb.prepare(`
    SELECT id, date, away_team as awayTeam, home_team as homeTeam
    FROM games ORDER BY id
  `);
  const schedule = scheduleStmt.all() as ScheduledGame[];
  
  seasonDb.close();
  
  console.log(`  Loaded ${schedule.length} games`);
  return { schedule };
}

// Initialize results database
function initResultsDB() {
  console.log(`\n[2/4] Initializing results database...`);
  
  if (existsSync(RESULTS_DB)) {
    unlinkSync(RESULTS_DB);
  }
  
  const db = new Database(RESULTS_DB);
  
  db.exec(`
    CREATE TABLE player_usage (
      player_id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      actual_pa INTEGER NOT NULL,
      replay_pa INTEGER DEFAULT 0,
      percentage REAL DEFAULT 0
    );
    
    CREATE INDEX idx_usage_team ON player_usage(team_id);
  `);
  
  console.log(`  Database initialized`);
  return db;
}

// Seed usage targets
function seedUsageTargets(db: Database) {
  console.log(`\n[3/4] Seeding usage targets...`);
  
  const seasonDb = new Database(SEASON_FILE, { readonly: true });
  
  // Get all batters with their PA
  const batterStmt = seasonDb.prepare(`
    SELECT id, team_id as teamId, pa
    FROM batters WHERE pa >= 20
  `);
  const batters = batterStmt.all() as any[];
  
  const insert = db.prepare(`
    INSERT INTO player_usage (player_id, team_id, actual_pa, replay_pa, percentage)
    VALUES (?, ?, ?, 0, 0)
  `);
  
  for (const batter of batters) {
    insert.run([batter.id, batter.teamId, batter.pa]);
  }
  
  seasonDb.close();
  console.log(`  Seeded ${batters.length} batters`);
}

// Run the replay
async function runReplay() {
  const { schedule } = await loadSeasonData();
  const db = initResultsDB();
  seedUsageTargets(db);
  
  console.log(`\n[4/4] Running ${schedule.length} games with GameEngine...`);
  
  // Dynamic import of the GameEngine and season loader
  const { loadSeasonForGame } = await import('./src/lib/game/sqlite-season-loader.js');
  const { GameEngine } = await import('./src/lib/game/engine.js');
  const { UsageTracker } = await import('./src/lib/game-results/usage-tracker.js');
  
  // Create a usage tracker
  const usageTracker = {
    playerUsage: new Map<string, number>(),
    
    getTeamUsageForContext(teamId: string) {
      return this.playerUsage;
    },
    
    updateGameUsage(gameStats: { batterPa: Map<string, number> }) {
      for (const [playerId, pa] of gameStats.batterPa) {
        const current = this.playerUsage.get(playerId) || 0;
        // Calculate usage percentage based on actual PA
        const seasonDb = new Database(SEASON_FILE, { readonly: true });
        const row = seasonDb.prepare('SELECT pa FROM batters WHERE id = ?').get(playerId) as { pa: number } | undefined;
        seasonDb.close();
        
        if (row) {
          const actualPA = row.pa;
          const totalPA = current * actualPA + pa;
          const newUsage = totalPA / actualPA;
          this.playerUsage.set(playerId, newUsage);
          
          // Update database
          db.prepare('UPDATE player_usage SET replay_pa = replay_pa + ?, percentage = ? WHERE player_id = ?')
            .run([pa, newUsage, playerId]);
        }
      }
    }
  };
  
  let completedGames = 0;
  
  for (let i = 0; i < schedule.length; i++) {
    const game = schedule[i];
    
    if (i % 100 === 0) {
      console.log(`  Progress: ${i}/${schedule.length} games (${((i / schedule.length) * 100).toFixed(1)}%)`);
    }
    
    try {
      // Load season data for this game
      const season = await loadSeasonForGame(YEAR, game.awayTeam, game.homeTeam);
      
      // Get usage context
      const awayUsage = await usageTracker.getTeamUsageForContext(game.awayTeam);
      const homeUsage = await usageTracker.getTeamUsageForContext(game.homeTeam);
      
      // Create GameEngine
      const managerial = {
        enabled: true,
        randomness: 0.1,
        pitcherUsage: new Map([...awayUsage, ...homeUsage]),
        restThreshold: 1.25
      };
      
      const engine = (GameEngine as any).create(
        season,
        game.awayTeam,
        game.homeTeam,
        managerial,
        { playerUsage: awayUsage },
        { playerUsage: homeUsage }
      );
      
      // Simulate the game
      let paCount = 0;
      while (!engine.isComplete()) {
        if (paCount > 500) {
          console.warn(`Game ${i + 1} exceeded 500 PAs, breaking`);
          break;
        }
        engine.simulatePlateAppearance();
        paCount++;
      }
      
      // Extract batter PA from game state
      const finalState = engine.getState();
      const batterPa = new Map<string, number>();
      
      for (const play of finalState.plays) {
        if (play.batterId && !play.isSummary) {
          batterPa.set(play.batterId, (batterPa.get(play.batterId) || 0) + 1);
        }
      }
      
      // Update usage
      usageTracker.updateGameUsage({ batterPa });
      completedGames++;
      
    } catch (e) {
      console.warn(`Error in game ${i + 1}: ${e}`);
    }
  }
  
  console.log(`  Completed ${completedGames} games`);
  
  // Output results
  console.log(`\n=== Results ===`);
  
  const reportStmt = db.prepare(`
    SELECT player_id, team_id, actual_pa, replay_pa, percentage
    FROM player_usage
    ORDER BY percentage DESC
    LIMIT 20
  `);
  
  const rows = reportStmt.all() as any[];
  
  console.log(`\nTop 20 most overused batters:`);
  console.log(`Player ID\t\tTeam\tActual\tReplay\t%`);
  console.log(`-`.repeat(60));
  
  for (const row of rows) {
    console.log(`${row.player_id}\t${row.team_id}\t${row.actual_pa}\t${row.replay_pa}\t${(row.percentage * 100).toFixed(0)}%`);
  }
  
  // Summary stats
  const summaryStmt = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN percentage > 1.25 THEN 1 ELSE 0 END) as over,
      SUM(CASE WHEN percentage < 0.75 THEN 1 ELSE 0 END) as under,
      SUM(CASE WHEN percentage BETWEEN 0.75 AND 1.25 THEN 1 ELSE 0 END) as inrange
    FROM player_usage
  `);
  
  const summary = summaryStmt.get() as any;
  console.log(`\nSummary:`);
  console.log(`  Total batters: ${summary.total}`);
  console.log(`  Over 125%: ${summary.over}`);
  console.log(`  Under 75%: ${summary.under}`);
  console.log(`  In range (75-125%): ${summary.inrange}`);
  
  db.close();
  console.log(`\nResults saved to: ${RESULTS_DB}`);
}

runReplay().catch(console.error);
