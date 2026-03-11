// These types are interchangeable with the database schema types in src/lib/server/db/schema

import * as table from "$lib/server/db/schema";

export interface Announcement {
    id: string;
    author: string;
    content: string;
    directedToSubteams?: string[];
    directedToRoles?: string[];
    attachments?: string[];
    edited?: boolean;
    deleted?: boolean;
}

export interface Message {
    // Snowflake ID (so includes timestamp)
    id: string;
    // Sender ID (links to user + indexed)
    author: string;
    // content
    content: string;
    // chat id that this message was sent in
    chatId: string;
    // was message edited?
    edited?: boolean;
    // previous message history (in case message was edited) (only for admins)
    editHistory?: {content: string, editedAt: string}[];
    // was message deleted?
    deleted?: boolean;
    // attachments (array of attachment IDs)
    attachments?: string[];
    // reactions (map of userId to emoji)
    reactions: {[userId: string]: string};
}

export interface Chat {
    id: string;
    // is this a group chat?
    isGroup: boolean;
    // chat name (for group chats)
    name?: string;
    archived?: boolean;
    participantIds: string[];
    // last message in the chat (if any)
    lastMessage?: Message;
    readReceipts?: {
        messageId: string | null;
        count: number;
    };
}

export function normaliseChatFromDatabase(res: {
    id: string;
    isGroup: boolean;
    name: string | null;
    archived: boolean;
    participants: { userId: string }[];
    lastMessage: typeof table.messages.$inferSelect | Message | null;
    readReceipts: typeof table.messagesReadReceipts.$inferSelect[];
    readCount: number;
}): Chat {
    const participantIds = res.participants.map(p => p.userId);
    const chatData: Chat = {
        id: res.id,
        isGroup: res.isGroup,
        name: res.name ?? undefined,
        archived: res.archived,
        participantIds: participantIds,
        lastMessage: res.lastMessage ? normaliseMessageFromDatabase(res.lastMessage as any) : undefined,
        readReceipts: {
            messageId: res.readReceipts?.[0]?.messageId || null,
            count: res.readCount || 0,
        },
    };
    return chatData;
}

export function normaliseMessageFromDatabase(res: typeof table.messages.$inferSelect & { reactions?: (typeof table.messagesReactions.$inferSelect)[] }): Message {
    const messageData: Message = {
        id: res.id,
        author: res.author,
        content: res.content,
        chatId: res.chatId,
        edited: res.edited,
        attachments: res.attachments,
        reactions: res.reactions?.reduce?.((acc, reaction) => {
            acc[reaction.userId] = reaction.emoji;
            return acc;
        }, {} as {[userId: string]: string}) || {},
    };
    return messageData;
}