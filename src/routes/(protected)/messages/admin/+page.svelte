<script lang="ts">
    import SidebarContent from "$lib/substructure/SidebarContent.svelte";
    import Button from "$lib/components/Button.svelte";
    import IconButton from "$lib/components/IconButton.svelte";
    import Input from "$lib/components/Input.svelte";
    import Table from "$lib/components/Table.svelte";
    import { alert, confirm, prompt } from "$lib/components/Dialog.svelte";
    import Toast, { showToast } from "$lib/components/Toast.svelte";
    import { snowflakeToDate } from "$lib/functions/Snowflake.js";
    import { toTitleCase } from "$lib/functions/chatHelpers";
    import type { User } from "$lib/types/types";
    import type { Message } from "$lib/types/messages";
    import { onMount } from "svelte";

    let { data } = $props();
    const users: User[] = data.allUsers;
    const getUserById = (id: string) => users.find(u => u.id === id);
    const getUserName = (id: string) => {
        const u = getUserById(id);
        return u ? toTitleCase(`${u.firstName} ${u.lastName}`) : id;
    };

    // ==================== PRIVACY DIALOG ====================
    let privacyAcknowledged = $state(false);

    onMount(async () => {
        await alert(
            "Privacy & Responsibility Notice",
            "This admin panel provides access to private user messages and reports. " +
            "All information must be handled with care and used only for legitimate moderation and safety purposes. " +
            "Any abuse of these features is a serious violation of trust and policy. " +
            "All monitoring activity may be audited."
        );
        privacyAcknowledged = true;
        loadReports();
        loadBadWordsConfig();
    });

    // ==================== CONDUCT ISSUES ====================
    let reports: any[] = $state([]);
    let reportsLoading = $state(false);
    let reportStatusFilter = $state("open");

    const loadReports = async () => {
        reportsLoading = true;
        const params = new URLSearchParams();
        if (reportStatusFilter !== "all") params.set("status", reportStatusFilter);
        const res = await fetch(`/api/messages/admin/reports?${params}`);
        if (res.ok) {
            const data = await res.json();
            reports = data.reports;
        }
        reportsLoading = false;
    };

    const updateReportStatus = async (reportId: string, status: string) => {
        const res = await fetch("/api/messages/admin/reports", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reportId, status }),
        });
        if (res.ok) {
            showToast("Report status updated", { icon: "check" });
            await loadReports();
        }
    };

    const addReportComment = async (reportId: string, currentNotes: string) => {
        const note = await prompt("Add Comment", "Enter a comment or note for this report:", { startingValue: currentNotes, promptValue: "Admin notes" });
        if (note === null) return;
        const res = await fetch("/api/messages/admin/reports", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reportId, adminNotes: note }),
        });
        if (res.ok) {
            showToast("Comment saved", { icon: "check" });
            await loadReports();
        }
    };

    // View message in chat context modal
    let viewingChatContext: any = $state(null);
    let chatContextMessages: any[] = $state([]);
    let chatContextLoading = $state(false);
    let viewingChatContextChatId: string | null = $state(null);

    const viewMessageInContext = async (msg: any) => {
        viewingChatContext = msg;
        viewingChatContextChatId = msg.chatId;
        chatContextLoading = true;
        const res = await fetch(`/api/messages/admin/chats?chatId=${msg.chatId}&limit=20`);
        if (res.ok) {
            const data = await res.json();
            chatContextMessages = data.messages.toReversed();
        }
        chatContextLoading = false;
    };

    const openContextInChatsPanel = () => {
        const chatId = viewingChatContextChatId;
        viewingChatContext = null;
        if (chatId) {
            // Load the chat data - user then switches to Chats tab to see it
            void selectChat(chatId);
            showToast("Chat loaded — switch to the Chats tab to view full context", { icon: "forum" });
        }
    };

    // Bad words config
    let badWordsConfig = $state({ enabled: false, words: [] as string[] });
    let newBadWord = $state("");

    const loadBadWordsConfig = async () => {
        const res = await fetch("/api/messages/admin/badwords");
        if (res.ok) badWordsConfig = await res.json();
    };

    const saveBadWordsConfig = async () => {
        const res = await fetch("/api/messages/admin/badwords", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(badWordsConfig),
        });
        if (res.ok) {
            badWordsConfig = await res.json();
            showToast("Bad words configuration saved", { icon: "check" });
        }
    };

    const addBadWord = () => {
        const word = newBadWord.trim().toLowerCase();
        if (word && !badWordsConfig.words.includes(word)) {
            badWordsConfig.words = [...badWordsConfig.words, word];
            newBadWord = "";
        }
    };

    const removeBadWord = (word: string) => {
        badWordsConfig.words = badWordsConfig.words.filter((w: string) => w !== word);
    };

    // ==================== MESSAGE VIEWING ====================
    let adminMessages: any[] = $state([]);
    let messagesLoading = $state(false);
    let messagesTotal = $state(0);
    let messagesPage = $state(1);
    let messagesLimit = $state(50);

    // Filters
    let filterAuthor = $state("");
    let filterChatId = $state("");
    let filterKeyword = $state("");
    let filterHasAttachment = $state(false);
    let filterShowDeleted = $state(false);
    let filterDateFrom = $state("");
    let filterDateTo = $state("");
    let filterSort = $state("desc");
    let selectedMessages = $state<boolean[]>([]);

    const loadMessages = async () => {
        messagesLoading = true;
        const params = new URLSearchParams();
        params.set("page", messagesPage.toString());
        params.set("limit", messagesLimit.toString());
        params.set("sort", filterSort);
        if (filterAuthor) params.set("author", filterAuthor);
        if (filterChatId) params.set("chatId", filterChatId);
        if (filterKeyword) params.set("keyword", filterKeyword);
        if (filterHasAttachment) params.set("hasAttachment", "true");
        if (filterShowDeleted) params.set("showDeleted", "true");
        if (filterDateFrom) params.set("dateFrom", filterDateFrom);
        if (filterDateTo) params.set("dateTo", filterDateTo);

        const res = await fetch(`/api/messages/admin?${params}`);
        if (res.ok) {
            const data = await res.json();
            adminMessages = data.messages;
            messagesTotal = data.total;
            selectedMessages = new Array(data.messages.length).fill(false);
        }
        messagesLoading = false;
    };

    const clearFilters = () => {
        filterAuthor = "";
        filterChatId = "";
        filterKeyword = "";
        filterHasAttachment = false;
        filterShowDeleted = false;
        filterDateFrom = "";
        filterDateTo = "";
        filterSort = "desc";
        messagesPage = 1;
    };

    // Edit history viewer
    let viewingEditHistory: any = $state(null);

    // Export
    const exportMessages = (format: string) => {
        const selected = adminMessages.filter((_, i) => selectedMessages[i]);
        const toExport = selected.length > 0 ? selected : adminMessages;

        if (format === "json") {
            const blob = new Blob([JSON.stringify(toExport, null, 2)], { type: "application/json" });
            downloadBlob(blob, "messages.json");
        } else if (format === "csv") {
            const header = "ID,Author,Content,Chat ID,Timestamp,Edited,Deleted\n";
            const rows = toExport.map((m: any) =>
                `"${m.id}","${m.authorUser?.username || m.author}","${(m.content || '').replace(/"/g, '""')}","${m.chatId}","${m.timestamp}","${m.edited}","${m.deleted}"`
            ).join("\n");
            const blob = new Blob([header + rows], { type: "text/csv" });
            downloadBlob(blob, "messages.csv");
        } else if (format === "txt") {
            const text = toExport.map((m: any) =>
                `[${m.timestamp}] ${m.authorUser?.username || m.author}: ${m.content}`
            ).join("\n");
            const blob = new Blob([text], { type: "text/plain" });
            downloadBlob(blob, "messages.txt");
        }
    };

    const downloadBlob = (blob: Blob, filename: string) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    };

    // Mass delete
    const massDelete = async (permanent: boolean) => {
        const ids = adminMessages.filter((_, i) => selectedMessages[i]).map((m: any) => m.id);
        if (ids.length === 0) {
            await alert("Mass Delete", "No messages selected.");
            return;
        }
        const ok = await confirm("Mass Delete", `Are you sure you want to ${permanent ? "permanently delete" : "mark as deleted"} ${ids.length} message(s)?`);
        if (!ok) return;
        const res = await fetch("/api/messages/admin", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messageIds: ids, permanent }),
        });
        if (res.ok) {
            showToast(`${ids.length} message(s) ${permanent ? "permanently deleted" : "marked as deleted"}`, { icon: "check" });
            await loadMessages();
        }
    };

    // ==================== CHAT MONITORING ====================
    let adminChats: any[] = $state([]);
    let adminChatUsers: Record<string, User> = $state({});
    let chatsLoading = $state(false);
    let selectedChatId = $state<string | null>(null);
    let chatMessages: any[] = $state([]);
    let chatMessagesLoading = $state(false);
    let chatMessagesPage = $state(1);
    let chatHasMore = $state(false);
    let chatLoadingMore = $state(false);
    let chatViewingEditHistory: any = $state(null);

    const loadChats = async () => {
        chatsLoading = true;
        const res = await fetch("/api/messages/admin/chats");
        if (res.ok) {
            const data = await res.json();
            adminChats = data.chats;
            adminChatUsers = data.users;
        }
        chatsLoading = false;
    };

    const selectChat = async (chatId: string) => {
        selectedChatId = chatId;
        chatMessagesPage = 1;
        chatMessages = [];
        chatMessagesLoading = true;
        const res = await fetch(`/api/messages/admin/chats?chatId=${chatId}&page=1&limit=50`);
        if (res.ok) {
            const data = await res.json();
            chatMessages = data.messages.toReversed();
            chatHasMore = data.hasMore;
        }
        chatMessagesLoading = false;
    };

    const loadMoreChatMessages = async () => {
        if (!selectedChatId || chatLoadingMore || !chatHasMore) return;
        chatLoadingMore = true;
        chatMessagesPage++;
        const res = await fetch(`/api/messages/admin/chats?chatId=${selectedChatId}&page=${chatMessagesPage}&limit=50`);
        if (res.ok) {
            const data = await res.json();
            chatMessages = [...data.messages.toReversed(), ...chatMessages];
            chatHasMore = data.hasMore;
        }
        chatLoadingMore = false;
    };

    const handleChatScroll = (e: Event) => {
        const target = e.target as HTMLElement;
        if (target.scrollTop < 100 && chatHasMore && !chatLoadingMore) {
            void loadMoreChatMessages();
        }
    };

    const getChatDisplayName = (chat: any) => {
        if (chat.name) return chat.name;
        if (!chat.isGroup && chat.participantIds.length === 2) {
            const names = chat.participantIds.map((id: string) => {
                const u = adminChatUsers[id] || getUserById(id);
                return u ? toTitleCase(`${u.firstName} ${u.lastName}`) : id;
            });
            return names.join(" & ");
        }
        return `Chat ${chat.id}`;
    };

    const formatTimestamp = (id: string) => {
        try {
            return snowflakeToDate(id).toLocaleString();
        } catch {
            return "Unknown";
        }
    };

    const formatReactions = (reactions: {[userId: string]: string}) => {
        if (!reactions || Object.keys(reactions).length === 0) return '';
        const counts: {[emoji: string]: number} = {};
        for (const emoji of Object.values(reactions)) {
            counts[emoji] = (counts[emoji] || 0) + 1;
        }
        return Object.entries(counts).map(([emoji, count]) => `${emoji} ${count}`).join(' ');
    };
</script>

<Toast />

<SidebarContent
    banner=""
    items={[
        {
            tabName: "Conduct",
            tabIcon: "gavel",
            custom: true,
            content: conductContent,
        },
        {
            tabName: "Messages",
            tabIcon: "mail",
            custom: true,
            content: messagesContent,
        },
        {
            tabName: "Chats",
            tabIcon: "forum",
            custom: true,
            content: chatsContent,
        },
    ]}
/>

{#snippet conductContent()}
<div class="p-6">
    <h1 class="text-3xl font-bold mb-2">Conduct Issues</h1>
    <p class="text-neutral-400 mb-6">Manage reported messages and configure content filters.</p>

    <!-- Privacy Warning Card -->
    <div class="bg-amber-900/30 shadow-md p-4 mb-6" role="alert">
        <div class="flex items-center gap-2 mb-1">
            <span class="material-symbols-outlined text-amber-400">warning</span>
            <strong class="text-amber-300">Privacy Notice</strong>
        </div>
        <p class="text-sm text-amber-200">This section provides access to user reports. Handle all information with care and in accordance with privacy policies. Do not abuse this feature.</p>
    </div>

    <!-- Reports Section -->
    <div class="mb-8">
        <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-bold">Reports</h2>
            <div class="flex items-center gap-2">
                <label for="report-status-filter" class="text-sm">Filter:</label>
                <select id="report-status-filter" bind:value={reportStatusFilter} onchange={loadReports}
                    class="bg-gray-700 border border-gray-600 px-3 py-1.5 text-sm">
                    <option value="all">All</option>
                    <option value="open">Open</option>
                    <option value="reviewed">Reviewed</option>
                    <option value="resolved">Resolved</option>
                    <option value="dismissed">Dismissed</option>
                </select>
                <IconButton onclick={() => void loadReports()}>refresh</IconButton>
            </div>
        </div>

        {#if reportsLoading}
            <p class="text-neutral-400">Loading reports...</p>
        {:else if reports.length === 0}
            <p class="text-neutral-400">No reports found.</p>
        {:else}
            <div class="space-y-3">
                {#each reports as report}
                    <div class="bg-gray-800 shadow-md p-4">
                        <div class="flex items-start justify-between mb-2">
                            <div class="flex items-center gap-2">
                                <span class="inline-block px-2 py-0.5 text-xs font-bold uppercase
                                    {report.status === 'open' ? 'bg-red-700' : report.status === 'reviewed' ? 'bg-yellow-700' : report.status === 'resolved' ? 'bg-green-700' : 'bg-gray-600'}">
                                    {report.status}
                                </span>
                                <span class="text-xs text-neutral-400">
                                    {report.source === 'badword' ? 'Auto-flagged (bad word)' : `Reported by ${report.reporter ? toTitleCase(`${report.reporter.firstName} ${report.reporter.lastName}`) : 'Unknown'}`}
                                </span>
                            </div>
                            <span class="text-xs text-neutral-400">{new Date(report.reportedAt).toLocaleString()}</span>
                        </div>
                        {#if report.reason}
                            <p class="text-sm mb-2"><strong>Reason:</strong> {report.reason}</p>
                        {/if}
                        <div class="bg-gray-700 p-3 mb-3">
                            <p class="text-xs text-neutral-400 mb-1">
                                Message by <strong>{report.messageAuthor ? toTitleCase(`${report.messageAuthor.firstName} ${report.messageAuthor.lastName}`) : 'Unknown'}</strong>
                                {#if report.message}
                                    <span class="ml-2">({formatTimestamp(report.message.id)})</span>
                                {/if}
                            </p>
                            <p class="text-sm">{report.message?.content || '[Message deleted]'}</p>
                        </div>
                        {#if report.adminNotes}
                            <div class="bg-green-900/30 p-3 mb-3 text-sm">
                                <strong class="text-green-300">Admin Notes:</strong> {report.adminNotes}
                            </div>
                        {/if}
                        <!-- Quick Actions -->
                        <div class="flex flex-wrap gap-2">
                            {#if report.status === 'open'}
                                <Button onclick={() => void updateReportStatus(report.id, 'reviewed')}>Mark Reviewed</Button>
                                <Button onclick={() => void updateReportStatus(report.id, 'resolved')}>Resolve</Button>
                                <Button onclick={() => void updateReportStatus(report.id, 'dismissed')}>Dismiss</Button>
                            {:else if report.status === 'reviewed'}
                                <Button onclick={() => void updateReportStatus(report.id, 'resolved')}>Resolve</Button>
                                <Button onclick={() => void updateReportStatus(report.id, 'dismissed')}>Dismiss</Button>
                            {:else}
                                <Button onclick={() => void updateReportStatus(report.id, 'open')}>Reopen</Button>
                            {/if}
                            <Button transparent onclick={() => void addReportComment(report.id, report.adminNotes || '')}>
                                <span class="material-symbols-outlined text-sm">comment</span>
                                Add Comment
                            </Button>
                            {#if report.message}
                                <Button transparent onclick={() => void viewMessageInContext(report.message)}>
                                    <span class="material-symbols-outlined text-sm">forum</span>
                                    View in Chat
                                </Button>
                            {/if}
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    </div>

    <!-- Bad Words Configuration -->
    <div>
        <h2 class="text-xl font-bold mb-4">Bad Words Filter</h2>
        <div class="bg-gray-800 shadow-md p-4">
            <div class="flex items-center gap-4 mb-4">
                <div class="flex flex-row justify-center items-center gap-2">
                    <Input type="checkbox" class='w-min' bind:value={badWordsConfig.enabled} />
                    <div>Enable filter</div>
                </div>
                <p class="text-sm text-neutral-400">When enabled, messages containing flagged words will be blocked.</p>
            </div>

            <p class="text-xs text-neutral-400 mb-3">
                Words use <strong>regex patterns</strong> by default (e.g. <code class="bg-gray-700 px-1">\bword\b</code> for word boundary matching).
                Plain words with special characters will be automatically escaped if the regex is invalid.
            </p>

            <div class="flex gap-2 mb-4">
                <input type="text" bind:value={newBadWord} placeholder="Add a word or regex pattern..."
                    class="bg-gray-700 border border-gray-600 px-3 py-1.5 flex-1 text-sm"
                    aria-label="New bad word"
                    onkeydown={(e) => { if (e.key === 'Enter') addBadWord(); }} />
                <Button onclick={addBadWord}>Add</Button>
            </div>

            {#if badWordsConfig.words.length > 0}
                <div class="flex flex-wrap gap-2 mb-4">
                    {#each badWordsConfig.words as word}
                        <span class="bg-gray-700 px-3 py-1 text-sm flex items-center gap-1">
                            {word}
                            <button onclick={() => removeBadWord(word)} class="text-red-400 hover:text-red-300 ml-1"
                                aria-label="Remove word {word}">
                                <span class="material-symbols-outlined text-sm">close</span>
                            </button>
                        </span>
                    {/each}
                </div>
            {:else}
                <p class="text-sm text-neutral-400 mb-4">No words configured.</p>
            {/if}

            <div class="flex items-center gap-3">
                <Button onclick={() => void saveBadWordsConfig()}>Save Configuration</Button>
                <span class="text-xs text-neutral-400 italic">Configuration does not autosave — click Save to apply changes.</span>
            </div>
        </div>
    </div>
</div>

<!-- Chat Context Modal -->
{#if viewingChatContext}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="fixed inset-0 bg-black/70 z-50 flex items-center justify-center" role="dialog" aria-label="Message in chat context" tabindex="-1"
        onclick={() => viewingChatContext = null}
        onkeydown={(e) => { if (e.key === 'Escape') viewingChatContext = null; }}>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div class="bg-neutral-800 shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col"
            role="document"
            onclick={(e) => e.stopPropagation()}>
            <div class="px-6 pt-5 pb-2">
                <h2 class="text-2xl font-bold">Message in Context</h2>
                <p class="text-sm text-neutral-400">Showing surrounding messages in the chat</p>
            </div>
            <div class="px-6 py-2 flex-1 overflow-y-auto">
                {#if chatContextLoading}
                    <p class="text-neutral-400">Loading...</p>
                {:else}
                    {#each chatContextMessages as msg}
                        <div class="mb-3 p-2 {msg.id === viewingChatContext.id ? 'bg-amber-900/30 border-l-2 border-amber-400' : ''}">
                            <div class="flex items-center gap-2 text-xs text-neutral-400 mb-0.5">
                                <strong class="text-neutral-200">
                                    {msg.authorUser ? toTitleCase(`${msg.authorUser.firstName} ${msg.authorUser.lastName}`) : getUserName(msg.author)}
                                </strong>
                                <span>{formatTimestamp(msg.id)}</span>
                            </div>
                            <p class="text-sm pl-2">{msg.content}</p>
                        </div>
                    {/each}
                {/if}
            </div>
            <div class="px-6 pb-4 pt-2 flex justify-end gap-2">
                <Button transparent onclick={openContextInChatsPanel}>
                    <span class="material-symbols-outlined text-sm">open_in_new</span>
                    Open in Chats Panel
                </Button>
                <Button onclick={() => viewingChatContext = null}>Close</Button>
            </div>
        </div>
    </div>
{/if}
{/snippet}

{#snippet messagesContent()}
<div class="p-6">
    <h1 class="text-3xl font-bold mb-2">Message Viewing</h1>
    <p class="text-neutral-400 mb-4">Search, filter, and manage all messages across the platform.</p>

    <!-- Privacy Warning Card -->
    <div class="bg-amber-900/30 shadow-md p-4 mb-6" role="alert">
        <div class="flex items-center gap-2 mb-1">
            <span class="material-symbols-outlined text-amber-400">warning</span>
            <strong class="text-amber-300">Privacy Notice</strong>
        </div>
        <p class="text-sm text-amber-200">You are viewing private messages. This feature must only be used for legitimate moderation and safety purposes. Any abuse of this feature is a violation of trust and policy.</p>
    </div>

    <!-- Filter Panel Card -->
    <div class="bg-gray-800 shadow-md p-4 mb-6">
        <h2 class="text-lg font-bold mb-3">Filters</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <div>
                <label for="filter-author" class="block text-xs text-neutral-400 mb-1">Author</label>
                <select id="filter-author" bind:value={filterAuthor}
                    class="bg-gray-700 border border-gray-600 px-3 py-1.5 w-full text-sm">
                    <option value="">All Users</option>
                    {#each users as user}
                        <option value={user.id}>{toTitleCase(`${user.firstName} ${user.lastName}`)} (@{user.username})</option>
                    {/each}
                </select>
            </div>
            <div>
                <label for="filter-keyword" class="block text-xs text-neutral-400 mb-1">Keyword Search</label>
                <input id="filter-keyword" type="text" bind:value={filterKeyword} placeholder="Search messages..."
                    class="bg-gray-700 border border-gray-600 px-3 py-1.5 w-full text-sm" />
            </div>
            <div>
                <label for="filter-chatid" class="block text-xs text-neutral-400 mb-1">Chat ID</label>
                <input id="filter-chatid" type="text" bind:value={filterChatId} placeholder="Filter by chat ID..."
                    class="bg-gray-700 border border-gray-600 px-3 py-1.5 w-full text-sm" />
            </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
            <div>
                <label for="filter-datefrom" class="block text-xs text-neutral-400 mb-1">Date From</label>
                <input id="filter-datefrom" type="date" bind:value={filterDateFrom}
                    class="bg-gray-700 border border-gray-600 px-3 py-1.5 w-full text-sm" />
            </div>
            <div>
                <label for="filter-dateto" class="block text-xs text-neutral-400 mb-1">Date To</label>
                <input id="filter-dateto" type="date" bind:value={filterDateTo}
                    class="bg-gray-700 border border-gray-600 px-3 py-1.5 w-full text-sm" />
            </div>
            <div class="flex items-end gap-4">
                <div class="flex flex-row justify-center items-center gap-2">
                    <Input type="checkbox" class="w-min" bind:value={filterHasAttachment}  />
                    <div>Has attachment</div>
                </div>
                <div class="flex flex-row justify-center items-center gap-2">
                    <Input type="checkbox" class="w-min" bind:value={filterShowDeleted} />
                    <div>Show Deleted</div>
                </div>
            </div>
            <div>
                <label for="filter-sort" class="block text-xs text-neutral-400 mb-1">Sort</label>
                <select id="filter-sort" bind:value={filterSort}
                    class="bg-gray-700 border border-gray-600 px-3 py-1.5 w-full text-sm">
                    <option value="desc">Newest First</option>
                    <option value="asc">Oldest First</option>
                </select>
            </div>
        </div>
        <div class="flex gap-2">
            <Button onclick={() => void loadMessages()}>
                <span class="material-symbols-outlined text-sm">search</span>
                Search
            </Button>
            <Button onclick={clearFilters} transparent>Clear Filters</Button>
        </div>
    </div>

    <!-- Results -->
    {#if messagesLoading}
        <p class="text-neutral-400">Loading messages...</p>
    {:else if adminMessages.length === 0}
        <p class="text-neutral-400">No messages found. Use the filters above and click Search.</p>
    {:else}
        <div class="mb-2 text-sm text-neutral-400">
            Showing {adminMessages.length} of {messagesTotal} messages (Page {messagesPage})
        </div>

        <Table
            source={adminMessages}
            bind:selected={selectedMessages}
            emptyStr="No messages found."
            actions={[
                { name: "View in Chat Context", icon: "forum", action: async (indices: number[]) => {
                    if (indices.length === 1) {
                        void viewMessageInContext(adminMessages[indices[0]]);
                    } else {
                        await alert("View in Context", "Please select exactly one message to view in context.");
                    }
                }},
                { name: "Mark Deleted", icon: "delete", action: async (indices: number[], reset: Function) => {
                    indices.forEach(i => selectedMessages[i] = true);
                    await massDelete(false);
                    reset();
                }},
                { name: "Permanently Delete", icon: "delete_forever", action: async (indices: number[], reset: Function) => {
                    indices.forEach(i => selectedMessages[i] = true);
                    await massDelete(true);
                    reset();
                }},
                { name: "Export JSON", icon: "download", action: async (indices: number[]) => {
                    indices.forEach(i => selectedMessages[i] = true);
                    exportMessages('json');
                }},
                { name: "Export CSV", icon: "table_chart", action: async (indices: number[]) => {
                    indices.forEach(i => selectedMessages[i] = true);
                    exportMessages('csv');
                }},
            ]}
            defaultActions={[
                { name: "Export JSON", icon: "download", action: () => exportMessages('json') },
                { name: "Export CSV", icon: "table_chart", action: () => exportMessages('csv') },
                { name: "Export Plaintext", icon: "description", action: () => exportMessages('txt') },
                { name: "Refresh", icon: "refresh", action: () => void loadMessages() },
            ]}
        >
            {#snippet header()}
                <th>Author</th>
                <th>Content</th>
                <th>Time</th>
                <th>Status</th>
            {/snippet}
            {#snippet template(msg, i)}
                <td class="px-2 text-sm whitespace-nowrap">
                    {msg.authorUser ? toTitleCase(`${msg.authorUser.firstName} ${msg.authorUser.lastName}`) : msg.author}
                </td>
                <td class="px-2 text-sm">{msg.content}</td>
                <td class="px-2 text-xs text-neutral-400 whitespace-nowrap">{msg.timestamp ? new Date(msg.timestamp).toLocaleString() : formatTimestamp(msg.id)}</td>
                <td class="px-2 text-xs">
                    {#if msg.deleted}<span class="text-red-400">[deleted]</span>{/if}
                    {#if msg.edited}
                        <span class="text-yellow-400 cursor-pointer underline decoration-dotted" role="button" tabindex="0"
                            onclick={() => viewingEditHistory = msg}
                            onkeydown={(e) => { if (e.key === 'Enter') viewingEditHistory = msg; }}
                            title="Click to view edit history"
                            aria-label="View edit history">(edited — click to view history)</span>
                    {/if}
                    {#if msg.attachments?.length > 0}
                        <span class="text-blue-400" title="{msg.attachments.length} attachment(s)">
                            <span class="material-symbols-outlined text-xs align-middle">attach_file</span>
                        </span>
                    {/if}
                </td>
            {/snippet}
        </Table>

        <!-- Pagination -->
        <div class="flex justify-center items-center gap-2 mt-4">
            <IconButton disabled={messagesPage <= 1} onclick={() => { messagesPage--; void loadMessages(); }}>
                chevron_left
            </IconButton>
            <span class="text-sm text-neutral-400">Page {messagesPage}</span>
            <IconButton disabled={adminMessages.length < messagesLimit} onclick={() => { messagesPage++; void loadMessages(); }}>
                chevron_right
            </IconButton>
        </div>
    {/if}

    <!-- Edit History Modal -->
    {#if viewingEditHistory}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div class="fixed inset-0 bg-black/70 z-50 flex items-center justify-center" role="dialog" aria-label="Edit history" tabindex="-1"
            onclick={() => viewingEditHistory = null}
            onkeydown={(e) => { if (e.key === 'Escape') viewingEditHistory = null; }}>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div class="bg-neutral-800 shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col"
                role="document"
                onclick={(e) => e.stopPropagation()}>
                <div class="px-6 pt-5 pb-2">
                    <h2 class="text-2xl font-bold">Edit History</h2>
                </div>
                <div class="px-6 py-2 flex-1 overflow-y-auto">
                    <div class="mb-4">
                        <p class="text-xs text-neutral-400 mb-1">Current version:</p>
                        <div class="bg-gray-700 p-3 text-sm">{viewingEditHistory.content}</div>
                    </div>
                    {#if viewingEditHistory.editHistory && viewingEditHistory.editHistory.length > 0}
                        {#each viewingEditHistory.editHistory.toReversed() as edit, i}
                            <div class="mb-3">
                                <p class="text-xs text-neutral-400 mb-1">
                                    Version {viewingEditHistory.editHistory.length - i} — {new Date(edit.editedAt).toLocaleString()}
                                </p>
                                <div class="bg-gray-700 p-3 text-sm">{edit.content}</div>
                            </div>
                        {/each}
                    {:else}
                        <p class="text-neutral-400 text-sm">No edit history available.</p>
                    {/if}
                </div>
                <div class="px-6 pb-4 pt-2 flex justify-end">
                    <Button onclick={() => viewingEditHistory = null}>Close</Button>
                </div>
            </div>
        </div>
    {/if}
</div>
{/snippet}

{#snippet chatsContent()}
<div class="p-6">
    <h1 class="text-3xl font-bold mb-2">Chat Monitoring</h1>
    <p class="text-neutral-400 mb-4">View all chats and their messages in a read-only mode.</p>

    <!-- Privacy Warning Card -->
    <div class="bg-amber-900/30 shadow-md p-4 mb-6" role="alert">
        <div class="flex items-center gap-2 mb-1">
            <span class="material-symbols-outlined text-amber-400">warning</span>
            <strong class="text-amber-300">Privacy Notice</strong>
        </div>
        <p class="text-sm text-amber-200">You are viewing private conversations between users. This feature is strictly for safety and moderation purposes. Any abuse of this access is a serious violation of trust. All monitoring activity may be audited.</p>
    </div>

    {#if !selectedChatId}
        <!-- Chat List -->
        <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-bold">All Chats</h2>
            <IconButton onclick={() => void loadChats()}>
                refresh
            </IconButton>
        </div>

        {#if chatsLoading}
            <p class="text-neutral-400">Loading chats...</p>
        {:else if adminChats.length === 0}
            <p class="text-neutral-400">Click the refresh button to load all conversations.</p>
        {:else}
            <div class="space-y-2">
                {#each adminChats as chat}
                    <button
                        class="w-full text-left bg-gray-800 shadow-md p-4 hover:bg-gray-700 transition-colors"
                        onclick={() => void selectChat(chat.id)}
                        aria-label="Open chat {getChatDisplayName(chat)}"
                    >
                        <div class="flex items-center justify-between">
                            <div>
                                <span class="font-bold">{getChatDisplayName(chat)}</span>
                                {#if chat.isGroup}
                                    <span class="ml-2 text-xs bg-green-700 px-2 py-0.5">Group</span>
                                {/if}
                                {#if chat.archived}
                                    <span class="ml-2 text-xs bg-gray-600 px-2 py-0.5">Archived</span>
                                {/if}
                            </div>
                            <span class="text-xs text-neutral-400">
                                {chat.participantIds.length} participant{chat.participantIds.length !== 1 ? 's' : ''}
                            </span>
                        </div>
                        <div class="text-xs text-neutral-400 mt-1">
                            Participants: {chat.participantIds.map((id) => {
                                const u = adminChatUsers[id] || getUserById(id);
                                return u ? toTitleCase(`${u.firstName} ${u.lastName}`) : id;
                            }).join(', ')}
                        </div>
                        {#if chat.lastMessage}
                            <p class="text-sm text-neutral-300 mt-2 truncate">
                                Last: {chat.lastMessage.content}
                            </p>
                        {/if}
                    </button>
                {/each}
            </div>
        {/if}
    {:else}
        <!-- Chat View (read-only) -->
        <div class="mb-4">
            <Button onclick={() => { selectedChatId = null; chatMessages = []; }}>
                <span class="material-symbols-outlined text-sm">arrow_back</span>
                Back to Chat List
            </Button>
        </div>

        {#if chatMessagesLoading}
            <p class="text-neutral-400">Loading messages...</p>
        {:else}
            <div class="bg-gray-800 shadow-md p-4 max-h-[60vh] overflow-y-auto" onscroll={handleChatScroll}>
                {#if chatLoadingMore}
                    <p class="text-neutral-400 text-center text-sm py-2">Loading older messages...</p>
                {/if}
                {#if chatHasMore && !chatLoadingMore}
                    <div class="text-center py-2">
                        <Button transparent onclick={() => void loadMoreChatMessages()}>Load older messages</Button>
                    </div>
                {/if}
                {#if chatMessages.length === 0}
                    <p class="text-neutral-400 text-center">No messages in this chat.</p>
                {:else}
                    {#each chatMessages as msg}
                        <div class="mb-3 {msg.deleted ? 'opacity-50' : ''}">
                            <div class="flex items-center gap-2 text-xs text-neutral-400 mb-0.5">
                                <strong class="text-neutral-200">
                                    {msg.authorUser ? toTitleCase(`${msg.authorUser.firstName} ${msg.authorUser.lastName}`) : getUserName(msg.author)}
                                </strong>
                                <span>{formatTimestamp(msg.id)}</span>
                                {#if msg.edited}
                                    <span class="text-yellow-400 cursor-pointer underline decoration-dotted" role="button" tabindex="0"
                                        onclick={() => chatViewingEditHistory = msg}
                                        onkeydown={(e) => { if (e.key === 'Enter') chatViewingEditHistory = msg; }}
                                        title="Click to view edit history"
                                        aria-label="View edit history">(edited — click to view history)</span>
                                {/if}
                                {#if msg.deleted}
                                    <span class="text-red-400">[deleted]</span>
                                {/if}
                            </div>
                            <p class="text-sm pl-2 border-l-2 border-gray-600">{msg.content}</p>
                            {#if msg.attachments?.length > 0}
                                <p class="text-xs text-blue-400 pl-2 mt-1">
                                    <span class="material-symbols-outlined text-xs align-middle">attach_file</span>
                                    {msg.attachments.length} attachment(s)
                                </p>
                            {/if}
                            {#if msg.reactions && Object.keys(msg.reactions).length > 0}
                                <div class="flex flex-wrap gap-1 pl-2 mt-1">
                                    {#each Object.entries(
                                        Object.values(msg.reactions).reduce((acc, emoji: any) => {
                                            acc[emoji] = (acc[emoji] || 0) + 1;
                                            return acc;
                                        }, {})
                                    ) as [emoji, count]}
                                        <span class="bg-gray-700 px-2 py-0.5 text-xs" title="{count} reaction(s)">{emoji} {count}</span>
                                    {/each}
                                </div>
                            {/if}
                        </div>
                    {/each}
                {/if}
            </div>
        {/if}
    {/if}
</div>

<!-- Chat Edit History Modal -->
{#if chatViewingEditHistory}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="fixed inset-0 bg-black/70 z-50 flex items-center justify-center" role="dialog" aria-label="Edit history" tabindex="-1"
        onclick={() => chatViewingEditHistory = null}
        onkeydown={(e) => { if (e.key === 'Escape') chatViewingEditHistory = null; }}>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div class="bg-neutral-800 shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col"
            role="document"
            onclick={(e) => e.stopPropagation()}>
            <div class="px-6 pt-5 pb-2">
                <h2 class="text-2xl font-bold">Edit History</h2>
            </div>
            <div class="px-6 py-2 flex-1 overflow-y-auto">
                <div class="mb-4">
                    <p class="text-xs text-neutral-400 mb-1">Current version:</p>
                    <div class="bg-gray-700 p-3 text-sm">{chatViewingEditHistory.content}</div>
                </div>
                {#if chatViewingEditHistory.editHistory && chatViewingEditHistory.editHistory.length > 0}
                    {#each chatViewingEditHistory.editHistory.toReversed() as edit, i}
                        <div class="mb-3">
                            <p class="text-xs text-neutral-400 mb-1">
                                Version {chatViewingEditHistory.editHistory.length - i} — {new Date(edit.editedAt).toLocaleString()}
                            </p>
                            <div class="bg-gray-700 p-3 text-sm">{edit.content}</div>
                        </div>
                    {/each}
                {:else}
                    <p class="text-neutral-400 text-sm">No edit history available.</p>
                {/if}
            </div>
            <div class="px-6 pb-4 pt-2 flex justify-end">
                <Button onclick={() => chatViewingEditHistory = null}>Close</Button>
            </div>
        </div>
    </div>
{/if}
{/snippet}
