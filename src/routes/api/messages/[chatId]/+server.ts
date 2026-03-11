import { RequiresPermissions } from "$lib/functions/requirePermissions";
import { db } from "$lib/server/db";
import { messages, chatParticipants } from "$lib/server/db/schema";
import { normaliseChatFromDatabase, normaliseMessageFromDatabase, type Message } from "$lib/types/messages";
import { Permission } from "$lib/types/types";
import type { RequestHandler } from "@sveltejs/kit";
import { and, count, desc, eq, gt, lt, ne, sql } from "drizzle-orm";
import { produce } from "sveltekit-sse";
import { _clients as clients } from "../stream/+server";
import { messagesReactions, messagesReadReceipts } from "$lib/server/db/schema/messages";

const MAX_MESSAGE_LENGTH = 10000;

const participantCache = new Map<string, { ids: string[]; expires: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute

async function getChatParticipantIds(chatId: string): Promise<string[]> {
    const cached = participantCache.get(chatId);
    if (cached && cached.expires > Date.now()) {
        return cached.ids;
    }
    const rows = await db.select({ userId: chatParticipants.userId })
        .from(chatParticipants)
        .where(eq(chatParticipants.chatId, chatId));
    const ids = rows.map(r => r.userId);
    participantCache.set(chatId, { ids, expires: Date.now() + CACHE_TTL_MS });
    return ids;
}

export function _invalidateParticipantCache(chatId: string) {
    participantCache.delete(chatId);
}

function notifyParticipants(participantIds: string[], senderId: string, eventName: string, data: string) {
    for (const userId of participantIds) {
        if (userId === senderId) continue;
        if (clients?.[userId]) {
            for (const sessionId in clients[userId]) {
                clients[userId][sessionId](eventName, data);
            }
        }
    }
}

// handler for the user to set which message they have read up to in this chat
export const HEAD: RequestHandler = async ({ request, params, locals }) => {
    if (!RequiresPermissions(locals, [Permission.message])) {
        return new Response(null, { status: 401 });
    }
    let messageId = new URL(request.url).searchParams.get("messageId");
    if (!messageId) {
        console.log(`${request.url}: Missing messageId in read receipt update: ${new URLSearchParams(request.url).get("messageId")}`);
        return new Response(null, { status: 400 });
    }

    try {
        // upsert the read receipt
        await db
            .insert(messagesReadReceipts)
            .values({
                messageId,
                userId: locals.user?.id,
                chatId: params.chatId,
            } as typeof messagesReadReceipts.$inferInsert)
            .onConflictDoUpdate({
                target: [messagesReadReceipts.userId, messagesReadReceipts.chatId],
                set: {
                    messageId,
                },
            });
    } catch (e) {
        console.error(`${request.url}: Error updating read receipt: `, e);
        return new Response(null, { status: 500 });
    }

    console.debug(
        `${request.url}: Updated read receipt to message ${messageId} for user ${locals.user?.id} in chat ${params.chatId}, there are now ${await db
            .select()
            .from(messages)
            .where(() => and(eq(messages.chatId, params.chatId || ""), gt(messages.id, messageId || "0"), ne(messages.deleted, true)))} unread messages.`
    );
    console.log(
        await db
            .select()
            .from(messages)
            .where(() => and(eq(messages.chatId, params.chatId || ""), gt(messages.id, messageId || "0"), ne(messages.deleted, true)))
    );

    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store", "X-Unread-Messages": new String(0).toString(), "X-Last-Message-Id": messageId } });
};

// handler to get historical messages for a specified chat id
// if "before" is provided, returns up to 50 messages before that id (chronological)
// if "before" is missing, returns the latest single message in the chat (most recent first)
export const GET: RequestHandler = async ({ request, params, locals }) => {
    if (!RequiresPermissions(locals, [Permission.message])) {
        return new Response(JSON.stringify({ error: "Insufficient permissions" }), { status: 401 });
    }

    const search = new URL(request.url).searchParams;
    const messageId = search.get("before");

    // fetch the most recent message in this chat
    if (!messageId) {
        // Find last read message to determine how many messages to load
        const readReceipt = await db.query.messagesReadReceipts.findFirst({
            where: (receipts) => and(eq(receipts.chatId, params.chatId || ""), eq(receipts.userId, locals.user?.id || ""))
        });
        
        const lastReadId = readReceipt?.messageId || "0";
        
        // Count unread messages
        const unreadCountRes = await db.select({ count: count() })
            .from(messages)
            .where(and(
                eq(messages.chatId, params.chatId ?? ""), 
                gt(messages.id, lastReadId),
                ne(messages.deleted, true)
            ));
            
        const unreadCount = Number(unreadCountRes[0].count);
        const limit = Math.max(50, unreadCount);

        const latest = await db.query.messages
            .findMany({
                where: (messages) => and(eq(messages.chatId, params.chatId ?? ""), ne(messages.deleted, true)),
                orderBy: (messages) => [desc(messages.id)],
                limit: limit,
                with: {
                    reactions: true
                }
            })
            .then((rows) => rows.reverse())
            .then((rows) => rows.map(normaliseMessageFromDatabase));

        return new Response(JSON.stringify(latest), { status: 200 });
    }

    // fetch older messages before the given id
    const messagesBefore = await db.query.messages
        .findMany({
            where: (messages) => and(eq(messages.chatId, params.chatId ?? ""), sql`${messages.id}::bigint < ${messageId}::bigint`),
            orderBy: (messages) => [desc(messages.id)],
            limit: 50,
        })
        .then((rows) => rows.reverse());

    const cleanedMessages = messagesBefore.map(normaliseMessageFromDatabase);

    return new Response(JSON.stringify(cleanedMessages), { status: 200 });
};

// handler to send a message to a specified chat id
export const POST: RequestHandler = async ({ request, locals, params }) => {
    if (!RequiresPermissions(locals, [Permission.message]) || !locals.user) {
        return new Response(JSON.stringify({ error: "Insufficient permissions" }), { status: 401 });
    }

    let formData: FormData;
    try {
        formData = await request.formData();
    } catch (e) {
        return new Response(JSON.stringify({ error: "Invalid form data" }), { status: 400 });
    }
    let chatId = params.chatId;
    let content = formData.get("content") as string;
    if (!chatId || !content) {
        return new Response(JSON.stringify({ error: "Please provide all required fields" }), { status: 400 });
    }
    if (content.length > MAX_MESSAGE_LENGTH) {
        return new Response(JSON.stringify({ error: `Message content exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters` }), { status: 400 });
    }

    // let's make sure the user is in the chat
    try {
        const chatRecord = await db.query.chats
            .findFirst({
                where: (chats) => eq(chats.id, chatId),
                with: {
                    participants: {
                        columns: {
                            userId: true,
                        },
                    },
                    messages: {
                        orderBy: (messages) => [desc(messages.id)],
                        limit: 1,
                    },
                },
            })
            .then((res: any) => {
                if (!res) throw new Error("Chat not found");
                res.lastMessage = res.messages?.[0] ?? null;
                return normaliseChatFromDatabase(res);
            });
        if (!chatRecord) {
            return new Response(JSON.stringify({ error: "Chat not found" }), { status: 404 });
        }
        if (!chatRecord.participantIds.includes(locals.user.id)) {
            return new Response(JSON.stringify({ error: "You are not a participant in this chat" }), { status: 403 });
        }
    } catch (e: any) {
        if (e.message === "Chat not found") {
            return new Response(JSON.stringify({ error: "Chat not found" }), { status: 404 });
        }
        console.error(`${request.url}: Error retrieving chat: `, e);
        return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
    }

    let item: Message;
    try {
        // now we can create the message in the database
        item = await db
            .insert(messages)
            .values({
                chatId,
                author: locals.user.id,
                content,
            })
            .returning()
            .then((res) => {
                const item = res[0];
                return normaliseMessageFromDatabase(item);
            });

        const normalisedItem = normaliseMessageFromDatabase(item as any);

        // notify only chat participants
        const participantIds = await getChatParticipantIds(chatId!);
        notifyParticipants(participantIds, locals.user!.id, "message", JSON.stringify({ message: normalisedItem }));
    } catch (e) {
        console.error(`${request.url}: Error creating message: `, e);
        return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
    }
    // Placeholder implementation
    return new Response(JSON.stringify({ message: normaliseMessageFromDatabase(item as any) }), { status: 201 });
};

export const DELETE: RequestHandler = async ({ request, locals, params }) => {
    if (!RequiresPermissions(locals, [Permission.message])) {
        return new Response(JSON.stringify({ error: "Insufficient permissions" }), { status: 401 });
    }

    let formData = await request.formData();
    let messageId = formData.get("messageId") as string;
    if (!messageId) {
        return new Response(JSON.stringify({ error: "Message ID is required" }), { status: 400 });
    }
    let message: Message | null;
    try {
        message = await db.query.messages
            .findFirst({
                where: (messages) => and(eq(messages.id, messageId), eq(messages.chatId, params.chatId || "")),
                with: {
                    reactions: true,
                },
            })
            .then((msg) => {
                if (!msg) return null;
                let newmsg = normaliseMessageFromDatabase(msg);
                newmsg.deleted = msg.deleted;
                return newmsg;
            });
        console.log(message);
    } catch (e) {
        console.error(`${request.url}: Error retrieving message: `, e);
        return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
    }
    if (!message) {
        return new Response(JSON.stringify({ error: "Message not found" }), { status: 404 });
    }
    if (message.author !== locals.user?.id) {
        return new Response(JSON.stringify({ error: "You can only delete your own messages" }), { status: 403 });
    }
    if (message.deleted) {
        return new Response(JSON.stringify({ error: "Message not found" }), { status: 404 });
    }
    if (message.chatId !== params.chatId) {
        return new Response(JSON.stringify({ error: "Message is not in this chat" }), { status: 404 });
    }

    try {
        await db
            .update(messages)
            .set({ deleted: true } as typeof messages.$inferSelect)
            .where(eq(messages.id, messageId));
    } catch (e) {
        console.error(`${request.url}: Error deleting message: `, e);
        return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
    }

    // notify only chat participants
    const participantIds = await getChatParticipantIds(params.chatId!);
    notifyParticipants(participantIds, locals.user!.id, "message-deleted", JSON.stringify({ messageId, chatId: params.chatId }));

    return new Response(null, { status: 204 });
};

// handler to edit a message in a specified chat id
export const PATCH: RequestHandler = async ({ request, locals, params }) => {
    if (!RequiresPermissions(locals, [Permission.message]) || locals.user == null) {
        return new Response(JSON.stringify({ error: "Insufficient permissions" }), { status: 401 });
    }

    let formData = await request.formData();
    let messageId = formData.get("messageId") as string;
    let newContent = ((formData.get("content") as string) || null)?.trim();
    if (!messageId || !newContent || newContent.length === 0) {
        return new Response(JSON.stringify({ error: "Please provide all required fields" }), { status: 400 });
    }
    if (newContent.length > MAX_MESSAGE_LENGTH) {
        return new Response(JSON.stringify({ error: `Message content exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters` }), { status: 400 });
    }

    let message: Message | null;
    try {
        message = await db.query.messages
            .findFirst({
                where: (messages) => and(eq(messages.id, messageId), eq(messages.chatId, params.chatId || ""), eq(messages.deleted, false)),
                with: {
                    reactions: true,
                },
            })
            .then((msg) => {
                if (!msg) return null;
                let newmsg = normaliseMessageFromDatabase(msg)
                newmsg.deleted = msg.deleted;
                newmsg.editHistory = msg.editHistory;
                return newmsg;
            });
    } catch (e) {
        console.error(`${request.url}: Error retrieving message: `, e);
        return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
    }
    if (!message) {
        return new Response(JSON.stringify({ error: "Message not found" }), { status: 404 });
    }
    if (message.author !== locals.user.id) {
        return new Response(JSON.stringify({ error: "You can only edit your own messages" }), { status: 403 });
    }
    if (message.deleted) {
        return new Response(JSON.stringify({ error: "Message not found" }), { status: 404 });
    }

    let newMessage: Message;
    try {
        // update the message content and edit history
        console.log("new message edit history: ", [...message.editHistory ?? [], { content: message.content, editedAt: new Date().toISOString() }]);
        const newEditHistory = [...message.editHistory ?? [], { content: message.content, editedAt: new Date().toISOString() }];
        newMessage = normaliseMessageFromDatabase(
            (
                await db
                    .update(messages)
                    .set({
                        content: newContent,
                        edited: true,
                        editHistory: newEditHistory,
                    } as typeof messages.$inferSelect)
                    .where(eq(messages.id, message.id))
                    .returning()
            )[0]
        );
    } catch (e) {
        console.error(`${request.url}: Error updating message: `, e);
        return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
    }

    // notify only chat participants
    const editParticipantIds = await getChatParticipantIds(params.chatId!);
    notifyParticipants(editParticipantIds, locals.user!.id, "message-edited", JSON.stringify({ message: newMessage }));

    const response = new Response(null, { status: 204 });
    return response;
};

// React to a message (idempotent btw)
export const PUT: RequestHandler = async ({ request, locals, params }) => {
    if (!RequiresPermissions(locals, [Permission.message])) {
        return new Response(JSON.stringify({ error: "Insufficient permissions" }), { status: 401 });
    }

    let formData = await request.formData();
    let messageId = formData.get("messageId") as string;
    let emoji = formData.get("emoji") as string | null;
    let action = formData.get("action") as string | null;
    if (!messageId) {
        return new Response(JSON.stringify({ error: "Please provide all required fields" }), { status: 400 });
    }
    if (action !== "remove" && (!emoji || !["👍", "👎", "❤️", "❗", "❓", "🔥", "💀", "🙂"].includes(emoji))) {
        return new Response(JSON.stringify({ error: "Invalid emoji reaction" }), { status: 400 });
    }

    // Fetch the message
    let message: Message | null;
    try {
        message = await db.query.messages
            .findFirst({
                where: (messages) => and(eq(messages.id, messageId), eq(messages.chatId, params.chatId || ""), eq(messages.deleted, false)),
                with: {
                    reactions: true,
                },
            })
            .then((msg) => {
                if (!msg) return null;
                return normaliseMessageFromDatabase(msg);
            });
    } catch (e) {
        console.error(`${request.url}: Error retrieving message: `, e);
        return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
    }
    if (!message || message.deleted || message.chatId !== params.chatId) {
        return new Response(JSON.stringify({ error: "Message not found" }), { status: 404 });
    }

    // Remove or upsert the reaction
    try {
        if (action === "remove") {
            await db.delete(messagesReactions).where(
                and(
                    eq(messagesReactions.messageId, messageId),
                    eq(messagesReactions.userId, locals.user?.id ?? "")
                )
            );
        } else {
            await db.insert(messagesReactions).values({
                messageId,
                userId: locals.user?.id,
                emoji: emoji!,
            } as typeof messagesReactions.$inferInsert).onConflictDoUpdate({
                target: [messagesReactions.messageId, messagesReactions.userId],
                set: {
                    emoji: emoji!,
                },
            });
        }
    } catch (e) {
        console.error(`${request.url}: Error updating message reactions: `, e);
        return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
    }

    // let's fetch all the reactions for this message now
    let reactions = await db.query.messagesReactions
        .findMany({
            where: (messagesReactions) => eq(messagesReactions.messageId, messageId),
        })
        .then((rows) => {
            const reacMap: Record<string, string> = {};
            for (const row of rows) {
                reacMap[row.userId] = row.emoji;
            }
            return reacMap;
        });
        
    // notify only chat participants
    const reactParticipantIds = await getChatParticipantIds(params.chatId!);
    notifyParticipants(reactParticipantIds, locals.user!.id, "message-reacted", JSON.stringify({ messageId, chatId: params.chatId, reactions }));

    return new Response(JSON.stringify({ reactions }), { status: 201 });
};
