import { db } from '$lib/server/db';
import * as schema from "$lib/server/db/schema.js"
import { hasAdminAccess } from '$lib/server/admin/access';

export const load = async ({ locals }) => {
    return {
        user: locals?.user,
        session: locals?.session,
        subteams: await db.select().from(schema.subteams),
        canAccessAdmin: hasAdminAccess(locals?.user),
    };
}
