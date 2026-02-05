/**
 * Export all baseball seasons (1910-2024) as SQLite databases
 *
 * Usage:
 *   pnpm exec tsx src/export-all-sqlite.ts              # All years
 *   pnpm exec tsx src/export-all-sqlite.ts 1950 1960    # Year range
 */

import { exportSeason as exportSeasonData } from './export-season.js';
import { exportSeasonAsSqlite } from './export-sqlite.js';
import { writeManifest } from './update-manifest.js';
import * as fs from 'fs';
import * as path from 'path';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function exportAllSqlite(
  startYear: number,
  endYear: number,
  dbPath: string,
  outputDir: string
): Promise<void> {
  console.log(`📦 Exporting seasons ${startYear}-${endYear} as SQLite...\n`);

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  let totalSize = 0;

  for (let year = startYear; year <= endYear; year++) {
    const sqlitePath = path.join(outputDir, `${year}.sqlite`);

    // Check if already exists (we only keep .gz files)
    const gzPath = `${sqlitePath}.gz`;
    if (fs.existsSync(gzPath)) {
      const stats = fs.statSync(gzPath);
      console.log(`⏭️  ${year}: Already exists (${formatBytes(stats.size)}), skipping`);
      totalSize += stats.size;
      skipCount++;
      continue;
    }

    process.stdout.write(`🔄 ${year}: Extracting... `);

    try {
      // Export season data to temp JSON first
      const tmpPath = path.join(outputDir, `${year}.tmp.json`);
      const season = await exportSeasonData(year, dbPath, tmpPath);

      // Convert to SQLite (creates both .sqlite and .sqlite.gz)
      process.stdout.write(`Converting to SQLite... `);
      await exportSeasonAsSqlite(season, sqlitePath, true);

      // Remove temp file
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }

      // Remove raw .sqlite file (we only need the .gz version)
      if (fs.existsSync(sqlitePath)) {
        fs.unlinkSync(sqlitePath);
      }

      // Use compressed file size for stats
      const gzPath = `${sqlitePath}.gz`;
      const stats = fs.statSync(gzPath);
      totalSize += stats.size;
      successCount++;

      console.log(`✅ ${formatBytes(stats.size)}`);
    } catch (error: any) {
      console.log(`❌ Error: ${error.message}`);
      errorCount++;

      // Clean up partial files
      const tmpPath = path.join(outputDir, `${year}.tmp.json`);
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      if (fs.existsSync(sqlitePath)) fs.unlinkSync(sqlitePath);
    }
  }

  // Update manifest
  console.log('\n📋 Updating manifest...');
  writeManifest(outputDir);

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 Export Summary');
  console.log('='.repeat(50));
  console.log(`✅ Successfully exported: ${successCount}`);
  console.log(`⏭️  Skipped (already exists): ${skipCount}`);
  console.log(`❌ Errors: ${errorCount}`);
  console.log(`📁 Total seasons: ${successCount + skipCount}`);
  console.log(`💾 Total size: ${formatBytes(totalSize)}`);
  console.log('='.repeat(50));
}

async function main() {
  const args = process.argv.slice(2);
  const startYear = args[0] ? parseInt(args[0]) : 1910;
  const endYear = args[1] ? parseInt(args[1]) : 2024;
  const dbPath = '../baseball.duckdb';
  const outputDir = '../app/static/seasons';

  if (isNaN(startYear) || isNaN(endYear) || startYear > endYear) {
    console.error('Invalid year range. Usage: tsx export-all-sqlite.ts [startYear] [endYear]');
    process.exit(1);
  }

  await exportAllSqlite(startYear, endYear, dbPath, outputDir);
}

main();
