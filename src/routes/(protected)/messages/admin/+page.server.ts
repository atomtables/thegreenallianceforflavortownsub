import { hasAdminAccess } from "$lib/server/admin/access";
import { error } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { users } from "$lib/server/db/schema";
import { cleanUserFromDatabase } from "$lib/server/auth";

export const load = async ({ locals }) => {
    // Return 404 for users without admin access (not 403/401)
    if (!hasAdminAccess(locals.user)) {
        error(404, "Not Found");
    }

    const allUsers = await db.select().from(users).then(rows => rows.map(cleanUserFromDatabase));

    return {
        allUsers,
    };
};
