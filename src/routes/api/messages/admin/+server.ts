import { hasAdminAccess } from "$lib/server/admin/access";
import { db } from "$lib/server/db";
import { messages, chats, chatParticipants, users } from "$lib/server/db/schema";
import { normaliseMessageFromDatabase, type Message } from "$lib/types/messages";
import type { RequestHandler } from "@sveltejs/kit";
import { and, eq, ne, like, desc, asc, sql, inArray, lt, gt, count } from "drizzle-orm";
import { snowflakeToDate } from "$lib/functions/Snowflake";
import { cleanUserFromDatabase } from "$lib/server/auth";

// GET: List all messages with filters
export const GET: RequestHandler = async ({ locals, url }) => {
    if (!hasAdminAccess(locals.user)) {
        return new Response("Not Found", { status: 404 });
    }

    const search = url.searchParams;
    const page = Math.max(1, parseInt(search.get("page") || "1"));
    const limit = Math.min(100, Math.max(1, parseInt(search.get("limit") || "50")));
    const offset = (page - 1) * limit;

    const authorId = search.get("author");
    const chatId = search.get("chatId");
    const keyword = search.get("keyword");
    const hasAttachment = search.get("hasAttachment");
    const showDeleted = search.get("showDeleted");
    const dateFrom = search.get("dateFrom");
    const dateTo = search.get("dateTo");
    const sortDir = search.get("sort") === "asc" ? "asc" : "desc";

    const conditions: any[] = [];

    if (authorId) conditions.push(eq(messages.author, authorId));
    if (chatId) conditions.push(eq(messages.chatId, chatId));
    if (keyword) conditions.push(like(messages.content, `%${keyword}%`));
    if (hasAttachment === "true") conditions.push(sql`jsonb_array_length(${messages.attachments}) > 0`);
    if (showDeleted !== "true") conditions.push(eq(messages.deleted, false));

    // Filter by date using Snowflake IDs
    // Snowflake IDs encode timestamps, so we can filter by comparing IDs
    // For simplicity, we'll filter in the application layer after fetching

    const orderBy = sortDir === "asc" ? asc(messages.id) : desc(messages.id);

    const totalRes = await db.select({ count: count() })
        .from(messages)
        .where(conditions.length > 0 ? and(...conditions) : undefined);
    const total = Number(totalRes[0].count);

    const rows = await db.query.messages.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: () => [orderBy],
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
            timestamp: snowflakeToDate(row.id).toISOString(),
        };
    });

    // Apply date filters in application layer
    let filtered = result;
    if (dateFrom) {
        const from = new Date(dateFrom);
        filtered = filtered.filter(m => new Date(m.timestamp) >= from);
    }
    if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        filtered = filtered.filter(m => new Date(m.timestamp) <= to);
    }

    return new Response(JSON.stringify({
        messages: filtered,
        total,
        page,
        limit,
    }), { status: 200 });
};

// DELETE: Mass delete messages
export const DELETE: RequestHandler = async ({ locals, request }) => {
    if (!hasAdminAccess(locals.user)) {
        return new Response("Not Found", { status: 404 });
    }

    let body: { messageIds: string[], permanent?: boolean };
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400 });
    }

    if (!body.messageIds || !Array.isArray(body.messageIds) || body.messageIds.length === 0) {
        return new Response(JSON.stringify({ error: "No message IDs provided" }), { status: 400 });
    }

    if (body.permanent) {
        await db.delete(messages).where(inArray(messages.id, body.messageIds));
    } else {
        await db.update(messages)
            .set({ deleted: true } as typeof messages.$inferSelect)
            .where(inArray(messages.id, body.messageIds));
    }

    return new Response(JSON.stringify({ success: true, count: body.messageIds.length }), { status: 200 });
};
