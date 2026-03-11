<script lang="ts">
    import Button from "$lib/components/Button.svelte";
    import { goto } from "$app/navigation";

    let { data } = $props();

    const agreeTos = async () => {
        const res = await fetch("/api/users/tos", { method: "POST" });
        if (res.ok) {
            goto("/home");
        }
    };
</script>

<div class="max-w-3xl mx-auto p-8">
    <h1 class="text-3xl font-bold mb-6">Terms of Service</h1>
    <p class="text-sm text-neutral-400 mb-4">Last updated: {new Date(data.tosLastUpdated).toLocaleDateString()}</p>
    <p class="mb-4">You must agree to the following terms before continuing to use the platform.</p>
    <div class="bg-gray-700 p-6 overflow-y-auto max-h-[50vh] whitespace-pre-wrap text-sm leading-relaxed mb-6" role="document" aria-label="Terms of Service">
        {data.tosContent}
    </div>
    <div class="flex justify-end">
        <Button onclick={agreeTos}>I Agree</Button>
    </div>
</div>
