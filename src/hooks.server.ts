import type { Handle } from '@sveltejs/kit';
import * as auth from '$lib/server/auth.js';
import "$lib/prototypes/prototypes";
import { Role } from '$lib/types/types';
import { canUserAccess } from './sitemap';
import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';

const handleAuth: Handle = async ({ event, resolve }) => {
	const isApi = event.url.pathname.startsWith('/api');
	const sessionToken = event.cookies.get(auth.sessionCookieName);

	if (!sessionToken) {
		event.locals.user = null;
		event.locals.session = null;
		if (!isApi && !canUserAccess(null, event.url.pathname, event.request.method)) {
			return redirect(302, '/account/signin');
		}
		return resolve(event);
	}

	const { session, user } = await auth.validateSessionToken(sessionToken);

	if (session) {
		auth.setSessionTokenCookie(event as any, sessionToken, session.expiresAt);
	} else {
		auth.deleteSessionTokenCookie(event as any);
	}

	event.locals.user = user;
	// give administrator superuser permissions
	if (user && user.role === Role.administrator) {
		user.permissions = Array.from(Array(33).keys())
	}
	event.locals.session = session;

	if (!isApi && !canUserAccess(event.locals.user, event.url.pathname, event.request.method)) {
		return redirect(302, '/home?nopermission=true');
	}
	return resolve(event);
};

export const handle = handleAuth;
