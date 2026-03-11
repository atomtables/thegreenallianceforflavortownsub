import {eq, type InferInsertModel} from 'drizzle-orm';
import {sha256} from '@oslojs/crypto/sha2';
import {encodeBase64url, encodeHexLowerCase} from '@oslojs/encoding';
import {db} from '$lib/server/db';
import * as table from '$lib/server/db/schema.js';
import {hash, verify} from "@node-rs/argon2";
import { isRedirect, redirect } from '@sveltejs/kit';
import type { User } from '$lib/types/types';
import type { RequestEvent } from '../../routes/$types';

const DAY_IN_MS = 1000 * 60 * 60 * 24;

export const sessionCookieName = 'auth-session';

export function generateSessionToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(18));
	return encodeBase64url(bytes);
}

export async function createSession(token: string, userId: string) {
	const sessionId = encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
	const session = {
		id: sessionId,
		userId,
		expiresAt: new Date(Date.now() + DAY_IN_MS * 30)
	};
	await db.insert(table.session).values(session);
	return session;
}

// This really just makes sure that no sensitive data is leaked
// a lot of the time we don't even select all columns, so this just makes sure that's
// never an issue. 
export function cleanUserFromDatabase(user: typeof table.users.$inferSelect): User {
	return {
		id: user.id,
		age: user.age || 0,
		username: user.username,
		passwordHash: null,
		createdAt: user.createdAt instanceof Date ? user.createdAt.getTime() : Number(user.createdAt),
		firstName: user.firstName,
		lastName: user.lastName,
		email: user.email,
		phone: user.phone ?? null,
		address: user.address ?? null,
		avatar: typeof user.avatar === "string" ? user.avatar : user.avatar ? String(user.avatar) : "",
		role: user.role,
		permissions: user.permissions ?? [],
		subteam: user.subteam,
		tosAgreedAt: user.tosAgreedAt instanceof Date ? user.tosAgreedAt.getTime() : user.tosAgreedAt ? Number(user.tosAgreedAt) : null,
	};
}

export async function validateSessionToken(token: string): Promise<{ session: typeof table.session.$inferSelect | null; user: User | null }> {
	const sessionId = encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
	const [result] = await db
		.select({
			// Adjust user table here to tweak returned data
			user: table.users,
			session: table.session
		})
		.from(table.session)
		.innerJoin(table.users, eq(table.session.userId, table.users.id))
		.where(eq(table.session.id, sessionId))
		.limit(1);

	if (!result) {
		return { session: null, user: null };
	}
	const { session, user } = result as { session: typeof table.session.$inferSelect; user: typeof table.users.$inferSelect };

	const sessionExpired = Date.now() >= session.expiresAt.getTime();
	if (sessionExpired) {
		await db.delete(table.session).where(eq(table.session.id, session.id));
		return { session: null, user: null };
	}

	const renewSession = Date.now() >= session.expiresAt.getTime() - DAY_IN_MS * 15;
	if (renewSession) {
		session.expiresAt = new Date(Date.now() + DAY_IN_MS * 30);
		await db
			.update(table.session)
			.set({ expiresAt: session.expiresAt })
			.where(eq(table.session.id, session.id));
	}

	return { session, user: cleanUserFromDatabase(user) };
}

export async function invalidateSession(sessionId: string) {
	await db.delete(table.session).where(eq(table.session.id, sessionId));
}

export function setSessionTokenCookie(event: RequestEvent, token: string, expiresAt: Date) {
	event.cookies.set(sessionCookieName, token, {
		expires: expiresAt,
		path: '/'
	});
}

export function deleteSessionTokenCookie(event: RequestEvent) {
	event.cookies.delete(sessionCookieName, {
		path: '/'
	});
}

function validateUsername(username: string) {
	return (
		typeof username === 'string' &&
		username.length >= 3 &&
		username.length <= 31 &&
		/^[a-z0-9_-]+$/.test(username)
	);
}

function validatePassword(password: string) {
	return (
		typeof password === 'string' &&
		password.length >= 6 &&
		password.length <= 255
	);
}

class ValidationError extends Error {
	public error: string;

	constructor(message: any) {
		super("A validation error occurred");
		this.name = 'ValidationError';
		this.error = message;
	}
}

export let validateLogin = async (formData: FormData) => {
	const username = formData.get('username')?.toString().toLowerCase().trim() ?? "";
	const password = formData.get('password')?.toString() ?? "";

	if (!validateUsername(username)) {
		throw new ValidationError({ error: "username", message: 'Invalid username (min 3, max 31 characters, alphanumeric only)' })
	}
	if (!validatePassword(password)) {
		throw new ValidationError({ error: "password", message: 'Invalid password (min 6, max 255 characters)' })
	}

	let results;
	try {
		results = db
		.select()
		.from(table.users)
		.where(eq(table.users.username, username))
	} catch (e) {
		throw new ValidationError({ error: "authentication", message: 'Incorrect username or password' })
	}

	let existingUser;
	try {
		existingUser = await results.then(takeUniqueOrThrow);
		if (!existingUser) {
			throw new ValidationError({ error: "authentication", message: 'Incorrect username or password' })
		}
	} catch (e) {
		throw new ValidationError({ error: "authentication", message: 'Incorrect username or password' })
	}

	const validPassword = await verify(existingUser.passwordHash, password, {
		memoryCost: 19456,
		timeCost: 2,
		outputLen: 32,
		parallelism: 1,
	});
	if (!validPassword) {
		throw new ValidationError({ error: "authentication", message: 'Incorrect username or password' })
	}

	return existingUser;
}

const normalizeData = (data: any) => {
    return data?.toString().toLowerCase().trim();
}

const validateName = (name: string) => {
	return typeof name === "string" &&
		/^[a-z]+$/.test(name);
}

const validatePhone = (phone: string) => {
	return true //typeof phone === "string" &&
		///^[0-9]{10}$/.test(phone);
}

const validateAge = (age: string) => {
	// age can't be null or zero
	return age && !isNaN(parseInt(age));
}

export const validateRegister = async (formData: FormData) => {
	const username = normalizeData(formData.get("username"));
	const password = formData.get("password")?.toString();
	const confirmation = formData.get("confirmation")?.toString();
	const phone = normalizeData(formData.get("pnumber"));
	const age = normalizeData(formData.get("age"));
	const firstName = normalizeData(formData.get("fname"));
	const lastName = normalizeData(formData.get("lname"));
	const email = normalizeData(formData.get("email"));
	const joinCode = normalizeData(formData.get("jcode")).toUpperCase();

	// address info
	const houseNumber = parseInt(formData.get("addnum")?.toString() ?? "0");
	const addressLine1 = parseInt(formData.get("addline1")?.toString() ?? "0");
	const addressLine2 = parseInt(formData.get("addline2")?.toString() ?? "0");
	const city = parseInt(formData.get("addcity")?.toString() ?? "0");
	const state = parseInt(formData.get("addstate")?.toString() ?? "0");
	const zip = parseInt(formData.get("addzip")?.toString() ?? "0");

	if (joinCode === null || joinCode === "" || joinCode === undefined) {
		redirect(303, "/account/signup")
	}
	if (!validateName(firstName) || !validateName(lastName)) {
		throw new Error("NAME_WRONG");
	}
	if (!validateAge(age)) {
		throw new Error("AGE_WRONG");
	}
	// TODO: doesn't actually ever trigger, but some people use +1 or +61 or have different formatting, so get a phone number formatter
	if (!validatePhone(phone)) {
		throw new Error("PHONE_WRONG");
	}
	if (!validateUsername(username)) {
		throw new Error("USERNAME_WRONG");
	}
	if (password !== confirmation || !validatePassword(password ?? "")) {
		throw new Error("PASSWORD_WRONG");
	}
	const passwordHash = await hash(password!, {
		// recommended minimum parameters
		memoryCost: 19456,
		timeCost: 2,
		outputLen: 32,
		parallelism: 1,
	});
	const id = crypto.randomUUID();
	
	try {
		let [joinCodeData] = await db.select().from(table.joincodes).where(
			eq(table.joincodes.joinCode, joinCode)
		).limit(1);
		if (!joinCodeData) {
			console.error(joinCodeData);
			return redirect(303, "/account/signup")
		}

		await db.insert(table.users).values({
			id: id,
			username,
			passwordHash,
			phone,
			address: null, // TODO: add address support
			age: parseInt(age),
			firstName,
			lastName,
			email,
			subteam: joinCodeData.subteam,
			role: joinCodeData.role,
			permissions: [0, 31]
		} as InferInsertModel<typeof table.users>);
	} catch (e) {
		if (isRedirect(e)) throw e;
		console.error("assume exists:", e)
		throw new Error("EXISTS")
	}
	return id;
}

const takeUniqueOrThrow = (values: any[]) => {
	if (values.length !== 1) throw new Error("Found non unique or inexistent value")
	return values[0]
}
