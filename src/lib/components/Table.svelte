<script lang="ts">
    import Input from "$lib/components/Input.svelte";
    import {slide} from "svelte/transition";
    import Button from "$lib/components/Button.svelte";
    import type { Snippet } from "svelte";

    let {
        source,
        header,
        template,
        emptyStr = "No data to show right now.",
        actions = [],
        defaultActions = [],
        checkable = true,
        selected = $bindable([]),
    }: {
        source: any[],
        header: Snippet,
        template: Snippet<[any, number]>,
        // what to show when empty
        emptyStr?: string,
        actions?: {name: string, icon: string, action: Function}[],
        defaultActions?: {name: string, icon: string, action: Function}[],
        checkable?: boolean,
        selected?: boolean[]
    } = $props();

    let all = $state(false);
    const allActive = () => {
        selected.length = source.length;
        for (let i = 0; i < selected.length; i++) if (!selected[i]) return false;
        return true;
    }
    const numberSelected = () => {
        let count = 0;
        for (let i = 0; i < selected.length; i++) if (selected[i]) count++;
        return count
    }
    const numbersActive = () => {
        let arr = []
        for (let i = 0; i < selected.length; i++) if (selected[i]) arr.push(i)
        return arr
    }
    const toggleAll = () => {
        selected.length = source.length;
        let n = source.length;
        let allToggled = false;
        for (let i = 0; i < n; i++) {
            if (!selected[i]) {
                allToggled = true;
                selected[i] = true;
            }
        }
        if (!allToggled)
            for (let i = 0; i < n; i++)
                selected[i] = false;
        all = allActive();
    }
    const toggleOne = n => {
        selected[n] = !selected[n]
        all = allActive();
    }
    const removeAll = () => {
        selected.length = source.length;
        for (let i = 0; i < selected.length; i++)
            selected[i] = false;
        all = allActive();
    }
</script>

{#if numberSelected() > 0}
    <div class="bg-green-400 text-gray-800 py-2 px-1 flex flex-row items-center justify-between" transition:slide>
        <div class="flex flex-row items-center">
            <Button transparent class="[&]:p-1" onclick={() => removeAll()}>
                <span class="material-symbols-outlined">close</span>
            </Button>
            <div class="font-bold pl-3">{numberSelected()} SELECTED</div>
        </div>
        <div class="flex flex-row px-1 space-x-2">
            {#each actions as {name, icon, action}}
                <Button disableLoading transparent class="[&]:p-1"
                        onclick={async () => await action(numbersActive(), removeAll)}>
                    <span class="material-symbols-outlined">{icon}</span>
                </Button>
            {/each}
        </div>
    </div>
{:else if defaultActions.length > 0}
    <div class="bg-green-900 py-2 px-1 flex flex-row items-center justify-end" transition:slide>
        <div class="flex flex-row px-1 space-x-2">
            {#each defaultActions as {name, icon, action}}
                <Button disableLoading transparent class="[&]:p-1"
                        onclick={async () => await action()}>
                    <span class="material-symbols-outlined">{icon}</span>
                </Button>
            {/each}
        </div>
    </div>
{/if}
<table class="bg-green-900 w-full text-left">
    <thead>
    <tr class="border-b-2 border-gray-400 text-gray-200 *:p-2">
        {#if checkable}
            <th class="w-8">
                <Input type="checkbox" name="" bind:value={all} action={() => toggleAll()}/>
            </th>
        {/if}
        {@render header()}
    </tr>
    </thead>
    <tbody>
    {#if source.length > 0}
        {#each source as data, i}
            <tr class="text-white *:p-2 hover:bg-neutral-500/40 transition-all">
                {#if checkable}
                    <th class="w-8 px-2">
                        <Input name="" type="checkbox" bind:value={selected[i]} action={() => toggleOne(i)}/>
                    </th>
                {/if}
                {@render template(data, i)}
            </tr>
        {/each}
    {/if}
    </tbody>
</table>
{#if source.length < 1}
    <div class="bg-green-900 p-2 w-full text-center">
        {emptyStr}
    </div>
{/if}