import { RequiresPermissions } from "$lib/functions/requirePermissions";
import { db } from "$lib/server/db";
import { Permission, type User } from "$lib/types/types";
import type { RequestHandler } from "@sveltejs/kit";
import { produce } from "sveltekit-sse";
import { eq, desc, and, sql } from "drizzle-orm";
import { normaliseMessageFromDatabase } from "$lib/types/messages";

export let _clients: {
    [userId: string]: {
        [sessionId: string]: (eventName: string, data: string) => import("sveltekit-sse").Unsafe<void, Error>
    }
} = {}

// handler to open an SSE connection for a specified chat id
export const GET: RequestHandler = async ({ params, locals }) => {
    if (!RequiresPermissions(locals, [Permission.message])) {
        return new Response(JSON.stringify({ error: "Insufficient permissions" }), { status: 401 });
    }

    const sessionId = crypto.randomUUID();
    // make sure the user can access this chat
    return produce(async ({ emit, lock }) => {
        let user = locals.user as User;
        // register the user
        // this will mark the user as connected to this chat
        if (!_clients) _clients = {};
        if (!_clients[user.id]) _clients[user.id] = {};
        _clients[user.id][sessionId] = emit;
        emit("session", sessionId);

        for (const userId in _clients) {
            if (userId === user?.id) continue; // don't send to self
            emit("presence", JSON.stringify({ userId: user.id, status: "online" }));
        }

        // now announce that this guy is online
        for (const userId in _clients) {
            if (userId === user.id) continue; // don't send to self
            for (const sessionId in _clients[userId]) {
                _clients[userId][sessionId]("presence", JSON.stringify({ userId: user.id, status: "online" }));
            }
        }
    }, {
        stop() {
            let user = locals.user as User;
            // unregister the user
            if (_clients?.[user.id]) {
                delete _clients[user.id][sessionId];
            }
            for (const userId in _clients) {
                if (userId === user.id) continue; // don't send to self
                for (const sessionId in _clients[userId]) {
                    _clients[userId][sessionId]("presence", JSON.stringify({ userId: user.id, status: "offline" }));
                }
            }
        }
    })
}