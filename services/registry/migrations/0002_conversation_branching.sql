ALTER TABLE "conversations" ADD COLUMN "parent_conversation_id" varchar(26);--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "branched_from_message_id" varchar(26);--> statement-breakpoint
CREATE INDEX "conversations_parent_idx" ON "conversations" USING btree ("parent_conversation_id");