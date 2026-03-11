import { hasAdminAccess } from "$lib/server/admin/access";
import { db } from "$lib/server/db";
import { messageReports } from "$lib/server/db/schema/messages";
import { messages, users } from "$lib/server/db/schema";
import { cleanUserFromDatabase } from "$lib/server/auth";
import { snowflakeToDate } from "$lib/functions/Snowflake";
import { normaliseMessageFromDatabase } from "$lib/types/messages";
import type { RequestHandler } from "@sveltejs/kit";
import { and, eq, desc, count } from "drizzle-orm";

// GET: List all reports
export const GET: RequestHandler = async ({ locals, url }) => {
    if (!hasAdminAccess(locals.user)) {
        return new Response("Not Found", { status: 404 });
    }

    const search = url.searchParams;
    const status = search.get("status");
    const page = Math.max(1, parseInt(search.get("page") || "1"));
    const limit = Math.min(100, Math.max(1, parseInt(search.get("limit") || "50")));
    const offset = (page - 1) * limit;

    const conditions: any[] = [];
    if (status) conditions.push(eq(messageReports.status, status));

    const totalRes = await db.select({ count: count() })
        .from(messageReports)
        .where(conditions.length > 0 ? and(...conditions) : undefined);
    const total = Number(totalRes[0].count);

    const rows = await db.select()
        .from(messageReports)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(messageReports.reportedAt))
        .limit(limit)
        .offset(offset);

    // Enrich with user and message data
    const enriched = await Promise.all(rows.map(async (report) => {
        const [messageRow] = await db.select().from(messages).where(eq(messages.id, report.messageId)).limit(1);
        const [authorRow] = await db.select().from(users).where(eq(users.id, report.messageAuthorId)).limit(1);
        const reporterRow = report.reporterId 
            ? (await db.select().from(users).where(eq(users.id, report.reporterId)).limit(1))[0]
            : null;

        return {
            ...report,
            message: messageRow ? { ...normaliseMessageFromDatabase(messageRow), deleted: messageRow.deleted, editHistory: messageRow.editHistory } : null,
            messageAuthor: authorRow ? cleanUserFromDatabase(authorRow) : null,
            reporter: reporterRow ? cleanUserFromDatabase(reporterRow) : null,
        };
    }));

    return new Response(JSON.stringify({
        reports: enriched,
        total,
        page,
        limit,
    }), { status: 200 });
};

// PATCH: Update report status
export const PATCH: RequestHandler = async ({ locals, request }) => {
    if (!hasAdminAccess(locals.user)) {
        return new Response("Not Found", { status: 404 });
    }

    let body: { reportId: string, status: string };
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400 });
    }

    if (!body.reportId || !body.status) {
        return new Response(JSON.stringify({ error: "Report ID and status are required" }), { status: 400 });
    }

    const validStatuses = ["open", "reviewed", "resolved", "dismissed"];
    if (!validStatuses.includes(body.status)) {
        return new Response(JSON.stringify({ error: "Invalid status" }), { status: 400 });
    }

    const updateData: any = { status: body.status };
    if (body.status === "resolved" || body.status === "dismissed") {
        updateData.resolvedAt = new Date();
        updateData.resolvedBy = locals.user!.id;
    }

    await db.update(messageReports)
        .set(updateData)
        .where(eq(messageReports.id, body.reportId));

    return new Response(JSON.stringify({ success: true }), { status: 200 });
};

// POST: Create a new report (user-facing)
export const POST: RequestHandler = async ({ locals, request }) => {
    if (!locals.user) {
        return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
    }

    let body: { messageId: string, reason?: string };
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400 });
    }

    if (!body.messageId) {
        return new Response(JSON.stringify({ error: "Message ID is required" }), { status: 400 });
    }

    // Get the message to find the author
    const [message] = await db.select().from(messages).where(eq(messages.id, body.messageId)).limit(1);
    if (!message) {
        return new Response(JSON.stringify({ error: "Message not found" }), { status: 404 });
    }

    await db.insert(messageReports).values({
        messageId: body.messageId,
        messageAuthorId: message.author,
        reporterId: locals.user.id,
        reason: body.reason || "",
        source: "user",
    } as typeof messageReports.$inferInsert);

    return new Response(JSON.stringify({ success: true }), { status: 201 });
};
