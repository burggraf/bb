/**
 * Build all season data files from the baseball database
 *
 * This script exports all seasons (1910-2024) with the latest schema,
 * including pitcher batting statistics.
 *
 * Usage: pnpm exec tsx scripts/build-seasons-data.ts
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.dirname(__dirname);
const DB_PATH = path.join(ROOT_DIR, 'baseball.duckdb');
const SEASONS_DIR = path.join(ROOT_DIR, 'app/static/seasons');

// Start and end years (adjust as needed)
const START_YEAR = 1910;
const END_YEAR = 2024;

console.log(`📦 Building all season data files (${START_YEAR}-${END_YEAR})...\n`);

// Ensure output directory exists
if (!fs.existsSync(SEASONS_DIR)) {
	fs.mkdirSync(SEASONS_DIR, { recursive: true });
}

// Get the export script path
const exportScript = path.join(ROOT_DIR, 'data-prep/src/export-season.ts');

let successCount = 0;
let failCount = 0;
const failedYears: number[] = [];

for (let year = START_YEAR; year <= END_YEAR; year++) {
	const outputPath = path.join(SEASONS_DIR, `${year}.json`);
	const gzippedPath = path.join(SEASONS_DIR, `${year}.json.gz`);

	console.log(`\n📅 Year ${year}...`);

	try {
		// Run the export script (must run from data-prep directory for workspace deps)
		console.log('  Exporting...');
		const dataPrepDir = path.join(ROOT_DIR, 'data-prep');
		const relativeExportScript = path.join('src', 'export-season.ts');
		// The database is in the parent repo
		// From main repo: ../baseball.duckdb
		// From worktree: ../../../baseball.duckdb
		const relativeDbPath = path.join('..', 'baseball.duckdb');
		const relativeOutputPath = path.join('..', 'app', 'static', 'seasons', `${year}.json`);

		execSync(
			`pnpm exec tsx "${relativeExportScript}" ${year} "${relativeDbPath}" "${relativeOutputPath}"`,
			{
				cwd: dataPrepDir,
				stdio: 'pipe',
				timeout: 120000, // 2 minute timeout per season
			}
		);

		// Verify the file was created
		if (!fs.existsSync(outputPath)) {
			throw new Error('Output file not created');
		}

		// Gzip the file
		console.log('  Compressing...');
		execSync(`gzip -c "${outputPath}" > "${gzippedPath}"`, {
			stdio: 'pipe',
		});

		// Verify the gzipped file was created
		if (!fs.existsSync(gzippedPath)) {
			throw new Error('Gzipped file not created');
		}

		// Get file sizes
		const originalSize = fs.statSync(outputPath).size;
		const gzippedSize = fs.statSync(gzippedPath).size;
		const reduction = ((1 - gzippedSize / originalSize) * 100).toFixed(1);

		console.log(
			`  ✓ ${year}.json: ${(originalSize / 1024).toFixed(1)} KB → ${(gzippedSize / 1024).toFixed(1)} KB (${reduction}% reduction)`
		);

		// Remove the uncompressed file
		fs.unlinkSync(outputPath);

		successCount++;
	} catch (error: any) {
		console.error(`  ✗ Failed: ${error.message}`);
		failCount++;
		failedYears.push(year);

		// Clean up any partial files
		if (fs.existsSync(outputPath)) {
			fs.unlinkSync(outputPath);
		}
		if (fs.existsSync(gzippedPath)) {
			fs.unlinkSync(gzippedPath);
		}
	}
}

console.log('\n' + '='.repeat(60));
console.log('📊 Summary:');
console.log(`   ✓ Success: ${successCount} seasons`);
console.log(`   ✗ Failed: ${failCount} seasons`);

if (failedYears.length > 0) {
	console.log(`   Failed years: ${failedYears.join(', ')}`);
}

console.log(`\n✅ Season data build complete!`);
console.log(`   Output directory: ${SEASONS_DIR}`);

if (failCount > 0) {
	process.exit(1);
}
