/**
 * Generate season-manifest.json for SQLite season files
 *
 * Scans the seasons directory for .sqlite files, collects metadata,
 * and writes a manifest with file sizes (both compressed and uncompressed).
 *
 * Usage:
 *   pnpm exec tsx src/update-manifest.ts
 */

import * as fs from 'fs';
import * as path from 'path';

interface SeasonEntry {
	year: number;
	file: string;
	size: number;
	compressedSize: number;
}

interface Manifest {
	meta: {
		generatedAt: string;
		totalYears: number;
		totalSize: number;
		totalCompressedSize: number;
	};
	seasons: SeasonEntry[];
}

function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function generateManifest(seasonsDir: string): Manifest {
	const files = fs.readdirSync(seasonsDir);
	const sqliteFiles = files.filter((f) => f.endsWith('.sqlite'));

	const seasons: SeasonEntry[] = [];
	let totalSize = 0;
	let totalCompressedSize = 0;

	for (const file of sqliteFiles) {
		const yearMatch = file.match(/(\d{4})\.sqlite/);
		if (!yearMatch) continue;

		const year = parseInt(yearMatch[1], 10);
		const sqlitePath = path.join(seasonsDir, file);
		const gzPath = path.join(seasonsDir, `${file}.gz`);

		const size = fs.statSync(sqlitePath).size;

		let compressedSize = 0;
		if (fs.existsSync(gzPath)) {
			compressedSize = fs.statSync(gzPath).size;
		}

		seasons.push({
			year,
			file,
			size,
			compressedSize,
		});

		totalSize += size;
		totalCompressedSize += compressedSize;
	}

	// Sort by year
	seasons.sort((a, b) => a.year - b.year);

	return {
		meta: {
			generatedAt: new Date().toISOString(),
			totalYears: seasons.length,
			totalSize,
			totalCompressedSize,
		},
		seasons,
	};
}

function writeManifest(seasonsDir: string): void {
	const manifest = generateManifest(seasonsDir);
	const manifestPath = path.join(seasonsDir, 'season-manifest.json');

	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

	// Log summary
	console.log('='.repeat(50));
	console.log('📊 Season Manifest Generated');
	console.log('='.repeat(50));
	console.log(`📁 Total seasons: ${manifest.meta.totalYears}`);
	console.log(`💾 Total size: ${formatBytes(manifest.meta.totalSize)}`);
	console.log(`🗜️  Total compressed: ${formatBytes(manifest.meta.totalCompressedSize)}`);
	console.log(`📄 Manifest: ${manifestPath}`);
	console.log('='.repeat(50));
}

async function main() {
	const seasonsDir = path.join(process.cwd(), '../app/static/seasons');

	if (!fs.existsSync(seasonsDir)) {
		console.error(`❌ Seasons directory not found: ${seasonsDir}`);
		process.exit(1);
	}

	writeManifest(seasonsDir);
}

main();
