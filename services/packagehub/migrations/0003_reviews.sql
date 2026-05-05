CREATE TABLE "package_reviews" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"package_id" varchar(26) NOT NULL,
	"reviewer_id" varchar(255) NOT NULL,
	"rating" integer NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"version" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "package_reviews_pkg_reviewer_unique" UNIQUE("package_id","reviewer_id")
);
--> statement-breakpoint
ALTER TABLE "package_reviews" ADD CONSTRAINT "package_reviews_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "package_reviews_package_id_idx" ON "package_reviews" USING btree ("package_id");