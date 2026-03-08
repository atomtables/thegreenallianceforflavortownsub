<script lang="ts">
    import Button from "$lib/components/Button.svelte";
    import { confirm, prompt, alert } from "$lib/components/Dialog.svelte";
    import IconButton from "$lib/components/IconButton.svelte";
    import Spinner from "$lib/components/Spinner.svelte";
    import { snowflakeToDate } from "$lib/functions/Snowflake.js";
    import { formatDate, formatDayLabel, isTailMessage, toTitleCase } from "$lib/functions/chatHelpers";
    import type { Chat, Message } from "$lib/types/messages";
    import { onDestroy, onMount, tick } from "svelte";
    import { flip } from "svelte/animate";
    import { scale, slide } from "svelte/transition";

    let { data } = $props();

    // This is our simple SSE connection to get live updates about new messages
    let conn: EventSource | null = $state(null);
    // The chats variable should never change significantly
    // to the point where we require the server to get the latest
    // content. The only change that happens are UI-only variable changes.
    // For that reason, after getting data.chats from the server,
    // we store it in a local variable and modify that instead.
    let chats: Chat[] = $state(null);
    // If we're at the bottom of the page, it means we can update
    // the scrolling and the last read properties. We just keep track of it here.
    let atBottom = $state(true);
    // This is simple state to hold the new message being typed
    let newMessage: string = $state("");
    // This is the currently selected chat id from the sidebar
    let currentlySelectedChatId = $state<string>(null);
    // Using a derived store, we can always have the currently selected chat object
    let currentlySelectedChat: Chat = $derived.by(() => {
        if (currentlySelectedChatId == null || chats == null) return null;
        return chats.find((chat: Chat) => chat.id === currentlySelectedChatId) || null;
    });
    // This is a store of every message we've listened to so far.
    // We don't store messages for chats we have not opened yet, because
    // we can just get those initially anyway.
    let messages = $state<{ [chatId: string]: Message[] }>({});
    // This keeps track of which menu is currently open for message actions
    let openMenuForMessage: string | null = $state(null);
    // This keeps track of which emoji selector is currently open for message
    let openEmojiSelectorForMessage: string | null = $state(null);
    // This keeps track of which reaction details dropdown is open
    let openReactionListForMessage: string | null = $state(null);
    // A simple emoji list for demonstration purposes 👍 👎 ❤️ ❗ ❓ 🔥 💀 🙂
    const emoji = ["👍", "👎", "❤️", "❗", "❓", "🔥", "💀", "🙂"];
    // State for the "new chat" dropdown
    let showNewChatDropdown = $state(false);
    let newChatSearch = $state("");
    // This is for the divider between unread messages (because it wouldn't
    // make sense for the divider to disappear the second a new message arrives)
    let stickyUnreadBoundary: Record<string, string | null> = $state({});

    // Our main SSE connection function to connect to the chat stream
    // and handle reconnections and events.
    const connectToChat = () => {
        conn?.close();
        const source = new EventSource(`/api/messages/stream`);
        conn = source;

        const logEvent = (label: string) => (event: MessageEvent) => {
            console.log(`[SSE:${label}]`, event.data);
        };

        source.addEventListener("open", () => {
            console.log("[SSE] connection open");
        });

        source.addEventListener("error", (event) => {
            console.error("[SSE] error", event);
            if (source.readyState === EventSource.CLOSED) {
                console.log("[SSE] connection closed by server, attempting to reconnect in 5 seconds...");
                setTimeout(() => {
                    connectToChat();
                }, 5000);
            }
        });

        source.addEventListener("close", () => {
            console.log("[SSE] connection closed");
            if (source.readyState === EventSource.CLOSED) {
                console.log("[SSE] connection closed by server, attempting to reconnect in 5 seconds...");
                setTimeout(() => {
                    connectToChat();
                }, 5000);
            }
        });

        source.addEventListener("message", async (ev) => {
            console.log("[SSE:message]", ev.data);
            const msg: Message = JSON.parse(ev.data).message;
            if (messages[msg.chatId]) {
                messages[msg.chatId] = [...messages[msg.chatId], msg];
            }
            const chat = chats.find((v) => v.id == msg.chatId);
            if (chat) {
                chat.lastMessage = msg;
            }
            if (currentlySelectedChatId === msg.chatId) {
                updateChatLists(msg.chatId, msg);
                // scroll to bottom if at bottom
                if (atBottom) {
                    await tick();
                    const container = document.querySelector(".flex-1.overflow-auto.p-5");
                    container.scrollTop = container.scrollHeight;
                }
                if (document.hasFocus()) {
                    updateLastReadForChat(msg.chatId, msg.id);
                } else {
                    chat!.readReceipts.count += 1;
                }
            } else {
                chat!.readReceipts.count += 1;
            }
        });
        source.addEventListener("session", logEvent("session"));
        source.addEventListener("presence", logEvent("presence"));
        source.addEventListener("message-deleted", async (ev) => {
            console.log("[SSE:message-deleted]", ev.data);
            const { messageId, chatId } = JSON.parse(ev.data);
            if (messages[chatId]) {
                messages[chatId] = messages[chatId].filter((m) => m.id !== messageId);
            }
            if (chats.find((v) => v.id == chatId)?.lastMessage?.id === messageId) {
                const chat = chats.find((v) => v.id == chatId);
                chat!.lastMessage = null;
            }
        });
        source.addEventListener("message-edited", async (ev) => {
            console.log("[SSE:message-edited]", ev.data);
            const { message } = JSON.parse(ev.data);
            if (messages[message.chatId]) {
                messages[message.chatId] = messages[message.chatId].map((v) => {
                    if (v.id !== message.id) return v;
                    else return message;
                });
            }
            if (chats.find((v) => v.id == message.chatId)?.lastMessage?.id === message.id) {
                const chat = chats.find((v) => v.id == message.chatId);
                chat!.lastMessage = message;
            }
        });
        source.addEventListener("message-reacted", async (ev) => {
            console.log("[SSE:message-reacted]", ev.data);
            const { messageId, chatId, reactions } = JSON.parse(ev.data);
            if (messages[chatId]) {
                messages[chatId] = messages[chatId].map((v) => {
                    if (v.id !== messageId) return v;
                    return { ...v, reactions };
                });
            }
        });
    };

    // This sends the server our last read message for the currently selected chat,
    // and we can get the updated unread count from the response headers.
    // we keep track of it locally, but it's not that expensive anyway.
    const updateLastReadForChat = (chatId: string, messageId: string) => {
        let chat = chats.find((v) => v.id == chatId);
        let message = messages[chatId]?.find((m) => m.id === messageId);
        if (!message) return;
        fetch(`/api/messages/${chatId}?messageId=${messageId}`, {
            method: "HEAD",
        }).then((res) => {
            console.log("Marked messages as read on focus:", res.status);
            if (res.ok) {
                chat!.readReceipts.count = res.headers.get("X-Unread-Messages") ? parseInt(res.headers.get("X-Unread-Messages")) : 0;
                chat!.readReceipts.messageId = res.headers.get("X-Last-Message-Id") || messageId;
            }
        });
    };

    // This function just moves up chat lists based on activity, so the most recent
    // chats are always at the top.
    const updateChatLists = (chatId: string, message: Message) => {
        const chat = chats.find((v) => v.id == chatId);
        if (chat) {
            chat.lastMessage = message;
            chats = [chat, ...chats.filter((v) => v.id != chat.id)];
        }
    };

    // These two are just helper functions for window events
    // Should be self-explanatory
    const onclickwindow = (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        if (!target.closest("[data-menu-container]")) {
            openMenuForMessage = null;
            openEmojiSelectorForMessage = null;
        }
        if (!target.closest("[data-reaction-list]")) {
            openReactionListForMessage = null;
        }
        if (!target.closest("[data-new-chat-dropdown]")) {
            showNewChatDropdown = false;
            newChatSearch = "";
        }

        const currentChatId = currentlySelectedChatId;
        const chat = currentlySelectedChat;
        if (currentChatId && chat && chat.readReceipts.count === 0 && stickyUnreadBoundary[currentChatId]) {
            stickyUnreadBoundary[currentChatId] = null;
        }
    };
    const onfocuswindow = (ev: any) => {
        if (currentlySelectedChatId && atBottom) {
            let chat = currentlySelectedChat;
            let message = messages[currentlySelectedChatId]?.findLast((v) => v);
            if (chat && message) {
                updateLastReadForChat(currentlySelectedChatId, message.id);
            }
        }
    };

    // When we load the page, we just wait for the chat data
    // to come in and connect via SSE
    onMount(async () => {
        chats = await data.chats;
        // currentlySelectedChatId = chats[0]?.id || null;
        connectToChat();
    });

    // Whenever the currently selected chat changes, we load its messages if we haven't already
    $effect(() => {
        if (currentlySelectedChatId && !messages[currentlySelectedChatId])
            (async () => {
                const res = await fetch(`/api/messages/${currentlySelectedChatId}`);
                if (res.ok) {
                    messages[currentlySelectedChatId] = await res.json();
                } else {
                    alert("Error", `Failed to load messages: ${res.statusText}`);
                    currentlySelectedChatId = null;
                }
                await tick();
                const container = document.querySelector(".flex-1.overflow-auto.p-5");
                if (atBottom) {
                    container.scrollTop = container.scrollHeight;
                }
                if (document.hasFocus()) {
                    let chat = currentlySelectedChat;
                    let message = messages[currentlySelectedChatId]?.findLast((v) => v);
                    chat!.readReceipts.count = 0;
                    chat!.readReceipts.messageId = message.id;
                    fetch(`/api/messages/${currentlySelectedChatId}?messageId=${message.id}`, {
                        method: "HEAD",
                    });
                }
            })();
    });

    // We keep the unread divider until the user interacts with the page a little more
    $effect(() => {
        if (!currentlySelectedChat) return;
        const chat = currentlySelectedChat;
        if (chat.readReceipts.count > 0) {
            stickyUnreadBoundary[chat.id] = chat.readReceipts.messageId;
        }
    });

    // If we've reached the bottom and we're focused, we can just manually
    // call the onfocuswindow function to update last read
    $effect(() => {
        if (atBottom && document.hasFocus()) onfocuswindow(null);
    });

    // Make sure we don't carry over the SSE to other pages
    onDestroy(() => {
        conn?.close();
        // document.removeEventListener("click", closeMenusOnClick);
    });

    // The next 3 functions are self-explanatory
    const sendMessage = async () => {
        if (!newMessage.trim() || !currentlySelectedChatId) return;

        let formData = new FormData();
        formData.append("content", newMessage.trim());

        const res = await fetch(`/api/messages/${currentlySelectedChatId}`, {
            method: "POST",
            body: formData,
        });

        if (res.ok) {
            const sentMessage: Message = (await res.json()).message;
            messages[currentlySelectedChatId] = [...(messages[currentlySelectedChatId] || []), sentMessage];
            updateChatLists(currentlySelectedChatId, sentMessage);
            newMessage = "";
            if (atBottom) {
                await tick();
                const container = document.querySelector(".flex-1.overflow-auto.p-5");
                container.scrollTop = container.scrollHeight;
            }
        } else {
            console.error("Failed to send message:", res.statusText);
        }
    };
    const editMessage = async (message: Message) => {
        const newContent = (await prompt("Edit message", message.content, { startingValue: message.content, promptValue: "Edit message" }))?.trim();
        if (!newContent || newContent === message.content) return;

        const formData = new FormData();
        formData.append("messageId", message.id);
        formData.append("content", newContent);

        const res = await fetch(`/api/messages/${message.chatId}`, {
            method: "PATCH",
            body: formData,
        });

        if (res.ok) {
            messages[message.chatId] = messages[message.chatId].map((m) => (m.id === message.id ? { ...m, content: newContent, edited: true } : m));
        } else {
            console.error("Failed to edit message:", res.statusText);
        }
        openMenuForMessage = null;
    };
    const deleteMessage = async (message: Message) => {
        const stamp = snowflakeToDate(message.id);
        let yes = await confirm("Delete Message", "Are you sure you want to delete this message?", {
            children: `
                    <div class="self-end max-w-xs flex flex-col items-end gap-1 group">
                        <div class="flex items-end gap-2 relative">
                            <div class="relative bg-green-600 text-white p-3 shadow-md break-words rounded-md">
                                ${message.content}
                                <div class="absolute -right-2 bottom-0 w-0 h-0 border-solid border-t-[15px] border-t-transparent border-l-[15px] border-l-green-600"></div>
                            </div>
                          2xs  <img src=${data.user?.avatar || "/noprofile.png"} alt="avatar" class="w-7 h-7 roundeext-xsd-full bg-gray-500 mb-1" />
                        </div>
                        <div class="text-[11px] text-white/80 pr-1">You • ${formatDate(stamp)}</div>
                    </div>
                `,
            isSnippet: false,
        });
        if (!yes) return;

        const formData = new FormData();
        formData.append("messageId", message.id);

        const res = await fetch(`/api/messages/${message.chatId}`, {
            method: "DELETE",
            body: formData,
        });

        if (res.ok) {
            messages[message.chatId] = messages[message.chatId].filter((m) => m.id !== message.id);
            const chat = chats.find((v) => v.id == message.chatId);
            if (chat?.lastMessage?.id === message.id) {
                chat.lastMessage = null;
            }
        } else {
            console.error("Failed to delete message:", res.statusText);
        }
        openMenuForMessage = null;
    };
    const reactToMessage = async (message: Message, emoji: string) => {
        const formData = new FormData();
        formData.append("messageId", message.id);
        formData.append("emoji", emoji);

        const res = await fetch(`/api/messages/${message.chatId}`, {
            method: "PUT",
            body: formData,
        });

        if (res.ok) {
            const { reactions } = await res.json();
            messages[message.chatId] = messages[message.chatId].map((m) => (m.id === message.id ? { ...m, reactions } : m));
        } else {
            console.error("Failed to react to message:", res.statusText);
        }
        openMenuForMessage = null;
        openEmojiSelectorForMessage = null;
    }
    const removeReaction = async (message: Message) => {
        const formData = new FormData();
        formData.append("messageId", message.id);
        formData.append("action", "remove");

        const res = await fetch(`/api/messages/${message.chatId}`, {
            method: "PUT",
            body: formData,
        });

        if (res.ok) {
            const { reactions } = await res.json();
            messages[message.chatId] = messages[message.chatId].map((m) => (m.id === message.id ? { ...m, reactions } : m));
        } else {
            console.error("Failed to remove reaction:", res.statusText);
        }
        openReactionListForMessage = null;
    }
    const createChat = async (userId: string) => {
        const formData = new FormData();
        formData.append("participantIds", userId);

        const res = await fetch("/api/messages", {
            method: "PUT",
            body: formData,
        });

        if (res.ok) {
            const { chat, existing } = await res.json();
            if (existing) {
                // Chat already exists, just select it
                const existingChat = chats.find((c) => c.id === chat.id);
                if (existingChat) {
                    currentlySelectedChatId = existingChat.id;
                } else {
                    // Existing chat not in our local list (shouldn't happen, but handle it)
                    chats = [{ ...chat, participantIds: chat.participants?.map((p: any) => p.userId) ?? chat.participantIds, lastMessage: null, readReceipts: { messageId: null, count: 0 } }, ...chats];
                    currentlySelectedChatId = chat.id;
                }
            } else {
                // New chat created
                const newChat = {
                    ...chat,
                    readReceipts: { messageId: null, count: 0 },
                };
                chats = [newChat, ...chats];
                currentlySelectedChatId = newChat.id;
            }
        } else {
            const err = await res.json();
            alert("Error", err.error || "Failed to create chat");
        }

        showNewChatDropdown = false;
        newChatSearch = "";
    };
</script>

<svelte:window on:focus={onfocuswindow} on:click={onclickwindow} />

<div class="w-full h-full lg:p-10">
    <div class="w-full h-full flex flex-row flex-nowrap border-gray-600">
        <div class="shadow-[25px_-5px_20px_-12px_rgb(0_0_0_/_0.25)] w-64 lg:w-96 bg-gray-600 shrink-0">
            <div class="w-full bg-green-700 font-bold text-xl flex justify-between items-center py-2 shadow-2xl">
                <div class="px-4">CHATS</div>
                <div class="flex flex-row gap-2" data-new-chat-dropdown>
                    <div class="relative">
                        <IconButton onclick={() => { showNewChatDropdown = !showNewChatDropdown; newChatSearch = ""; }}><span class="material-symbols-outlined icons-fill">add</span></IconButton>
                        {#if showNewChatDropdown}
                            <div class="absolute right-0 top-full mt-1 z-50 w-64 bg-gray-800 shadow-lg rounded-md overflow-hidden" transition:slide={{ duration: 150 }}>
                                <div class="p-2">
                                    <input
                                        bind:value={newChatSearch}
                                        type="text"
                                        placeholder="Search users..."
                                        class="w-full bg-gray-700 text-white text-sm px-3 py-2 rounded placeholder-gray-400 border-0 focus:outline-none focus:ring-1 focus:ring-green-500"
                                    />
                                </div>
                                <div class="max-h-60 overflow-y-auto">
                                    {#await data.users}
                                        <div class="flex justify-center p-3"><Spinner /></div>
                                    {:then users}
                                        {@const filtered = users.filter((u) => u.id !== data.user.id && (newChatSearch === "" || `${u.firstName} ${u.lastName}`.toLowerCase().includes(newChatSearch.toLowerCase())))}
                                        {#if filtered.length === 0}
                                            <div class="text-sm text-gray-400 text-center py-3">No users found</div>
                                        {:else}
                                            {#each filtered as user}
                                                <button
                                                    onclick={() => createChat(user.id)}
                                                    class="flex items-center gap-3 w-full px-3 py-2 text-left text-sm hover:bg-neutral-500/40 active:bg-neutral-400/40 transition-colors"
                                                >
                                                    <img src={user.avatar || "/noprofile.png"} alt="avatar" class="w-8 h-8 rounded-full bg-gray-500" />
                                                    <span>{toTitleCase(`${user.firstName} ${user.lastName}`)}</span>
                                                </button>
                                            {/each}
                                        {/if}
                                    {/await}
                                </div>
                            </div>
                        {/if}
                    </div>
                </div>
            </div>
            {#if chats == null}
                <div class="w-full flex justify-center items-center p-5 gap-2 font-bold text-lg">
                    <Spinner />
                </div>
            {:else if chats.length === 0}
                <div class="w-full flex justify-center items-center p-5 gap-2 font-bold text-lg text-gray-300">No chats available.</div>
            {:else}
                {#each chats.filter((v) => v) as chat, ind}
                    <button
                        onclick={() => {
                            currentlySelectedChatId = chat.id;
                        }}
                        class="block grow w-full {chat.id === currentlySelectedChatId ? 'bg-neutral-500/50' : 'hover:bg-neutral-500/25 active:bg-neutral-500/50'} font-bold py-5 px-2 text-lg flex items-center justify-between gap-2 transition-all"
                    >
                        <div class="flex flex-row items-center gap-2">
                            <img src="/noprofile.png" alt="avatar" class="h-10 px-2 rounded-full" />
                            <div class="flex flex-col items-start justify-evenly text-left -space-y-1">
                                <div class="overflow-clip line-clamp-1">
                                    {#if chat.isGroup}
                                        {chat.name}
                                    {:else}
                                        {#await data.users}
                                            <span>Loading...</span>
                                        {:then users}
                                            {@const other = chat.participantIds.find((id) => id !== data.user.id)}
                                            {@const user = users.find((u) => u.id === other)}
                                            {@const name = user ? `${user.firstName} ${user.lastName}` : "Unknown User"}
                                            {toTitleCase(name)}
                                        {/await}
                                    {/if}
                                </div>
                                <div>
                                    {#if chat.lastMessage}
                                        <span class="text-sm font-normal text-gray-300 overflow-clip line-clamp-1">
                                            {#if !chat.isGroup}
                                                {#if chat.lastMessage.author === data.user.id}
                                                    You:
                                                {/if}
                                            {:else}
                                                {#await data.users}
                                                    <span>Loading...</span>
                                                {:then users}
                                                    {@const author = users.find((u) => u.id === chat.lastMessage.author)}
                                                    {@const authorName = author ? `${author.firstName}` : "Unknown"}
                                                    {toTitleCase(authorName)}:
                                                {/await}
                                            {/if}
                                            {chat.lastMessage.content.slice(0, 30)}{chat.lastMessage.content.length > 30 ? "..." : ""}
                                        </span>
                                    {:else}
                                        <span class="text-sm font-normal text-gray-300">Nothing new yet</span>
                                    {/if}
                                </div>
                            </div>
                        </div>
                        {#if chat.readReceipts.count > 0}
                            <div class="text-white bg-green-600 grid place-items-center aspect-square w-5 text-xs m-1 rounded-full">{chat.readReceipts.count}</div>
                        {/if}
                    </button>
                {/each}
            {/if}
        </div>
        <div
            class="bg-gray-600/50 flex-1 grow-1 overflow-auto"
            onscroll={(event: Event) => {
                const target = event.target as HTMLElement;
                const threshold = 20; // pixels from the bottom to consider "at bottom"
                atBottom = target.scrollHeight - target.scrollTop - target.clientHeight <= threshold;
            }}
        >
            {#await data.users then users}
                {@const chat = currentlySelectedChat}
                {#if chat != null}
                    {@const other = chat.participantIds.find((id) => id !== data.user.id)}
                    {@const user = users.find((u) => u.id === other)}
                    {@const name = user ? `${user.firstName} ${user.lastName}` : "Unknown User"}

                    {#snippet chatBubble(isMine, message, tail, stamp, reactionGroups, i)}
                        <div class="{isMine ? 'self-end' : 'self-start'} max-w-1/2 flex flex-col {isMine ? 'items-end' : 'items-start'} gap-1 group" data-menu-container>
                            <div class="flex items-end gap-2 relative">
                                {#if isMine}
                                    <div class="relative inline-block self-center">
                                        <IconButton
                                            onclick={() => {
                                                openMenuForMessage = openMenuForMessage === message.id ? null : message.id;
                                            }}
                                            transparent
                                            class="self-center !p-0 grid place-items-center [&]:opacity-0 {openMenuForMessage === message.id ? 'opacity-100! bg-neutral-400/50 hover:bg-neutral-400/50' : ''} group-hover:opacity-100! transition duration-150 ease-out"
                                        >
                                            more_vert
                                        </IconButton>
                                        {#if openMenuForMessage === message.id}
                                            <div class="absolute left-2 z-50 {i === messages[chat.id].length - 1 && 'bottom-full'} py-1 min-w-max overflow-hidden bg-gray-800 shadow-md rounded-md rounded-tl-none" transition:slide={{ duration: 150 }}>
                                                <button class="block w-full text-left px-4 py-2 text-sm hover:bg-neutral-500/40 active:bg-neutral-400/40 transition-colors" onclick={() => editMessage(message)}> Edit </button>
                                                <button class="block w-full text-left px-4 py-2 text-sm hover:bg-neutral-500/40 active:bg-neutral-400/40 transition-colors" onclick={() => deleteMessage(message)}> Delete </button>
                                            </div>
                                        {/if}
                                    </div>
                                {:else}
                                    {#if tail}
                                        <img src={user?.avatar || "/noprofile.png"} alt="avatar" class="w-7 h-7 rounded-full bg-gray-500 mb-1" />
                                    {:else}
                                        <div class="w-7 h-7"></div>
                                    {/if}
                                {/if}
                                <div class="relative {isMine ? 'bg-green-600' : 'bg-gray-600'} text-white p-3 shadow-md break-words rounded-md">
                                    <div
                                        class="absolute bg-gray-700 flex rounded-full {isMine ? 'flex-row' : 'flex-row-reverse'} items-center z-10 transition-all {openEmojiSelectorForMessage === message.id || reactionGroups.length > 0 ? 'opacity-100' : 'opacity-0'} group-hover:opacity-100"
                                        style="top: -14px; {isMine ? 'right' : 'left'}: calc(100% - 14px);"
                                    >
                                        <div class="relative">
                                            <IconButton
                                                onclick={() => {
                                                    openEmojiSelectorForMessage = openEmojiSelectorForMessage === message.id ? null : message.id;
                                                }}
                                                transparent
                                                class="transition-all text-sm p-0! aspect-square! self-center w-7 duration-150 ease-out"
                                            >
                                                add_reaction
                                            </IconButton>
                                            {#if openEmojiSelectorForMessage === message.id}
                                                <div class="absolute {isMine ? 'right-full' : 'left-full'} -top-1 z-50 flex flex-row min-w-max items-center justify-center overflow-hidden bg-gray-800 shadow-md rounded-full" transition:slide={{ axis: 'x', duration: 150 }}>
                                                    {#each emoji as emj}
                                                        <Button onclick={() => void reactToMessage(message, emj)} transparent class="rounded-full !p-2">
                                                            {emj}
                                                        </Button>
                                                    {/each}
                                                </div>
                                            {/if}
                                        </div>
                                        {#each reactionGroups as [emj, count]}
                                            <button
                                                onclick={(e) => { e.stopPropagation(); openReactionListForMessage = openReactionListForMessage === message.id ? null : message.id; }}
                                                class="rounded-full text-sm p-1 flex items-center select-none cursor-pointer hover:bg-gray-600 transition-colors"
                                                data-reaction-list
                                            >
                                                <span>{emj}</span>{#if count > 1}<span class="text-xs ml-0.5">{count}</span>{/if}
                                            </button>
                                        {/each}
                                        {#if openReactionListForMessage === message.id}
                                            <div class="absolute top-full {isMine ? 'left-0' : 'right-0'} mt-1 z-50 bg-gray-800 shadow-lg rounded-md overflow-hidden min-w-max" data-reaction-list transition:slide={{ duration: 150 }}>
                                                {#each Object.entries(message.reactions ?? {}) as [userId, emj]}
                                                    {@const reactor = users.find((u) => u.id === userId)}
                                                    <div class="flex items-center gap-2 px-3 py-1.5 text-sm whitespace-nowrap">
                                                        <span>{emj}</span>
                                                        <span class="flex-1">{reactor ? toTitleCase(`${reactor.firstName} ${reactor.lastName}`) : 'Unknown User'}</span>
                                                        {#if userId === data.user.id}
                                                            <IconButton transparent onclick={() => removeReaction(message)} class="text-red-400 !p-1 aspect-square">
                                                                close
                                                            </IconButton>
                                                        {/if}
                                                    </div>
                                                {/each}
                                            </div>
                                        {/if}
                                    </div>
                                    {message.content}
                                    {#if tail}
                                        <div class="absolute {isMine ? '-right-2' : '-left-2'} bottom-0 w-0 h-0 border-solid border-t-[15px] border-t-transparent {isMine ? 'border-l-[15px] border-l-green-600' : 'border-r-[15px] border-r-gray-600'}"></div>
                                    {/if}
                                    {#if message.edited}
                                        <div class="text-[0.625rem] text-white/70 italic pt-0.5 select-none">Edited</div>
                                    {/if}
                                </div>
                                {#if isMine}
                                    {#if tail}
                                        <img src={data.user?.avatar || "/noprofile.png"} alt="avatar" class="w-7 h-7 rounded-full bg-gray-500 mb-1" />
                                    {:else}
                                        <div class="w-7 h-7"></div>
                                    {/if}
                                {/if}
                            </div>
                            {#if tail}
                                <div class="text-[11px] {isMine ? 'text-white/80 pr-1' : 'text-gray-200/90 pl-1'}">{isMine ? 'You' : toTitleCase(user.firstName)} • {formatDate(stamp)}</div>
                            {/if}
                        </div>
                    {/snippet}
                    <div class="flex flex-col gap-0 inset-0 h-full">
                        <div class="w-full bg-green-700 font-medium text-xl flex justify-between items-center p-2 shadow-2xl">
                            <div class="px-2">
                                {toTitleCase(name)}
                            </div>
                            <div class="flex flex-row gap-2">
                                {#if user.phone}
                                    <IconButton onclick={() => (window.location.href = `tel:${user.phone}`)}>
                                        <span class="material-symbols-outlined icons-fill">phone</span>
                                    </IconButton>
                                {/if}
                                <IconButton onclick={() => (window.location.href = `mailto:${user.email}`)}><span class="material-symbols-outlined icons-fill">email</span></IconButton>
                                <IconButton onclick={() => null}><span class="material-symbols-outlined icons-fill">account_circle</span></IconButton>
                            </div>
                        </div>
                        <div class="flex-1 overflow-auto p-5">
                            {#if !messages[chat.id]}
                                <div class="w-full flex justify-center items-center p-5 gap-2 font-bold text-lg">
                                    <Spinner />
                                </div>
                            {:else if messages[chat.id].length === 0}
                                <div class="w-full flex justify-center items-center p-5 gap-2 font-bold text-lg text-gray-300">No messages yet. Say hello!</div>
                            {:else}
                                {@const liveUnreadId = chat.readReceipts.count > 0 ? chat.readReceipts.messageId : null}
                                {@const stickyUnreadId = stickyUnreadBoundary[chat.id] ?? null}
                                {@const unreadBoundaryId = liveUnreadId ?? stickyUnreadId}
                                <div class="flex flex-col gap-1 w-full">
                                    {#each messages[chat.id] as message, i (message.id)}
                                        {@const tail = isTailMessage(messages[chat.id], i)}
                                        {@const stamp = snowflakeToDate(message.id)}
                                        {@const prevStamp = i > 0 ? snowflakeToDate(messages[chat.id][i - 1].id) : null}
                                        {@const showDaySeparator = !prevStamp || stamp.toDateString() !== prevStamp.toDateString()}
                                        {@const reactionGroups = Object.entries(
                                            Object.values(message.reactions ?? {}).reduce((acc: Record<string, number>, emj: string) => { acc[emj] = (acc[emj] || 0) + 1; return acc; }, {})
                                        )}
                                        <span animate:flip style="display: contents;" id={"message-" + message.id}>
                                            {#if showDaySeparator}
                                                <div class="flex items-center gap-3 my-4 text-xs text-gray-300/80">
                                                    <div class="flex-1 h-px bg-gray-500/60"></div>
                                                    <span class="px-3 py-1 rounded-full bg-gray-700/80 text-gray-300 select-none">{formatDayLabel(stamp)}</span>
                                                    <div class="flex-1 h-px bg-gray-500/60"></div>
                                                </div>
                                            {/if}
                                            {@render chatBubble(message.author === data.user.id, message, tail, stamp, reactionGroups, i)}
                                            {#if tail && (messages[chat.id].length > i+1 && messages[chat.id][i+1].author === message.author)}<div class="mb-0.5"></div>{/if}
                                            {#if unreadBoundaryId === message.id}
                                                <div class="flex items-center gap-3 my-3 text-xs text-gray-200/80" aria-label="Unread messages divider">
                                                    <div class="flex-1 h-px bg-gray-500"></div>
                                                    <span class="px-3 py-1 rounded-full bg-gray-700 border border-gray-500">Unread</span>
                                                    <div class="flex-1 h-px bg-gray-500"></div>
                                                </div>
                                            {/if}
                                        </span>
                                    {/each}
                                </div>
                            {/if}
                        </div>
                        <div>
                            <div class="w-full bg-gray-700 p-2 flex flex-row gap- items-center">
                                <IconButton onclick={() => null} transparent>
                                    <span class="material-symbols-outlined icons-fill">emoji_emotions</span>
                                </IconButton>
                                <div class="relative flex-1 group -mt-1.5">
                                    <input bind:value={newMessage} type="text" placeholder="Type a message..." class="w-full bg-gray-700 text-white px-2 pt-2 pb-1 placeholder-gray-300 border-0 focus:outline-none focus:ring-0 focus:border-transparent" />
                                    <div class="absolute left-2 right-2 bottom-0 h-px bg-gray-600"></div>
                                    <div class="absolute left-2 right-2 bottom-0 h-0.5 bg-green-400 scale-x-0 group-focus-within:scale-x-100 transition-transform duration-200 origin-left"></div>
                                </div>
                                <IconButton onclick={() => sendMessage()} transparent>
                                    <span class="material-symbols-outlined icons-fill">send</span>
                                </IconButton>
                            </div>
                        </div>
                    </div>
                {/if}
            {/await}
        </div>
    </div>
</div>
