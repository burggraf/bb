/**
 * CLI Game Simulation Test Script
 *
 * Run multiple games and validate:
 * - All 17 outcomes are covered
 * - Legal baseball rules
 * - Sensical gameplay
 * - Good play-by-play descriptions
 *
 * Usage: pnpm exec tsx test-game-sim.ts [number of games] [--year|-y YEAR] [--verbose|-v]
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

// All 16 possible outcomes (unknownOut is not a real outcome - it's distributed
// to actual trajectory types during data export via distributeUnknownTrajectory)
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
] as const;

// Format name from "Last, First" to "First Last"
function formatName(name: string): string {
	const commaIndex = name.indexOf(',');
	if (commaIndex === -1) return name;
	return `${name.slice(commaIndex + 1).trim()} ${name.slice(0, commaIndex).trim()}`;
}

interface HalfInningStats {
	inning: number;
	isTop: boolean;
	outs: number;
	plays: number;
	endedWithSummary: boolean;
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
		halfInnings: HalfInningStats[];
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

		// Calculate final game scores upfront (before iterating through plays)
		// This is needed for walk-off detection, since summaries appear before their plays in the array
		let finalAwayScore = 0;
		let finalHomeScore = 0;
		for (const play of state.plays) {
			if (!play.isSummary) {
				if (play.isTopInning) {
					finalAwayScore += play.runsScored;
				} else {
					finalHomeScore += play.runsScored;
				}
			}
		}

		// Track state for validation
		let awayScore = 0;
		let homeScore = 0;
		const pitchersUsed = new Map<string, Set<string>>(); // team -> pitcher IDs

		// Track half-innings for proper validation
		const halfInnings: HalfInningStats[] = [];
		let currentHalfInning: HalfInningStats | null = null;

		// Process plays in reverse (oldest to newest)
		const plays = [...state.plays].reverse();

		for (let i = 0; i < plays.length; i++) {
			const play = plays[i];

			// Track outcomes
			if (!play.isSummary) {
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
			}

			// === HALF-INNING TRACKING ===
			const isOutEvent = ['strikeout', 'groundOut', 'flyOut', 'lineOut', 'popOut', 'fieldersChoice', 'sacrificeFly', 'sacrificeBunt'].includes(play.outcome);

			// Handle summaries first - they mark the end of a half-inning
			if (play.isSummary) {
				// Count outs for ALL non-summary plays that match this summary's inning
				// (not just plays before the summary, because the array order is newest-first)
				let outsInThisHalfInning = 0;
				for (let j = 0; j < plays.length; j++) {
					const otherPlay = plays[j];
					if (!otherPlay.isSummary && otherPlay.inning === play.inning && otherPlay.isTopInning === play.isTopInning) {
						const otherIsOut = ['strikeout', 'groundOut', 'flyOut', 'lineOut', 'popOut', 'fieldersChoice', 'sacrificeFly', 'sacrificeBunt'].includes(otherPlay.outcome);
						if (otherIsOut) {
							outsInThisHalfInning++;
						}
					}
				}

				// Check if this is a walk-off win (home team took lead in bottom of 9th or later)
				// For walk-off wins, fewer than 3 outs is acceptable
				// NOTE: Use final scores, not incremental, because summaries appear before their plays
				const isBottomInning = !play.isTopInning;
				const isLateInning = play.inning >= 9;
				const homeTeamWon = finalHomeScore > finalAwayScore;
				const isWalkOff = isBottomInning && isLateInning && homeTeamWon;

				if (outsInThisHalfInning !== 3 && !isWalkOff) {
					errors.push(`Summary for ${play.isTopInning ? 'top' : 'bottom'} ${play.inning} shows ${outsInThisHalfInning} outs (expected 3)`);
				}

				// Mark current half-inning as ended if it matches
				if (currentHalfInning !== null && currentHalfInning.inning === play.inning && currentHalfInning.isTop === play.isTopInning) {
					currentHalfInning.endedWithSummary = true;
				}
				continue; // Skip the rest of the loop for summaries
			}

			// For regular plays, check if we need to start a new half-inning
			if (currentHalfInning === null ||
				play.inning !== currentHalfInning.inning ||
				play.isTopInning !== currentHalfInning.isTop) {

				// Validate previous half-inning if it exists
				if (currentHalfInning !== null && !currentHalfInning.endedWithSummary) {
					// Half-inning ended without a summary - validate it had 3 outs
					if (currentHalfInning.outs !== 3) {
						errors.push(`${currentHalfInning.isTop ? 'Top' : 'Bottom'} ${currentHalfInning.inning} ended with ${currentHalfInning.outs} outs (expected 3)`);
					}
				}

				// Start new half-inning
				currentHalfInning = {
					inning: play.inning,
					isTop: play.isTopInning,
					outs: 0,
					plays: 0,
					endedWithSummary: false,
				};
				halfInnings.push(currentHalfInning);
			}

			// Update current half-inning stats for regular plays
			currentHalfInning.plays++;
			if (isOutEvent) {
				currentHalfInning.outs++;
				if (currentHalfInning.outs > 3) {
					errors.push(`Play ${i}: More than 3 outs in ${play.isTopInning ? 'top' : 'bottom'} of ${play.inning} (outs: ${currentHalfInning.outs})`);
				}
			}

			// === RULE VALIDATIONS ===

			// Skip summary entries for most other validations
			if (play.isSummary) {
				// Verify half-inning summary format
				if (!play.description.includes('Top') && !play.description.includes('Bottom')) {
					errors.push(`Play ${i}: Invalid summary format: ${play.description}`);
				}
				continue;
			}

			// Check for inning jumps
			if (i > 0) {
				const prevPlay = plays[i - 1];
				if (prevPlay && !prevPlay.isSummary && play.inning !== prevPlay.inning) {
					if (play.inning !== prevPlay.inning + 1) {
						errors.push(`Play ${i}: Inning jumped from ${prevPlay.inning} to ${play.inning}`);
					}
				}
			}

			// Fielder's choice should have runners on base
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

			// Sacrifice flies should have runners on base
			if (play.outcome === 'sacrificeFly') {
				const hadRunners = play.runnersBefore && play.runnersBefore.some(r => r !== null);
				if (!hadRunners) {
					errors.push(`Play ${i}: Sacrifice fly with no runners on base`);
				}
			}

			// Sacrifice bunt should typically have runners on base
			if (play.outcome === 'sacrificeBunt') {
				const hadRunners = play.runnersBefore && play.runnersBefore.some(r => r !== null);
				if (!hadRunners) {
					warnings.push(`Play ${i}: Sacrifice bunt with no runners on base (unusual but possible)`);
				}
			}

			// Check for runner advancement sanity
			if (play.runnersBefore && play.runnersAfter) {
				const runnersOnBase = play.runnersAfter.filter(r => r !== null);
				const uniqueRunners = new Set(runnersOnBase);
				if (runnersOnBase.length !== uniqueRunners.size) {
					errors.push(`Play ${i}: Duplicate runners on base. Runners: ${runnersOnBase.join(', ')}`);
				}
			}

			// Check pitcher name format (should be "First Last")
			if (play.pitcherName.includes(',')) {
				errors.push(`Play ${i}: Pitcher name not formatted: "${play.pitcherName}"`);
			}

			// Check batter name format (should be "First Last")
			if (play.batterName.includes(',')) {
				errors.push(`Play ${i}: Batter name not formatted: "${play.batterName}"`);
			}

			// Validate play description format
			this.validatePlayDescription(play, i, errors, warnings);
		}

		// === POST-GAME VALIDATIONS ===

		// Check final half-inning (game might have ended without summary)
		if (currentHalfInning !== null && !currentHalfInning.endedWithSummary) {
			// Game-ending play might not have a summary after it
			// But it should still have 3 outs (unless home team won in bottom 9th)
			const isWalkOff = !currentHalfInning.isTop &&
				currentHalfInning.inning >= 9 &&
				finalHomeScore > finalAwayScore;

			if (!isWalkOff && currentHalfInning.outs !== 3) {
				errors.push(`Final half-inning (${currentHalfInning.isTop ? 'top' : 'bottom'} ${currentHalfInning.inning}) ended with ${currentHalfInning.outs} outs (expected 3)`);
			}
		}

		// Check game length - should be at least 9 innings (unless walk-off)
		// Use the actual state's inning number to determine game length
		const actualInning = state.inning;
		const isTopOfNext = state.isTopInning;

		// Calculate how many full innings were played
		// If we're in top of inning X, then X-1 full innings were completed
		// If we're in bottom of inning X, then X full innings were completed (or in progress)
		let fullInningsPlayed = actualInning;
		if (isTopOfNext) {
			fullInningsPlayed = actualInning - 1;
		}

		// Check if game ended properly
		// Game is INVALID if:
		// - Fewer than 9 full innings played AND NOT a walk-off win
		// Walk-off win: home team won in bottom of 9th or later (or home team leading after top of 9th, doesn't need to bat)
		const hasFull9Innings = fullInningsPlayed >= 9;
		const homeWonWalkOff = !isTopOfNext && actualInning >= 9 && finalHomeScore > finalAwayScore;

		if (!hasFull9Innings && !homeWonWalkOff) {
			errors.push(`Game ended after only ${fullInningsPlayed} full innings (state: inning=${actualInning}, isTop=${isTopOfNext}, home=${finalHomeScore}, away=${finalAwayScore}), expected at least 9`);
		}

		// Check game ended properly
		if (finalAwayScore === finalHomeScore && fullInningsPlayed < 9) {
			errors.push(`Game ended in tie before 9th inning: ${finalAwayScore}-${finalHomeScore}`);
		}

		// Validate each half-inning had exactly 3 outs
		for (const hi of halfInnings) {
			if (hi.outs !== 3 && !hi.endedWithSummary) {
				errors.push(`${hi.isTop ? 'Top' : 'Bottom'} ${hi.inning}: ${hi.outs} outs (expected 3)`);
			}
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
				innings: fullInningsPlayed,
				finalScore: { away: awayScore, home: homeScore },
				outcomesSeen: Array.from(this.seenOutcomes),
				halfInnings,
			},
		};
	}

	private validatePlayDescription(play: PlayEvent, index: number, errors: string[], warnings: string[]): void {
		const desc = play.description.toLowerCase();

		// Skip lineup and pitching change events - they're informational, not plays
		if (play.eventType === 'startingLineup' || play.eventType === 'pitchingChange') {
			return;
		}

		// Check for common formatting issues
		if (desc.includes('  ')) {
			warnings.push(`Play ${index}: Double spaces in description: "${play.description}"`);
		}

		// Check that action descriptions are clear
		const actionWords = ['singles', 'doubles', 'triples', 'homers', 'walks', 'strikes out', 'grounds out', 'flies out', 'lines out', 'pops out', 'reaches', 'hits', 'hit by pitch', 'intentionally walked', 'lays down a sacrifice', 'hits a sacrifice', 'reaches on'];
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

function printGamePlayByPlay(engine: GameEngine, gameNum: number, awayTeam: string, homeTeam: string, teams: Record<string, { city: string; nickname: string }>): void {
	const state = engine.getState();
	const plays = [...state.plays].reverse();

	const awayName = teams[awayTeam] ? `${teams[awayTeam].city} ${teams[awayTeam].nickname}` : awayTeam;
	const homeName = teams[homeTeam] ? `${teams[homeTeam].city} ${teams[homeTeam].nickname}` : homeTeam;

	console.log(`\n${'='.repeat(60)}`);
	console.log(`Game ${gameNum}: ${awayName} @ ${homeName}`);
	console.log('='.repeat(60));

	plays.forEach((play, i) => {
		if (play.isSummary) {
			console.log(`\n  ${play.description}`);
		} else {
			const playNum = plays.slice(0, i).filter(p => !p.isSummary).length + 1;
			console.log(`  ${playNum}. ${play.description}`);
		}
	});
	console.log('');
}

async function runGameTests(numGames: number = 10, verbose: boolean = false, year: number = 1976): Promise<void> {
	console.log(`\n🏟️  Running ${numGames} game simulation tests (${year} season)...\n`);

	const season = await loadSeason(year);
	const validator = new GameValidator();

	const allErrors: string[] = [];
	const allWarnings: string[] = [];
	const results: ValidationResult[] = [];
	const gameTeams: { away: string; home: string }[] = []; // Track teams for verbose output

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

		// Track teams for verbose output
		gameTeams.push({ away: awayTeam, home: homeTeam });

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

		// Print full play-by-play for each game if verbose
		if (verbose) {
			printGamePlayByPlay(engine, i + 1, awayTeam, homeTeam, season.teams);
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

	// Half-inning validation stats
	console.log(`\n📊 Half-Inning Validation:`);
	let totalHalfInnings = 0;
	let halfInningsWith3Outs = 0;
	for (const r of results) {
		for (const hi of r.stats.halfInnings) {
			totalHalfInnings++;
			if (hi.outs === 3) halfInningsWith3Outs++;
		}
	}
	console.log(`  Total half-innings: ${totalHalfInnings}`);
	console.log(`  Half-innings with 3 outs: ${halfInningsWith3Outs}`);
	console.log(`  Half-innings with wrong outs: ${totalHalfInnings - halfInningsWith3Outs}`);


	console.log(`\n${'='.repeat(60)}\n`);

	// Exit with error code if any failures
	if (allErrors.length > 0) {
		process.exit(1);
	}
}

// Parse command line arguments
// Supports: test-game-sim.ts [num_games] [--year|-y YEAR] [--verbose|-v]
// Or: test-game-sim.ts --verbose|-v [num_games] [year]
let numGames = 10;
let verbose = false;
let year = 1976;

for (let i = 0; i < process.argv.slice(2).length; i++) {
	const arg = process.argv.slice(2)[i];
	if (arg === '--verbose' || arg === '-v') {
		verbose = true;
	} else if ((arg === '--year' || arg === '-y') && i + 1 < process.argv.slice(2).length) {
		year = parseInt(process.argv.slice(2)[++i]);
	} else if (!isNaN(parseInt(arg))) {
		numGames = parseInt(arg);
	}
}

runGameTests(numGames, verbose, year).catch(err => {
	console.error('Error running tests:', err);
	process.exit(1);
});
