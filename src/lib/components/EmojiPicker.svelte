<script lang="ts">
    import { emojis, type Emoji } from "$lib/data/emojis";
    import { onMount } from "svelte";

    let { onselect }: { onselect: (emoji: string) => void } = $props();

    let searchQuery = $state("");
    let recentEmojis: string[] = $state([]);
    
    // Group emojis by category
    const categories = Array.from(new Set(emojis.map(e => e.category)));
    
    // Filtered emojis
    let filteredEmojis = $derived(
        searchQuery 
        ? emojis.filter(e => 
            e.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
            e.keywords.some(k => k.toLowerCase().includes(searchQuery.toLowerCase()))
          )
        : emojis
    );
    
    // Group filtered emojis if not searching, or just list them if searching
    let groupedEmojis = $derived(
        searchQuery 
        ? { "Search Results": filteredEmojis }
        : categories.reduce((acc, cat) => {
            const catEmojis = emojis.filter(e => e.category === cat);
            if (catEmojis.length) acc[cat] = catEmojis;
            return acc;
        }, {} as Record<string, Emoji[]>)
    );

    onMount(() => {
        const stored = localStorage.getItem("recentEmojis");
        if (stored) {
            try {
                recentEmojis = JSON.parse(stored);
            } catch (e) {
                console.error("Failed to parse recent emojis", e);
            }
        }
    });

    function handleSelect(emoji: string) {
        // Update recents
        const newRecents = [emoji, ...recentEmojis.filter(e => e !== emoji)].slice(0, 16);
        recentEmojis = newRecents;
        localStorage.setItem("recentEmojis", JSON.stringify(newRecents));
        
        onselect(emoji);
    }
</script>

<div class="flex flex-col h-80 w-80 bg-gray-800 rounded-lg shadow-xl border border-gray-700 overflow-hidden" role="dialog" tabindex="0" aria-modal="true" onclick={(e) => e.stopPropagation()} onkeypress={() => {}}>
    <div class="p-2 border-b border-gray-700">
        <input 
            type="text" 
            bind:value={searchQuery}
            placeholder="Search emojis..." 
            class="w-full bg-gray-700 text-white px-3 py-1.5 rounded-md text-sm placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-green-500"
        />
    </div>
    
    <div class="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent">
        {#if !searchQuery && recentEmojis.length > 0}
            <div class="mb-4">
                <h3 class="text-xs font-semibold text-gray-400 mb-2 px-1 uppercase tracking-wider">Recently Used</h3>
                <div class="grid grid-cols-8 gap-1">
                    {#each recentEmojis as emoji}
                        <button 
                            class="hover:bg-gray-700 rounded p-1 text-xl transition-colors cursor-pointer w-8 h-8 flex items-center justify-center"
                            onclick={() => handleSelect(emoji)}
                            title={emoji}
                        >
                            {emoji}
                        </button>
                    {/each}
                </div>
            </div>
        {/if}

        {#each Object.entries(groupedEmojis) as [category, list]}
            {#if list.length > 0}
                <div class="">
                    <h3 class="text-xs font-semibold text-gray-400 px-1 uppercase tracking-wider sticky py-2 bg-gray-800/95 backdrop-blur-sm z-10">{category}</h3>
                    <div class="grid grid-cols-8 gap-1">
                        {#each list as emoji}
                            <button 
                                class="hover:bg-gray-700 rounded p-1 text-xl transition-colors cursor-pointer w-8 h-8 flex items-center justify-center"
                                onclick={() => handleSelect(emoji.emoji)}
                                title={emoji.name}
                            >
                                {emoji.emoji}
                            </button>
                        {/each}
                    </div>
                </div>
            {/if}
        {/each}
        
        {#if Object.keys(groupedEmojis).length === 0}
             <div class="text-center text-gray-500 py-8 text-sm">
                No emojis found
            </div>
        {/if}
    </div>
</div>
