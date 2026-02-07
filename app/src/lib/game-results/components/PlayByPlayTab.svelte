<script lang="ts">
	import type { GameEvent } from '../types.js';

	interface Props {
		events: GameEvent[];
	}

	let { events }: Props = $props();

	// Group events by inning
	let eventsByInning = $derived(() => {
		const groups = new Map<
			number,
			{ isTop: GameEvent[]; isBottom: GameEvent[] }
		>();

		for (const event of events) {
			if (!groups.has(event.inning)) {
				groups.set(event.inning, { isTop: [], isBottom: [] });
			}
			const group = groups.get(event.inning)!;
			if (event.isTopInning) {
				group.isTop.push(event);
			} else {
				group.isBottom.push(event);
			}
		}

		return Array.from(groups.entries()).sort((a, b) => a[0] - b[0]) as [number, { isTop: GameEvent[]; isBottom: GameEvent[] }][];
	});

	// Format inning label
	function inningLabel(inning: number, isTop: boolean): string {
		const ordinal = (n: number): string => {
			const s = ['th', 'st', 'nd', 'rd'];
			const v = n % 100;
			return n + (s[(v - 20) % 10] || s[v] || s[0]);
		};
		return isTop ? `Top ${ordinal(inning)}` : `Bottom ${ordinal(inning)}`;
	}

	// Check if event scored runs
	function scoredRuns(event: GameEvent): boolean {
		return event.runsScored > 0;
	}
</script>

<div class="space-y-4">
	{#each eventsByInning() as [inning, { isTop, isBottom }]}
		<div class="border-l-2 border-zinc-800 pl-4">
			<!-- Top of inning -->
			{#if isTop.length > 0}
				<h3 class="text-sm font-semibold text-zinc-400 mb-2">{inningLabel(inning, true)}</h3>
				<div class="space-y-1 mb-4">
					{#each isTop as event}
						{#if event.description}
							<div class="flex items-start gap-2 text-sm">
								<span class="text-zinc-500 font-mono text-xs w-6 flex-shrink-0">
									{event.outs}
								</span>
								<span class="{scoredRuns(event) ? 'text-green-400' : 'text-zinc-300'}">
									{event.description}
									{#if scoredRuns(event)}
										<span class="ml-2 text-green-400 font-semibold">
											({event.runsScored} {event.runsScored === 1 ? 'run' : 'runs'})
										</span>
									{/if}
								</span>
							</div>
						{/if}
					{/each}
				</div>
			{/if}

			<!-- Bottom of inning -->
			{#if isBottom.length > 0}
				<h3 class="text-sm font-semibold text-zinc-400 mb-2">{inningLabel(inning, false)}</h3>
				<div class="space-y-1">
					{#each isBottom as event}
						{#if event.description}
							<div class="flex items-start gap-2 text-sm">
								<span class="text-zinc-500 font-mono text-xs w-6 flex-shrink-0">
									{event.outs}
								</span>
								<span class="{scoredRuns(event) ? 'text-green-400' : 'text-zinc-300'}">
									{event.description}
									{#if scoredRuns(event)}
										<span class="ml-2 text-green-400 font-semibold">
											({event.runsScored} {event.runsScored === 1 ? 'run' : 'runs'})
										</span>
									{/if}
								</span>
							</div>
						{/if}
					{/each}
				</div>
			{/if}
		</div>
	{/each}

	{#if events.length === 0}
		<p class="text-zinc-500 text-sm">No play-by-play data available.</p>
	{/if}
</div>
