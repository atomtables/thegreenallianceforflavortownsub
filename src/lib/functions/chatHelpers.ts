import { snowflakeToDate } from "./Snowflake.js";
import type { Message } from "$lib/types/messages";

export const toTitleCase = (str: string): string =>
    str
        .toLowerCase()
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");

export const isTailMessage = (messagesForChat: Message[], index: number): boolean => {
    if (index === messagesForChat.length - 1) return true;
    const current = messagesForChat[index];
    const next = messagesForChat[index + 1];
    if (!next) return true;
    if (next.author !== current.author) return true;

    const currentTs = snowflakeToDate(current.id);
    const nextTs = snowflakeToDate(next.id);
    if (!currentTs || !nextTs) return next.author !== current.author;

    const diffMs = nextTs.getTime() - currentTs.getTime();
    const sixtyMinutes = 60 * 60 * 1000;
    return diffMs > sixtyMinutes;
};

export const formatDayLabel = (date: Date): string => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    const isSameDay = (a: Date, b: Date) =>
        a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

    if (isSameDay(date, now)) return "Today";
    if (isSameDay(date, yesterday)) return "Yesterday";

    return date.toLocaleDateString([], {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
    });
};

export const formatDate = (date: Date): string => {
    const now = new Date();
    const isSameDay =
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate();

    if (isSameDay) {
        return date.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    return date.toLocaleString([], {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
};
