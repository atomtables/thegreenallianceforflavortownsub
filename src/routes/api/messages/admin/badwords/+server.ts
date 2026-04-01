import { hasAdminAccess } from "$lib/server/admin/access";
import { getBadWordsConfig, saveBadWordsConfig } from "$lib/server/admin/badwords";
import type { RequestHandler } from "@sveltejs/kit";

// GET: Get current bad words config
export const GET: RequestHandler = async ({ locals }) => {
    if (!hasAdminAccess(locals.user)) {
        return new Response("Not Found", { status: 404 });
    }

    return new Response(JSON.stringify(getBadWordsConfig()), { status: 200 });
};

// PUT: Update bad words config
export const PUT: RequestHandler = async ({ locals, request }) => {
    if (!hasAdminAccess(locals.user)) {
        return new Response("Not Found", { status: 404 });
    }

    let body: { enabled?: boolean, words?: string[] };
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400 });
    }

    const current = getBadWordsConfig();

    if (typeof body.enabled === "boolean") {
        current.enabled = body.enabled;
    }
    if (Array.isArray(body.words)) {
        current.words = body.words.map(w => w.toLowerCase().trim()).filter(w => w.length > 0);
    }

    saveBadWordsConfig(current);

    return new Response(JSON.stringify(current), { status: 200 });
};
