import { db } from "$lib/server/db";
import { users } from "$lib/server/db/schema";
import { TOS_LAST_UPDATED, TOS_CONTENT } from "$lib/server/admin/tos";
import { eq } from "drizzle-orm";
import type { RequestHandler } from "@sveltejs/kit";

export const GET: RequestHandler = async ({ locals }) => {
    return new Response(JSON.stringify({
        content: TOS_CONTENT,
        lastUpdated: TOS_LAST_UPDATED.toISOString(),
    }), { status: 200 });
};

export const POST: RequestHandler = async ({ locals }) => {
    if (!locals.user) {
        return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
    }

    await db.update(users)
        .set({ tosAgreedAt: new Date() } as typeof users.$inferSelect)
        .where(eq(users.id, locals.user.id));

    return new Response(JSON.stringify({ success: true }), { status: 200 });
};
