import { Permission, Role, type User } from "$lib/types/types";

// Admin access requires mentor role (3) or above AND message_moderate permission
export function hasAdminAccess(user: User | null): boolean {
    if (!user) return false;
    if (user.role < Role.mentor) return false;
    if (!user.permissions.includes(Permission.message_moderate)) return false;
    return true;
}
