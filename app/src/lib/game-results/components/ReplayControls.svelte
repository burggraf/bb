<script lang="ts">
	import { onMount } from 'svelte';
	import { SeasonReplayEngine } from '$lib/season-replay/index.js';
	import type { ReplayProgress, ReplayStatus } from '$lib/season-replay/index.js';

	interface Props {
		seriesId: string;
		seasonYear: number;
		onStandingsUpdate: () => Promise<void>;
		onStatusChange?: (status: ReplayStatus) => void;
	}

	let { seriesId, seasonYear, onStandingsUpdate, onStatusChange }: Props = $props();

	// Engine
	let engine = $state<SeasonReplayEngine | null>(null);

	// Progress state
	let progress = $state<ReplayProgress>({
		currentGameIndex: 0,
		totalGames: 0,
		percent: 0,
		currentDate: ''
	});

	let status = $state<ReplayStatus>('idle');
	let loading = $state(false);
	let error = $state<string | null>(null);

	// Initialize engine on mount
	onMount(async () => {
		try {
			engine = new SeasonReplayEngine(seriesId, seasonYear, { playbackSpeed: 'instant' });
			await engine.initialize();

			// Set up event listeners
			engine.on('statusChange', (data: { status: ReplayStatus }) => {
				status = data.status;
				onStatusChange?.(data.status);
			});

			engine.on('progress', (data: ReplayProgress) => {
				progress = data;
			});

			// Get initial progress and status
			progress = engine.getProgress();
			status = engine.getStatus();

			// Auto-resume if status was 'playing'
			if (status === 'playing') {
				await resume();
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to initialize replay engine';
		}
	});

	// Control actions
	async function togglePlayPause() {
		if (!engine) return;

		if (status === 'playing') {
			await pause();
		} else {
			await resume();
		}
	}

	async function resume() {
		if (!engine || status === 'playing') return;
		await engine.resume();
		status = engine.getStatus();

		// Auto-play games
		while (engine.getStatus() === 'playing') {
			await playNextGame();
		}
	}

	async function pause() {
		if (!engine) return;
		await engine.pause();
		status = engine.getStatus();
	}

	async function playNextGame() {
		if (!engine || loading) return;
		loading = true;
		error = null;

		try {
			const result = await engine.playNextGame();
			progress = engine.getProgress();
			status = engine.getStatus();

			// Trigger standings update
			if (result) {
				await onStandingsUpdate();
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to play game';
		} finally {
			loading = false;
		}
	}

	async function playNextDay() {
		if (!engine || loading) return;
		loading = true;
		error = null;

		try {
			const results = await engine.playNextDay();
			progress = engine.getProgress();
			status = engine.getStatus();

			// Trigger standings update
			if (results.length > 0) {
				await onStandingsUpdate();
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to play day';
		} finally {
			loading = false;
		}
	}

	async function stop() {
		if (!engine) return;

		// Pause if playing
		if (status === 'playing') {
			await engine.pause();
		}

		status = engine.getStatus();
	}

	// Status badge helper
	function getStatusBadgeColor(status: ReplayStatus): string {
		switch (status) {
			case 'playing':
				return 'bg-green-900/50 text-green-300 border-green-700';
			case 'paused':
				return 'bg-yellow-900/50 text-yellow-300 border-yellow-700';
			case 'completed':
				return 'bg-blue-900/50 text-blue-300 border-blue-700';
			case 'idle':
			default:
				return 'bg-zinc-800 text-zinc-400 border-zinc-700';
		}
	}

	function getStatusText(status: ReplayStatus): string {
		switch (status) {
			case 'playing':
				return 'Playing';
			case 'paused':
				return 'Paused';
			case 'completed':
				return 'Completed';
			case 'idle':
			default:
				return 'Idle';
		}
	}
</script>

<div class="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-4">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<h3 class="text-lg font-semibold text-white">Season Replay</h3>
		<span class="text-xs px-2 py-1 rounded border {getStatusBadgeColor(status)}">
			{getStatusText(status)}
		</span>
	</div>

	<!-- Error message -->
	{#if error}
		<div class="text-red-400 text-sm">{error}</div>
	{/if}

	<!-- Progress bar -->
	<div class="space-y-2">
		<div class="flex justify-between text-sm">
			<span class="text-zinc-400">Progress</span>
			<span class="text-white font-medium">{progress.currentGameIndex} / {progress.totalGames} games</span>
		</div>

		<!-- Percentage bar -->
		<div class="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
			<div
				class="bg-blue-500 h-full transition-all duration-300 ease-out"
				style="width: {progress.percent}%"
			></div>
		</div>

		<div class="flex justify-between text-xs text-zinc-500">
			<span>{progress.percent}% complete</span>
			<span>{progress.currentDate || 'Not started'}</span>
		</div>
	</div>

	<!-- Control buttons -->
	<div class="grid grid-cols-2 gap-2">
		<!-- Play/Pause button (spans 2 columns) -->
		<button
			onclick={togglePlayPause}
			disabled={status === 'completed' || !engine || loading}
			class="col-span-2 flex items-center justify-center gap-2 px-4 py-2 rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed
				{status === 'playing' ? 'bg-yellow-600 hover:bg-yellow-700 text-white' : 'bg-green-600 hover:bg-green-700 text-white'}"
		>
			{#if loading}
				<svg
					class="animate-spin h-4 w-4"
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
				>
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
					<path
						class="opacity-75"
						fill="currentColor"
						d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
					></path>
				</svg>
				Processing...
			{:else if status === 'playing'}
				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
					<rect x="6" y="4" width="4" height="16"></rect>
					<rect x="14" y="4" width="4" height="16"></rect>
				</svg>
				Pause
			{:else}
				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
					<polygon points="5 3 19 12 5 21 5 3"></polygon>
				</svg>
				{status === 'completed' ? 'Finished' : status === 'paused' ? 'Resume' : 'Play'}
			{/if}
		</button>

		<!-- Next Game -->
		<button
			onclick={playNextGame}
			disabled={status === 'completed' || !engine || loading}
			class="flex items-center justify-center gap-1 px-3 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded font-medium transition-colors"
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<polygon points="5 4 15 12 5 20 5 4"></polygon>
				<line x1="19" y1="5" x2="19" y2="19"></line>
			</svg>
			Next Game
		</button>

		<!-- Next Day -->
		<button
			onclick={playNextDay}
			disabled={status === 'completed' || !engine || loading}
			class="flex items-center justify-center gap-1 px-3 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded font-medium transition-colors"
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
				<line x1="16" y1="2" x2="16" y2="6"></line>
				<line x1="8" y1="2" x2="8" y2="6"></line>
				<line x1="3" y1="10" x2="21" y2="10"></line>
			</svg>
			Next Day
		</button>

		<!-- Stop button (spans 2 columns) -->
		<button
			onclick={stop}
			disabled={status === 'idle' || status === 'completed' || !engine}
			class="col-span-2 flex items-center justify-center gap-2 px-4 py-2 bg-red-900/50 hover:bg-red-900/70 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded font-medium transition-colors border border-red-800"
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
				<rect x="6" y="6" width="12" height="12"></rect>
			</svg>
			Stop
		</button>
	</div>
</div>
