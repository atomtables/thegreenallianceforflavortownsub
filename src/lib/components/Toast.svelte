<script lang="ts" module>
    interface ToastItem {
        id: number;
        message: string;
        icon?: string;
        timeout: ReturnType<typeof setTimeout>;
    }

    let toasts = $state<ToastItem[]>([]);
    let nextId = 0;

    export function showToast(message: string, { icon, duration = 4000 }: { icon?: string; duration?: number } = {}) {
        const id = nextId++;
        const timeout = setTimeout(() => dismissToast(id), duration);
        toasts.push({ id, message, icon, timeout });
    }

    function dismissToast(id: number) {
        const idx = toasts.findIndex((t) => t.id === id);
        if (idx !== -1) {
            clearTimeout(toasts[idx].timeout);
            toasts.splice(idx, 1);
        }
    }
</script>

{#if toasts.length > 0}
    <div class="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
        {#each toasts as toast (toast.id)}
            <button
                class="pointer-events-auto flex items-center gap-2 bg-gray-800 text-white px-4 py-3 shadow-lg max-w-sm text-sm animate-slide-in cursor-pointer hover:bg-gray-700 transition-colors"
                onclick={() => dismissToast(toast.id)}
            >
                {#if toast.icon}
                    <span class="material-symbols-outlined icons-fill text-lg">{toast.icon}</span>
                {/if}
                <span class="break-words text-left">{toast.message}</span>
            </button>
        {/each}
    </div>
{/if}

<style>
    @keyframes slide-in {
        from {
            opacity: 0;
            transform: translateY(1rem);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    .animate-slide-in {
        animation: slide-in 0.2s ease-out;
    }
</style>
