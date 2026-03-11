// This handles the creation and getting of
// new chats between people

import { messages, chats, chatParticipants, users, messagesReadReceipts } from "$lib/server/db/schema";
import type { RequestHandler } from "@sveltejs/kit";
import { db } from "$lib/server/db/index";
import { normaliseChatFromDatabase, normaliseMessageFromDatabase, type Chat, type Message } from "$lib/types/messages";
import { RequiresPermissions } from "$lib/functions/requirePermissions";
import { Permission, Role, type User } from "$lib/types/types";
import { and, count, desc, eq, inArray, gt, ne, notInArray } from "drizzle-orm";
import { cleanUserFromDatabase } from "$lib/server/auth";
import { _clients as clients } from "./stream/+server";
import { _invalidateParticipantCache as invalidateParticipantCache } from "./[chatId]/+server";

// Retrieve all chats for a given user.
export const GET: RequestHandler = async ({ locals }) => {
    if (!RequiresPermissions(locals, [Permission.message])) {
        return new Response(JSON.stringify({ error: "Insufficient permissions" }), { status: 401 });
    }

    const userId = locals.user!.id;

    // Fetch chats the user participates in using relations
    const participantRows = await db.query.chatParticipants.findMany({
        where: eq(chatParticipants.userId, userId),
        with: {
            chat: {
                columns: {
                    id: true,
                    isGroup: true,
                    name: true,
                    archived: true,
                },
                with: {
                    participants: {
                        columns: {
                            userId: true,
                        },
                    },
                    messages: {
                        limit: 1,
                        orderBy: desc(messages.id),
                        where: (msg) => eq(msg.deleted, false),
                        with: {
                            reactions: true
                        }
                    },
                    readReceipts: {
                        where: (rr) => eq(rr.userId, userId)
                    }
                },
            }
        },
    }).then(res => res.map(row => {
        return {
            ...row,
            chat: row.chat ? {
                ...row.chat,
                lastMessage: row.chat.messages?.[0] ? normaliseMessageFromDatabase(row.chat.messages[0]) : null
            } : null
        };
    }));

    // De-duplicate chats (a chat can appear multiple times via participants relation)
    const chatMap = new Map<string, Chat>();
    for (const row of participantRows) {
        const chat = row.chat;
        if (!chat) continue;
        if (chat.archived) continue; // skip archived chats
        const participantIds = chat.participants?.map((p) => p.userId) ?? [];
        console.log(await db.select().from(messages).where(() => and(
            eq(messages.chatId, row.chatId),
            gt(messages.id, chat.readReceipts[0]?.messageId || "0"),
            ne(messages.deleted, true)
        )))
        if (!chatMap.has(chat.id)) {
            chatMap.set(chat.id, {
                id: chat.id,
                isGroup: chat.isGroup,
                name: chat.name ?? undefined,
                archived: chat.archived,
                participantIds,
                lastMessage: chat.lastMessage ?? undefined,
                readReceipts: {
                    messageId: chat.readReceipts[0]?.messageId || null,
                    count: (await db.select({ value: count() }).from(messages).where(() => and(
                        eq(messages.chatId, chat.id),
                        gt(messages.id, chat.readReceipts[0]?.messageId || "0"),
                        ne(messages.deleted, true)
                    )).then(res => res[0].value)) || 0,
                }
            });
        }
    }

    const userChats = Array.from(chatMap.values()).sort((a, b) => {
        if (!a.lastMessage && !b.lastMessage) return 0;
        if (!a.lastMessage) return 1;
        if (!b.lastMessage) return -1;
        return BigInt(b.lastMessage.id) > BigInt(a.lastMessage.id) ? 1 : -1;
    });

    const usersInvolved: { [id: string]: User } = {};
    for (const chat of userChats) {
        for (const participantId of chat.participantIds) {
            if (participantId !== userId && !usersInvolved[participantId]) {
                const userRecord = await db.select().from(users).where(eq(users.id, participantId)).limit(1).then(res => res[0]);
                if (userRecord) {
                    usersInvolved[participantId] = cleanUserFromDatabase(userRecord) as User;
                }
            }
        }
    }

    // Build the list of users this user is allowed to message,
    // filtered by their messaging permissions (message, message_leads, message_anyone).
    // This is provided so that users without the "users" permission (user list access)
    // can still see who they are allowed to start chats with.
    // Filter at the database level by excluding roles the user can't message.
    // Permission hierarchy: message_anyone grants access to members (Role.member),
    // message_leads grants access to leads (Role.lead). Without these permissions,
    // those roles are excluded. All other roles (captain, mentor, coach, admin) are
    // messageable by anyone with the base "message" permission.
    const excludedRoles: Role[] = [];
    if (!locals.user!.permissions.includes(Permission.message_anyone)) {
        excludedRoles.push(Role.member);
    }
    if (!locals.user!.permissions.includes(Permission.message_leads)) {
        excludedRoles.push(Role.lead);
    }
    const allowedUsersConditions = [ne(users.id, userId)];
    if (excludedRoles.length > 0) {
        allowedUsersConditions.push(notInArray(users.role, excludedRoles));
    }
    const allowedUsers = await db.query.users.findMany({
        where: and(...allowedUsersConditions)
    }).then(res => res.map(cleanUserFromDatabase));

    return new Response(JSON.stringify({
        chats: userChats,
        // list of all users that can be linked to participantId
        // because some users may not have access to the user lists if they don't
        // have permissions.
        users: usersInvolved,
        // list of all users this user is allowed to message
        allowedUsers: allowedUsers
    }), { status: 200 });
}

const checkIfUserCanMessage = (user: User, target: User): boolean => {
    if (target.role === Role.member && !user.permissions.includes(Permission.message_anyone))
        return false;
    if (target.role === Role.lead && !user.permissions.includes(Permission.message_leads))
        return false;
    if (!user.permissions.includes(Permission.message))
        return false;
    return true;
}

// Create a chat with specified participant IDs
export const PUT: RequestHandler = async ({ request, locals }) => {
    if (!RequiresPermissions(locals, [Permission.message])) return new Response(JSON.stringify({ error: "Insufficient permissions" }), { status: 401 });

    let formData: FormData;
    try {
        formData = await request.formData();
    } catch (e) {
        console.error(`${request.url}: Error parsing form data: `, e);
        return new Response(JSON.stringify({ error: "Invalid form data" }), { status: 400 });
    }
    let participantIds = formData.getAll("participantIds") as string[];
    let name = formData.get("name") as string | null;
    if (!participantIds || participantIds.length === 0) {
        return new Response(JSON.stringify({ error: "Please provide all required fields" }), { status: 400 });
    }
    participantIds.push(locals.user!.id); // ensure the creator is included
    participantIds = Array.from(new Set(participantIds)); // deduplicate

    const trimmedName = name?.trim() ?? "";
    const hasExplicitName = trimmedName.length > 0;

    // let's get the User for each here to make sure the IDs can be messaged
    let validUsers: User[] = [];
    try {
        validUsers = await db.query.users.findMany({
            where: inArray(users.id, participantIds)
        }).then(res => res.map(cleanUserFromDatabase));
    } catch (e) {
        console.error(`${request.url}: Error retrieving users: `, e);
        return new Response(JSON.stringify({ error: `Internal server error: ${e}` }), { status: 500 });
    }
    if (validUsers.length !== participantIds.length) {
        return new Response(JSON.stringify({ error: "One or more participant IDs are invalid" }), { status: 400 });
    }
    for (const user of validUsers) {
        if (!checkIfUserCanMessage(locals.user!, user)) {
            return new Response(JSON.stringify({ error: `You do not have permission to message user ${user.username}` }), { status: 403 });
        }
    }

    // now that we have users, let's double check that a chat with these exact users doesn't already exist
    // excluding archived chats
    // we do this by collecting all chats from the logged in user, then filtering each one to see
    // if the participant IDs match exactly
    if (!hasExplicitName) {
        try {
            const existingChats = await db.query.chats.findMany({
                where: eq(chats.archived, false),
                with: {
                    participants: {
                        columns: {
                            userId: true,
                        }
                    }
                }
            });
            for (const chat of existingChats) {
                const chatParticipantIds = chat.participants.map(p => p.userId).sort();
                const desiredParticipantIds = participantIds.slice().sort();
                let allMatch = chatParticipantIds.length === desiredParticipantIds.length;
                for (let i = 0; i < chatParticipantIds.length; i++) {
                    if (chatParticipantIds.at(i) !== desiredParticipantIds.at(i)) {
                        allMatch = false;
                        break;
                    }
                }
                // chat already exists
                if (allMatch)
                    return new Response(
                        JSON.stringify({
                            chat: chat,
                            existing: true
                        }),
                        { status: 200 }
                    );
            }
        } catch (e) {
            console.error(`${request.url}:${request.method}: Error checking existing chats: `, e);
            return new Response(JSON.stringify({ error: `Internal server error` }), { status: 500 });
        }
    }

    // ok let's create the chat now
    let newChat: Chat;
    try {
        const chatInsert = await db.insert(chats).values({
            isGroup: participantIds.length > 2,
            name: hasExplicitName ? trimmedName : participantIds.length > 2 ? validUsers.map(u => `${u.firstName} ${u.lastName}`).join(", ") : null,
        }).returning().then(res => res[0]);

        // Insert participants into the junction table
        await db.insert(chatParticipants).values(
            participantIds.map(userId => ({
                chatId: chatInsert.id,
                userId: userId,
            }))
        );

        invalidateParticipantCache(chatInsert.id);

        newChat = {
            id: chatInsert.id,
            isGroup: chatInsert.isGroup,
            name: chatInsert.name ?? undefined,
            participantIds: participantIds,
            lastMessage: undefined,
            readReceipts: undefined
        };

        // notify all OTHER participants about the new chat (creator adds it themselves via response)
        new Promise<void>((res) => {
            for (const participantId of participantIds) {
                if (participantId === locals.user?.id) continue; // skip creator
                if (clients && clients[participantId]) {
                    for (const sessionId in clients[participantId]) {
                         clients[participantId][sessionId]("chat-created", JSON.stringify({ chat: newChat }));
                    }
                }
            }
            res();
        });

        return new Response(JSON.stringify({ chat: newChat }), { status: 201 });
    } catch (e) {
        console.error(`${request.url}: Error creating chat: `, e);
        return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
    }
}

// Archive a chat (soft delete)
export const DELETE: RequestHandler = async ({ request, locals }) => {
    if (!RequiresPermissions(locals, [Permission.message])) {
        return new Response(JSON.stringify({ error: "Insufficient permissions" }), { status: 401 });
    } 

    let formData = await request.formData();
    let chatId = formData.get("chatId") as string;

    if (!chatId) {
        return new Response(JSON.stringify({ error: "Please provide all required fields" }), { status: 400 });
    }

    // Let's get the chat to make sure the user is a participant
    let chatRecord: Chat;
    try {
        chatRecord = await db.query.chats.findFirst({
            where: eq(chats.id, chatId),
            with: {
                participants: {
                    columns: {
                        userId: true,
                    }
                },
                messages: {
                    limit: 1,
                    orderBy: desc(messages.id),
                }
            }
        }).then((res: any) => {
            if (!res) throw new Error("Chat not found");
            res.lastMessage = res.messages?.[0] ?? null;
            return normaliseChatFromDatabase(res);
        });
        if (!chatRecord) {
            return new Response(JSON.stringify({ error: "Chat not found" }), { status: 404 });
        }
    } catch (e: any) {
        if (e?.message === "Chat not found") {
            return new Response(JSON.stringify({ error: "Chat not found" }), { status: 404 });
        }
        console.error(`${request.url}: Error retrieving chat: `, e);
        return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
    }

    // Check if the user is a participant
    if (!chatRecord.participantIds.includes(locals.user!.id)) {
        return new Response(JSON.stringify({ error: "You are not a participant in this chat" }), { status: 403 });
    }

    // Archive the chat
    try {
        await db.update(chats).set({
            archived: true
        }).where(eq(chats.id, chatId));
    } catch (e) {
        console.error(`${request.url}: Error archiving chat: `, e);
        return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
    }

    return new Response(JSON.stringify({ message: "Chat archived successfully" }), { status: 200 });
}