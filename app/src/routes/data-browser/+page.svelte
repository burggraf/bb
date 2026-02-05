<script lang="ts">
	import type { Database } from 'sql.js';
	import { getAvailableYears } from '$lib/game/season-loader';
	import { onMount } from 'svelte';

	let selectedYear = $state<number | null>(null);
	let db = $state<Database | null>(null);
	let tables = $state<string[]>([]);
	let selectedTable = $state<string | null>(null);
	let tableSchema = $state<
		Array<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>
	>([]);
	let query = $state<string>('');
	let results = $state<Array<string[]>>([]);
	let columns = $state<string[]>([]);
	let error = $state<string | null>(null);
	let loading = $state<boolean>(false);
	let availableYears = $state<number[]>([]);

	onMount(async () => {
		availableYears = await getAvailableYears();
		if (availableYears.length > 0) {
			selectedYear = availableYears[0];
			loadDatabase(availableYears[0]);
		}
	});

	// TODO: Load season database and populate tables
	function loadDatabase(year: number) {
		// Will be implemented in Task 3
		console.log('Loading database for year:', year);
	}
</script>

<svelte:head>
	<title>Database Viewer - Baseball Sim</title>
</svelte:head>

<div class="container mx-auto p-4">
	<h1 class="text-2xl font-bold mb-4">Database Viewer</h1>

	<!-- Season Selector -->
	<div class="mb-4">
		<label for="season-select" class="block mb-1">Season:</label>
		<select
			id="season-select"
			class="border rounded p-2"
			onchange={(e) => {
				const year = parseInt((e.target as HTMLSelectElement).value);
				selectedYear = year;
				loadDatabase(year);
			}}
		>
			{#each availableYears as year}
				<option value={year} selected={year === selectedYear}>
					{year}
				</option>
			{/each}
		</select>
	</div>

	<!-- Schema Browser -->
	<div class="mb-4 grid grid-cols-2 gap-4">
		<div>
			<h2 class="font-bold mb-2">Tables</h2>
			<ul class="border rounded p-2">
				<!-- Table list -->
			</ul>
		</div>
		<div>
			<h2 class="font-bold mb-2">Schema</h2>
			<div class="border rounded p-2">
				<!-- Schema display -->
			</div>
		</div>
	</div>

	<!-- Query Editor -->
	<div class="mb-4">
		<h2 class="font-bold mb-2">Query</h2>
		<textarea
			class="w-full border rounded p-2 font-mono"
			rows="3"
			placeholder="SELECT * FROM batters LIMIT 10"
			aria-label="SQL query editor"
		></textarea>
		<button class="mt-2 bg-blue-500 text-white px-4 py-2 rounded"> Run Query </button>
	</div>

	<!-- Results -->
	<div>
		<h2 class="font-bold mb-2">Results</h2>
		{#if error}
			<p class="text-red-500">{error}</p>
		{:else if results.length === 0}
			<p class="text-gray-500">Run a query to see results</p>
		{:else}
			<table class="border-collapse border">
				<!-- Results table -->
			</table>
		{/if}
	</div>
</div>
