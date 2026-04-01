import {redirect} from "@sveltejs/kit";
import { TOS_LAST_UPDATED } from "$lib/server/admin/tos";

export const load = ({ locals, url }: any) => {
    if (!locals.user) redirect(302, "/account/signin")

    // Check if user needs to agree to TOS (skip if already on TOS page)
    if (url.pathname !== "/tos") {
        const tosAgreedAt = locals.user.tosAgreedAt;
        if (!tosAgreedAt || new Date(tosAgreedAt) < TOS_LAST_UPDATED) {
            redirect(302, "/tos");
        }
    }
}