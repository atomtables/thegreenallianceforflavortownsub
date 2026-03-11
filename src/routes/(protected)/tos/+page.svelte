<script lang="ts">
    import Button from "$lib/components/Button.svelte";
    import { goto } from "$app/navigation";
    import { markdownToSafeHTML } from "$lib/functions/markdownRenderer.js";

    let { data } = $props();

    const agreeTos = async () => {
        const res = await fetch("/api/users/tos", { method: "POST" });
        if (res.ok) {
            goto("/home");
        }
    };
</script>

<style>
    
</style>

<div class="max-w-3xl mx-auto p-2">
    <div class="bg-green-900">
        <h1 class="text-3xl font-bold p-5 bg-green-800">Terms of Service</h1>
        <div class="p-5">
            <p class="mb-4 font-bold">You must agree to the following terms before continuing to use the platform.</p>
            <tos class="bg-gray-700 p-6 overflow-y-auto max-h-[50vh] whitespace-pre-wrap text-sm leading-relaxed" role="document" aria-label="Terms of Service">
                {@html markdownToSafeHTML(data.tosContent)}
            </tos>
            <p class="text-sm text-neutral-400 text-right pt-2">Last updated: {new Date(data.tosLastUpdated).toLocaleDateString()}</p>
        </div>
        <div class="flex justify-end w-full bg-green-800 p-5">
            <Button onclick={() => void agreeTos()}>I Agree</Button>
        </div>
    </div>
</div>
