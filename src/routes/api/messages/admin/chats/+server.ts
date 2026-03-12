import { hasAdminAccess } from "$lib/server/admin/access";
import { db } from "$lib/server/db";
import { chats, chatParticipants, messages, users } from "$lib/server/db/schema";
import { normaliseMessageFromDatabase } from "$lib/types/messages";
import { cleanUserFromDatabase } from "$lib/server/auth";
import type { RequestHandler } from "@sveltejs/kit";
import { desc, eq, count, and, ne } from "drizzle-orm";

// GET: List all chats for admin monitoring
export const GET: RequestHandler = async ({ locals, url }) => {
    if (!hasAdminAccess(locals.user)) {
        return new Response("Not Found", { status: 404 });
    }

    const search = url.searchParams;
    const chatId = search.get("chatId");

    // If chatId is provided, return messages for that chat
    if (chatId) {
        const page = Math.max(1, parseInt(search.get("page") || "1"));
        const limit = Math.min(100, Math.max(1, parseInt(search.get("limit") || "50")));
        const offset = (page - 1) * limit;

        const rows = await db.query.messages.findMany({
            where: eq(messages.chatId, chatId),
            orderBy: () => [desc(messages.id)],
            limit,
            offset,
            with: {
                reactions: true,
                authorUser: true,
            },
        });

        const result = rows.map(row => {
            const msg = normaliseMessageFromDatabase(row);
            msg.deleted = row.deleted;
            msg.editHistory = row.editHistory;
            return {
                ...msg,
                authorUser: row.authorUser ? cleanUserFromDatabase(row.authorUser) : null,
            };
        });

        return new Response(JSON.stringify({ messages: result, hasMore: rows.length === limit }), { status: 200 });
    }

    // List all chats with participant info and last message
    const allChats = await db.query.chats.findMany({
        with: {
            participants: {
                columns: { userId: true },
            },
            messages: {
                limit: 1,
                orderBy: desc(messages.id),
                where: (msg) => eq(msg.deleted, false),
                with: {
                    reactions: true,
                },
            },
        },
        orderBy: () => [desc(chats.id)],
    });

    // Get unique user IDs from all participants
    const userIds = new Set<string>();
    for (const chat of allChats) {
        for (const p of chat.participants) {
            userIds.add(p.userId);
        }
    }

    // Fetch all users at once
    const allUsers: Record<string, any> = {};
    if (userIds.size > 0) {
        const userRows = await db.select().from(users);
        for (const u of userRows) {
            allUsers[u.id] = cleanUserFromDatabase(u);
        }
    }

    const result = allChats.map(chat => ({
        id: chat.id,
        isGroup: chat.isGroup,
        name: chat.name,
        archived: chat.archived,
        participantIds: chat.participants.map(p => p.userId),
        lastMessage: chat.messages[0] ? normaliseMessageFromDatabase(chat.messages[0]) : null,
        messageCount: 0,
    }));

    return new Response(JSON.stringify({
        chats: result,
        users: allUsers,
    }), { status: 200 });
};
