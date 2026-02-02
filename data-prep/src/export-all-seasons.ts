/**
 * Export all baseball seasons (1910-2024) with gzip compression
 *
 * Usage:
 *   pnpm exec tsx src/export-all-seasons.ts              # All years
 *   pnpm exec tsx src/export-all-seasons.ts 1950 1960     # Year range
 */

import { exportSeason } from './export-season.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

interface ManifestEntry {
	year: number;
	file: string;
	compressedSize: number;
	generatedAt: string;
}

interface SeasonManifest {
	meta: {
		generatedAt: string;
		totalYears: number;
		totalCompressedSize: number;
	};
	seasons: ManifestEntry[];
}

function compressFile(inputPath: string, outputPath: string): number {
	const input = fs.readFileSync(inputPath);
	const compressed = zlib.gzipSync(input, { level: 9 });
	fs.writeFileSync(outputPath, compressed);

	// Delete uncompressed file to save space
	fs.unlinkSync(inputPath);

	return compressed.length;
}

function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function exportAllSeasons(
	startYear: number,
	endYear: number,
	dbPath: string,
	outputDir: string
): Promise<SeasonManifest> {
	console.log(`📦 Exporting seasons ${startYear}-${endYear}...\n`);

	// Ensure output directory exists
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	const manifest: SeasonManifest = {
		meta: {
			generatedAt: new Date().toISOString(),
			totalYears: 0,
			totalCompressedSize: 0,
		},
		seasons: [],
	};

	let successCount = 0;
	let skipCount = 0;
	let errorCount = 0;

	for (let year = startYear; year <= endYear; year++) {
		const jsonPath = path.join(outputDir, `${year}.json`);
		const gzPath = path.join(outputDir, `${year}.json.gz`);

		// Check if already exists
		if (fs.existsSync(gzPath)) {
			console.log(`⏭️  ${year}: Already exists, skipping`);
			const stats = fs.statSync(gzPath);
			manifest.seasons.push({
				year,
				file: `${year}.json.gz`,
				compressedSize: stats.size,
				generatedAt: stats.mtime.toISOString(),
			});
			manifest.meta.totalCompressedSize += stats.size;
			skipCount++;
			continue;
		}

		process.stdout.write(`🔄 ${year}: Exporting... `);

		try {
			// Export season (creates uncompressed JSON)
			await exportSeason(year, dbPath, jsonPath);

			// Compress and remove uncompressed
			process.stdout.write(`Compressing... `);
			const compressedSize = compressFile(jsonPath, gzPath);

			const entry: ManifestEntry = {
				year,
				file: `${year}.json.gz`,
				compressedSize,
				generatedAt: new Date().toISOString(),
			};

			manifest.seasons.push(entry);
			manifest.meta.totalCompressedSize += compressedSize;
			manifest.meta.totalYears++;
			successCount++;

			console.log(`✅ ${formatBytes(compressedSize)}`);
		} catch (error: any) {
			console.log(`❌ Error: ${error.message}`);
			errorCount++;

			// Clean up partial files
			if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
			if (fs.existsSync(gzPath)) fs.unlinkSync(gzPath);
		}
	}

	// Write manifest
	const manifestPath = path.join(outputDir, 'season-manifest.json');
	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

	// Summary
	console.log('\n' + '='.repeat(50));
	console.log('📊 Export Summary');
	console.log('='.repeat(50));
	console.log(`✅ Successfully exported: ${successCount}`);
	console.log(`⏭️  Skipped (already exists): ${skipCount}`);
	console.log(`❌ Errors: ${errorCount}`);
	console.log(`📁 Total seasons: ${manifest.meta.totalYears + skipCount}`);
	console.log(`💾 Total compressed size: ${formatBytes(manifest.meta.totalCompressedSize)}`);
	console.log(`📄 Manifest: ${manifestPath}`);
	console.log('='.repeat(50));

	return manifest;
}

async function main() {
	const args = process.argv.slice(2);
	const startYear = args[0] ? parseInt(args[0]) : 1910;
	const endYear = args[1] ? parseInt(args[1]) : 2024;
	const dbPath = '../baseball.duckdb';
	const outputDir = '../app/static/seasons';

	if (isNaN(startYear) || isNaN(endYear) || startYear > endYear) {
		console.error('Invalid year range. Usage: tsx export-all-seasons.ts [startYear] [endYear]');
		process.exit(1);
	}

	await exportAllSeasons(startYear, endYear, dbPath, outputDir);
}

main();
