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
	// Look for .sqlite.gz files (we only keep the compressed versions)
	const gzFiles = files.filter((f) => f.endsWith('.sqlite.gz'));

	const seasons: SeasonEntry[] = [];
	let totalSize = 0;
	let totalCompressedSize = 0;

	for (const gzFile of gzFiles) {
		const yearMatch = gzFile.match(/(\d{4})\.sqlite\.gz/);
		if (!yearMatch) continue;

		const year = parseInt(yearMatch[1], 10);
		const gzPath = path.join(seasonsDir, gzFile);
		const sqlitePath = gzPath.replace('.gz', '');

		// Estimate uncompressed size (typically ~2.5-3x compression ratio for SQLite)
		// We'll use the compressed size as a proxy since we don't keep uncompressed files
		const compressedSize = fs.statSync(gzPath).size;
		const estimatedSize = Math.round(compressedSize * 2.8);

		// Store the .gz filename since that's what we actually have
		seasons.push({
			year,
			file: gzFile,
			size: estimatedSize,
			compressedSize,
		});

		totalSize += estimatedSize;
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

export function writeManifest(seasonsDir: string): void {
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
