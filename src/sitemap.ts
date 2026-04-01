import { Permission, type User } from "$lib/types/types";

export type RouteRule = {
    path: string;
    auth?: boolean;
    permissions?: Permission[];
    methods?: string[];
};

export const routeRules: RouteRule[] = [
    { path: "/", auth: false },
    { path: "/about", auth: false },
    { path: "/account/signin", auth: false },
    { path: "/account/signup", auth: false },

    { path: "/home", auth: true, permissions: [Permission.exist] },
    { path: "/account/logout", auth: true, permissions: [Permission.exist] },
    { path: "/tos", auth: true, permissions: [Permission.exist] },
    { path: "/meetings/calendar", auth: true, permissions: [Permission.exist, Permission.calendar] },
    { path: "/users", auth: true, permissions: [Permission.exist, Permission.users] },
    { path: "/messages/chat", auth: true, permissions: [Permission.exist, Permission.message] },

    { path: "/api/meetings", auth: true, permissions: [Permission.exist, Permission.calendar_moderate], methods: ["PUT", "DELETE"] },
    { path: "/api/users/joincodes", auth: true, permissions: [Permission.exist, Permission.users_modify], methods: ["PUT", "DELETE"] },
    { path: "/api/users/signin", auth: false, methods: ["POST"] },
    // { path: "/api/messages", auth: true, permissions: [Permission.exist, Permission.message], methods: ["POST"] },
    // { path: "/api/messages/[chatId]", auth: true, permissions: [Permission.exist, Permission.message], methods: ["GET"] },
    // { path: "/api/messages/stream", auth: true, permissions: [Permission.exist, Permission.message], methods: ["PUT", "DELETE"] },
    
];

const normalizePath = (value: string) => {
    const [pathOnly] = value.split(/[?#]/);
    const trimmed = pathOnly.replace(/\/+/g, "/").replace(/\/$/, "");
    if (trimmed === "" || trimmed === "/") return "/";
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

const segmentMatches = (templateSegment: string, pathSegment: string) => {
    if (templateSegment.startsWith("[[...")) return true; // optional rest parameter
    if (templateSegment.startsWith("[...")) return true; // greedy rest parameter
    if (templateSegment.startsWith("[") && templateSegment.endsWith("]")) return pathSegment.length > 0;
    return templateSegment === pathSegment;
};

const pathMatches = (template: string, path: string) => {
    const tSegments = normalizePath(template).split("/").filter(Boolean);
    const pSegments = normalizePath(path).split("/").filter(Boolean);

    const hasRest = tSegments.some((segment) => segment.startsWith("[..."));
    if (!hasRest && tSegments.length !== pSegments.length) return false;
    if (hasRest && pSegments.length < tSegments.length - 1) return false;

    for (let i = 0; i < tSegments.length; i++) {
        const t = tSegments[i];
        const p = pSegments[i];

        if (t?.startsWith("[[...")) return true; // optional rest consumes remaining
        if (t?.startsWith("[...")) return true; // rest consumes remaining
        if (!segmentMatches(t, p ?? "")) return false;
    }

    return pSegments.length === tSegments.length || hasRest;
};

const findRuleFor = (url: string, method: string) => {
    const normalizedMethod = method.toUpperCase();
    const normalizedPath = normalizePath(url);
    return routeRules.find((rule) => {
        if (!pathMatches(rule.path, normalizedPath)) return false;
        if (!rule.methods) return true;
        return rule.methods.map((m) => m.toUpperCase()).includes(normalizedMethod);
    });
};

export const canUserAccess = (user: User | null | undefined, url: string, method = "GET"): boolean => {
    const rule = findRuleFor(url, method);
    if (!rule) return true; // allow when no rule

    if (rule.auth && !user) return false;

    if (rule.permissions?.length) {
        const userPerms = user?.permissions || [];
        return rule.permissions.every((perm) => userPerms.includes(perm));
    }

    return true;
};

export default routeRules;