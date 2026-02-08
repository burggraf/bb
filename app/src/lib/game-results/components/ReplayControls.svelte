<script lang="ts">
	import { onMount } from 'svelte';
	import { SeasonReplayEngine } from '$lib/season-replay/index.js';
	import type { ReplayProgress, ReplayStatus } from '$lib/season-replay/index.js';

	interface Props {
		seriesId: string;
		seasonYear: number;
		onStandingsUpdate: () => Promise<void>;
		onStatusChange?: (status: ReplayStatus) => void;
		onAnimatedChange?: (animated: boolean) => void;
		onEngineReady?: (engine: SeasonReplayEngine) => void;
	}

	let { seriesId, seasonYear, onStandingsUpdate, onStatusChange, onAnimatedChange, onEngineReady }: Props = $props();

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
	let isAutoPlaying = $state(false); // Track if we're in auto-play loop
	let error = $state<string | null>(null);
	let gameError = $state<{ message: string; gameIndex: number } | null>(null);
	let shouldContinuePlaying = false;

	// Animated mode state
	let animatedMode = $state(false);
	let simSpeed = $state(500); // Default to medium speed (milliseconds delay)
	let speedSliderValue = $state(75); // Slider value (0-100, where 100 = fastest)

	// Game completion state
	let gameComplete = $state(false);
	let previousGameIndex = $state(0);

	// Initialize engine on mount
	onMount(async () => {
		try {
			engine = new SeasonReplayEngine(seriesId, seasonYear, { animated: false, simSpeed: 500 });
			await engine.initialize();

			// Notify parent that engine is ready
			onEngineReady?.(engine);

			// Set up event listeners
			engine.on('statusChange', (data: { status: ReplayStatus }) => {
				status = data.status;
				onStatusChange?.(data.status);
			});

			engine.on('progress', (data: ReplayProgress) => {
				progress = data;

				// Detect game completion in animated mode
				if (animatedMode && data.currentGameIndex > previousGameIndex && previousGameIndex > 0) {
					gameComplete = true;
					shouldContinuePlaying = false; // Pause auto-play loop
				}
				previousGameIndex = data.currentGameIndex;
			});

			engine.on('gameError', (data: { error: string; gameIndex: number }) => {
				// Set game error state
				gameError = { message: data.error, gameIndex: data.gameIndex };
				// Don't pause - let the replay continue and skip the errored game
				// The engine will skip games with missing data and continue
			});

			// Get initial progress and status
			progress = engine.getProgress();
			previousGameIndex = progress.currentGameIndex;
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

		try {
			// Start or resume based on current status
			if (status === 'idle') {
				await engine.start();
			} else {
				await engine.resume();
			}
			status = engine.getStatus();
			isAutoPlaying = true; // Mark auto-play as active

			// Set flag to continue playing
			shouldContinuePlaying = true;

			// Continuously play games while we should continue
			while (shouldContinuePlaying && status === 'playing') {
				await playNextGame();

				// Check if we should stop (status changed, error occurred, or game complete)
				if (status !== 'playing' || error || engine.getStatus() === 'completed') {
					break;
				}

				// Small delay to allow UI updates between games
				await new Promise(resolve => setTimeout(resolve, 10));
			}
			isAutoPlaying = false; // Auto-play loop ended
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to start replay';
			shouldContinuePlaying = false;
			isAutoPlaying = false;
		}
	}

	async function pause() {
		if (!engine) return;
		// Signal the loop to stop
		shouldContinuePlaying = false;
		isAutoPlaying = false;
		await engine.pause();
		status = engine.getStatus();
	}

	async function playNextGame() {
		if (!engine || loading) return;
		// Only show loading for manual actions, not during auto-play
		if (!isAutoPlaying) {
			loading = true;
		}
		error = null;

		try {
			console.log('[ReplayControls] Calling engine.playNextGame()...');
			const result = await engine.playNextGame();
			console.log('[ReplayControls] Game result:', result);
			progress = engine.getProgress();
			status = engine.getStatus();

			// Trigger standings update
			if (result) {
				console.log('[ReplayControls] Updating standings...');
				await onStandingsUpdate();
			}
		} catch (e) {
			console.error('[ReplayControls] Error in playNextGame:', e);
			error = e instanceof Error ? e.message : 'Failed to play game';
			// Stop the loop on error
			shouldContinuePlaying = false;
		} finally {
			// Only clear loading for manual actions
			if (!isAutoPlaying) {
				loading = false;
			}
		}
	}

	async function continueToNextGame() {
		// Reset game completion state
		gameComplete = false;
		// Continue to next game
		await playNextGame();

		// If still in animated mode and not complete, resume auto-play
		if (animatedMode && status !== 'completed' && !gameComplete) {
			shouldContinuePlaying = true;
			isAutoPlaying = true;
			while (shouldContinuePlaying && engine && engine.getStatus() === 'playing' && !gameComplete) {
				await playNextGame();
				// Small delay to allow browser to update UI
				await new Promise(resolve => setTimeout(resolve, 10));
			}
			isAutoPlaying = false;
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

	function skipToNextGame() {
		if (!engine) return;

		// Clear the game error
		gameError = null;

		// Skip to the next game
		engine.skipToNextGame();
		progress = engine.getProgress();
		status = engine.getStatus();
	}

	// Toggle animated mode
	function toggleAnimatedMode() {
		animatedMode = !animatedMode;
		if (engine) {
			engine.setOptions({ animated: animatedMode, simSpeed });
		}
		onAnimatedChange?.(animatedMode);
	}

	// Update simulation speed (slider value 0-100, convert to milliseconds delay)
	// Slider 0 = slow (2000ms), Slider 100 = fast (50ms)
	function updateSpeed(sliderVal: number) {
		speedSliderValue = sliderVal;
		const delayMs = Math.round(2050 - (sliderVal * 20));
		simSpeed = delayMs;
		if (engine && animatedMode) {
			engine.setOptions({ animated: animatedMode, simSpeed });
		}
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

	<!-- Game error with skip option -->
	{#if gameError}
		<div class="bg-red-900/30 border border-red-800 rounded-lg p-3 space-y-2">
			<div class="flex items-start gap-2">
				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-400 mt-0.5 flex-shrink-0">
					<circle cx="12" cy="12" r="10"></circle>
					<line x1="12" y1="8" x2="12" y2="12"></line>
					<line x1="12" y1="16" x2="12.01" y2="16"></line>
				</svg>
				<div class="flex-1">
					<p class="text-red-300 text-sm font-medium">Game #{gameError.gameIndex + 1} Failed</p>
					<p class="text-red-400 text-xs mt-1">{gameError.message}</p>
				</div>
			</div>
			<button
				onclick={skipToNextGame}
				class="w-full flex items-center justify-center gap-2 px-3 py-2 bg-red-800/50 hover:bg-red-800/70 text-white text-sm rounded font-medium transition-colors border border-red-700"
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<polygon points="5 4 15 12 5 20 5 4"></polygon>
					<line x1="19" y1="5" x2="19" y2="19"></line>
				</svg>
				Skip to Next Game
			</button>
		</div>
	{/if}

	<!-- Game Complete Message -->
	{#if gameComplete && animatedMode}
		<div class="bg-blue-900/30 border border-blue-700 rounded-lg p-4 space-y-3">
			<div class="text-center">
				<p class="text-blue-300 font-medium text-sm">Game Complete!</p>
				<p class="text-zinc-400 text-xs mt-1">
					{progress.currentGameIndex} of {progress.totalGames} games finished
				</p>
			</div>
			<button
				onclick={continueToNextGame}
				disabled={loading || status === 'completed'}
				class="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded font-medium transition-colors"
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
					Loading...
				{:else}
					<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
						<polygon points="5 4 15 12 5 20 5 4"></polygon>
					</svg>
					Continue to Next Game
				{/if}
			</button>
		</div>
	{/if}

	<!-- Animated Mode Toggle -->
	<div class="flex items-center justify-between">
		<span class="text-sm text-zinc-300">Animated Mode</span>
		<button
			onclick={toggleAnimatedMode}
			disabled={status === 'completed' || !engine}
			aria-label="Toggle animated mode"
			class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed
				{animatedMode ? 'bg-blue-600' : 'bg-zinc-700'}"
		>
			<span
				class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform
					{animatedMode ? 'translate-x-6' : 'translate-x-1'}"
			></span>
		</button>
	</div>

	<!-- Speed Control (shown when animated mode is on) -->
	{#if animatedMode}
		<div class="bg-zinc-800 rounded-lg p-3 border border-zinc-700">
			<div class="flex items-center justify-between mb-2">
				<span class="text-xs text-zinc-400">Simulation Speed</span>
				<span class="text-xs text-zinc-500">{simSpeed}ms</span>
			</div>
			<input
				type="range"
				min="0"
				max="100"
				step="1"
				bind:value={speedSliderValue}
				oninput={() => updateSpeed(speedSliderValue)}
				class="w-full accent-blue-500 h-2"
				disabled={status === 'completed' || !engine}
			/>
			<div class="flex justify-between text-xs text-zinc-600 mt-1">
				<span>Slow</span>
				<span>Fast</span>
			</div>
		</div>
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

		<!-- Next Game and Next Day - only shown in non-animated mode -->
		{#if !animatedMode}
			<!-- Next Game -->
			<button
				onclick={playNextGame}
				disabled={status === 'completed' || !engine || isAutoPlaying || loading}
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
				disabled={status === 'completed' || !engine || isAutoPlaying || loading}
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
		{/if}
	</div>
</div>
