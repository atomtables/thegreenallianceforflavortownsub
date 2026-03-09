import { expect, test } from "@playwright/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { users } from "../../src/lib/server/db/schema";
import { routeRules } from "../../src/sitemap";
import { Role } from "../../src/lib/types/types";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

/**
 * Get the required permissions for a given URL from the sitemap route rules.
 */
function getRequiredPermissions(url: string): number[] {
    const normalized = url.split(/[?#]/)[0].replace(/\/+/g, "/").replace(/\/$/, "") || "/";
    const rule = routeRules.find(r => {
        const rPath = r.path.split(/[?#]/)[0].replace(/\/+/g, "/").replace(/\/$/, "") || "/";
        return rPath === normalized;
    });
    return (rule?.permissions ?? []) as number[];
}

/**
 * Get a user's effective permissions from the database, accounting for
 * administrator superuser status (gets all 33 permissions).
 */
async function getUserPermissions(username: string): Promise<number[]> {
    const [user] = await db.select({
        role: users.role,
        permissions: users.permissions,
    }).from(users).where(eq(users.username, username));
    if (!user) return [];
    // Administrators get all permissions (mirrors hooks.server.ts logic)
    if (user.role === Role.administrator) {
        return Array.from(Array(33).keys());
    }
    return (user.permissions ?? []) as number[];
}

const signin = async ( page, user = process.env.MOD_USER, pass = process.env.MOD_PASS ) => {

    // Go to the signin page
    await page.goto("/account/signin");

    // Fill in form with standard user
    await page.fill("input[name='username']", user);
    await page.fill("input[name='password']", pass);

    // Submit form
    await page.click("button[type='submit']");

}

const lackPerms = async ( page, url ) => {

    // Pre-check: verify REG_USER actually lacks the required permissions
    const requiredPerms = getRequiredPermissions(url);
    const userPerms = await getUserPermissions(process.env.REG_USER!);
    const hasAllPerms = requiredPerms.every(p => userPerms.includes(p));
    test.skip(hasAllPerms, `Skipping: REG_USER unexpectedly HAS all required permissions ${JSON.stringify(requiredPerms)} for ${url}`);

    // Sign in as non-admin
    await signin(page, process.env.REG_USER, process.env.REG_PASS);

    // Go to page
    await page.goto(url);

    // Expect redirect
    await expect(page).toHaveURL("/home?nopermission=true");

}

const properPerms = async ( page, url ) => {

    // Pre-check: verify MOD_USER actually has the required permissions
    const requiredPerms = getRequiredPermissions(url);
    const userPerms = await getUserPermissions(process.env.MOD_USER!);
    const hasAllPerms = requiredPerms.every(p => userPerms.includes(p));
    test.skip(!hasAllPerms, `Skipping: MOD_USER lacks required permissions ${JSON.stringify(requiredPerms)} for ${url}`);

    // Sign in as admin
    await signin(page);

    // Go to page
    await page.goto(url);

    // Expect no redirect
    await expect(page).toHaveURL(url);

}

export { signin, lackPerms, properPerms };
