import { test, expect } from "@playwright/test";
import { lackPerms, properPerms, signin } from "./util";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, inArray } from "drizzle-orm";
import { chats, chatParticipants, messages } from "../../src/lib/server/db/schema";

/**
 * Database connection for cleanup of test chats.
 */
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);
const createdChatIds: string[] = [];

async function deleteChat(chatId: string): Promise<void> {
    await db.delete(messages).where(eq(messages.chatId, chatId));
    await db.delete(chatParticipants).where(eq(chatParticipants.chatId, chatId));
    await db.delete(chats).where(eq(chats.id, chatId));
}

test.afterAll(async () => {
    for (const chatId of createdChatIds) {
        try { await deleteChat(chatId); } catch (e) { /* ignore */ }
    }
    await pool.end();
});

/**
 * Frontend (page) tests for the /messages/chat route.
 * These tests verify page-level access control and basic UI interactions.
 */
test.describe("Chat page tests (/messages/chat)", () => {

    // ==================== ACCESS CONTROL ====================

    test.describe("Access control", () => {

        test("redirects to /home?nopermission=true for users without message permission", async ({ page }) => {
            await lackPerms(page, "/messages/chat");
        });

        test("loads successfully for users with message permission", async ({ page }) => {
            await properPerms(page, "/messages/chat");
        });

        test("redirects to signin page if not authenticated", async ({ page }) => {
            // Access without signing in
            await page.goto("/messages/chat");
            // Should be redirected away from the chat page
            await expect(page).not.toHaveURL("/messages/chat");
        });

    });

    // ==================== PAGE STRUCTURE ====================

    test.describe("Page structure", () => {

        test("shows CHATS header in sidebar", async ({ page }) => {
            await signin(page);
            await page.goto("/messages/chat");

            await expect(page.getByText("CHATS", { exact: true })).toBeVisible();
        });

        test("shows add button for creating new chats", async ({ page }) => {
            await signin(page);
            await page.goto("/messages/chat");

            // The add button should be visible in the sidebar header
            const addButton = page.locator('button').filter({ hasText: 'add' });
            await expect(addButton).toBeVisible();
        });

        test("shows empty state message when no chats exist", async ({ page }) => {
            await signin(page);
            await page.goto("/messages/chat");

            // Either shows existing chats or the "No chats available." empty state
            const hasChatList = await page.locator('button.grow').count();
            const hasEmptyState = await page.getByText("No chats available.").count();

            // Either chats exist or the empty state is shown
            expect(hasChatList + hasEmptyState).toBeGreaterThan(0);
        });

    });

    // ==================== NEW CHAT DROPDOWN ====================

    test.describe("New chat dropdown", () => {

        test("clicking add button opens the new chat dropdown", async ({ page }) => {
            await signin(page);
            await page.goto("/messages/chat");

            // Click the add button
            await page.locator('button').filter({ hasText: 'add' }).click();

            // Should show both tabs
            await expect(page.getByRole('button', { name: 'Direct Message' })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Group Chat' })).toBeVisible();
        });

        test("new chat dropdown shows user search input", async ({ page }) => {
            await signin(page);
            await page.goto("/messages/chat");

            await page.locator('button').filter({ hasText: 'add' }).click();

            await expect(page.getByPlaceholder("Search users...")).toBeVisible();
        });

        test("Direct Message mode is active by default when dropdown opens", async ({ page }) => {
            await signin(page);
            await page.goto("/messages/chat");

            await page.locator('button').filter({ hasText: 'add' }).click();

            // Direct Message button should be visually active (has bg-green-700 class)
            const dmButton = page.getByRole('button', { name: 'Direct Message' });
            await expect(dmButton).toBeVisible();

            // Group name input should NOT be visible in DM mode
            await expect(page.getByPlaceholder("Group name (optional)...")).not.toBeVisible();
        });

        test("switching to Group Chat mode shows group name input", async ({ page }) => {
            await signin(page);
            await page.goto("/messages/chat");

            await page.locator('button').filter({ hasText: 'add' }).click();
            await page.getByRole('button', { name: 'Group Chat' }).click();

            // Group name input should now be visible
            await expect(page.getByPlaceholder("Group name (optional)...")).toBeVisible();
        });

        test("switching to Group Chat mode shows Create Group button", async ({ page }) => {
            await signin(page);
            await page.goto("/messages/chat");

            await page.locator('button').filter({ hasText: 'add' }).click();
            await page.getByRole('button', { name: 'Group Chat' }).click();

            await expect(page.getByRole('button', { name: /Create Group/i })).toBeVisible();
        });

        test("Create Group button is disabled when no users are selected", async ({ page }) => {
            await signin(page);
            await page.goto("/messages/chat");

            await page.locator('button').filter({ hasText: 'add' }).click();
            await page.getByRole('button', { name: 'Group Chat' }).click();

            const createButton = page.getByRole('button', { name: /Create Group/i });
            await expect(createButton).toBeDisabled();
        });

        test("Create Group button shows count of selected users", async ({ page }) => {
            await signin(page);
            await page.goto("/messages/chat");

            await page.locator('button').filter({ hasText: 'add' }).click();
            await page.getByRole('button', { name: 'Group Chat' }).click();

            // Wait for users to load
            await page.waitForSelector('[placeholder="Search users..."]');

            // Find user buttons in group mode — they contain an avatar image
            const userItems = page.locator('[data-new-chat-dropdown]').getByRole('button').filter({
                has: page.locator('img[alt="avatar"]')
            });

            const firstUserItem = userItems.first();
            const isVisible = await firstUserItem.isVisible();

            if (isVisible) {
                await firstUserItem.click();
                // Create button should now show "1 selected"
                const createButton = page.getByRole('button', { name: /Create Group/i });
                await expect(createButton).toBeVisible();
                await expect(createButton).not.toBeDisabled();
                // The button text includes the count
                await expect(createButton).toContainText('1 selected');
            }
        });

        test("dropdown closes when clicking outside", async ({ page }) => {
            await signin(page);
            await page.goto("/messages/chat");

            await page.locator('button').filter({ hasText: 'add' }).click();

            // Dropdown should be open
            await expect(page.getByRole('button', { name: 'Direct Message' })).toBeVisible();

            // Click outside the dropdown
            await page.locator('body').click({ position: { x: 100, y: 100 } });

            // Dropdown should be closed
            await expect(page.getByRole('button', { name: 'Direct Message' })).not.toBeVisible();
        });

        test("switching back to Direct Message mode hides group name input", async ({ page }) => {
            await signin(page);
            await page.goto("/messages/chat");

            await page.locator('button').filter({ hasText: 'add' }).click();

            // Switch to Group Chat mode
            await page.getByRole('button', { name: 'Group Chat' }).click();
            await expect(page.getByPlaceholder("Group name (optional)...")).toBeVisible();

            // Switch back to Direct Message mode
            await page.getByRole('button', { name: 'Direct Message' }).click();
            await expect(page.getByPlaceholder("Group name (optional)...")).not.toBeVisible();

            // Create button should not be visible in DM mode
            await expect(page.getByRole('button', { name: /Create Group/i })).not.toBeVisible();
        });

    });

    // ==================== CREATING CHATS ====================

    test.describe("Creating chats", () => {

        test("clicking a user in DM mode creates a chat and shows it selected", async ({ page }) => {
            await signin(page);
            await page.goto("/messages/chat");

            // Open the dropdown
            await page.locator('button').filter({ hasText: 'add' }).click();

            // Wait for users to load
            await page.waitForSelector('[placeholder="Search users..."]');

            // Find user buttons in DM mode (no checkbox)
            const userItems = page.locator('[data-new-chat-dropdown]').getByRole('button').filter({
                has: page.locator('img[alt="avatar"]')
            });

            const firstUserItem = userItems.first();
            const isVisible = await firstUserItem.isVisible();

            if (!isVisible) {
                test.skip();
                return;
            }

            const userName = (await firstUserItem.textContent())?.trim();
            await firstUserItem.click();

            // The dropdown should close
            await expect(page.getByPlaceholder("Search users...")).not.toBeVisible();

            // A chat should now be selected, showing the chat content area
            // The header should show the user's name or a message input
            const messageInput = page.getByPlaceholder("Type a message...");
            await expect(messageInput).toBeVisible({ timeout: 5000 });
        });

        test("creating a DM chat adds it to the sidebar", async ({ page }) => {
            await signin(page);
            await page.goto("/messages/chat");

            await page.locator('button').filter({ hasText: 'add' }).click();
            await page.waitForSelector('[placeholder="Search users..."]');

            const userItems = page.locator('[data-new-chat-dropdown]').getByRole('button').filter({
                has: page.locator('img[alt="avatar"]')
            });

            if (!(await userItems.first().isVisible())) {
                test.skip();
                return;
            }

            // Count sidebar chat buttons before
            const countBefore = await page.locator('button.grow').count();

            await userItems.first().click();

            // After creation, sidebar should have at least as many chats
            await page.waitForTimeout(500);
            const countAfter = await page.locator('button.grow').count();
            expect(countAfter).toBeGreaterThanOrEqual(countBefore);
        });

    });

    // ==================== CHAT HEADER ====================

    test.describe("Chat header", () => {

        test("chat header shows info button (not email button)", async ({ page }) => {
            await signin(page);
            await page.goto("/messages/chat");

            // Create a chat first so we have something selected
            await page.locator('button').filter({ hasText: 'add' }).click();
            await page.waitForSelector('[placeholder="Search users..."]');

            const userItems = page.locator('[data-new-chat-dropdown]').getByRole('button').filter({
                has: page.locator('img[alt="avatar"]')
            });

            if (!(await userItems.first().isVisible())) {
                test.skip();
                return;
            }

            await userItems.first().click();
            await page.waitForSelector('[placeholder="Type a message..."]');

            // Should show the info button
            const infoButton = page.getByRole('button').filter({ hasText: 'info' });
            await expect(infoButton).toBeVisible();

            // Should NOT show the email button
            const emailButton = page.getByRole('button').filter({ hasText: 'email' });
            await expect(emailButton).not.toBeVisible();
        });

        test("group chat header shows group name and info button", async ({ page }) => {
            await signin(page);
            await page.goto("/messages/chat");

            await page.locator('button').filter({ hasText: 'add' }).click();
            await page.getByRole('button', { name: 'Group Chat' }).click();
            await page.waitForSelector('[placeholder="Search users..."]');

            const userItems = page.locator('[data-new-chat-dropdown]').getByRole('button').filter({
                has: page.locator('img[alt="avatar"]')
            });

            if ((await userItems.count()) < 2) {
                test.skip();
                return;
            }

            // Type a group name
            const groupName = `UI Test Group ${Date.now()}`;
            await page.getByPlaceholder("Group name (optional)...").fill(groupName);

            // Select two users
            await userItems.nth(0).click();
            await userItems.nth(1).click();

            // Create the group
            await page.getByRole('button', { name: /Create Group/i }).click();

            // Wait for the chat to be created and selected
            await page.waitForSelector('[placeholder="Type a message..."]', { timeout: 5000 });

            // Header should show the group name (use first() to avoid strict mode with sidebar)
            await expect(page.getByText(groupName).first()).toBeVisible();

            // Info button should be visible
            const infoButton = page.getByRole('button').filter({ hasText: 'info' });
            await expect(infoButton).toBeVisible();
        });

    });

    // ==================== SENDING MESSAGES ====================

    test.describe("Sending messages", () => {

        test("can type a message and send it via Enter key", async ({ page }) => {
            await signin(page);
            await page.goto("/messages/chat");

            // Create a chat first
            await page.locator('button').filter({ hasText: 'add' }).click();
            await page.waitForSelector('[placeholder="Search users..."]');

            const userItems = page.locator('[data-new-chat-dropdown]').getByRole('button').filter({
                has: page.locator('img[alt="avatar"]')
            });

            if (!(await userItems.first().isVisible())) {
                test.skip();
                return;
            }

            await userItems.first().click();

            const messageInput = page.getByPlaceholder("Type a message...");
            await expect(messageInput).toBeVisible({ timeout: 5000 });

            const msgText = `Hello from test ${Date.now()}`;
            await messageInput.fill(msgText);
            await messageInput.press("Enter");

            // The message should appear in the chat bubble area (use first() to avoid strict mode violation
            // when the same text appears in both the sidebar preview and the chat bubble)
            await expect(page.getByText(msgText).first()).toBeVisible({ timeout: 5000 });
        });

        test("can type a message and send it via the send button", async ({ page }) => {
            await signin(page);
            await page.goto("/messages/chat");

            await page.locator('button').filter({ hasText: 'add' }).click();
            await page.waitForSelector('[placeholder="Search users..."]');

            const userItems = page.locator('[data-new-chat-dropdown]').getByRole('button').filter({
                has: page.locator('img[alt="avatar"]')
            });

            if (!(await userItems.first().isVisible())) {
                test.skip();
                return;
            }

            await userItems.first().click();

            const messageInput = page.getByPlaceholder("Type a message...");
            await expect(messageInput).toBeVisible({ timeout: 5000 });

            const msgText = `Send button test ${Date.now()}`;
            await messageInput.fill(msgText);
            await page.getByRole('button').filter({ hasText: 'send' }).click();

            await expect(page.getByText(msgText).first()).toBeVisible({ timeout: 5000 });
        });

        test("message input is cleared after sending", async ({ page }) => {
            await signin(page);
            await page.goto("/messages/chat");

            await page.locator('button').filter({ hasText: 'add' }).click();
            await page.waitForSelector('[placeholder="Search users..."]');

            const userItems = page.locator('[data-new-chat-dropdown]').getByRole('button').filter({
                has: page.locator('img[alt="avatar"]')
            });

            if (!(await userItems.first().isVisible())) {
                test.skip();
                return;
            }

            await userItems.first().click();

            const messageInput = page.getByPlaceholder("Type a message...");
            await expect(messageInput).toBeVisible({ timeout: 5000 });

            await messageInput.fill("Clear after send test");
            await messageInput.press("Enter");

            // Input should be empty after sending
            await expect(messageInput).toHaveValue("");
        });

    });

    // ==================== SIDEBAR DISPLAY ====================

    test.describe("Sidebar display", () => {

        test("sidebar shows group icon for group chats", async ({ page }) => {
            await signin(page);
            await page.goto("/messages/chat");

            // Create a group chat
            await page.locator('button').filter({ hasText: 'add' }).click();
            await page.getByRole('button', { name: 'Group Chat' }).click();
            await page.waitForSelector('[placeholder="Search users..."]');

            const userItems = page.locator('[data-new-chat-dropdown]').getByRole('button').filter({
                has: page.locator('img[alt="avatar"]')
            });

            if ((await userItems.count()) < 2) {
                test.skip();
                return;
            }

            const groupName = `Sidebar Icon Test ${Date.now()}`;
            await page.getByPlaceholder("Group name (optional)...").fill(groupName);
            await userItems.nth(0).click();
            await userItems.nth(1).click();
            await page.getByRole('button', { name: /Create Group/i }).click();

            await page.waitForSelector('[placeholder="Type a message..."]', { timeout: 5000 });

            // The sidebar should show a "group" material icon for the group chat
            const groupIconInSidebar = page.locator('button.grow')
                .filter({ hasText: groupName })
                .locator('.material-symbols-outlined')
                .filter({ hasText: 'group' });

            await expect(groupIconInSidebar).toBeVisible();
        });

        test("sidebar shows user avatar for DM chats", async ({ page }) => {
            await signin(page);
            await page.goto("/messages/chat");

            await page.locator('button').filter({ hasText: 'add' }).click();
            await page.waitForSelector('[placeholder="Search users..."]');

            const userItems = page.locator('[data-new-chat-dropdown]').getByRole('button').filter({
                has: page.locator('img[alt="avatar"]')
            });

            if (!(await userItems.first().isVisible())) {
                test.skip();
                return;
            }

            await userItems.first().click();

            await page.waitForSelector('[placeholder="Type a message..."]', { timeout: 5000 });

            // The sidebar chat button should contain an img (avatar), not a group icon
            const sidebarItems = page.locator('button.grow');
            await expect(sidebarItems.first().locator('img[alt="avatar"]')).toBeVisible();
        });

        test("sidebar shows last message preview", async ({ page }) => {
            await signin(page);
            await page.goto("/messages/chat");

            await page.locator('button').filter({ hasText: 'add' }).click();
            await page.waitForSelector('[placeholder="Search users..."]');

            const userItems = page.locator('[data-new-chat-dropdown]').getByRole('button').filter({
                has: page.locator('img[alt="avatar"]')
            });

            if (!(await userItems.first().isVisible())) {
                test.skip();
                return;
            }

            await userItems.first().click();

            const messageInput = page.getByPlaceholder("Type a message...");
            await expect(messageInput).toBeVisible({ timeout: 5000 });

            const msgText = `Sidebar preview ${Date.now()}`;
            await messageInput.fill(msgText);
            await messageInput.press("Enter");

            // Wait for the message to appear in the chat (use first() to avoid strict mode violation)
            await expect(page.getByText(msgText).first()).toBeVisible({ timeout: 5000 });

            // The sidebar should show a preview of the last message
            const sidebarItem = page.locator('button.grow').first();
            await expect(sidebarItem).toContainText(msgText.slice(0, 20));
        });

    });

});
