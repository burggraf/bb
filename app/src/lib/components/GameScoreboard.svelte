<script lang="ts">
	import { formatNameInitialLast } from '$lib/utils/name-format.js';
	import type { PlayEvent } from '$lib/game/types.js';

	interface Props {
		awayScore: number;
		homeScore: number;
		inning: number;
		isTopInning: boolean;
		outs: number;
		runners: [string | null, string | null, string | null]; // Runner IDs
		runnerNames: [string | null, string | null, string | null]; // Runner names
		currentBatter: string;
		currentPitcher: string;
		awayTeam?: string;
		homeTeam?: string;
		awayTeamFull?: string;
		homeTeamFull?: string;
		plays: PlayEvent[];
	}

	let {
		awayScore,
		homeScore,
		inning,
		isTopInning,
		outs,
		runners,
		runnerNames,
		currentBatter,
		currentPitcher,
		awayTeam = 'AWAY',
		homeTeam = 'HOME',
		awayTeamFull = 'Away Team',
		homeTeamFull = 'Home Team',
		plays
	}: Props = $props();

	// Compute inning-by-inning scores from plays
	interface InningScore {
		away: number | null;
		home: number | null;
	}

	// Calculate line score from plays
	function computeLineScore(): { innings: InningScore[]; awayHits: number; homeHits: number; awayErrors: number; homeErrors: number; maxInning: number } {
		const innings: InningScore[] = [];
		let awayHits = 0;
		let homeHits = 0;
		let awayErrors = 0;
		let homeErrors = 0;

		// Find the actual max inning that has plays (not just the current inning value)
		// This prevents showing empty 10th inning when game ends at inning=10
		let actualMaxInning = 1;
		for (const play of plays) {
			if (!play.isSummary) {
				actualMaxInning = Math.max(actualMaxInning, play.inning);
			}
		}

		// For 9-inning games, ensure at least 9 innings are shown (even if no data yet)
		// But don't show more innings than actually played + current inning
		const maxInning = Math.max(Math.min(inning, actualMaxInning), 9);
		for (let i = 1; i <= maxInning; i++) {
			innings.push({ away: null, home: null });
		}

		for (const play of plays) {
			if (play.isSummary) continue;

			const idx = play.inning - 1;
			if (idx < 0 || idx >= innings.length) continue;

			// Count runs
			if (play.isTopInning) {
				innings[idx].away = (innings[idx].away || 0) + play.runsScored;
			} else {
				innings[idx].home = (innings[idx].home || 0) + play.runsScored;
			}

			// Count hits
			const isHit = ['single', 'double', 'triple', 'homeRun'].includes(play.outcome);
			if (isHit) {
				if (play.isTopInning) {
					awayHits++;
				} else {
					homeHits++;
				}
			}

			// Count errors (reachedOnError)
			if (play.outcome === 'reachedOnError') {
				if (play.isTopInning) {
					homeErrors++; // Defense made error
				} else {
					awayErrors++;
				}
			}
		}

		// Mark current inning as in-progress if not complete
		const currentIdx = inning - 1;
		if (currentIdx >= 0 && currentIdx < innings.length) {
			// In modern baseball, both teams get at least 0 if they've started the inning
			// Top of inning: away team is active, home team hasn't batted yet
			if (isTopInning) {
				if (innings[currentIdx].away === null) innings[currentIdx].away = 0;
			} else {
				// Bottom of inning: both teams should have at least 0
				if (innings[currentIdx].away === null) innings[currentIdx].away = 0;
				if (innings[currentIdx].home === null) innings[currentIdx].home = 0;
			}
		}

		return { innings, awayHits, homeHits, awayErrors, homeErrors, maxInning };
	}

	// Format runners row
	const runnersText = $derived.by(() => {
		if (runners[0] || runners[1] || runners[2]) {
			const parts = [];
			if (runners[2]) parts.push(`3B: ${formatNameInitialLast(runnerNames[2])}`);
			if (runners[1]) parts.push(`2B: ${formatNameInitialLast(runnerNames[1])}`);
			if (runners[0]) parts.push(`1B: ${formatNameInitialLast(runnerNames[0])}`);
			return parts.join(' • ');
		}
		return 'Bases empty';
	});

	// Determine which innings to show (sliding window for extras)
	function getVisibleInnings(totalInnings: number, currentInning: number): { start: number; end: number } {
		if (totalInnings <= 9) {
			return { start: 1, end: totalInnings };
		}
		// For extra innings, show a 9-inning window
		const end = Math.max(currentInning, 9);
		const start = Math.max(1, end - 8);
		return { start, end };
	}

	// Reactive computations
	const lineScore = $derived(computeLineScore());
	const visibleRange = $derived(getVisibleInnings(lineScore.innings.length, inning));
	const visibleInnings = $derived(
		lineScore.innings.slice(visibleRange.start - 1, visibleRange.end)
	);
</script>

<div class="scoreboard-wrapper">
	<!-- Main container: score bug + line score side by side on desktop -->
	<div class="scoreboard-container">
		<!-- Score Bug (compact current game status) -->
		<div class="score-bug">
			<div class="score-bug-top">
				<div class="teams-section">
					<div class="team-row">
						<span class="team-abbr">{awayTeam}</span>
						<span class="team-score">{awayScore}</span>
					</div>
					<div class="team-row">
						<span class="team-abbr">{homeTeam}</span>
						<span class="team-score">{homeScore}</span>
					</div>
				</div>

				<div class="divider"></div>

				<!-- Mini Diamond -->
				<div class="diamond-section">
					<svg viewBox="0 0 32 32" class="mini-diamond">
						<polygon
							points="16,4 28,16 16,28 4,16"
							fill="none"
							stroke="rgba(255,255,255,0.3)"
							stroke-width="1.5"
						/>
						<circle cx="16" cy="4" r="3.5" fill={runners[1] ? '#fbbf24' : 'rgba(255,255,255,0.2)'} />
						<circle cx="28" cy="16" r="3.5" fill={runners[0] ? '#fbbf24' : 'rgba(255,255,255,0.2)'} />
						<circle cx="4" cy="16" r="3.5" fill={runners[2] ? '#fbbf24' : 'rgba(255,255,255,0.2)'} />
						<polygon points="16,26 18,28 16,30 14,28" fill="rgba(255,255,255,0.4)" />
					</svg>
				</div>

				<div class="divider"></div>

				<!-- Inning -->
				<div class="inning-section">
					<span class="inning-arrow">{isTopInning ? '▲' : '▼'}</span>
					<span class="inning-num">{inning}</span>
				</div>

				<div class="divider"></div>

				<!-- Outs -->
				<div class="outs-section">
					<span class="outs-label">OUT</span>
					<div class="outs-dots">
						{#each [0, 1, 2] as i}
							<span class="out-dot" class:active={i < outs}></span>
						{/each}
					</div>
				</div>
			</div>

			<!-- Runners text at bottom of score bug -->
			<div class="runners-row">
				<span class="runner-text" class:empty={!runners[0] && !runners[1] && !runners[2]}>
					{runnersText}
				</span>
			</div>
		</div>

		<!-- Line Score (innings + R H E) -->
		<div class="line-score">
			<table>
				<thead>
					<tr>
						<th class="team-col"></th>
						{#each { length: visibleRange.end - visibleRange.start + 1 } as _, i}
							<th class="inning-col">{visibleRange.start + i}</th>
						{/each}
						<th class="stat-col">R</th>
						<th class="stat-col">H</th>
						<th class="stat-col">E</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td class="team-col">{awayTeam}</td>
						{#each visibleInnings as inn, i}
							<td class="inning-col" class:current={visibleRange.start + i === inning && isTopInning}>
								{inn.away !== null ? inn.away : '-'}
							</td>
						{/each}
						<td class="stat-col total">{awayScore}</td>
						<td class="stat-col">{lineScore.awayHits}</td>
						<td class="stat-col">{lineScore.awayErrors}</td>
					</tr>
					<tr>
						<td class="team-col">{homeTeam}</td>
						{#each visibleInnings as inn, i}
							<td class="inning-col" class:current={visibleRange.start + i === inning && !isTopInning}>
								{inn.home !== null ? inn.home : '-'}
							</td>
						{/each}
						<td class="stat-col total">{homeScore}</td>
						<td class="stat-col">{lineScore.homeHits}</td>
						<td class="stat-col">{lineScore.homeErrors}</td>
					</tr>
				</tbody>
			</table>
		</div>
	</div>

	<!-- Matchup Info -->
	<div class="matchup-info">
		<div class="matchup-row">
			<span class="matchup-label">P</span>
			<span class="matchup-name">{formatNameInitialLast(currentPitcher)}</span>
		</div>
		<span class="matchup-vs">vs</span>
		<div class="matchup-row">
			<span class="matchup-label">AB</span>
			<span class="matchup-name">{formatNameInitialLast(currentBatter)}</span>
		</div>
	</div>

</div>

<style>
	.scoreboard-wrapper {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
	}

	/* Container for score bug + line score */
	.scoreboard-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
	}

	/* Score Bug */
	.score-bug {
		display: flex;
		flex-direction: column;
		background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
		padding: 0.75rem 1rem;
		border-radius: 0.5rem;
		border: 1px solid rgba(255, 255, 255, 0.1);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
		height: 6.5rem;
		justify-content: space-between;
	}

	.score-bug-top {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.runners-row {
		display: flex;
		gap: 0.75rem;
		justify-content: center;
		margin-top: -0.75rem;
	}

	.runner-text {
		font-size: 0.6875rem;
		color: #fbbf24;
	}

	.runner-text.empty {
		color: rgba(255, 255, 255, 0.3);
		font-style: italic;
	}

	.teams-section {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.team-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.team-abbr {
		font-size: 0.75rem;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.7);
		width: 2rem;
		letter-spacing: 0.02em;
	}

	.team-score {
		font-size: 1rem;
		font-weight: 700;
		color: white;
		min-width: 1.25rem;
		text-align: right;
	}

	.divider {
		width: 1px;
		height: 2rem;
		background: rgba(255, 255, 255, 0.15);
	}

	.diamond-section {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.mini-diamond {
		width: 2rem;
		height: 2rem;
	}

	.inning-section {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.inning-arrow {
		font-size: 0.625rem;
		color: rgba(255, 255, 255, 0.6);
	}

	.inning-num {
		font-size: 1.125rem;
		font-weight: 700;
		color: white;
	}

	.outs-section {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
	}

	.outs-label {
		font-size: 0.5rem;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.5);
		letter-spacing: 0.1em;
	}

	.outs-dots {
		display: flex;
		gap: 0.25rem;
	}

	.out-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.2);
		transition: all 0.2s ease;
	}

	.out-dot.active {
		background: #fbbf24;
		box-shadow: 0 0 6px #fbbf24;
	}

	/* Line Score Table */
	.line-score {
		background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
		border-radius: 0.5rem;
		border: 1px solid rgba(255, 255, 255, 0.1);
		padding: 0.75rem 0.75rem;
		overflow-x: auto;
		max-width: 100%;
		height: 6.5rem;
		display: flex;
		flex-direction: column;
		justify-content: center;
	}

	.line-score table {
		border-collapse: collapse;
		font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace;
		font-size: 0.75rem;
		white-space: nowrap;
	}

	.line-score th,
	.line-score td {
		padding: 0.25rem 0.5rem;
		text-align: center;
	}

	.line-score th {
		color: rgba(255, 255, 255, 0.5);
		font-weight: 500;
		font-size: 0.625rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
	}

	.line-score td {
		color: rgba(255, 255, 255, 0.8);
	}

	.team-col {
		text-align: left !important;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.9) !important;
		padding-right: 1rem !important;
	}

	.inning-col {
		min-width: 1.5rem;
	}

	.inning-col.current {
		background: rgba(251, 191, 36, 0.2);
		color: #fbbf24 !important;
		font-weight: 700;
	}

	.stat-col {
		border-left: 1px solid rgba(255, 255, 255, 0.1);
		font-weight: 600;
	}

	.stat-col.total {
		color: white !important;
	}

	/* Matchup Info */
	.matchup-info {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 1rem;
		background: rgba(15, 23, 42, 0.6);
		border-radius: 0.375rem;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
	}

	.matchup-row {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.matchup-label {
		font-size: 0.625rem;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.4);
		background: rgba(255, 255, 255, 0.1);
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
	}

	.matchup-name {
		font-size: 0.875rem;
		font-weight: 500;
		color: rgba(255, 255, 255, 0.9);
	}

	.matchup-vs {
		font-size: 0.625rem;
		color: rgba(255, 255, 255, 0.3);
		font-style: italic;
	}


	/* Responsive: side by side on larger screens */
	@media (min-width: 768px) {
		.scoreboard-container {
			flex-direction: row;
			justify-content: center;
			gap: 1rem;
		}

		.score-bug {
			gap: 1rem;
			padding: 0.625rem 1.25rem;
		}

		.team-abbr {
			font-size: 0.8125rem;
		}

		.team-score {
			font-size: 1.125rem;
		}

		.mini-diamond {
			width: 2.25rem;
			height: 2.25rem;
		}

		.line-score {
			padding: 0.75rem;
		}

		.line-score table {
			font-size: 0.8125rem;
		}

		.line-score th,
		.line-score td {
			padding: 0.375rem 0.625rem;
		}

		.matchup-name {
			font-size: 1rem;
		}
	}

	@media (min-width: 1024px) {
		.score-bug {
			gap: 1.25rem;
			padding: 0.75rem 1.5rem;
		}

		.team-abbr {
			font-size: 0.875rem;
			width: 2.5rem;
		}

		.team-score {
			font-size: 1.25rem;
		}

		.inning-num {
			font-size: 1.25rem;
		}

		.line-score table {
			font-size: 0.875rem;
		}

		.inning-col {
			min-width: 2rem;
		}
	}
</style>
