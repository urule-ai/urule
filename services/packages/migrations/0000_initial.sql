CREATE TABLE "installations" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"package_name" varchar(255) NOT NULL,
	"version" varchar(50) DEFAULT '' NOT NULL,
	"type" varchar(30) DEFAULT 'unknown' NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "version_history" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"installation_id" varchar(26) NOT NULL,
	"version" varchar(50) NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "version_history" ADD CONSTRAINT "version_history_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "installations_workspace_idx" ON "installations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "installations_workspace_pkg_idx" ON "installations" USING btree ("workspace_id","package_name");--> statement-breakpoint
CREATE INDEX "version_history_installation_idx" ON "version_history" USING btree ("installation_id");