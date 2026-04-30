CREATE TABLE "packages" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(50) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"author" varchar(255) NOT NULL,
	"repository" varchar(500),
	"homepage" varchar(500),
	"license" varchar(50),
	"verified" boolean DEFAULT false NOT NULL,
	"downloads" integer DEFAULT 0 NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packages_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "package_versions" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"package_id" varchar(26) NOT NULL,
	"version" varchar(50) NOT NULL,
	"manifest" jsonb NOT NULL,
	"readme" text DEFAULT '' NOT NULL,
	"checksum" varchar(128),
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"yanked" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "package_versions" ADD CONSTRAINT "package_versions_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "packages_name_idx" ON "packages" USING btree ("name");--> statement-breakpoint
CREATE INDEX "packages_type_idx" ON "packages" USING btree ("type");--> statement-breakpoint
CREATE INDEX "package_versions_package_id_idx" ON "package_versions" USING btree ("package_id");