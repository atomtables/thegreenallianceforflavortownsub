<script module lang="ts">
    import { createRawSnippet, mount, unmount, type Snippet } from 'svelte';
    import Dialog from './Dialog.svelte';
    import Input from '$lib/components/Input.svelte';

    async function never(promise) {
        let run = true;
        while (run) {
            promise.then(() => (run = false));
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }

    export const alert = async (title: string, description: string = '', children: string = null) => {
        let state;
        const result = new Promise((resolve) => (state = resolve));

        let element = document.createElement('div');
        document.body.appendChild(element);

        let props = $state({
            open: false,
            title,
            description,
            actions: [
                {
                    name: 'OK',
                    action: async () => {
                        await state(true);
                    },
                    primary: true,
                },
            ],
            children: createRawSnippet(() => ({
                render: () => children ?? '<div></div>',
            })),
        });

        const dialog = mount(Dialog, {
            target: element,
            props,
        });

        props.open = true;

        let value = await result;
        props.open = false;
        setTimeout(async () => {
            await unmount(dialog);
            element.remove();
        }, 400);
        return value;
    };

    export const confirm = async (title, description = '', {children, isSnippet}: {
        children?: string | Snippet,
        isSnippet?: boolean
    } = {}): Promise<boolean> => {
        let state;
        const result: Promise<boolean> = new Promise((resolve) => (state = resolve));

        let element = document.createElement('div');
        document.body.appendChild(element);

        let props = $state({
            open: false,
            title,
            description,
            actions: [
                {
                    name: 'Cancel',
                    action: async () => {
                        state(false);
                    },
                    close: true,
                },
                {
                    name: 'Yes',
                    action: async () => {
                        state(true);
                    },
                    primary: true,
                    close: true,
                },
            ],
            children: isSnippet
                ? children
                : createRawSnippet(() => ({
                      render: () => children as string ?? '<div></div>',
                  })),
        });

        const dialog = mount(Dialog, {
            target: element,
            props,
        });

        props.open = true;

        let value = await result;
        props.open = false;
        setTimeout(async () => {
            await unmount(dialog);
            element.remove();
        }, 400);
        return value;
    };

    export const wait = async (promise, title, description, { children, showFail }: {
        children?: string,
        showFail?: boolean
    } = {}) => {
        let state;
        const result = new Promise((resolve) => (state = resolve));
        let close;
        const manual = new Promise((resolve) => (close = resolve));

        let element = document.createElement('div');
        document.body.appendChild(element);

        let props = $state({
            open: false,
            title,
            description,
            loading: true,
            actions: [
                promise?.cancel && {
                    name: 'Cancel',
                    action: async () => {
                        promise.cancel();
                        state(false);
                        if (manual) await never(manual);
                    },
                    close: true,
                },
            ].filter((n) => n),
            children: createRawSnippet(() => ({
                render: () => children ?? '<div></div>',
            })),
        });

        const dialog = mount(Dialog, {
            target: element,
            props,
        });

        props.open = true;

        promise.then(() => {
            props.open = false;
            setTimeout(async () => {
                await unmount(dialog);
                element.remove();
            }, 400);
        });

        promise.catch(() => {
            props.open = false;
            setTimeout(async () => {
                await unmount(dialog);
                element.remove();
            }, 400);
            if (showFail) alert('Error', 'An error occured while waiting.');
        });

        promise.finally(() => state(true));

        return [await result, close];
    };

    export const prompt = async (title, description = '', { children, isSnippet, startingValue, promptValue }: {
        children?: string,
        isSnippet?: boolean,
        promptValue?: string
        startingValue?: string
    } = {}): Promise<string> => {
        let state;
        const result = new Promise<string>((resolve) => (state = resolve));

        let element = document.createElement('div');
        document.body.appendChild(element);

        let inputProps = $state({
            name: promptValue || 'Input',
            value: startingValue || '',
        });
        let props = $state({
            open: false,
            title,
            description,
            actions: [
                {
                    name: 'Cancel',
                    action: async () => {
                        state(null);
                    },
                    close: true,
                },
                {
                    name: 'OK',
                    action: async () => {
                        state(inputProps.value);
                    },
                    primary: true,
                    close: true,
                },
            ],
            children: isSnippet
                ? children
                : createRawSnippet(() => ({
                      render: () => "<div class='w-full h-full'></div>",
                      setup: (target) => {
                          const comp = mount(Input, {
                              target,
                              props: inputProps,
                          });
                          return () => {
                              unmount(comp);
                          };
                      },
                  })),
        });

        const dialog = mount(Dialog, {
            target: element,
            props,
        });

        props.open = true;

        let value: string = await result;
        props.open = false;
        setTimeout(async () => {
            await unmount(dialog);
            element.remove();
        }, 400);
        return value;
    };
</script>

<script lang="ts">
    import Button from '$lib/components/Button.svelte';
    import Spinner from '$lib/components/Spinner.svelte';
    import { fade } from 'svelte/transition';
    import { quadInOut } from 'svelte/easing';

    let { open = $bindable(), title, description = '', actions = [], children = null, loading = false } = $props();
    const closeF = () => (open = false);
</script>

{#if open}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/50 backdrop-blur-sm" transition:fade={{ delay: 50, duration: 150, easing: quadInOut }}>
        <div class="bg-neutral-800 shadow-xl w-full min-w-md max-w-2xl mx-4 max-h-[85vh] flex flex-col" role="dialog" aria-modal="true" transition:fade={{ duration: 150, easing: quadInOut }}>
            <div class="px-6 pt-5 shrink-0">
                <h2 class="text-2xl font-bold flex flex-row items-center gap-2">
                    {#if loading}
                        <Spinner class="p-1" />
                    {/if}
                    <span>{title}</span>
                </h2>
                <h5 class="pt-0 font-semibold max-w-full text-ellipsis overflow-none">{@html description}</h5>
            </div>

            <div class="px-6 py-2 overflow-y-auto flex-1 min-h-0">
                {@render children?.()}
            </div>

            {#if actions}
                <div class="px-6 pb-4 pt-4 flex justify-end gap-2 shrink-0">
                    {#each actions as { name, action, primary, close }}
                        <Button
                            transparent={!primary}
                            onclick={!close
                                ? action
                                : async () => {
                                      await action();
                                      closeF();
                                  }}
                        >
                            {name}
                        </Button>
                    {/each}
                </div>
            {/if}
        </div>
    </div>
{/if}

<style>
    @keyframes fade-in {
        from {
            opacity: 0;
            transform: translateY(20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
</style>