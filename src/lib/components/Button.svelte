<script lang="ts">
    import Spinner from "$lib/components/Spinner.svelte";
    import { cubicInOut } from "svelte/easing";
    import { fade } from "svelte/transition";

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
    let showTooltip = $state(false);

    const hasTooltip = $derived(Boolean(title?.trim()));

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

    const handleMouseEnter = () => {
        if (hasTooltip) showTooltip = true;
    };

    const handleMouseLeave = () => {
        showTooltip = false;
    };

    const handleFocus = () => {
        if (hasTooltip) showTooltip = true;
    };

    const handleBlur = () => {
        showTooltip = false;
    };
</script>

<button {type}
        aria-label={title}
        class="relative grid place-items-center px-5 py-2 {disabled ? `cursor-not-allowed ${!transparent && 'dark:bg-neutral-700 bg-green-200'} text-gray-300` : `cursor-pointer ${!transparent ? 'dark:bg-green-700 dark:hover:bg-green-600 dark:active:bg-green-500 bg-green-300 hover:bg-green-400 active:bg-green-500' : 'hover:bg-neutral-400/25 active:bg-neutral-400/50'}`} {resolving && !disableLoading && 'cursor-progress'} uppercase font-bold transition-all flex flex-row {className}"
        onclick={handleClick}
        onmouseenter={handleMouseEnter}
        onmouseleave={handleMouseLeave}
        onfocus={handleFocus}
        onblur={handleBlur}>
    <span class="flex flex-row">
        {#if resolving && !disableLoading}
            <Spinner size={24} class="mr-2" />
        {/if}
        {@render children()}
    </span>

    {#if hasTooltip && showTooltip}
        <span
            transition:fade={{ duration: 150, easing: cubicInOut }}
            role="tooltip"
            class="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs font-medium normal-case text-neutral-900 shadow-md dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        >
            {title}
        </span>
    {/if}
</button>