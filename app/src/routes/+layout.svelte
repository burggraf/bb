<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Baseball Sim - Statistical Baseball Game</title>
</svelte:head>

<div class="min-h-screen">
	{@render children()}
</div>
