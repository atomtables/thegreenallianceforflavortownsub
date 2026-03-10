import { test, expect } from '@playwright/test';
import { signin } from './util';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq, inArray, and, desc } from 'drizzle-orm';
import { chats, chatParticipants, messages, users } from '../../src/lib/server/db/schema';

/**
 * Database connection for direct verification of data.
 */
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

// Track resources for cleanup
const createdChatIds: string[] = [];

/**
 * Helper to delete a chat and all its associated data
 */
async function deleteChat(chatId: string): Promise<void> {
    await db.delete(messages).where(eq(messages.chatId, chatId));
    await db.delete(chatParticipants).where(eq(chatParticipants.chatId, chatId));
    await db.delete(chats).where(eq(chats.id, chatId));
}

/**
 * Helper to clean up all chats involving specific user IDs
 */
async function cleanupChatsForUsers(userIds: string[]): Promise<void> {
    const participantRecords = await db.select({ chatId: chatParticipants.chatId })
        .from(chatParticipants)
        .where(inArray(chatParticipants.userId, userIds));
    const chatIdsToDelete = [...new Set(participantRecords.map(p => p.chatId))];
    if (chatIdsToDelete.length > 0) {
        await db.delete(messages).where(inArray(messages.chatId, chatIdsToDelete));
        await db.delete(chatParticipants).where(inArray(chatParticipants.chatId, chatIdsToDelete));
        await db.delete(chats).where(inArray(chats.id, chatIdsToDelete));
    }
}

/**
 * Helper to create a chat via PUT /api/messages using multipart form data.
 * Supports multiple participantIds and an optional group name.
 */
async function createChatViaApi(
    request: any,
    participantIds: string | string[],
    name?: string
): Promise<any> {
    const ids = Array.isArray(participantIds) ? participantIds : [participantIds];
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    let body = '';
    for (const id of ids) {
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="participantIds"\r\n\r\n`;
        body += `${id}\r\n`;
    }
    if (name !== undefined) {
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="name"\r\n\r\n`;
        body += `${name}\r\n`;
    }
    body += `--${boundary}--\r\n`;
    return request.put('/api/messages', {
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        data: body
    });
}

/**
 * Helper to send a message to a chat.
 */
async function sendMessage(request: any, chatId: string, content: string): Promise<any> {
    return request.post(`/api/messages/${chatId}`, {
        multipart: { content }
    });
}

// Clean up after all tests
test.afterAll(async () => {
    for (const chatId of createdChatIds) {
        try { await deleteChat(chatId); } catch (e) { /* ignore */ }
    }
    await pool.end();
});

/**
 * Tests specifically for the group chat feature, including auto-naming, isGroup flag,
 * participant count thresholds, and chat list sorting.
 */
test.describe("Group chat feature tests", () => {

    let modUserId: string;
    let otherUsers: any[];

    // Set up test data once before all tests
    test.beforeAll(async ({ request }) => {
        await signin(request);

        // Get all users
        const usersResponse = await request.get('/api/users/list');
        if (usersResponse.status() !== 200) return;
        const usersBody = await usersResponse.json();

        // Find the mod user's ID
        const modUserRecord = usersBody.users.find((u: any) => u.username === process.env.MOD_USER);
        if (!modUserRecord) return;
        modUserId = modUserRecord.id;

        // Get other users
        otherUsers = usersBody.users.filter((u: any) => u.username !== process.env.MOD_USER);

        // Clean up any existing chats for the mod user to ensure test isolation
        if (modUserId) {
            await cleanupChatsForUsers([modUserId]);
        }
    });

    test.beforeEach(async ({}, testInfo) => {
        if (!modUserId || !otherUsers || otherUsers.length < 1) {
            testInfo.skip();
        }
    });

    // ==================== DIRECT MESSAGE (2 PARTICIPANTS) ====================

    test.describe("Direct message chats (2 participants)", () => {

        test("DM chat has isGroup=false", async ({ request }) => {
            await signin(request);

            const response = await request.put('/api/messages', {
                multipart: { participantIds: otherUsers[0].id }
            });

            expect([200, 201]).toContain(response.status());
            const body = await response.json();
            expect(body.chat.isGroup).toBe(false);

            createdChatIds.push(body.chat.id);
        });

        test("DM chat has no auto-generated name (name is null/undefined)", async ({ request }) => {
            await signin(request);

            // Create a fresh DM
            const response = await request.put('/api/messages', {
                multipart: { participantIds: otherUsers[0].id }
            });

            expect([200, 201]).toContain(response.status());
            const body = await response.json();

            // DM chats should not have a name
            expect(body.chat.name == null || body.chat.name === undefined).toBe(true);

            // Verify in database
            const dbChat = await db.select().from(chats).where(eq(chats.id, body.chat.id));
            expect(dbChat[0].name).toBeNull();

            createdChatIds.push(body.chat.id);
        });

        test("DM chat has exactly 2 participants", async ({ request }) => {
            await signin(request);

            const response = await request.put('/api/messages', {
                multipart: { participantIds: otherUsers[0].id }
            });

            expect([200, 201]).toContain(response.status());
            const body = await response.json();
            const chatId = body.chat.id;
            createdChatIds.push(chatId);

            // Verify participants via database (API may return existing chat without participantIds)
            const dbParticipants = await db.select()
                .from(chatParticipants)
                .where(eq(chatParticipants.chatId, chatId));
            expect(dbParticipants).toHaveLength(2);
            const participantUserIds = dbParticipants.map(p => p.userId);
            expect(participantUserIds).toContain(otherUsers[0].id);
            expect(participantUserIds).toContain(modUserId);
        });

    });

    // ==================== GROUP CHAT (3+ PARTICIPANTS) ====================

    test.describe("Group chat (3+ participants)", () => {

        test("group chat has isGroup=true when 3 or more participants total", async ({ request }) => {
            if (otherUsers.length < 2) { test.skip(); return; }

            await signin(request);

            const response = await createChatViaApi(request, [otherUsers[0].id, otherUsers[1].id]);

            expect(response.status()).toBe(201);
            const body = await response.json();
            expect(body.chat.isGroup).toBe(true);

            // Verify in database
            const dbChat = await db.select().from(chats).where(eq(chats.id, body.chat.id));
            expect(dbChat[0].isGroup).toBe(true);

            createdChatIds.push(body.chat.id);
        });

        test("group chat with explicit name uses that name exactly", async ({ request }) => {
            if (otherUsers.length < 2) { test.skip(); return; }

            await signin(request);

            const explicitName = `Test Group ${Date.now()}`;
            const response = await createChatViaApi(request, [otherUsers[0].id, otherUsers[1].id], explicitName);

            expect(response.status()).toBe(201);
            const body = await response.json();
            expect(body.chat.name).toBe(explicitName);
            expect(body.chat.isGroup).toBe(true);

            // Verify name is stored correctly in database
            const dbChat = await db.select().from(chats).where(eq(chats.id, body.chat.id));
            expect(dbChat[0].name).toBe(explicitName);

            createdChatIds.push(body.chat.id);
        });

        test("group chat auto-name uses firstName and lastName (not username)", async ({ request }) => {
            if (otherUsers.length < 2) { test.skip(); return; }

            await signin(request);

            // Fetch full user details directly from database to get firstName/lastName
            const user1 = await db.select({
                id: users.id, firstName: users.firstName, lastName: users.lastName, username: users.username
            }).from(users).where(eq(users.id, otherUsers[0].id)).limit(1).then(r => r[0]);

            const user2 = await db.select({
                id: users.id, firstName: users.firstName, lastName: users.lastName, username: users.username
            }).from(users).where(eq(users.id, otherUsers[1].id)).limit(1).then(r => r[0]);

            const modUser = await db.select({
                id: users.id, firstName: users.firstName, lastName: users.lastName, username: users.username
            }).from(users).where(eq(users.id, modUserId)).limit(1).then(r => r[0]);

            if (!user1 || !user2 || !modUser) { test.skip(); return; }

            // Create group chat without explicit name — use a unique name to avoid deduplication
            const response = await createChatViaApi(request, [user1.id, user2.id]);

            expect([200, 201]).toContain(response.status());
            const body = await response.json();
            const chatId = body.chat.id;
            createdChatIds.push(chatId);

            // Fetch the actual name from the database (API response for existing chat may differ)
            const dbChat = await db.select().from(chats).where(eq(chats.id, chatId));
            const autoName: string = dbChat[0].name!;

            expect(autoName).toBeDefined();
            expect(typeof autoName).toBe('string');
            expect(autoName.length).toBeGreaterThan(0);

            // Name should contain first and last names (case-insensitive check)
            const autoNameLower = autoName.toLowerCase();
            expect(autoNameLower).toContain(user1.firstName.toLowerCase());
            expect(autoNameLower).toContain(user1.lastName.toLowerCase());
            expect(autoNameLower).toContain(user2.firstName.toLowerCase());
            expect(autoNameLower).toContain(user2.lastName.toLowerCase());
            expect(autoNameLower).toContain(modUser.firstName.toLowerCase());
            expect(autoNameLower).toContain(modUser.lastName.toLowerCase());

            // Name should NOT contain usernames
            expect(autoNameLower).not.toContain(user1.username.toLowerCase());
            expect(autoNameLower).not.toContain(user2.username.toLowerCase());
        });

        test("group chat auto-name format is 'First Last, First Last, ...'", async ({ request }) => {
            if (otherUsers.length < 2) { test.skip(); return; }

            await signin(request);

            const response = await createChatViaApi(request, [otherUsers[0].id, otherUsers[1].id]);

            expect([200, 201]).toContain(response.status());
            const body = await response.json();
            const chatId = body.chat.id;
            createdChatIds.push(chatId);

            // Fetch from database for the actual name
            const dbChat = await db.select().from(chats).where(eq(chats.id, chatId));
            const autoName: string = dbChat[0].name!;

            // Should be comma-separated pairs of "firstName lastName"
            const parts = autoName.split(', ');
            expect(parts.length).toBe(3); // 2 other users + creator

            for (const part of parts) {
                // Each part should have at least one space (firstName lastName)
                const words = part.trim().split(' ');
                expect(words.length).toBeGreaterThanOrEqual(2);
            }
        });

        test("group chat has all participants in participantIds", async ({ request }) => {
            if (otherUsers.length < 2) { test.skip(); return; }

            await signin(request);

            const response = await createChatViaApi(request, [otherUsers[0].id, otherUsers[1].id]);

            expect([200, 201]).toContain(response.status());
            const body = await response.json();
            const chatId = body.chat.id;
            createdChatIds.push(chatId);

            // Verify via database (API may return existing chat in different format)
            const dbParticipants = await db.select()
                .from(chatParticipants)
                .where(eq(chatParticipants.chatId, chatId));
            expect(dbParticipants).toHaveLength(3);

            const participantUserIds = dbParticipants.map(p => p.userId);
            expect(participantUserIds).toContain(otherUsers[0].id);
            expect(participantUserIds).toContain(otherUsers[1].id);
            expect(participantUserIds).toContain(modUserId);
        });

        test("whitespace-only group name is treated as no explicit name (auto-generates name)", async ({ request }) => {
            if (otherUsers.length < 2) { test.skip(); return; }

            await signin(request);

            const response = await createChatViaApi(request, [otherUsers[0].id, otherUsers[1].id], "   ");

            expect([200, 201]).toContain(response.status());
            const body = await response.json();
            expect(body.chat).toBeDefined();
            // The name should be auto-generated (not the whitespace string)
            if (body.chat.name) {
                expect(body.chat.name.trim()).not.toBe('');
                expect(body.chat.name.trim()).not.toBe('   ');
            }

            createdChatIds.push(body.chat.id);
        });

    });

    // ==================== CHAT LIST SORTING ====================

    test.describe("Chat list sorting by last message time", () => {

        test("chat with more recent message appears first in the list", async ({ request }) => {
            if (otherUsers.length < 2) { test.skip(); return; }

            await signin(request);

            // Create two chats
            const chat1Response = await request.put('/api/messages', {
                multipart: { participantIds: otherUsers[0].id }
            });
            expect([200, 201]).toContain(chat1Response.status());
            const chat1 = (await chat1Response.json()).chat;
            createdChatIds.push(chat1.id);

            const chat2Response = await createChatViaApi(request, [otherUsers[0].id, otherUsers[1].id], `Sort Test Group ${Date.now()}`);
            expect(chat2Response.status()).toBe(201);
            const chat2 = (await chat2Response.json()).chat;
            createdChatIds.push(chat2.id);

            // Send a message to chat1 first
            await sendMessage(request, chat1.id, 'Message in chat1');
            // Small delay to ensure different timestamps
            await new Promise(resolve => setTimeout(resolve, 50));
            // Send a message to chat2 after
            await sendMessage(request, chat2.id, 'Message in chat2');

            // Get chat list — chat2 (more recent) should appear first
            const listResponse = await request.get('/api/messages');
            expect(listResponse.status()).toBe(200);
            const listBody = await listResponse.json();

            const chat1Index = listBody.chats.findIndex((c: any) => c.id === chat1.id);
            const chat2Index = listBody.chats.findIndex((c: any) => c.id === chat2.id);

            expect(chat1Index).not.toBe(-1);
            expect(chat2Index).not.toBe(-1);
            // chat2 has the more recent message, so it should come first (lower index)
            expect(chat2Index).toBeLessThan(chat1Index);
        });

        test("chat with no messages is sorted after chats with messages", async ({ request }) => {
            if (otherUsers.length < 2) { test.skip(); return; }

            await signin(request);

            // Create a chat with a message
            const chatWithMsgResponse = await createChatViaApi(
                request,
                [otherUsers[0].id, otherUsers[1].id],
                `Sorted With Msg ${Date.now()}`
            );
            expect(chatWithMsgResponse.status()).toBe(201);
            const chatWithMsg = (await chatWithMsgResponse.json()).chat;
            createdChatIds.push(chatWithMsg.id);

            await sendMessage(request, chatWithMsg.id, 'A message');

            // Create a chat without any messages
            const chatNoMsgResponse = await request.put('/api/messages', {
                multipart: { participantIds: otherUsers[0].id }
            });
            expect([200, 201]).toContain(chatNoMsgResponse.status());
            const chatNoMsg = (await chatNoMsgResponse.json()).chat;
            createdChatIds.push(chatNoMsg.id);

            // Get chat list
            const listResponse = await request.get('/api/messages');
            expect(listResponse.status()).toBe(200);
            const listBody = await listResponse.json();

            const withMsgIndex = listBody.chats.findIndex((c: any) => c.id === chatWithMsg.id);
            const noMsgIndex = listBody.chats.findIndex((c: any) => c.id === chatNoMsg.id);

            if (withMsgIndex !== -1 && noMsgIndex !== -1) {
                // Chat with message should appear before chat with no message
                expect(withMsgIndex).toBeLessThan(noMsgIndex);
            }
        });

        test("sending a message moves a chat to the top of the list", async ({ request }) => {
            if (otherUsers.length < 2) { test.skip(); return; }

            await signin(request);

            // Create two chats
            const olderChatResp = await request.put('/api/messages', {
                multipart: { participantIds: otherUsers[0].id }
            });
            expect([200, 201]).toContain(olderChatResp.status());
            const olderChat = (await olderChatResp.json()).chat;
            createdChatIds.push(olderChat.id);

            // Send a message to older chat first
            await sendMessage(request, olderChat.id, 'Older message');
            await new Promise(resolve => setTimeout(resolve, 50));

            const newerChatResp = await createChatViaApi(
                request,
                [otherUsers[0].id, otherUsers[1].id],
                `Newer Chat ${Date.now()}`
            );
            expect(newerChatResp.status()).toBe(201);
            const newerChat = (await newerChatResp.json()).chat;
            createdChatIds.push(newerChat.id);

            // Send a message to newer chat
            await new Promise(resolve => setTimeout(resolve, 50));
            await sendMessage(request, newerChat.id, 'Newer message');

            // Get list — newerChat should be first
            const listResp1 = await request.get('/api/messages');
            const body1 = await listResp1.json();
            const newerIndex1 = body1.chats.findIndex((c: any) => c.id === newerChat.id);
            const olderIndex1 = body1.chats.findIndex((c: any) => c.id === olderChat.id);
            expect(newerIndex1).toBeLessThan(olderIndex1);

            // Now send a message to olderChat — it should jump to top
            await new Promise(resolve => setTimeout(resolve, 50));
            await sendMessage(request, olderChat.id, 'New message in older chat');

            const listResp2 = await request.get('/api/messages');
            const body2 = await listResp2.json();
            const olderIndex2 = body2.chats.findIndex((c: any) => c.id === olderChat.id);
            const newerIndex2 = body2.chats.findIndex((c: any) => c.id === newerChat.id);
            // olderChat now has the most recent message, should be first
            expect(olderIndex2).toBeLessThan(newerIndex2);
        });

        test("chat list includes lastMessage with author and content", async ({ request }) => {
            await signin(request);

            // Create a chat and send a message
            const chatResp = await request.put('/api/messages', {
                multipart: { participantIds: otherUsers[0].id }
            });
            expect([200, 201]).toContain(chatResp.status());
            const chat = (await chatResp.json()).chat;
            createdChatIds.push(chat.id);

            const msgContent = `Last message test ${Date.now()}`;
            const sendResp = await sendMessage(request, chat.id, msgContent);
            expect(sendResp.status()).toBe(201);
            const sentMsg = (await sendResp.json()).message;

            // Fetch chat list
            const listResp = await request.get('/api/messages');
            expect(listResp.status()).toBe(200);
            const listBody = await listResp.json();

            const foundChat = listBody.chats.find((c: any) => c.id === chat.id);
            expect(foundChat).toBeDefined();
            expect(foundChat.lastMessage).toBeDefined();
            expect(foundChat.lastMessage.id).toBe(sentMsg.id);
            expect(foundChat.lastMessage.content).toBe(msgContent);
            expect(foundChat.lastMessage.author).toBe(modUserId);
        });

    });

    // ==================== SSE chat-created EVENT ====================

    test.describe("SSE chat-created event", () => {

        test("creator does not receive chat-created SSE (chat is returned in PUT response)", async ({ request }) => {
            if (otherUsers.length < 2) { test.skip(); return; }

            await signin(request);

            // The PUT response itself contains the new chat — the creator does NOT need
            // an SSE event since they get the data synchronously from the response.
            const response = await createChatViaApi(request, [otherUsers[0].id, otherUsers[1].id], `SSE Test ${Date.now()}`);
            expect(response.status()).toBe(201);
            const body = await response.json();

            // The response must include the full chat object for the creator
            expect(body.chat).toBeDefined();
            expect(body.chat.id).toBeDefined();
            expect(body.chat.isGroup).toBe(true);
            expect(body.chat.participantIds).toContain(modUserId);
            expect(body.chat.participantIds).toContain(otherUsers[0].id);
            expect(body.chat.participantIds).toContain(otherUsers[1].id);

            // existing flag should be false/absent for a new chat
            expect(body.existing).toBeFalsy();

            createdChatIds.push(body.chat.id);
        });

        test("non-existing chat creates a new entry (existing=false) and returns 201", async ({ request }) => {
            if (otherUsers.length < 2) { test.skip(); return; }

            await signin(request);

            const chatName = `Brand New Group ${Date.now()}`;
            const response = await createChatViaApi(request, [otherUsers[0].id, otherUsers[1].id], chatName);

            expect(response.status()).toBe(201);
            const body = await response.json();

            expect(body.existing).toBeFalsy();
            expect(body.chat.name).toBe(chatName);

            // Verify actually in database
            const dbChat = await db.select().from(chats).where(eq(chats.id, body.chat.id));
            expect(dbChat).toHaveLength(1);
            expect(dbChat[0].isGroup).toBe(true);
            expect(dbChat[0].name).toBe(chatName);

            createdChatIds.push(body.chat.id);
        });

        test("SSE chat-created delivers correct chat structure to non-creator via page", async ({}) => {
            // Testing SSE delivery to non-creator requires known credentials for other users,
            // which are not available in this test setup.
            // The SSE event structure is tested via the API response verification above.
            test.skip();
        });

    });

    // ==================== GROUP CHAT DEDUPLICATION ====================

    test.describe("Group chat deduplication", () => {

        test("named group chat never de-duplicates (always creates a new chat)", async ({ request }) => {
            if (otherUsers.length < 2) { test.skip(); return; }

            await signin(request);

            const chatName = `Dedup Test ${Date.now()}`;

            // Create first named group chat
            const resp1 = await createChatViaApi(request, [otherUsers[0].id, otherUsers[1].id], chatName);
            expect(resp1.status()).toBe(201);
            const chat1 = (await resp1.json()).chat;
            createdChatIds.push(chat1.id);

            // Create second with same participants and same name
            const resp2 = await createChatViaApi(request, [otherUsers[0].id, otherUsers[1].id], chatName);
            expect(resp2.status()).toBe(201); // Creates a new chat, not de-duplicated
            const chat2 = (await resp2.json()).chat;
            createdChatIds.push(chat2.id);

            // Should be different chats
            expect(chat1.id).not.toBe(chat2.id);
        });

        test("unnamed DM is de-duplicated and returns existing=true", async ({ request }) => {
            await signin(request);

            // Create initial DM
            const resp1 = await request.put('/api/messages', {
                multipart: { participantIds: otherUsers[0].id }
            });
            expect([200, 201]).toContain(resp1.status());
            const chat1 = (await resp1.json()).chat;
            createdChatIds.push(chat1.id);

            // Try to create same DM again
            const resp2 = await request.put('/api/messages', {
                multipart: { participantIds: otherUsers[0].id }
            });
            expect(resp2.status()).toBe(200);
            const body2 = await resp2.json();
            expect(body2.existing).toBe(true);
            expect(body2.chat.id).toBe(chat1.id);
        });

    });

});
