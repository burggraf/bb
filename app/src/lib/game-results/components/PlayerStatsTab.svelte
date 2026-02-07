<script lang="ts">
	import type { GameEvent, Outcome } from '../types.js';

	interface Props {
		events: GameEvent[];
		awayTeamId: string;
		homeTeamId: string;
	}

	let { events, awayTeamId, homeTeamId }: Props = $props();

	// Aggregate player stats from game events
	const playerStats = $derived(() => {
		const batters = new Map<
			string,
			{
				name: string;
				teamId: string;
				ab: number;
				r: number;
				h: number;
				rbi: number;
				bb: number;
				so: number;
				hr: number;
				singles: number;
				doubles: number;
				triples: number;
			}
		>();

		const pitchers = new Map<
			string,
			{
				name: string;
				teamId: string;
				ip: number;
				outs: number;
				h: number;
				r: number;
				er: number;
				bb: number;
				so: number;
				hr: number;
				battersFaced: number;
			}
		>();

		const batterRuns = new Map<string, number>(); // Track runs scored by batters
		const teamMap = new Map<string, string>(); // Map batter ID to team ID

		for (const event of events) {
			// Skip non-plate appearance events
			if (event.eventType !== 'plateAppearance' || !event.outcome || !event.batterId) continue;

			// Determine team (batter's team)
			// Home team bats in bottom, away team bats in top
			const isHomeTeam = !event.isTopInning;
			const teamId = isHomeTeam ? homeTeamId : awayTeamId;
			teamMap.set(event.batterId, teamId);

			// Get or create batter stats
			let batter = batters.get(event.batterId);
			if (!batter) {
				batter = {
					name: event.batterName ?? 'Unknown',
					teamId,
					ab: 0,
					r: 0,
					h: 0,
					rbi: 0,
					bb: 0,
					so: 0,
					hr: 0,
					singles: 0,
					doubles: 0,
					triples: 0
				};
				batters.set(event.batterId, batter);
			}

			// Track runs scored (from runnerAfter/runnerBefore comparison)
			if (event.runner1bAfter && !event.runner1bBefore && event.runner1bAfter === event.batterId) {
				// This shouldn't happen - batter can't be on 1B after their own PA
			}
			// Check if batter scored (they'd be in runnerAfter but not runnerBefore)
			// Actually, the scorer is tracked separately. Let me check if batter scored.
			// For now, we'll track runs from the runsScored field and scorer tracking

			// At-bats (not walks, HBP, sacrifices, catcher interference)
			if (
				!['walk', 'hitByPitch', 'sacrificeFly', 'sacrificeBunt', 'catcherInterference'].includes(
					event.outcome
				)
			) {
				batter.ab++;
			}

			// Hits
			if (['single', 'double', 'triple', 'homeRun'].includes(event.outcome)) {
				batter.h++;
				if (event.outcome === 'single') batter.singles++;
				if (event.outcome === 'double') batter.doubles++;
				if (event.outcome === 'triple') batter.triples++;
			}

			// Walks
			if (event.outcome === 'walk') batter.bb++;

			// Strikeouts
			if (event.outcome === 'strikeout') batter.so++;

			// Home runs
			if (event.outcome === 'homeRun') batter.hr++;

			// RBIs (runs scored on this play)
			batter.rbi += event.runsScored;

			// Track pitcher stats
			if (event.pitcherId) {
				let pitcher = pitchers.get(event.pitcherId);
				if (!pitcher) {
					pitcher = {
						name: event.pitcherName ?? 'Unknown',
						teamId: isHomeTeam ? awayTeamId : homeTeamId, // Pitcher is opposite team
						ip: 0,
						outs: 0,
						h: 0,
						r: 0,
						er: 0,
						bb: 0,
						so: 0,
						hr: 0,
						battersFaced: 0
					};
					pitchers.set(event.pitcherId, pitcher);
				}

				pitcher.battersFaced++;

				// Outs recorded
				if (
					['strikeout', 'groundOut', 'flyOut', 'lineOut', 'popOut', 'sacrificeFly', 'sacrificeBunt', 'fieldersChoice'].includes(
						event.outcome
					)
				) {
					pitcher.outs++;
				}

				// Hits allowed
				if (['single', 'double', 'triple', 'homeRun'].includes(event.outcome)) {
					pitcher.h++;
				}

				// Walks allowed
				if (['walk', 'hitByPitch'].includes(event.outcome)) {
					pitcher.bb++;
				}

				// Strikeouts
				if (event.outcome === 'strikeout') {
					pitcher.so++;
				}

				// Home runs allowed
				if (event.outcome === 'homeRun') {
					pitcher.hr++;
				}

				// Runs allowed
				pitcher.r += event.runsScored;

				// Earned runs
				pitcher.er += event.earnedRuns;
			}
		}

		// Calculate innings pitched for pitchers
		for (const pitcher of pitchers.values()) {
			pitcher.ip = pitcher.outs / 3;
		}

		// Calculate runs scored for batters by tracking who crossed home
		// This is tricky - we need to track runner movement
		// Let's do a second pass to find runs
		const runnerPositions = new Map<string, { base: number; crossedHome: boolean }>();

		for (const event of events) {
			if (event.eventType !== 'plateAppearance') continue;

			// Track runners before
			const beforeRunners: string[] = [
				event.runner1bBefore,
				event.runner2bBefore,
				event.runner3bBefore
			].filter((id): id is string => id !== null);

			// Track runners after
			const afterRunners: string[] = [
				event.runner1bAfter,
				event.runner2bAfter,
				event.runner3bAfter
			].filter((id): id is string => id !== null);

			// Runners who were on base but are not anymore (they scored or made out)
			// For simplicity, let's use the runsScored field and match to scorers
			// But we don't have scorerIds in GameEvent, just runsScored count

			// For a simpler approach, track base runners and see who disappears
			for (const runnerId of beforeRunners) {
				if (!afterRunners.includes(runnerId)) {
					// Runner either scored or made out
					// For this implementation, we'll assume they scored if runsScored > 0
					// This is imperfect but works for most cases
					const currentRuns = batterRuns.get(runnerId) ?? 0;
					if (event.runsScored > 0 && (!event.batterId || runnerId !== event.batterId)) {
						batterRuns.set(runnerId, currentRuns + 1);
					}
				}
			}

			// Batter could also score on HR
			if (event.outcome === 'homeRun' && event.batterId) {
				const currentRuns = batterRuns.get(event.batterId) ?? 0;
				batterRuns.set(event.batterId, currentRuns + 1);
			}
		}

		// Add runs to batter stats
		for (const [batterId, runs] of batterRuns) {
			const batter = batters.get(batterId);
			if (batter) {
				batter.r = runs;
			}
		}

		return { batters, pitchers };
	});

	// Calculate batting average
	function avg(h: number, ab: number): string {
		if (ab === 0) return '.---';
		return (h / ab).toFixed(3).slice(1);
	}

	// Format innings pitched
	function formatIP(ip: number): string {
		const full = Math.floor(ip);
		const partial = Math.round((ip - full) * 3);
		return `${full}${partial > 0 ? `'${partial}` : ''}`;
	}

	// Calculate ERA
	function era(er: number, ip: number): string {
		if (ip === 0) return '-.--';
		return ((er * 9) / ip).toFixed(2);
	}

	// Get stats for a team
	const awayBatters = $derived(
		Array.from(playerStats().batters.values())
			.filter((b) => b.teamId === awayTeamId)
			.sort((a, b) => {
				// Sort by batting order implicitly (first appearance in game)
				return 0;
			})
	);

	const homeBatters = $derived(
		Array.from(playerStats().batters.values())
			.filter((b) => b.teamId === homeTeamId)
			.sort((a, b) => {
				return 0;
			})
	);

	const awayPitchers = $derived(
		Array.from(playerStats().pitchers.values())
			.filter((p) => p.teamId === awayTeamId)
			.sort((a, b) => a.name.localeCompare(b.name))
	);

	const homePitchers = $derived(
		Array.from(playerStats().pitchers.values())
			.filter((p) => p.teamId === homeTeamId)
			.sort((a, b) => a.name.localeCompare(b.name))
	);
</script>

<div class="space-y-6">
	<!-- Batting Stats -->
	<div>
		<h3 class="text-lg font-semibold text-white mb-3">Batting</h3>

		<!-- Away Team -->
		<div class="mb-4">
			<h4 class="text-sm font-medium text-zinc-400 mb-2">{awayTeamId}</h4>
			<div class="overflow-x-auto">
				<table class="w-full text-sm font-mono">
					<thead>
						<tr class="border-b border-zinc-800">
							<th class="text-left py-2 px-2 text-zinc-500">Player</th>
							<th class="text-center py-2 px-2 text-zinc-400">AB</th>
							<th class="text-center py-2 px-2 text-zinc-400">R</th>
							<th class="text-center py-2 px-2 text-zinc-400">H</th>
							<th class="text-center py-2 px-2 text-zinc-400">RBI</th>
							<th class="text-center py-2 px-2 text-zinc-400">BB</th>
							<th class="text-center py-2 px-2 text-zinc-400">SO</th>
							<th class="text-center py-2 px-2 text-zinc-400">HR</th>
							<th class="text-center py-2 px-2 text-zinc-400">AVG</th>
						</tr>
					</thead>
					<tbody>
						{#each awayBatters as batter}
							<tr class="border-b border-zinc-800/50">
								<td class="py-1 px-2 text-white">{batter.name}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{batter.ab}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{batter.r}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{batter.h}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{batter.rbi}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{batter.bb}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{batter.so}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{batter.hr}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{avg(batter.h, batter.ab)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>

		<!-- Home Team -->
		<div class="mb-4">
			<h4 class="text-sm font-medium text-zinc-400 mb-2">{homeTeamId}</h4>
			<div class="overflow-x-auto">
				<table class="w-full text-sm font-mono">
					<thead>
						<tr class="border-b border-zinc-800">
							<th class="text-left py-2 px-2 text-zinc-500">Player</th>
							<th class="text-center py-2 px-2 text-zinc-400">AB</th>
							<th class="text-center py-2 px-2 text-zinc-400">R</th>
							<th class="text-center py-2 px-2 text-zinc-400">H</th>
							<th class="text-center py-2 px-2 text-zinc-400">RBI</th>
							<th class="text-center py-2 px-2 text-zinc-400">BB</th>
							<th class="text-center py-2 px-2 text-zinc-400">SO</th>
							<th class="text-center py-2 px-2 text-zinc-400">HR</th>
							<th class="text-center py-2 px-2 text-zinc-400">AVG</th>
						</tr>
					</thead>
					<tbody>
						{#each homeBatters as batter}
							<tr class="border-b border-zinc-800/50">
								<td class="py-1 px-2 text-white">{batter.name}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{batter.ab}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{batter.r}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{batter.h}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{batter.rbi}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{batter.bb}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{batter.so}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{batter.hr}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{avg(batter.h, batter.ab)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	</div>

	<!-- Pitching Stats -->
	<div>
		<h3 class="text-lg font-semibold text-white mb-3">Pitching</h3>

		<!-- Away Team -->
		<div class="mb-4">
			<h4 class="text-sm font-medium text-zinc-400 mb-2">{awayTeamId}</h4>
			<div class="overflow-x-auto">
				<table class="w-full text-sm font-mono">
					<thead>
						<tr class="border-b border-zinc-800">
							<th class="text-left py-2 px-2 text-zinc-500">Player</th>
							<th class="text-center py-2 px-2 text-zinc-400">IP</th>
							<th class="text-center py-2 px-2 text-zinc-400">H</th>
							<th class="text-center py-2 px-2 text-zinc-400">R</th>
							<th class="text-center py-2 px-2 text-zinc-400">ER</th>
							<th class="text-center py-2 px-2 text-zinc-400">BB</th>
							<th class="text-center py-2 px-2 text-zinc-400">SO</th>
							<th class="text-center py-2 px-2 text-zinc-400">HR</th>
							<th class="text-center py-2 px-2 text-zinc-400">ERA</th>
						</tr>
					</thead>
					<tbody>
						{#each awayPitchers as pitcher}
							<tr class="border-b border-zinc-800/50">
								<td class="py-1 px-2 text-white">{pitcher.name}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{formatIP(pitcher.ip)}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{pitcher.h}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{pitcher.r}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{pitcher.er}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{pitcher.bb}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{pitcher.so}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{pitcher.hr}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{era(pitcher.er, pitcher.ip)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>

		<!-- Home Team -->
		<div class="mb-4">
			<h4 class="text-sm font-medium text-zinc-400 mb-2">{homeTeamId}</h4>
			<div class="overflow-x-auto">
				<table class="w-full text-sm font-mono">
					<thead>
						<tr class="border-b border-zinc-800">
							<th class="text-left py-2 px-2 text-zinc-500">Player</th>
							<th class="text-center py-2 px-2 text-zinc-400">IP</th>
							<th class="text-center py-2 px-2 text-zinc-400">H</th>
							<th class="text-center py-2 px-2 text-zinc-400">R</th>
							<th class="text-center py-2 px-2 text-zinc-400">ER</th>
							<th class="text-center py-2 px-2 text-zinc-400">BB</th>
							<th class="text-center py-2 px-2 text-zinc-400">SO</th>
							<th class="text-center py-2 px-2 text-zinc-400">HR</th>
							<th class="text-center py-2 px-2 text-zinc-400">ERA</th>
						</tr>
					</thead>
					<tbody>
						{#each homePitchers as pitcher}
							<tr class="border-b border-zinc-800/50">
								<td class="py-1 px-2 text-white">{pitcher.name}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{formatIP(pitcher.ip)}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{pitcher.h}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{pitcher.r}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{pitcher.er}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{pitcher.bb}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{pitcher.so}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{pitcher.hr}</td>
								<td class="py-1 px-2 text-center text-zinc-300">{era(pitcher.er, pitcher.ip)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	</div>
</div>
