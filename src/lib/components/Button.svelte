<script lang="ts">
    import Spinner from "$lib/components/Spinner.svelte";

    type ButtonProps = {
        children: () => any,
        onclick?: () => boolean | void | Promise<boolean>,
        class?: string,
        type?: "button" | "submit" | "reset",
        disabled?: boolean,
        transparent?: boolean,
        disableLoading?: boolean,
        title?: string,
    };

    let {
        children, 
        onclick, 
        class: className = "",
        type = "button", 
        disabled = $bindable(), 
        transparent = false, 
        disableLoading = false,
        title = undefined,
    }:ButtonProps = $props();

    let resolving = $state(false);

    const handleClick = async () => {
        if (disabled || resolving) return;

        resolving = true;
        try {
            if (typeof onclick === 'function')
                await Promise.resolve(onclick?.());
        } finally {
            resolving = false;
        }
    };
</script>

<button {type} {title}
        class="grid place-items-center px-5 py-2 {disabled ? `cursor-not-allowed ${!transparent && 'dark:bg-neutral-700 bg-green-200'} text-gray-300` : `cursor-pointer ${!transparent ? 'dark:bg-green-700 dark:hover:bg-green-600 dark:active:bg-green-500 bg-green-300 hover:bg-green-400 active:bg-green-500' : 'hover:bg-neutral-400/25 active:bg-neutral-400/50'}`} {resolving && !disableLoading && 'cursor-progress'} uppercase font-bold transition-all flex flex-row {className}"
        onclick={handleClick}>
    <span class="flex flex-row">
        {#if resolving && !disableLoading}
            <Spinner size={24} class="mr-2" />
        {/if}
        {@render children()}
    </span>
</button>