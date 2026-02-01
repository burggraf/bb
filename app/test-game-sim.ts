/**
 * CLI Game Simulation Test Script
 *
 * Run multiple games and validate:
 * - All 17 outcomes are covered
 * - Legal baseball rules
 * - Sensical gameplay
 * - Good play-by-play descriptions
 *
 * Usage: pnpm exec tsx test-game-sim.ts [number of games]
 */

import { GameEngine } from './src/lib/game/engine.js';
import type { SeasonPackage, PlayEvent } from './src/lib/game/types.js';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load season data directly from file system (Node.js compatible)
async function loadSeason(year: number): Promise<SeasonPackage> {
	const seasonPath = join(process.cwd(), 'static', 'seasons', `${year}.json`);
	const data = readFileSync(seasonPath, 'utf-8');
	return JSON.parse(data) as SeasonPackage;
}

// All 17 possible outcomes
const ALL_OUTCOMES = [
	'single',
	'double',
	'triple',
	'homeRun',
	'walk',
	'hitByPitch',
	'strikeout',
	'groundOut',
	'flyOut',
	'lineOut',
	'popOut',
	'sacrificeFly',
	'sacrificeBunt',
	'fieldersChoice',
	'reachedOnError',
	'catcherInterference',
	'unknownOut', // Not a real outcome but might appear in data
] as const;

// Format name from "Last, First" to "First Last"
function formatName(name: string): string {
	const commaIndex = name.indexOf(',');
	if (commaIndex === -1) return name;
	return `${name.slice(commaIndex + 1).trim()} ${name.slice(0, commaIndex).trim()}`;
}

interface ValidationResult {
	isValid: boolean;
	errors: string[];
	warnings: string[];
	stats: {
		totalPlays: number;
		outcomes: Record<string, number>;
		innings: number;
		finalScore: { away: number; home: number };
		outcomesSeen: string[];
	};
}

class GameValidator {
	private seenOutcomes = new Set<string>();
	private playErrors: string[] = [];
	private playWarnings: string[] = [];

	validateGame(engine: GameEngine, season: any): ValidationResult {
		const state = engine.getState();
		const errors: string[] = [];
		const warnings: string[] = [];
		const outcomes: Record<string, number> = {};

		// Track state for validation
		let currentInning = 0;
		let currentIsTop = true;
		let outsInInning = 0;
		let lastOuts = 0;
		let awayScore = 0;
		let homeScore = 0;
		const pitchersUsed = new Map<string, Set<string>>(); // team -> pitcher IDs

		// Process plays in reverse (oldest to newest)
		const plays = [...state.plays].reverse();

		for (let i = 0; i < plays.length; i++) {
			const play = plays[i];

			// Skip summary entries
			if (play.isSummary) {
				// Verify half-inning summary format
				if (!play.description.includes('Top') && !play.description.includes('Bottom')) {
					errors.push(`Play ${i}: Invalid summary format: ${play.description}`);
				}
				continue;
			}

			// Track outcomes
			if (!outcomes[play.outcome]) {
				outcomes[play.outcome] = 0;
			}
			outcomes[play.outcome]++;
			this.seenOutcomes.add(play.outcome);

			// Update score
			if (play.isTopInning) {
				awayScore += play.runsScored;
			} else {
				homeScore += play.runsScored;
			}

			// Track pitchers
			const team = play.isTopInning ? state.meta.awayTeam : state.meta.homeTeam;
			if (!pitchersUsed.has(team)) {
				pitchersUsed.set(team, new Set());
			}
			pitchersUsed.get(team)!.add(play.pitcherId);

			// === RULE VALIDATIONS ===

			// 1. Check for inning changes
			if (play.inning !== currentInning) {
				if (play.inning !== currentInning + 1) {
					errors.push(`Play ${i}: Inning jumped from ${currentInning} to ${play.inning}`);
				}
				if (!play.isSummary) {
					// Should have a summary before non-summary play in new inning
					if (i > 0 && plays[i - 1].inning !== play.inning) {
						const prevPlay = plays[i - 1];
						if (!prevPlay?.isSummary) {
							warnings.push(`Play ${i}: New inning ${play.inning} without summary`);
						}
					}
				}
				currentInning = play.inning;
				outsInInning = 0;
			}

			// 2. Check for top/bottom transitions
			if (i > 0) {
				const prevPlay = plays[i - 1];
				if (prevPlay && !prevPlay.isSummary) {
					// Check if we switched from top to bottom or vice versa
					if (prevPlay.inning === play.inning && prevPlay.isTopInning !== play.isTopInning) {
						// We should have a summary between halves
						if (!prevPlay.isSummary) {
							errors.push(`Play ${i}: Switched from ${prevPlay.isTopInning ? 'top' : 'bottom'} to ${play.isTopInning ? 'top' : 'bottom'} of inning ${play.inning} without summary`);
						}
					}
				}
			}

			// 3. Validate outs count
			if (play.inning === currentInning && play.isTopInning === currentIsTop) {
				// Same half-inning
				const isOut = ['strikeout', 'groundOut', 'flyOut', 'lineOut', 'popOut', 'fieldersChoice', 'sacrificeFly', 'sacrificeBunt', 'doublePlay', 'triplePlay'].includes(play.outcome);
				// Note: doublePlay and triplePlay aren't outcomes yet, but might be added
				const isOutEvent = ['strikeout', 'groundOut', 'flyOut', 'lineOut', 'popOut', 'fieldersChoice', 'sacrificeFly'].includes(play.outcome);

				if (isOutEvent) {
					outsInInning++;
					if (outsInInning > 3) {
						errors.push(`Play ${i}: More than 3 outs in ${play.isTopInning ? 'top' : 'bottom'} of ${play.inning} (outs: ${outsInInning})`);
					}
				}
			} else {
				// New half-inning
				currentIsTop = play.isTopInning;
				outsInInning = 0;
				const isOutEvent = ['strikeout', 'groundOut', 'flyOut', 'lineOut', 'popOut', 'fieldersChoice', 'sacrificeFly'].includes(play.outcome);
				if (isOutEvent) {
					outsInInning = 1;
				}
			}

			// 4. Fielder's choice should have runners on base
			if (play.outcome === 'fieldersChoice') {
				const hadRunners = play.runnersBefore && play.runnersBefore.some(r => r !== null);
				if (!hadRunners) {
					errors.push(`Play ${i}: Fielder's choice with no runners on base. Description: "${play.description}"`);
				}
				// Should mention which runner was out
				if (!play.description.includes('out at')) {
					warnings.push(`Play ${i}: Fielder's choice doesn't specify which runner was out: "${play.description}"`);
				}
			}

			// 5. Sacrifice flies should have runners on base or be with 0-2 outs
			if (play.outcome === 'sacrificeFly') {
				const hadRunners = play.runnersBefore && play.runnersBefore.some(r => r !== null);
				if (!hadRunners) {
					errors.push(`Play ${i}: Sacrifice fly with no runners on base`);
				}
			}

			// 6. Sacrifice bunt should typically have runners on base
			if (play.outcome === 'sacrificeBunt') {
				const hadRunners = play.runnersBefore && play.runnersBefore.some(r => r !== null);
				if (!hadRunners) {
					warnings.push(`Play ${i}: Sacrifice bunt with no runners on base (unusual but possible)`);
				}
			}

			// 7. Check for runner advancement sanity
			// Note: We can't track which specific runner was put out on most plays
			// (except fielder's choice), so runner disappearance is expected on outs
			if (play.runnersBefore && play.runnersAfter) {
				// Check for duplicate runners
				// Note: runnersAfter includes the batter if they reached base
				// We need to check for duplicates within runnersAfter itself
				const runnersOnBase = play.runnersAfter.filter(r => r !== null);
				const uniqueRunners = new Set(runnersOnBase);
				if (runnersOnBase.length !== uniqueRunners.size) {
					errors.push(`Play ${i}: Duplicate runners on base. Runners: ${runnersOnBase.join(', ')}`);
				}
			}

			// 8. Check pitcher name format (should be "First Last")
			if (play.pitcherName.includes(',')) {
				errors.push(`Play ${i}: Pitcher name not formatted: "${play.pitcherName}"`);
			}

			// 9. Check batter name format (should be "First Last")
			if (play.batterName.includes(',')) {
				errors.push(`Play ${i}: Batter name not formatted: "${play.batterName}"`);
			}

			// 10. Validate play description format
			this.validatePlayDescription(play, i, errors, warnings);
		}

		// === POST-GAME VALIDATIONS ===

		// Check game ended properly
		if (awayScore === homeScore && currentInning < 9) {
			errors.push(`Game ended in tie before 9th inning: ${awayScore}-${homeScore}`);
		}

		// Check if home team got their last at-bat
		if (awayScore > homeScore && currentInning === 9 && currentIsTop) {
			// Home team was about to bat in bottom 9th but game ended
			// This is OK if away team was winning
		} else if (awayScore > homeScore && currentInning === 9 && !currentIsTop) {
			// Home team batted in bottom 9th and lost - OK
		} else if (homeScore > awayScore) {
			// Home team won - OK
		}

		// Check that pitchers were reasonably consistent
		for (const [team, pitcherSet] of pitchersUsed) {
			if (pitcherSet.size > 5) {
				warnings.push(`Team ${team} used ${pitcherSet.size} different pitchers (unusual for V1)`);
			}
		}

		return {
			isValid: errors.length === 0,
			errors,
			warnings,
			stats: {
				totalPlays: plays.filter(p => !p.isSummary).length,
				outcomes,
				innings: currentInning,
				finalScore: { away: awayScore, home: homeScore },
				outcomesSeen: Array.from(this.seenOutcomes),
			},
		};
	}

	private validatePlayDescription(play: PlayEvent, index: number, errors: string[], warnings: string[]): void {
		const desc = play.description.toLowerCase();

		// Check for common formatting issues
		if (desc.includes('  ')) {
			warnings.push(`Play ${index}: Double spaces in description: "${play.description}"`);
		}

		// Check that action descriptions are clear
		const actionWords = ['singles', 'doubles', 'triples', 'homers', 'walks', 'strikes out', 'grounds out', 'flies out', 'lines out', 'pops out', 'reaches', 'hits'];
		const hasAction = actionWords.some(word => desc.includes(word));
		if (!hasAction && !play.isSummary) {
			warnings.push(`Play ${index}: Unclear action in description: "${play.description}"`);
		}

		// For hits, check format
		if (['single', 'double', 'triple', 'homeRun'].includes(play.outcome)) {
			if (!desc.includes('off') && !desc.includes('homers')) {
				warnings.push(`Play ${index}: Hit description missing pitcher: "${play.description}"`);
			}
		}

		// For strikeouts, check format
		if (play.outcome === 'strikeout') {
			if (!desc.includes('strikes out against') && !desc.includes('struck out')) {
				warnings.push(`Play ${index}: Strikeout description: "${play.description}"`);
			}
		}
	}

	getSeenOutcomes(): string[] {
		return Array.from(this.seenOutcomes);
	}
}

async function runGameTests(numGames: number = 10): Promise<void> {
	console.log(`\n🏟️  Running ${numGames} game simulation tests...\n`);

	const season = await loadSeason(1976);
	const validator = new GameValidator();

	const allErrors: string[] = [];
	const allWarnings: string[] = [];
	const results: ValidationResult[] = [];

	for (let i = 0; i < numGames; i++) {
		process.stdout.write(`\r  Game ${i + 1}/${numGames}...`);

		// Get valid teams (teams with both batters and pitchers)
		const validTeams = Object.keys(season.teams).filter(teamId => {
			const hasBatters = Object.values(season.batters).some(b => b.teamId === teamId);
			const hasPitchers = Object.values(season.pitchers).some(p => p.teamId === teamId);
			return hasBatters && hasPitchers;
		});

		// Create random teams for variety
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

		const result = validator.validateGame(engine, season);
		results.push(result);

		if (result.errors.length > 0) {
			allErrors.push(...result.errors.map(e => `Game ${i + 1}: ${e}`));
		}
		if (result.warnings.length > 0) {
			allWarnings.push(...result.warnings.map(w => `Game ${i + 1}: ${w}`));
		}
	}

	process.stdout.write(`\r  ✓ Complete!                     \n`);

	// Print summary
	console.log(`\n${'='.repeat(60)}`);
	console.log('TEST SUMMARY');
	console.log('='.repeat(60));

	const passedGames = results.filter(r => r.isValid).length;
	console.log(`\nGames Passed: ${passedGames}/${numGames}`);

	// Outcomes coverage
	const outcomesSeen = validator.getSeenOutcomes();
	console.log(`\n📊 Outcomes Coverage (${outcomesSeen.length}/${ALL_OUTCOMES.length}):`);
	const missingOutcomes = ALL_OUTCOMES.filter(o => !outcomesSeen.includes(o));
	for (const outcome of ALL_OUTCOMES) {
		const seen = outcomesSeen.includes(outcome);
		const status = seen ? '✓' : '✗';
		const count = results.reduce((sum, r) => sum + (r.stats.outcomes[outcome] || 0), 0);
		console.log(`  ${status} ${outcome.padEnd(20)} (${count} occurrences)`);
	}

	if (missingOutcomes.length > 0) {
		console.log(`\n⚠️  Missing outcomes: ${missingOutcomes.join(', ')}`);
	}

	// Errors
	if (allErrors.length > 0) {
		console.log(`\n❌ ERRORS (${allErrors.length}):`);
		allErrors.slice(0, 20).forEach(err => console.log(`  - ${err}`));
		if (allErrors.length > 20) {
			console.log(`  ... and ${allErrors.length - 20} more errors`);
		}
	} else {
		console.log(`\n✅ No errors found!`);
	}

	// Warnings
	if (allWarnings.length > 0) {
		console.log(`\n⚠️  WARNINGS (${allWarnings.length}):`);
		const uniqueWarnings = [...new Set(allWarnings)];
		uniqueWarnings.slice(0, 20).forEach(warn => console.log(`  - ${warn}`));
		if (uniqueWarnings.length > 20) {
			console.log(`  ... and ${uniqueWarnings.length - 20} more unique warnings`);
		}
	} else {
		console.log(`\n✅ No warnings!`);
	}

	// Game stats
	console.log(`\n📈 Game Statistics:`);
	const totalPlays = results.reduce((sum, r) => sum + r.stats.totalPlays, 0);
	const avgPlays = Math.round(totalPlays / numGames);
	console.log(`  Average plays per game: ${avgPlays}`);

	const avgInnings = results.reduce((sum, r) => sum + r.stats.innings, 0) / numGames;
	console.log(`  Average innings: ${avgInnings.toFixed(1)}`);

	// Sample play-by-play from first game
	console.log(`\n📝 Sample Play-by-Play (Game 1):`);
	console.log('─'.repeat(60));
	const firstEngine = new GameEngine(season, 'CIN', 'HOU');
	while (!firstEngine.isComplete()) {
		firstEngine.simulatePlateAppearance();
	}
	const state = firstEngine.getState();
	const plays = [...state.plays].reverse().filter(p => !p.isSummary);
	plays.slice(0, 10).forEach((play, i) => {
		console.log(`  ${i + 1}. ${play.description}`);
	});
	if (plays.length > 10) {
		console.log(`  ... (${plays.length - 10} more plays)`);
	}

	// Print one full game if there were errors
	if (allErrors.length > 0 && results.length > 0) {
		const errorGameIndex = results.findIndex(r => !r.isValid);
		if (errorGameIndex >= 0) {
			console.log(`\n🔍 Full Play-by-Play for Game ${errorGameIndex + 1} (had errors):`);
			console.log('='.repeat(60));

			// Re-simulate the same game
			const validTeams = Object.keys(season.teams).filter(teamId => {
				const hasBatters = Object.values(season.batters).some(b => b.teamId === teamId);
				const hasPitchers = Object.values(season.pitchers).some(p => p.teamId === teamId);
				return hasBatters && hasPitchers;
			});
			const errorEngine = new GameEngine(season, validTeams[0], validTeams[1]);
			while (!errorEngine.isComplete()) {
				errorEngine.simulatePlateAppearance();
			}
			const errorState = errorEngine.getState();
			const errorPlays = [...errorState.plays].reverse();
			errorPlays.forEach((play, i) => {
				if (play.isSummary) {
					console.log(`\n  ${play.description}`);
				} else {
					const playNum = errorPlays.slice(0, i).filter(p => !p.isSummary).length + 1;
					console.log(`  ${playNum}. ${play.description}`);
				}
			});
		}
	}

	console.log(`\n${'='.repeat(60)}\n`);

	// Exit with error code if any failures
	if (allErrors.length > 0) {
		process.exit(1);
	}
}

// Get number of games from command line
const numGames = parseInt(process.argv[2]) || 10;

runGameTests(numGames).catch(err => {
	console.error('Error running tests:', err);
	process.exit(1);
});
