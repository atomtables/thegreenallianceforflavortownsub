import { sql } from 'drizzle-orm';
import { integer, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { type Address, type Permission, Role } from '$lib/types/types';
import * as crypto from 'node:crypto';
import { json } from './common';

export const subteams = pgTable('subteams', {
    name: text('name').primaryKey(),
});

export const users = pgTable('users', {
    id: varchar('id', { length: 36 }).primaryKey().$default(() => crypto.randomUUID()),
    age: integer('age').notNull(),
    username: text('username').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),

    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    address: json<Address>('address'),

    avatar: text('avatar'),
    role: integer('role').$type<Role>().notNull(),
    permissions: json<Permission[]>('permissions').notNull().default(sql`'[]'::jsonb`),
    subteam: text('subteam').notNull().references(() => subteams.name).default('All'),
    tosAgreedAt: timestamp('tos_agreed_at', { mode: 'date' }),
}, (table) => [
    uniqueIndex('emailUniqueIndex').on(table.email),
]);

export const joincodes = pgTable('joincodes', {
    joinCode: varchar('joinCode', { length: 10 }).primaryKey(),
    role: integer('role').notNull().$type<Role>(),
    subteam: text('subteam').notNull().references(() => subteams.name).default('All'),
    firstName: text('firstName'),
    lastName: text('lastName'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    usedAt: timestamp('used_at', { mode: 'date' }),
});
