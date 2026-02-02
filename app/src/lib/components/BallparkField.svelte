<script lang="ts">
	interface Props {
		awayScore: number;
		homeScore: number;
		inning: number;
		isTopInning: boolean;
		outs: number;
		runners: boolean[];
		currentBatter: string;
		currentPitcher: string;
		awayTeam?: string;
		homeTeam?: string;
	}

	let {
		awayScore,
		homeScore,
		inning,
		isTopInning,
		outs,
		runners,
		currentBatter,
		currentPitcher,
		awayTeam = 'AWAY',
		homeTeam = 'HOME'
	}: Props = $props();

	// Format names: "Last, First" -> "F. Last"
	function formatName(name: string): string {
		if (!name || name === 'Loading...') return name;
		const commaIndex = name.indexOf(',');
		if (commaIndex === -1) return name;
		const lastName = name.slice(0, commaIndex).trim();
		const firstName = name.slice(commaIndex + 1).trim();
		return `${firstName.charAt(0)}. ${lastName}`;
	}
</script>

<div class="ballpark-wrapper">
	<!-- Main Field SVG -->
	<svg viewBox="0 0 300 260" class="field-svg" preserveAspectRatio="xMidYMid meet">
		<defs>
			<!-- Outfield grass gradient - darker at edges -->
			<radialGradient id="grassGradient" cx="50%" cy="100%" r="100%">
				<stop offset="0%" stop-color="#2a7d47" />
				<stop offset="60%" stop-color="#236b3c" />
				<stop offset="100%" stop-color="#1a5530" />
			</radialGradient>

			<!-- Infield dirt -->
			<radialGradient id="dirtGradient" cx="50%" cy="50%" r="70%">
				<stop offset="0%" stop-color="#c4915c" />
				<stop offset="100%" stop-color="#a67c4e" />
			</radialGradient>

			<!-- Warning track -->
			<radialGradient id="trackGradient" cx="50%" cy="100%" r="100%">
				<stop offset="0%" stop-color="#8b5a2b" />
				<stop offset="100%" stop-color="#6d4522" />
			</radialGradient>
		</defs>

		<!-- Outfield wall (dark green arc) -->
		<path
			d="M 10,255 L 10,140 Q 10,15 150,15 Q 290,15 290,140 L 290,255"
			fill="#0d3320"
			stroke="#0a2819"
			stroke-width="3"
		/>

		<!-- Warning track arc -->
		<path
			d="M 20,255 L 20,140 Q 20,30 150,30 Q 280,30 280,140 L 280,255"
			fill="url(#trackGradient)"
		/>

		<!-- Outfield grass -->
		<path
			d="M 30,255 L 30,140 Q 30,42 150,42 Q 270,42 270,140 L 270,255"
			fill="url(#grassGradient)"
		/>

		<!-- Mow lines pattern -->
		<g opacity="0.08">
			{#each Array(12) as _, i}
				<line
					x1={30 + i * 20}
					y1="42"
					x2={30 + i * 20}
					y2="255"
					stroke="white"
					stroke-width="8"
				/>
			{/each}
		</g>

		<!-- Infield grass arc (extends above 2nd base) -->
		<ellipse cx="150" cy="215" rx="95" ry="85" fill="#2d8a4e" />

		<!-- Infield dirt diamond -->
		<polygon
			points="150,85 220,165 150,245 80,165"
			fill="url(#dirtGradient)"
		/>

		<!-- Base paths (white chalk lines) -->
		<polygon
			points="150,85 220,165 150,245 80,165"
			fill="none"
			stroke="rgba(255,255,255,0.5)"
			stroke-width="1.5"
		/>

		<!-- Foul lines extending to outfield -->
		<line x1="80" y1="165" x2="25" y2="110" stroke="rgba(255,255,255,0.6)" stroke-width="1.5" />
		<line x1="220" y1="165" x2="275" y2="110" stroke="rgba(255,255,255,0.6)" stroke-width="1.5" />

		<!-- Pitcher's mound -->
		<ellipse cx="150" cy="165" rx="12" ry="9" fill="#b8834a" />
		<rect x="147" y="163" width="6" height="3" fill="white" rx="0.5" />

		<!-- Home plate area -->
		<rect x="140" y="228" width="20" height="28" fill="#a67c4e" rx="2" />
		<!-- Batter's boxes -->
		<rect x="125" y="225" width="14" height="24" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1" />
		<rect x="161" y="225" width="14" height="24" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1" />
		<!-- Home plate -->
		<polygon points="150,233 155,238 155,243 145,243 145,238" fill="white" />

		<!-- ===== BASES ===== -->

		<!-- Second base -->
		<g transform="translate(150, 85)">
			<rect x="-7" y="-7" width="14" height="14" fill="white" rx="1" transform="rotate(45)" />
			{#if runners[1]}
				<!-- Runner dot -->
				<circle cx="0" cy="-18" r="6" fill="#fbbf24" />
			{/if}
		</g>

		<!-- First base -->
		<g transform="translate(220, 165)">
			<rect x="-6" y="-6" width="12" height="12" fill="white" rx="1" />
			{#if runners[0]}
				<!-- Runner dot -->
				<circle cx="10" cy="-10" r="6" fill="#fbbf24" />
			{/if}
		</g>

		<!-- Third base -->
		<g transform="translate(80, 165)">
			<rect x="-6" y="-6" width="12" height="12" fill="white" rx="1" />
			{#if runners[2]}
				<!-- Runner dot -->
				<circle cx="-10" cy="-10" r="6" fill="#fbbf24" />
			{/if}
		</g>
	</svg>

	<!-- Score Bug (TV broadcast style) -->
	<div class="score-bug">
		<!-- Teams & Score -->
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

		<!-- Divider -->
		<div class="divider"></div>

		<!-- Mini Diamond (base runners indicator) -->
		<div class="diamond-section">
			<svg viewBox="0 0 32 32" class="mini-diamond">
				<!-- Diamond outline -->
				<polygon
					points="16,4 28,16 16,28 4,16"
					fill="none"
					stroke="rgba(255,255,255,0.3)"
					stroke-width="1.5"
				/>
				<!-- 2nd base -->
				<circle cx="16" cy="4" r="3.5" fill={runners[1] ? '#fbbf24' : 'rgba(255,255,255,0.2)'} />
				<!-- 1st base -->
				<circle cx="28" cy="16" r="3.5" fill={runners[0] ? '#fbbf24' : 'rgba(255,255,255,0.2)'} />
				<!-- 3rd base -->
				<circle cx="4" cy="16" r="3.5" fill={runners[2] ? '#fbbf24' : 'rgba(255,255,255,0.2)'} />
				<!-- Home plate marker -->
				<polygon points="16,26 18,28 16,30 14,28" fill="rgba(255,255,255,0.4)" />
			</svg>
		</div>

		<!-- Divider -->
		<div class="divider"></div>

		<!-- Inning -->
		<div class="inning-section">
			<span class="inning-arrow">{isTopInning ? '▲' : '▼'}</span>
			<span class="inning-num">{inning}</span>
		</div>

		<!-- Divider -->
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

	<!-- Matchup Info (below score bug) -->
	<div class="matchup-info">
		<div class="matchup-row">
			<span class="matchup-label">P</span>
			<span class="matchup-name">{formatName(currentPitcher)}</span>
		</div>
		<span class="matchup-vs">vs</span>
		<div class="matchup-row">
			<span class="matchup-label">AB</span>
			<span class="matchup-name">{formatName(currentBatter)}</span>
		</div>
	</div>
</div>

<style>
	.ballpark-wrapper {
		width: 100%;
		max-width: 700px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
	}

	.field-svg {
		width: 100%;
		height: auto;
		border-radius: 0.75rem 0.75rem 0 0;
		background: #0d1117;
	}

	/* Score Bug - TV broadcast style */
	.score-bug {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
		padding: 0.5rem 1rem;
		border-radius: 0.5rem;
		border: 1px solid rgba(255, 255, 255, 0.1);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
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

	/* Responsive adjustments */
	@media (min-width: 640px) {
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

		.matchup-name {
			font-size: 1rem;
		}
	}
</style>
