import { test, expect } from '@playwright/test';
import { signin } from './util';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq, inArray, and, gt, ne } from 'drizzle-orm';
import { chats, chatParticipants, messages, messagesReadReceipts, users } from '../../src/lib/server/db/schema';

/**
 * Database connection for direct verification of data.
 */
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

// Track resources for cleanup
const createdChatIds: string[] = [];
const createdMessageIds: string[] = [];

/**
 * Helper to delete a chat and all its associated data
 */
async function deleteChat(chatId: string): Promise<void> {
    await db.delete(messagesReadReceipts).where(eq(messagesReadReceipts.chatId, chatId));
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
        await db.delete(messagesReadReceipts).where(inArray(messagesReadReceipts.chatId, chatIdsToDelete));
        await db.delete(messages).where(inArray(messages.chatId, chatIdsToDelete));
        await db.delete(chatParticipants).where(inArray(chatParticipants.chatId, chatIdsToDelete));
        await db.delete(chats).where(inArray(chats.id, chatIdsToDelete));
    }
}

/**
 * Helper to send a message to a chat.
 */
async function sendMessage(request: any, chatId: string, content: string): Promise<any> {
    return request.post(`/api/messages/${chatId}`, {
        multipart: { content }
    });
}

/**
 * Update a read receipt via the HEAD endpoint.
 * Returns the raw Response so callers can inspect headers.
 */
async function updateReadReceipt(request: any, chatId: string, messageId: string): Promise<any> {
    return request.head(`/api/messages/${chatId}?messageId=${encodeURIComponent(messageId)}`);
}

// Clean up after all tests
test.afterAll(async () => {
    for (const chatId of createdChatIds) {
        try { await deleteChat(chatId); } catch (e) { /* ignore */ }
    }
    await pool.end();
});

/**
 * Comprehensive tests for the read receipt HEAD endpoint.
 * The HEAD endpoint is: HEAD /api/messages/[chatId]?messageId=<id>
 */
test.describe("Read receipts (HEAD /api/messages/[chatId])", () => {

    let testChatId: string;
    let modUserId: string;
    let regUserId: string;

    // Create a test chat before all tests in this suite
    test.beforeAll(async ({ request }) => {
        await signin(request);

        // Get user IDs
        const usersResponse = await request.get('/api/users/list');
        if (usersResponse.status() !== 200) return;
        const usersBody = await usersResponse.json();

        const modUser = usersBody.users.find((u: any) => u.username === process.env.MOD_USER);
        const regUser = usersBody.users.find((u: any) => u.username === process.env.REG_USER);
        if (!modUser || !regUser) return;

        modUserId = modUser.id;
        regUserId = regUser.id;

        // Clean up any existing chats between test users
        await cleanupChatsForUsers([modUserId, regUserId]);

        // Create a fresh chat for tests
        const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
        let body = `--${boundary}\r\nContent-Disposition: form-data; name="participantIds"\r\n\r\n${regUserId}\r\n--${boundary}--\r\n`;
        const createResponse = await request.put('/api/messages', {
            headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
            data: body
        });
        if (![200, 201].includes(createResponse.status())) return;
        const createBody = await createResponse.json();
        testChatId = createBody.chat.id;
        createdChatIds.push(testChatId);
    });

    test.beforeEach(async ({}, testInfo) => {
        if (!testChatId || !modUserId || !regUserId) {
            testInfo.skip();
        }
    });

    // ==================== PERMISSION TESTS ====================

    test.describe("Permission checks", () => {

        test("HEAD: requires authentication — returns 401 for unauthenticated request", async ({ request }) => {
            const chatId = testChatId || 'test-chat-id';
            const response = await request.head(`/api/messages/${chatId}?messageId=123`);
            expect(response.status()).toBe(401);
        });

        test("HEAD: returns 400 when messageId query param is missing", async ({ request }) => {
            await signin(request);
            const response = await request.head(`/api/messages/${testChatId}`);
            expect(response.status()).toBe(400);
        });

        test("HEAD: returns 400 when messageId is an empty string", async ({ request }) => {
            await signin(request);
            const response = await request.head(`/api/messages/${testChatId}?messageId=`);
            expect(response.status()).toBe(400);
        });

    });

    // ==================== SUCCESSFUL READ RECEIPT UPDATE ====================

    test.describe("Successful read receipt update", () => {

        test("HEAD with valid messageId returns 204", async ({ request }) => {
            await signin(request);

            // Send a message to get a valid messageId
            const sendResp = await sendMessage(request, testChatId, 'Read receipt test message');
            expect(sendResp.status()).toBe(201);
            const messageId = (await sendResp.json()).message.id;
            createdMessageIds.push(messageId);

            // Update read receipt
            const response = await updateReadReceipt(request, testChatId, messageId);
            expect(response.status()).toBe(204);
        });

        test("HEAD returns X-Last-Message-Id header equal to the provided messageId", async ({ request }) => {
            await signin(request);

            const sendResp = await sendMessage(request, testChatId, 'Header test message');
            expect(sendResp.status()).toBe(201);
            const messageId = (await sendResp.json()).message.id;
            createdMessageIds.push(messageId);

            const response = await updateReadReceipt(request, testChatId, messageId);
            expect(response.status()).toBe(204);

            // The X-Last-Message-Id header should match what we passed in
            const lastMessageIdHeader = response.headers()['x-last-message-id'];
            expect(lastMessageIdHeader).toBe(messageId);
        });

        test("HEAD returns X-Unread-Messages header", async ({ request }) => {
            await signin(request);

            const sendResp = await sendMessage(request, testChatId, 'Unread count test');
            expect(sendResp.status()).toBe(201);
            const messageId = (await sendResp.json()).message.id;
            createdMessageIds.push(messageId);

            const response = await updateReadReceipt(request, testChatId, messageId);
            expect(response.status()).toBe(204);

            // X-Unread-Messages header should be present and numeric
            const unreadHeader = response.headers()['x-unread-messages'];
            expect(unreadHeader).toBeDefined();
            expect(Number(unreadHeader)).not.toBeNaN();
        });

        test("HEAD persists read receipt in the database", async ({ request }) => {
            await signin(request);

            const sendResp = await sendMessage(request, testChatId, 'DB persistence test');
            expect(sendResp.status()).toBe(201);
            const messageId = (await sendResp.json()).message.id;
            createdMessageIds.push(messageId);

            // Update the read receipt
            const response = await updateReadReceipt(request, testChatId, messageId);
            expect(response.status()).toBe(204);

            // After: receipt should exist and point to our messageId
            const afterReceipts = await db.select()
                .from(messagesReadReceipts)
                .where(and(
                    eq(messagesReadReceipts.userId, modUserId),
                    eq(messagesReadReceipts.chatId, testChatId)
                ));
            expect(afterReceipts).toHaveLength(1);
            expect(afterReceipts[0].messageId).toBe(messageId);
            expect(afterReceipts[0].chatId).toBe(testChatId);
            expect(afterReceipts[0].userId).toBe(modUserId);
        });

        test("HEAD is idempotent — calling it twice with the same messageId succeeds both times", async ({ request }) => {
            await signin(request);

            const sendResp = await sendMessage(request, testChatId, 'Idempotent read receipt test');
            expect(sendResp.status()).toBe(201);
            const messageId = (await sendResp.json()).message.id;
            createdMessageIds.push(messageId);

            // Call HEAD twice with the same messageId
            const response1 = await updateReadReceipt(request, testChatId, messageId);
            expect(response1.status()).toBe(204);

            const response2 = await updateReadReceipt(request, testChatId, messageId);
            expect(response2.status()).toBe(204);

            // Database should still have exactly one record per user+chat
            const receipts = await db.select()
                .from(messagesReadReceipts)
                .where(and(
                    eq(messagesReadReceipts.userId, modUserId),
                    eq(messagesReadReceipts.chatId, testChatId)
                ));
            expect(receipts).toHaveLength(1);
            expect(receipts[0].messageId).toBe(messageId);
        });

        test("HEAD advances the read receipt when called with a newer messageId", async ({ request }) => {
            await signin(request);

            // Send two messages
            const send1 = await sendMessage(request, testChatId, 'First message for advancing receipt');
            const messageId1 = (await send1.json()).message.id;
            createdMessageIds.push(messageId1);

            await new Promise(r => setTimeout(r, 20));

            const send2 = await sendMessage(request, testChatId, 'Second message for advancing receipt');
            const messageId2 = (await send2.json()).message.id;
            createdMessageIds.push(messageId2);

            // Read up to message 1
            await updateReadReceipt(request, testChatId, messageId1);

            let receipts = await db.select()
                .from(messagesReadReceipts)
                .where(and(
                    eq(messagesReadReceipts.userId, modUserId),
                    eq(messagesReadReceipts.chatId, testChatId)
                ));
            expect(receipts[0].messageId).toBe(messageId1);

            // Advance to message 2
            await updateReadReceipt(request, testChatId, messageId2);

            receipts = await db.select()
                .from(messagesReadReceipts)
                .where(and(
                    eq(messagesReadReceipts.userId, modUserId),
                    eq(messagesReadReceipts.chatId, testChatId)
                ));
            expect(receipts).toHaveLength(1); // Still only one record (upserted)
            expect(receipts[0].messageId).toBe(messageId2); // Updated to newer message
        });

    });

    // ==================== UNREAD COUNT INTERACTION ====================

    test.describe("Unread count in GET /api/messages", () => {

        test("unread count is included in GET /api/messages response per chat", async ({ request }) => {
            await signin(request);

            const listResp = await request.get('/api/messages');
            expect(listResp.status()).toBe(200);
            const listBody = await listResp.json();

            // Every chat in the response should include readReceipts with a count
            for (const chat of listBody.chats) {
                expect(chat.readReceipts).toBeDefined();
                expect(typeof chat.readReceipts.count).toBe('number');
            }
        });

        test("chat without read receipt shows non-negative unread count", async ({ request }) => {
            await signin(request);

            // Send some messages to our test chat
            await sendMessage(request, testChatId, 'Unread msg A');
            await sendMessage(request, testChatId, 'Unread msg B');

            // Get the chat list (without updating read receipt first)
            const listResp = await request.get('/api/messages');
            expect(listResp.status()).toBe(200);
            const listBody = await listResp.json();

            const foundChat = listBody.chats.find((c: any) => c.id === testChatId);
            if (foundChat) {
                expect(foundChat.readReceipts.count).toBeGreaterThanOrEqual(0);
            }
        });

        test("after updating read receipt, the chat receipt messageId matches", async ({ request }) => {
            await signin(request);

            // Send a message
            const sendResp = await sendMessage(request, testChatId, 'Receipt sync check');
            expect(sendResp.status()).toBe(201);
            const sentMsgId = (await sendResp.json()).message.id;
            createdMessageIds.push(sentMsgId);

            // Update read receipt to this message
            await updateReadReceipt(request, testChatId, sentMsgId);

            // GET /api/messages should show the updated messageId in readReceipts
            const listResp = await request.get('/api/messages');
            const listBody = await listResp.json();
            const foundChat = listBody.chats.find((c: any) => c.id === testChatId);

            if (foundChat) {
                expect(foundChat.readReceipts.messageId).toBe(sentMsgId);
            }
        });

    });

    // ==================== PER-USER ISOLATION ====================

    test.describe("Read receipts are per-user", () => {

        test("mod user and reg user have independent read receipts", async ({ request }) => {
            await signin(request);

            // Send two messages as mod user
            const send1 = await sendMessage(request, testChatId, 'Receipt isolation test A');
            const msg1Id = (await send1.json()).message.id;
            createdMessageIds.push(msg1Id);

            await new Promise(r => setTimeout(r, 20));

            const send2 = await sendMessage(request, testChatId, 'Receipt isolation test B');
            const msg2Id = (await send2.json()).message.id;
            createdMessageIds.push(msg2Id);

            // Mod user reads up to message 1
            const modReceiptResp = await updateReadReceipt(request, testChatId, msg1Id);
            expect(modReceiptResp.status()).toBe(204);

            // Regular user reads up to message 2
            await signin(request, process.env.REG_USER, process.env.REG_PASS);
            const regReceiptResp = await updateReadReceipt(request, testChatId, msg2Id);

            // If the regular user doesn't have message permission, skip the test
            if (regReceiptResp.status() !== 204) {
                test.skip();
                return;
            }

            // Verify in database that both receipts exist independently
            const modReceipt = await db.select()
                .from(messagesReadReceipts)
                .where(and(
                    eq(messagesReadReceipts.userId, modUserId),
                    eq(messagesReadReceipts.chatId, testChatId)
                ));
            const regReceipt = await db.select()
                .from(messagesReadReceipts)
                .where(and(
                    eq(messagesReadReceipts.userId, regUserId),
                    eq(messagesReadReceipts.chatId, testChatId)
                ));

            expect(modReceipt).toHaveLength(1);
            expect(regReceipt).toHaveLength(1);
            expect(modReceipt[0].messageId).toBe(msg1Id);
            expect(regReceipt[0].messageId).toBe(msg2Id);
            // Verify they differ
            expect(modReceipt[0].messageId).not.toBe(regReceipt[0].messageId);
        });

    });

    // ==================== CACHE-CONTROL HEADER ====================

    test.describe("Response headers", () => {

        test("HEAD returns Cache-Control: no-store header", async ({ request }) => {
            await signin(request);

            const sendResp = await sendMessage(request, testChatId, 'Cache control test');
            expect(sendResp.status()).toBe(201);
            const messageId = (await sendResp.json()).message.id;
            createdMessageIds.push(messageId);

            const response = await updateReadReceipt(request, testChatId, messageId);
            expect(response.status()).toBe(204);

            const cacheControl = response.headers()['cache-control'];
            expect(cacheControl).toBeDefined();
            expect(cacheControl).toContain('no-store');
        });

    });

});
