import type { Chat } from "$lib/types/messages";
import { Permission, type User } from "$lib/types/types.js";

export const load = async ({ locals, fetch, depends }) => {
    depends("messages:chats");

    const messagesData = fetch('/api/messages').then((res) => res.json());

    const hasUserListPerm = locals.user?.permissions?.includes(Permission.users) ?? false;

    return {
        chats: messagesData.then((data) => data.chats as Chat[]),
        // If the user has the "users" permission, they can access the full user list.
        // Otherwise, merge allowedUsers (who they can message) with chat participant users
        // (for name resolution in existing chats) from the messages endpoint.
        users: hasUserListPerm
            ? fetch('/api/users/list').then((res) => res.json()).then((data) => data.users as User[])
            : messagesData.then((data) => {
                const allowed = (data.allowedUsers || []) as User[];
                const involved = Object.values(data.users || {}) as User[];
                const map = new Map<string, User>();
                for (const u of allowed) map.set(u.id, u);
                for (const u of involved) map.set(u.id, u);
                return Array.from(map.values());
            }),
        // The list of users this user is allowed to create new chats with,
        // always sourced from the messages endpoint (permission-filtered).
        allowedUsers: messagesData.then((data) => data.allowedUsers as User[]),
    };
}