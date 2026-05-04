CREATE TABLE "agent_memories" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"agent_id" varchar(26) NOT NULL,
	"content" text NOT NULL,
	"kind" varchar(50) DEFAULT 'note' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_memories_agent_id_idx" ON "agent_memories" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "messages_sender_id_idx" ON "messages" USING btree ("sender_id","sender_type");