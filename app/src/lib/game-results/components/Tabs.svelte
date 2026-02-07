<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Tab {
		id: string;
		label: string;
	}

	interface Props {
		tabs: Tab[];
		activeTab: string;
		onChange: (tabId: string) => void;
	}

	let { tabs, activeTab, onChange }: Props = $props();
</script>

<div class="border-b border-zinc-800 mb-4">
	<nav class="flex space-x-8" aria-label="Tabs">
		{#each tabs as tab}
			<button
				onclick={() => onChange(tab.id)}
				class="whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm transition-colors {
					activeTab === tab.id
						? 'border-blue-500 text-white'
						: 'border-transparent text-zinc-400 hover:text-zinc-300 hover:border-zinc-700'
				}"
			>
				{tab.label}
			</button>
		{/each}
	</nav>
</div>
