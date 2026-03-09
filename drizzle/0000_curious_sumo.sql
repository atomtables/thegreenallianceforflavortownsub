CREATE TABLE "announcements" (
	"id" varchar(21) PRIMARY KEY NOT NULL,
	"author" varchar(36) NOT NULL,
	"content" text NOT NULL,
	"directed_to_subteams" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"directed_to_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"edited" boolean DEFAULT false NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"author" varchar(36) NOT NULL,
	"filename" text NOT NULL,
	"filesize" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_participants" (
	"chat_id" varchar(21) NOT NULL,
	"user_id" varchar(36) NOT NULL,
	CONSTRAINT "chat_participants_chat_id_user_id_pk" PRIMARY KEY("chat_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" varchar(21) PRIMARY KEY NOT NULL,
	"is_group" boolean DEFAULT false NOT NULL,
	"name" text,
	"archived" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "joincodes" (
	"joinCode" varchar(10) PRIMARY KEY NOT NULL,
	"role" integer NOT NULL,
	"subteam" text DEFAULT 'All' NOT NULL,
	"firstName" text,
	"lastName" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"used_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "meeting_attendees" (
	"id" serial PRIMARY KEY NOT NULL,
	"meeting_id" varchar(36) NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"status" text
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"user" varchar(36) NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"date_of" timestamp NOT NULL,
	"subteams" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" varchar(21) PRIMARY KEY NOT NULL,
	"author" varchar(36) NOT NULL,
	"content" text NOT NULL,
	"chat_id" varchar(21) NOT NULL,
	"edited" boolean DEFAULT false NOT NULL,
	"edit_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_reactions" (
	"message_id" varchar(21) NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"emoji" varchar(64) NOT NULL,
	CONSTRAINT "message_reactions_message_id_user_id_pk" PRIMARY KEY("message_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "message_read_receipts" (
	"message_id" varchar(21) NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"chat_id" varchar(21) NOT NULL,
	CONSTRAINT "message_read_receipts_user_id_chat_id_pk" PRIMARY KEY("user_id","chat_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subteams" (
	"name" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"age" integer NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"address" jsonb DEFAULT '{}',
	"avatar" text,
	"role" integer NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subteam" text DEFAULT 'All' NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_users_id_fk" FOREIGN KEY ("author") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_author_users_id_fk" FOREIGN KEY ("author") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "joincodes" ADD CONSTRAINT "joincodes_subteam_subteams_name_fk" FOREIGN KEY ("subteam") REFERENCES "public"."subteams"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_user_users_id_fk" FOREIGN KEY ("user") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_users_id_fk" FOREIGN KEY ("author") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_read_receipts" ADD CONSTRAINT "message_read_receipts_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_read_receipts" ADD CONSTRAINT "message_read_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_read_receipts" ADD CONSTRAINT "message_read_receipts_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_subteam_subteams_name_fk" FOREIGN KEY ("subteam") REFERENCES "public"."subteams"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcement_index_author" ON "announcements" USING btree ("author");--> statement-breakpoint
CREATE INDEX "attachment_index" ON "attachments" USING btree ("author");--> statement-breakpoint
CREATE INDEX "chat_participants_user_idx" ON "chat_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "message_index_author" ON "messages" USING btree ("author");--> statement-breakpoint
CREATE INDEX "message_index_chat" ON "messages" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "message_reactions_user_idx" ON "message_reactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "message_reactions_message_idx" ON "message_reactions" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "message_read_receipts_user_idx" ON "message_read_receipts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "message_read_receipts_chat_idx" ON "message_read_receipts" USING btree ("chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "emailUniqueIndex" ON "users" USING btree ("email");