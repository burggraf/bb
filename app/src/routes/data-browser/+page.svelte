<script lang="ts">
	import type { Database } from 'sql.js';
	import { getAvailableYears } from '$lib/game/season-loader';
	import { getDatabaseBytes } from '$lib/game/sqlite-season-loader';
	import initSqlJs from 'sql.js';
	import { onMount } from 'svelte';

	let SqlJs: Awaited<ReturnType<typeof initSqlJs>> | null = null;

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
		// Initialize sql.js
		SqlJs = await initSqlJs({
			locateFile: (file: string) => `https://sql.js.org/dist/${file}`
		});

		availableYears = await getAvailableYears();
		if (availableYears.length > 0) {
			selectedYear = availableYears[0];
			await loadDatabase(availableYears[0]);
		}
	});

	// TODO: Load season database and populate tables
	async function loadDatabase(year: number) {
		loading = true;
		error = null;

		try {
			// Load from IndexedDB cache or download
			const dbBytes = await getDatabaseBytes(year);

			if (!SqlJs) {
				throw new Error('sql.js not initialized');
			}

			// Create in-memory database
			db = new SqlJs.Database(dbBytes);

			// Get list of tables
			const tableResult = db.exec(
				"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
			);

			if (tableResult.length > 0) {
				tables = tableResult[0].values.map((row: unknown[]) => row[0] as string);
			}

			// Clear previous state
			selectedTable = null;
			tableSchema = [];
			results = [];
			columns = [];
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load database';
		} finally {
			loading = false;
		}
	}

	function loadTableSchema(tableName: string) {
		if (!db) return;

		selectedTable = tableName;

		try {
			const result = db.exec(`PRAGMA table_info("${tableName}")`);

			if (result.length > 0) {
				tableSchema = result[0].values.map((row) => ({
					name: row[1] as string,
					type: row[2] as string,
					notnull: row[3] as number,
					dflt_value: row[4] as string | null,
					pk: row[5] as number
				}));
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load schema';
		}
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

	{#if loading}
		<p class="text-gray-500">Loading {selectedYear}...</p>
	{/if}

	<!-- Schema Browser -->
	<div class="mb-4 grid grid-cols-2 gap-4">
		<div>
			<h2 class="font-bold mb-2">Tables</h2>
			<ul class="border rounded p-2">
				{#each tables as table}
					<li
						class="cursor-pointer hover:bg-gray-100 p-1 {selectedTable === table ? 'bg-blue-100' : ''}"
						onclick={() => loadTableSchema(table)}
					>
						{table}
					</li>
				{/each}
			</ul>
		</div>
		<div>
			<h2 class="font-bold mb-2">Schema</h2>
			<div class="border rounded p-2">
				{#if tableSchema.length > 0}
					<table class="w-full text-sm">
						<thead>
							<tr class="border-b">
								<th class="text-left">Column</th>
								<th class="text-left">Type</th>
								<th class="text-left">Nullable</th>
								<th class="text-left">PK</th>
							</tr>
						</thead>
						<tbody>
							{#each tableSchema as col}
								<tr class="border-b">
									<td class="py-1">{col.name}</td>
									<td>{col.type}</td>
									<td>{col.notnull ? 'NO' : 'YES'}</td>
									<td>{col.pk ? '✓' : ''}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{:else}
					<p class="text-gray-500">Select a table to view schema</p>
				{/if}
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
