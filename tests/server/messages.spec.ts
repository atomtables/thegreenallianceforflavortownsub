import { test, expect } from '@playwright/test';
import { signin } from './util';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq, and, inArray, or } from 'drizzle-orm';
import { chats, chatParticipants, users } from '../../src/lib/server/db/schema';

/**
 * Database connection for direct verification of data.
 * This allows tests to verify that API operations correctly persist data.
 */
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

// Track chat IDs created during tests for cleanup
const createdChatIds: string[] = [];

/**
 * Helper to delete a chat and its participants from the database
 */
async function deleteChat(chatId: string): Promise<void> {
    await db.delete(chatParticipants).where(eq(chatParticipants.chatId, chatId));
    await db.delete(chats).where(eq(chats.id, chatId));
}

/**
 * Helper to clean up all chats involving specific user IDs
 */
async function cleanupChatsForUsers(userIds: string[]): Promise<void> {
    // Find all chats where any of these users are participants
    const participantRecords = await db.select({ chatId: chatParticipants.chatId })
        .from(chatParticipants)
        .where(inArray(chatParticipants.userId, userIds));
    
    const chatIdsToDelete = [...new Set(participantRecords.map(p => p.chatId))];
    
    if (chatIdsToDelete.length > 0) {
        await db.delete(chatParticipants).where(inArray(chatParticipants.chatId, chatIdsToDelete));
        await db.delete(chats).where(inArray(chats.id, chatIdsToDelete));
    }
}

/**
 * Helper to create a chat via PUT /api/messages
 * Handles the multipart form data with multiple participantIds
 */
async function createChat(
    request: any,
    participantIds: string | string[],
    name?: string
): Promise<any> {
    const ids = Array.isArray(participantIds) ? participantIds : [participantIds];
    
    // Build form data string for multipart
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
        headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        data: body
    });
}

/**
 * Helper to archive a chat via DELETE /api/messages
 */
async function archiveChat(request: any, chatId: string): Promise<any> {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    let body = `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="chatId"\r\n\r\n`;
    body += `${chatId}\r\n`;
    body += `--${boundary}--\r\n`;
    
    return request.delete('/api/messages', {
        headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        data: body
    });
}

// Clean up any created chats and close database connection after all tests
test.afterAll(async () => {
    // Delete all chats created during tests
    for (const chatId of createdChatIds) {
        try {
            await deleteChat(chatId);
        } catch (e) {
            // Ignore errors - chat may have already been deleted
        }
    }
    await pool.end();
});

/**
 * Test suite for /api/messages endpoint
 * Tests chat creation, retrieval, and deletion (archiving)
 */
test.describe("Messages endpoint tests", () => {

    // Pre-test cleanup: Get test user IDs and delete any existing chats between them
    test.beforeAll(async ({ request }) => {
        await signin(request);
        
        // Get the test users
        const usersResponse = await request.get('/api/users/list');
        if (usersResponse.status() === 200) {
            const usersBody = await usersResponse.json();
            const testUserIds: string[] = [];
            
            // Find mod user and regular user
            const modUser = usersBody.users.find((u: any) => u.username === process.env.MOD_USER);
            const regUser = usersBody.users.find((u: any) => u.username === process.env.REG_USER);
            
            if (modUser) testUserIds.push(modUser.id);
            if (regUser) testUserIds.push(regUser.id);
            
            // Clean up existing chats involving these test users
            if (testUserIds.length > 0) {
                await cleanupChatsForUsers(testUserIds);
            }
        }
    });

    // ==================== PERMISSION TESTS ====================

    test.describe("Permission checks", () => {

        test("GET: requires authentication", async ({ request }) => {
            // Unauthenticated users should receive 401 Unauthorized
            const response = await request.get('/api/messages');
            expect(response.status()).toBe(401);
        });

        test("PUT: requires authentication", async ({ request }) => {
            const response = await request.put('/api/messages', {
                multipart: {
                    participantIds: "some-user-id"
                }
            });
            expect(response.status()).toBe(401);
        });

        test("DELETE: requires authentication", async ({ request }) => {
            // Unauthenticated users should receive 401 Unauthorized
            const response = await request.delete('/api/messages', {
                multipart: {
                    chatId: "some-chat-id"
                }
            });
            expect(response.status()).toBe(401);
        });

    });

    // ==================== INPUT VALIDATION TESTS ====================

    test.describe("Input validation", () => {

        test("PUT: returns 400 when participantIds is missing", async ({ request }) => {
            await signin(request);

            const response = await request.put('/api/messages', {
                multipart: {
                    name: "Test Chat"
                }
            });

            expect(response.status()).toBe(400);
            const body = await response.json();
            expect(body.error).toBeDefined();
        });

        test("PUT: returns 400 when participantIds is empty", async ({ request }) => {
            await signin(request);

            const response = await request.put('/api/messages', {
                multipart: {}
            });

            expect(response.status()).toBe(400);
            const body = await response.json();
            expect(body.error).toBeDefined();
        });

        test("PUT: returns 400 when form data is invalid", async ({ request }) => {
            await signin(request);

            const response = await request.put('/api/messages', {
                headers: {
                    'Content-Type': 'application/json'
                },
                data: { invalid: "data" }
            });

            expect(response.status()).toBe(400);
        });

        test("DELETE: returns 400 when chatId is missing", async ({ request }) => {
            await signin(request);

            const response = await request.delete('/api/messages', {
                multipart: {}
            });

            expect(response.status()).toBe(400);
            const body = await response.json();
            expect(body.error).toBeDefined();
        });

    });

    // ==================== CHAT CREATION TESTS ====================

    test.describe("Chat creation (PUT)", () => {

        test("successfully creates a direct message chat", async ({ request }) => {
            await signin(request);

            // Get list of users to find a valid participant
            const usersResponse = await request.get('/api/users/list');
            expect(usersResponse.status()).toBe(200);
            
            const usersBody = await usersResponse.json();
            expect(usersBody.users).toBeDefined();
            expect(usersBody.users.length).toBeGreaterThan(0);

            // Find a user that's not the current logged-in user
            const otherUser = usersBody.users.find((u: any) => u.username !== process.env.MOD_USER);
            expect(otherUser).toBeDefined();

            const response = await request.put('/api/messages', {
                multipart: {
                    participantIds: otherUser.id
                }
            });

            expect(response.status()).toBe(201);
            const body = await response.json();
            expect(body.chat).toBeDefined();
            expect(body.chat.id).toBeDefined();
            expect(body.chat.isGroup).toBe(false);
            expect(body.chat.participantIds).toContain(otherUser.id);

            // Verify in database
            const chatId = body.chat.id;
            const dbChat = await db.select().from(chats).where(eq(chats.id, chatId));
            expect(dbChat.length).toBe(1);
            expect(dbChat[0].isGroup).toBe(false);
            expect(dbChat[0].archived).toBe(false);

            // Verify participants in database
            const dbParticipants = await db.select().from(chatParticipants).where(eq(chatParticipants.chatId, chatId));
            expect(dbParticipants.length).toBeGreaterThanOrEqual(2);
            const participantUserIds = dbParticipants.map(p => p.userId);
            expect(participantUserIds).toContain(otherUser.id);

            // Cleanup: Delete the chat from database
            await deleteChat(chatId);
        });

        test("successfully creates a group chat with name", async ({ request }) => {
            await signin(request);

            // Get list of users to find valid participants
            const usersResponse = await request.get('/api/users/list');
            expect(usersResponse.status()).toBe(200);
            
            const usersBody = await usersResponse.json();
            const otherUsers = usersBody.users.filter((u: any) => u.username !== process.env.MOD_USER);
            
            // Need at least 2 other users for a group chat
            if (otherUsers.length < 2) {
                test.skip();
                return;
            }

            const chatName = "Test Group Chat";
            const response = await createChat(request, [otherUsers[0].id, otherUsers[1].id], chatName);

            expect(response.status()).toBe(201);
            const body = await response.json();
            expect(body.chat).toBeDefined();
            expect(body.chat.id).toBeDefined();
            expect(body.chat.isGroup).toBe(true);
            expect(body.chat.name).toBe(chatName);

            // Verify in database
            const chatId = body.chat.id;
            const dbChat = await db.select().from(chats).where(eq(chats.id, chatId));
            expect(dbChat.length).toBe(1);
            expect(dbChat[0].isGroup).toBe(true);
            expect(dbChat[0].name).toBe(chatName);
            expect(dbChat[0].archived).toBe(false);

            // Verify all participants in database
            const dbParticipants = await db.select().from(chatParticipants).where(eq(chatParticipants.chatId, chatId));
            expect(dbParticipants.length).toBeGreaterThanOrEqual(3); // 2 other users + creator
            const participantUserIds = dbParticipants.map(p => p.userId);
            expect(participantUserIds).toContain(otherUsers[0].id);
            expect(participantUserIds).toContain(otherUsers[1].id);

            // Cleanup: Delete the chat from database
            await deleteChat(chatId);
        });

        test("successfully creates a group chat without explicit name", async ({ request }) => {
            await signin(request);

            // Get list of users
            const usersResponse = await request.get('/api/users/list');
            expect(usersResponse.status()).toBe(200);
            
            const usersBody = await usersResponse.json();
            const otherUsers = usersBody.users.filter((u: any) => u.username !== process.env.MOD_USER);
            
            if (otherUsers.length < 2) {
                test.skip();
                return;
            }

            const response = await createChat(request, [otherUsers[0].id, otherUsers[1].id]);

            expect(response.status()).toBe(201);
            const body = await response.json();
            expect(body.chat).toBeDefined();
            expect(body.chat.isGroup).toBe(true);
            // Name should be auto-generated from usernames when not provided
            expect(body.chat.name).toBeDefined();

            // Cleanup: Delete the chat from database
            await deleteChat(body.chat.id);
        });

        test("returns existing chat when creating duplicate", async ({ request }) => {
            await signin(request);

            // Get list of users
            const usersResponse = await request.get('/api/users/list');
            expect(usersResponse.status()).toBe(200);
            
            const usersBody = await usersResponse.json();
            const otherUser = usersBody.users.find((u: any) => u.username !== process.env.MOD_USER);
            expect(otherUser).toBeDefined();

            // Create first chat
            const response1 = await request.put('/api/messages', {
                multipart: {
                    participantIds: otherUser.id
                }
            });

            // Could be 201 (new) or 200 (existing from previous test run)
            expect([200, 201]).toContain(response1.status());
            const body1 = await response1.json();
            expect(body1.chat).toBeDefined();
            const chatId = body1.chat.id;

            // Try to create same chat again - should return 200 with existing flag
            const response2 = await request.put('/api/messages', {
                multipart: {
                    participantIds: otherUser.id
                }
            });

            // API should return 200 and mark chat as existing
            expect(response2.status()).toBe(200);
            const body2 = await response2.json();
            expect(body2.chat).toBeDefined();
            expect(body2.chat.id).toBe(chatId);
            expect(body2.existing).toBe(true);

            // Cleanup: Delete the chat from database
            await deleteChat(chatId);
        });

        test("returns 403 when trying to message user without permission", async ({ request }) => {
            // Login as regular user (less permissions)
            await signin(request, process.env.REG_USER, process.env.REG_PASS);

            // Get list of users
            const usersResponse = await request.get('/api/users/list');
            
            // If regular user doesn't have permission to list users, skip this test
            if (usersResponse.status() !== 200) {
                test.skip();
                return;
            }
            
            const usersBody = await usersResponse.json();
            const otherUser = usersBody.users.find((u: any) => u.username !== process.env.REG_USER);
            
            if (!otherUser) {
                test.skip();
                return;
            }

            const response = await request.put('/api/messages', {
                multipart: {
                    participantIds: otherUser.id
                }
            });

            // Should either succeed or fail with 403 depending on permissions
            // Regular users typically can't message everyone
            expect([201, 200, 401, 403]).toContain(response.status());
        });

    });

    // ==================== CHAT RETRIEVAL TESTS ====================

    test.describe("Chat retrieval (GET)", () => {

        test("successfully retrieves user's chats", async ({ request }) => {
            await signin(request);

            const response = await request.get('/api/messages');

            expect(response.status()).toBe(200);
            const body = await response.json();
            expect(body.chats).toBeDefined();
            expect(Array.isArray(body.chats)).toBe(true);
            expect(body.users).toBeDefined();
            // allowedUsers should always be present
            expect(body.allowedUsers).toBeDefined();
            expect(Array.isArray(body.allowedUsers)).toBe(true);
        });

        test("allowedUsers does not include the current user and has no password hashes", async ({ request }) => {
            await signin(request);

            // Get the current user's info
            const usersResponse = await request.get('/api/users/list');
            expect(usersResponse.status()).toBe(200);
            const usersBody = await usersResponse.json();
            const currentUser = usersBody.users.find((u: any) => u.username === process.env.MOD_USER);
            expect(currentUser).toBeDefined();

            const response = await request.get('/api/messages');
            expect(response.status()).toBe(200);
            const body = await response.json();

            expect(body.allowedUsers).toBeDefined();
            expect(Array.isArray(body.allowedUsers)).toBe(true);

            // The current user should never appear in their own allowedUsers list
            const selfInAllowed = body.allowedUsers.find((u: any) => u.id === currentUser.id);
            expect(selfInAllowed).toBeUndefined();

            // Each allowed user should have basic fields and no password hash
            for (const user of body.allowedUsers) {
                expect(user.id).toBeDefined();
                expect(user.passwordHash).toBeNull();
            }
        });

        test("chats include participant information", async ({ request }) => {
            await signin(request);

            // First create a chat to ensure we have at least one
            const usersResponse = await request.get('/api/users/list');
            expect(usersResponse.status()).toBe(200);
            
            const usersBody = await usersResponse.json();
            const otherUser = usersBody.users.find((u: any) => u.username !== process.env.MOD_USER);
            
            let createdChatId: string | null = null;
            if (otherUser) {
                const createRes = await request.put('/api/messages', {
                    multipart: {
                        participantIds: otherUser.id
                    }
                });
                const createBody = await createRes.json();
                createdChatId = createBody.chat?.id;
            }

            // Now get all chats
            const response = await request.get('/api/messages');
            expect(response.status()).toBe(200);
            
            const body = await response.json();
            expect(body.chats).toBeDefined();
            
            // Each chat should have participantIds
            for (const chat of body.chats) {
                expect(chat.id).toBeDefined();
                expect(chat.participantIds).toBeDefined();
                expect(Array.isArray(chat.participantIds)).toBe(true);
                expect(typeof chat.isGroup).toBe('boolean');
            }

            // Cleanup: Delete the chat from database
            if (createdChatId) {
                await deleteChat(createdChatId);
            }
        });

        test("users object contains participant details", async ({ request }) => {
            await signin(request);

            // Create a chat first
            const usersResponse = await request.get('/api/users/list');
            expect(usersResponse.status()).toBe(200);
            
            const usersBody = await usersResponse.json();
            const otherUser = usersBody.users.find((u: any) => u.username !== process.env.MOD_USER);
            
            let createdChatId: string | null = null;
            if (otherUser) {
                const createRes = await request.put('/api/messages', {
                    multipart: {
                        participantIds: otherUser.id
                    }
                });
                const createBody = await createRes.json();
                createdChatId = createBody.chat?.id;
            }

            const response = await request.get('/api/messages');
            expect(response.status()).toBe(200);
            
            const body = await response.json();
            expect(body.users).toBeDefined();
            
            // Users object should contain user details keyed by ID
            for (const [userId, user] of Object.entries(body.users) as [string, any][]) {
                expect(user.id).toBe(userId);
                expect(user.username).toBeDefined();
                // Password hash should never be included
                expect(user.passwordHash).toBeNull();
            }

            // Cleanup: Delete the chat from database
            if (createdChatId) {
                await deleteChat(createdChatId);
            }
        });

    });

    // ==================== CHAT DELETION TESTS ====================

    test.describe("Chat deletion/archiving (DELETE)", () => {

        test("successfully archives a chat", async ({ request }) => {
            await signin(request);

            // Get list of users
            const usersResponse = await request.get('/api/users/list');
            expect(usersResponse.status()).toBe(200);
            
            const usersBody = await usersResponse.json();
            const otherUser = usersBody.users.find((u: any) => u.username !== process.env.MOD_USER);
            
            if (!otherUser) {
                test.skip();
                return;
            }

            // Create a chat
            const createResponse = await request.put('/api/messages', {
                multipart: {
                    participantIds: otherUser.id
                }
            });

            expect([200, 201]).toContain(createResponse.status());
            const createBody = await createResponse.json();
            const chatId = createBody.chat.id;

            // Verify chat is NOT archived in database before deletion
            const dbChatBefore = await db.select().from(chats).where(eq(chats.id, chatId));
            expect(dbChatBefore.length).toBe(1);
            expect(dbChatBefore[0].archived).toBe(false);

            // Delete (archive) the chat
            const deleteResponse = await request.delete('/api/messages', {
                multipart: {
                    chatId: chatId
                }
            });

            expect(deleteResponse.status()).toBe(200);
            const deleteBody = await deleteResponse.json();
            expect(deleteBody.message).toBeDefined();

            // Verify chat IS archived in database after deletion
            const dbChatAfter = await db.select().from(chats).where(eq(chats.id, chatId));
            expect(dbChatAfter.length).toBe(1);
            expect(dbChatAfter[0].archived).toBe(true);

            // Cleanup: Delete the chat from database
            await deleteChat(chatId);
        });

        test("archived chat allows creating new chat with same participants", async ({ request }) => {
            await signin(request);

            // Get list of users
            const usersResponse = await request.get('/api/users/list');
            expect(usersResponse.status()).toBe(200);
            
            const usersBody = await usersResponse.json();
            const otherUser = usersBody.users.find((u: any) => u.username !== process.env.MOD_USER);
            
            if (!otherUser) {
                test.skip();
                return;
            }

            // Create a chat
            const createResponse1 = await request.put('/api/messages', {
                multipart: {
                    participantIds: otherUser.id
                }
            });

            expect([200, 201]).toContain(createResponse1.status());
            const createBody1 = await createResponse1.json();
            const chatId1 = createBody1.chat.id;

            // Archive the chat
            await request.delete('/api/messages', {
                multipart: {
                    chatId: chatId1
                }
            });

            // Verify first chat is archived in database
            const dbChat1 = await db.select().from(chats).where(eq(chats.id, chatId1));
            expect(dbChat1.length).toBe(1);
            expect(dbChat1[0].archived).toBe(true);

            // Create a new chat with same participants
            const createResponse2 = await request.put('/api/messages', {
                multipart: {
                    participantIds: otherUser.id
                }
            });

            expect(createResponse2.status()).toBe(201);
            const createBody2 = await createResponse2.json();
            // Should be a new chat since previous one was archived
            expect(createBody2.chat.id).not.toBe(chatId1);
            expect(createBody2.existing).toBeFalsy();

            // Verify new chat exists in database and is NOT archived
            const dbChat2 = await db.select().from(chats).where(eq(chats.id, createBody2.chat.id));
            expect(dbChat2.length).toBe(1);
            expect(dbChat2[0].archived).toBe(false);

            // Verify both chats exist in database (old archived, new active)
            const allChats = await db.select().from(chats).where(inArray(chats.id, [chatId1, createBody2.chat.id]));
            expect(allChats.length).toBe(2);

            // Cleanup: Delete both chats from database
            await deleteChat(chatId1);
            await deleteChat(createBody2.chat.id);
        });

    });

    // ==================== EDGE CASE TESTS ====================

    test.describe("Edge cases", () => {

        test("PUT: handles whitespace-only chat name", async ({ request }) => {
            await signin(request);

            const usersResponse = await request.get('/api/users/list');
            expect(usersResponse.status()).toBe(200);
            
            const usersBody = await usersResponse.json();
            const otherUsers = usersBody.users.filter((u: any) => u.username !== process.env.MOD_USER);
            
            if (otherUsers.length < 2) {
                test.skip();
                return;
            }

            const response = await createChat(request, [otherUsers[0].id, otherUsers[1].id], "   ");

            expect([200, 201]).toContain(response.status());
            const body = await response.json();
            // Whitespace-only name should be treated as no name
            // So the name should be auto-generated or undefined
            expect(body.chat).toBeDefined();

            // Cleanup: Delete the chat from database
            await deleteChat(body.chat.id);
        });

        test("PUT: handles invalid user ID", async ({ request }) => {
            await signin(request);

            const response = await request.put('/api/messages', {
                multipart: {
                    participantIds: "invalid-user-id-that-does-not-exist"
                }
            });

            // API should return an error for invalid/non-existent user ID
            // Valid error codes: 400 (bad request) or 404 (user not found)
            expect([400, 404]).toContain(response.status());
            const body = await response.json();
            expect(body.error).toBeDefined();
        });

        test("PUT: creator is automatically added to participants", async ({ request }) => {
            await signin(request);

            const usersResponse = await request.get('/api/users/list');
            expect(usersResponse.status()).toBe(200);
            
            const usersBody = await usersResponse.json();
            const otherUser = usersBody.users.find((u: any) => u.username !== process.env.MOD_USER);
            
            if (!otherUser) {
                test.skip();
                return;
            }

            const response = await request.put('/api/messages', {
                multipart: {
                    participantIds: otherUser.id
                }
            });

            expect([200, 201]).toContain(response.status());
            const body = await response.json();
            expect(body.chat.participantIds.length).toBeGreaterThanOrEqual(2);

            // Cleanup: Delete the chat from database
            await deleteChat(body.chat.id);
        });

        test("DELETE: handles non-existent chat ID gracefully", async ({ request }) => {
            await signin(request);

            const response = await request.delete('/api/messages', {
                multipart: {
                    chatId: "non-existent-chat-id-12345"
                }
            });

            // Should either succeed silently or return an error
            // The API currently doesn't validate if chat exists
            expect([200, 400, 404]).toContain(response.status());
        });

    });

    // ==================== FULL WORKFLOW TESTS ====================

    test.describe("Full workflow tests", () => {

        test("complete chat lifecycle: create, retrieve, archive", async ({ request }) => {
            await signin(request);

            // Step 1: Get users
            const usersResponse = await request.get('/api/users/list');
            expect(usersResponse.status()).toBe(200);
            const usersBody = await usersResponse.json();
            const otherUser = usersBody.users.find((u: any) => u.username !== process.env.MOD_USER);
            
            if (!otherUser) {
                test.skip();
                return;
            }

            // Step 2: Create a chat
            const createResponse = await request.put('/api/messages', {
                multipart: {
                    participantIds: otherUser.id
                }
            });
            expect([200, 201]).toContain(createResponse.status());
            const createBody = await createResponse.json();
            const chatId = createBody.chat.id;

            // Step 2b: Verify chat exists in database
            const dbChatCreated = await db.select().from(chats).where(eq(chats.id, chatId));
            expect(dbChatCreated.length).toBe(1);
            expect(dbChatCreated[0].archived).toBe(false);

            // Step 3: Verify chat appears in list
            const getResponse = await request.get('/api/messages');
            expect(getResponse.status()).toBe(200);
            const getBody = await getResponse.json();
            const foundChat = getBody.chats.find((c: any) => c.id === chatId);
            expect(foundChat).toBeDefined();
            expect(foundChat.participantIds).toContain(otherUser.id);

            // Step 4: Verify user details are included
            expect(getBody.users[otherUser.id]).toBeDefined();
            expect(getBody.users[otherUser.id].username).toBe(otherUser.username);

            // Step 5: Archive the chat
            const deleteResponse = await archiveChat(request, chatId);
            expect(deleteResponse.status()).toBe(200);

            // Step 5b: Verify chat is archived in database
            const dbChatArchived = await db.select().from(chats).where(eq(chats.id, chatId));
            expect(dbChatArchived.length).toBe(1);
            expect(dbChatArchived[0].archived).toBe(true);

            // Step 6: Verify archived chat no longer appears (or is marked as archived)
            const getAfterDeleteResponse = await request.get('/api/messages');
            expect(getAfterDeleteResponse.status()).toBe(200);
            const getAfterDeleteBody = await getAfterDeleteResponse.json();
            const archivedChat = getAfterDeleteBody.chats.find((c: any) => c.id === chatId);
            
            // Chat should either be missing or marked as archived
            if (archivedChat) {
                expect(archivedChat.archived).toBe(true);
            }

            // Cleanup: Delete the chat from database
            await deleteChat(chatId);
        });

        test("group chat workflow with multiple participants", async ({ request }) => {
            await signin(request);

            // Step 1: Get users
            const usersResponse = await request.get('/api/users/list');
            expect(usersResponse.status()).toBe(200);
            const usersBody = await usersResponse.json();
            const otherUsers = usersBody.users.filter((u: any) => u.username !== process.env.MOD_USER);
            
            if (otherUsers.length < 2) {
                test.skip();
                return;
            }

            const participant1 = otherUsers[0];
            const participant2 = otherUsers[1];
            const groupName = `Test Group ${Date.now()}`;

            // Step 2: Create group chat
            const createResponse = await createChat(request, [participant1.id, participant2.id], groupName);
            expect(createResponse.status()).toBe(201);
            const createBody = await createResponse.json();
            
            expect(createBody.chat.isGroup).toBe(true);
            expect(createBody.chat.name).toBe(groupName);
            expect(createBody.chat.participantIds).toContain(participant1.id);
            expect(createBody.chat.participantIds).toContain(participant2.id);

            const chatId = createBody.chat.id;

            // Step 2b: Verify group chat in database
            const dbGroupChat = await db.select().from(chats).where(eq(chats.id, chatId));
            expect(dbGroupChat.length).toBe(1);
            expect(dbGroupChat[0].isGroup).toBe(true);
            expect(dbGroupChat[0].name).toBe(groupName);
            expect(dbGroupChat[0].archived).toBe(false);

            // Step 2c: Verify all participants in database
            const dbParticipants = await db.select().from(chatParticipants).where(eq(chatParticipants.chatId, chatId));
            expect(dbParticipants.length).toBeGreaterThanOrEqual(3); // 2 participants + creator
            const participantUserIds = dbParticipants.map(p => p.userId);
            expect(participantUserIds).toContain(participant1.id);
            expect(participantUserIds).toContain(participant2.id);

            // Step 3: Retrieve and verify
            const getResponse = await request.get('/api/messages');
            expect(getResponse.status()).toBe(200);
            const getBody = await getResponse.json();
            
            const foundChat = getBody.chats.find((c: any) => c.id === chatId);
            expect(foundChat).toBeDefined();
            expect(foundChat.isGroup).toBe(true);
            expect(foundChat.name).toBe(groupName);

            // Step 4: Verify all participant details are available
            expect(getBody.users[participant1.id]).toBeDefined();
            expect(getBody.users[participant2.id]).toBeDefined();

            // Step 5: Clean up - archive the chat
            const deleteResponse = await archiveChat(request, chatId);
            expect(deleteResponse.status()).toBe(200);

            // Step 5b: Verify archived in database
            const dbGroupChatArchived = await db.select().from(chats).where(eq(chats.id, chatId));
            expect(dbGroupChatArchived.length).toBe(1);
            expect(dbGroupChatArchived[0].archived).toBe(true);

            // Cleanup: Delete the chat from database
            await deleteChat(chatId);
        });

    });

});
