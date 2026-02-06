<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Baseball Sim - Statistical Baseball Game</title>
</svelte:head>

<div class="min-h-screen bg-zinc-950">
	<!-- Navigation Header -->
	<nav class="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-sm sticky top-0 z-50">
		<div class="container mx-auto px-3 sm:px-4 py-3 max-w-6xl">
			<div class="flex items-center justify-between gap-4">
				<!-- Logo/Title -->
				<a href="/" class="flex items-center gap-2 text-white hover:text-blue-400 transition-colors">
					<span class="text-xl sm:text-2xl">⚾</span>
					<span class="font-bold text-sm sm:text-base">Baseball Sim</span>
				</a>

				<!-- Navigation Links -->
				<div class="flex items-center gap-4 sm:gap-6">
					<a
						href="/"
						class="text-zinc-400 hover:text-white text-sm transition-colors"
					>
						Home
					</a>
					<a
						href="/game-results"
						class="text-zinc-400 hover:text-white text-sm transition-colors"
					>
						Game Results
					</a>
					<a
						href="/data-browser"
						class="text-zinc-400 hover:text-white text-sm transition-colors"
					>
						Data Browser
					</a>
				</div>
			</div>
		</div>
	</nav>

	<!-- Page Content -->
	<div>{@render children()}</div>
</div>
