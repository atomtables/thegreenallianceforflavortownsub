<script lang="ts">
    import Button from "./Button.svelte";
    import Dialog from "./Dialog.svelte";

    let {
        children,
        onclick,
        class: className = "",
        type = "button", 
        disabled = $bindable(), 
        transparent = false, 
        disableLoading = false,
        title = undefined,
    }: {
        children: () => any,
        onclick?: () => boolean | void | Promise<boolean>,
        class?: string,
        type?: string,
        disabled?: boolean,
        transparent?: boolean,
        disableLoading?: boolean,
        title?: string,
    } = $props();
</script>

<Button {onclick} class="[&]:p-2 [&]:rounded-full [&]:aspect-square {className}" {transparent} type={type as any} {disabled} {disableLoading} {title}>
    <div class="material-symbols-outlined icons-fill !text-sm !flex !items-center">
        {@render children()}
    </div>
</Button>