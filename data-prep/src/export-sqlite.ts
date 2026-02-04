import Database from 'better-sqlite3';
import * as fs from 'fs';
import type { SeasonPackage } from './export-season.js';
import { createSeasonSchema, eventRatesToSQL } from './sqlite-schema.js';
import { gzipSync } from 'zlib';

/**
 * Export a season to SQLite format
 */
export async function exportSeasonAsSqlite(
  season: SeasonPackage,
  outputPath: string,
  compress: boolean = true
): Promise<void> {
  console.log(`📦 Exporting ${season.meta.year} season to SQLite: ${outputPath}...\n`);

  // Remove existing file if present
  if (fs.existsSync(outputPath)) {
    fs.unlinkSync(outputPath);
  }

  // Create SQLite database
  const db = new Database(outputPath);
  createSeasonSchema(db);

  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL');

  // Insert data in transactions
  insertMeta(db, season);
  insertNorms(db, season);
  insertBatters(db, season.batters);
  insertPitchers(db, season.pitchers);
  insertLeagueAverages(db, season.league);
  insertTeams(db, season.teams);
  insertGames(db, season.games);

  db.close();
  console.log(`\n✅ Season exported to ${outputPath}`);

  // Compress if requested
  if (compress) {
    const compressedPath = `${outputPath}.gz`;
    const dbBuffer = fs.readFileSync(outputPath);
    const gzipped = gzipSync(dbBuffer);
    fs.writeFileSync(compressedPath, gzipped);
    const originalSize = dbBuffer.length;
    const compressedSize = gzipped.length;
    const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(1);
    console.log(`✅ Compressed to ${compressedPath} (${ratio}% reduction)`);
  }
}

function insertMeta(db: Database.Database, season: SeasonPackage): void {
  const stmt = db.prepare('INSERT OR REPLACE INTO meta (year, generated_at, version) VALUES (?, ?, ?)');
  stmt.run(season.meta.year, season.meta.generatedAt, season.meta.version);
  stmt.finalize();
  console.log('  ✓ Meta data');
}

function insertNorms(db: Database.Database, season: SeasonPackage): void {
  const stmt = db.prepare('INSERT OR REPLACE INTO norms (year, era, norms_json) VALUES (?, ?, ?)');
  stmt.run(season.norms.year, season.norms.era, JSON.stringify(season.norms));
  stmt.finalize();
  console.log('  ✓ Season norms');
}

function insertBatters(db: Database.Database, batters: SeasonPackage['batters']): void {
  const insertBatter = db.prepare(`
    INSERT OR REPLACE INTO batters (id, name, bats, team_id, primary_position, position_eligibility, pa, avg, obp, slg, ops)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertRates = db.prepare(`
    INSERT OR REPLACE INTO batter_rates (
      batter_id, split, single, double, triple, home_run, walk, hit_by_pitch, strikeout,
      ground_out, fly_out, line_out, pop_out, sacrifice_fly, sacrifice_bunt,
      fielders_choice, reached_on_error, catcher_interference
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((batterList: SeasonPackage['batters'][string][]) => {
    for (const batter of batterList) {
      insertBatter.run(
        batter.id,
        batter.name,
        batter.bats,
        batter.teamId,
        batter.primaryPosition,
        JSON.stringify(batter.positionEligibility),
        batter.pa,
        batter.avg,
        batter.obp,
        batter.slg,
        batter.ops
      );

      // Insert vsLHP rates
      const vsLHP = eventRatesToSQL(batter.rates.vsLHP);
      insertRates.run(
        batter.id, 'vsLHP',
        vsLHP.single, vsLHP.double, vsLHP.triple, vsLHP.home_run,
        vsLHP.walk, vsLHP.hit_by_pitch, vsLHP.strikeout,
        vsLHP.ground_out, vsLHP.fly_out, vsLHP.line_out, vsLHP.pop_out,
        vsLHP.sacrifice_fly, vsLHP.sacrifice_bunt,
        vsLHP.fielders_choice, vsLHP.reached_on_error, vsLHP.catcher_interference
      );

      // Insert vsRHP rates
      const vsRHP = eventRatesToSQL(batter.rates.vsRHP);
      insertRates.run(
        batter.id, 'vsRHP',
        vsRHP.single, vsRHP.double, vsRHP.triple, vsRHP.home_run,
        vsRHP.walk, vsRHP.hit_by_pitch, vsRHP.strikeout,
        vsRHP.ground_out, vsRHP.fly_out, vsRHP.line_out, vsRHP.pop_out,
        vsRHP.sacrifice_fly, vsRHP.sacrifice_bunt,
        vsRHP.fielders_choice, vsRHP.reached_on_error, vsRHP.catcher_interference
      );
    }
  });

  insertMany(Object.values(batters));
  insertBatter.finalize();
  insertRates.finalize();
  console.log(`  ✓ ${Object.keys(batters).length} batters`);
}

function insertPitchers(db: Database.Database, pitchers: SeasonPackage['pitchers']): void {
  const insertPitcher = db.prepare(`
    INSERT OR REPLACE INTO pitchers (
      id, name, throws, team_id, avg_bfp_as_starter, avg_bfp_as_reliever,
      games, games_started, complete_games, saves, innings_pitched, whip, era
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertRates = db.prepare(`
    INSERT OR REPLACE INTO pitcher_rates (
      pitcher_id, split, single, double, triple, home_run, walk, hit_by_pitch, strikeout,
      ground_out, fly_out, line_out, pop_out, sacrifice_fly, sacrifice_bunt,
      fielders_choice, reached_on_error, catcher_interference
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((pitcherList: SeasonPackage['pitchers'][string][]) => {
    for (const pitcher of pitcherList) {
      insertPitcher.run(
        pitcher.id,
        pitcher.name,
        pitcher.throws,
        pitcher.teamId,
        pitcher.avgBfpAsStarter,
        pitcher.avgBfpAsReliever,
        pitcher.games,
        pitcher.gamesStarted,
        pitcher.completeGames,
        pitcher.saves,
        pitcher.inningsPitched,
        pitcher.whip,
        pitcher.era
      );

      // Insert vsLHB rates
      const vsLHB = eventRatesToSQL(pitcher.rates.vsLHB);
      insertRates.run(
        pitcher.id, 'vsLHB',
        vsLHB.single, vsLHB.double, vsLHB.triple, vsLHB.home_run,
        vsLHB.walk, vsLHB.hit_by_pitch, vsLHB.strikeout,
        vsLHB.ground_out, vsLHB.fly_out, vsLHB.line_out, vsLHB.pop_out,
        vsLHB.sacrifice_fly, vsLHB.sacrifice_bunt,
        vsLHB.fielders_choice, vsLHB.reached_on_error, vsLHB.catcher_interference
      );

      // Insert vsRHB rates
      const vsRHB = eventRatesToSQL(pitcher.rates.vsRHB);
      insertRates.run(
        pitcher.id, 'vsRHB',
        vsRHB.single, vsRHB.double, vsRHB.triple, vsRHB.home_run,
        vsRHB.walk, vsRHB.hit_by_pitch, vsRHB.strikeout,
        vsRHB.ground_out, vsRHB.fly_out, vsRHB.line_out, vsRHB.pop_out,
        vsRHB.sacrifice_fly, vsRHB.sacrifice_bunt,
        vsRHB.fielders_choice, vsRHB.reached_on_error, vsRHB.catcher_interference
      );
    }
  });

  insertMany(Object.values(pitchers));
  insertPitcher.finalize();
  insertRates.finalize();
  console.log(`  ✓ ${Object.keys(pitchers).length} pitchers`);
}

function insertLeagueAverages(db: Database.Database, league: SeasonPackage['league']): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO league_averages (
      split, single, double, triple, home_run, walk, hit_by_pitch, strikeout,
      ground_out, fly_out, line_out, pop_out, sacrifice_fly, sacrifice_bunt,
      fielders_choice, reached_on_error, catcher_interference
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const vsLHP = eventRatesToSQL(league.vsLHP);
  stmt.run(
    'vsLHP',
    vsLHP.single, vsLHP.double, vsLHP.triple, vsLHP.home_run,
    vsLHP.walk, vsLHP.hit_by_pitch, vsLHP.strikeout,
    vsLHP.ground_out, vsLHP.fly_out, vsLHP.line_out, vsLHP.pop_out,
    vsLHP.sacrifice_fly, vsLHP.sacrifice_bunt,
    vsLHP.fielders_choice, vsLHP.reached_on_error, vsLHP.catcher_interference
  );

  const vsRHP = eventRatesToSQL(league.vsRHP);
  stmt.run(
    'vsRHP',
    vsRHP.single, vsRHP.double, vsRHP.triple, vsRHP.home_run,
    vsRHP.walk, vsRHP.hit_by_pitch, vsRHP.strikeout,
    vsRHP.ground_out, vsRHP.fly_out, vsRHP.line_out, vsRHP.pop_out,
    vsRHP.sacrifice_fly, vsRHP.sacrifice_bunt,
    vsRHP.fielders_choice, vsRHP.reached_on_error, vsRHP.catcher_interference
  );

  stmt.finalize();
  console.log('  ✓ League averages');

  // Insert pitcher-batter league averages
  const pbStmt = db.prepare('INSERT OR REPLACE INTO pitcher_batter_league (split, rates_json) VALUES (?, ?)');
  pbStmt.run('vsLHP', JSON.stringify(league.pitcherBatter.vsLHP));
  pbStmt.run('vsRHP', JSON.stringify(league.pitcherBatter.vsRHP));
  pbStmt.finalize();
  console.log('  ✓ Pitcher-batter league averages');
}

function insertTeams(db: Database.Database, teams: SeasonPackage['teams']): void {
  const stmt = db.prepare('INSERT OR REPLACE INTO teams (id, league, city, nickname) VALUES (?, ?, ?, ?)');
  const insertMany = db.transaction((teamList: SeasonPackage['teams'][string][]) => {
    for (const team of Object.values(teams)) {
      stmt.run(team.id, team.league, team.city, team.nickname);
    }
  });
  insertMany(Object.values(teams));
  stmt.finalize();
  console.log(`  ✓ ${Object.keys(teams).length} teams`);
}

function insertGames(db: Database.Database, games: SeasonPackage['games']): void {
  const stmt = db.prepare('INSERT OR REPLACE INTO games (id, date, away_team, home_team, use_dh) VALUES (?, ?, ?, ?, ?)');
  const insertMany = db.transaction((gameList: SeasonPackage['games']) => {
    for (const game of gameList) {
      stmt.run(game.id, game.date, game.awayTeam, game.homeTeam, game.useDH ? 1 : 0);
    }
  });
  insertMany(games);
  stmt.finalize();
  console.log(`  ✓ ${games.length} games`);
}
