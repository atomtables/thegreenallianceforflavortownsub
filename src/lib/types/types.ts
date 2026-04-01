
export type Address = {
    streetLine1: string,
    streetLine2?: string,
    city: string,
    state: string,
    zip: string,
    country_code: string,
}

export enum Role {
    member, 		// normal person
    lead, 			// team lead
    captain,
    mentor, 		// trusted adult
    coach, 			// team manager (purchaser or etc)
    administrator,	// IT personnel 🫡
}

// legitimately not that deep worst case we can mod this later without affecting any migrations
export enum Permission {
    exist, // not be banned from looking at anything
    interact, // not be banned from touching anything
    announcement_react,
    announcement_reply,
    announcement_post,
    announcement_delete,
    announcement_moderate, // edit other people's announcements
    announcement_notify, // have people get emailed or texted through announcements ($$)
    message, // only trusted adult
    message_leads, // team lead
    message_anyone, // anyone on the team
    message_moderate, // see all chats
    attendance, // mark attendance for one day
    attendance_postpast, // mark attendance for days before
    attendance_modify, // mark attendance for others
    attendance_moderate, // remove attendance for others
    inventory, // see inventory
    inventory_changestatus, // change the location/status of certain items
    inventory_moderate, // change inventory
    calendar, // see calendar
    calendar_moderate, // add/remove dates to calendar
    calendar_notify, // add notifications to dates on a calendar ($$),
    finance, // see finances
    finance_request, // add a request to purchase item
    finance_moderate, // add or remove purchased items from receipt
    email, // see emails sent from email portal
    email_send, // send emails from email portal
    email_moderate, // modify existing email threads
    resources, // see team resources given
    resources_moderate, // modify team resources given
    users, // see existing users
    users_modify, // modify existing users
    users_moderate, // see all activity performed by users
}

export type User = {
    id: string,
    age: number,
    username: string,
    passwordHash: null,
    createdAt: number,

    firstName: string,
    lastName: string,
    email: string,
    phone: any,
    address: any,

    avatar: string,
    role: Role,
    permissions: Permission[],
    subteam: string,
    tosAgreedAt: number | null,
}