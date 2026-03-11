CREATE TABLE "message_reports" (
	"id" varchar(21) PRIMARY KEY NOT NULL,
	"message_id" varchar(21) NOT NULL,
	"message_author_id" varchar(36) NOT NULL,
	"reporter_id" varchar(36),
	"reason" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reported_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"resolved_by" varchar(36),
	"source" text DEFAULT 'user' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tos_agreed_at" timestamp;--> statement-breakpoint
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_message_author_id_users_id_fk" FOREIGN KEY ("message_author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_reports_message_idx" ON "message_reports" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "message_reports_author_idx" ON "message_reports" USING btree ("message_author_id");--> statement-breakpoint
CREATE INDEX "message_reports_reporter_idx" ON "message_reports" USING btree ("reporter_id");