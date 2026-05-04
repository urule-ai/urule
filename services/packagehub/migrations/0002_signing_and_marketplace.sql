CREATE TABLE "entitlements" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"package_id" varchar(26) NOT NULL,
	"workspace_id" varchar(26),
	"user_id" varchar(255),
	"kind" varchar(20) DEFAULT 'purchase' NOT NULL,
	"external_ref" varchar(255),
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "publisher_pubkey" varchar(64);--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "pubkey_kind" varchar(20) DEFAULT 'ed25519' NOT NULL;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "license_tier" varchar(20) DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "price_cents" integer;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "payment_provider" varchar(20);--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "payment_link" varchar(500);--> statement-breakpoint
ALTER TABLE "package_versions" ADD COLUMN "signature" varchar(256);--> statement-breakpoint
ALTER TABLE "package_versions" ADD COLUMN "signature_kind" varchar(20) DEFAULT 'ed25519' NOT NULL;--> statement-breakpoint
ALTER TABLE "package_versions" ADD COLUMN "signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entitlements_package_id_idx" ON "entitlements" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "entitlements_workspace_id_idx" ON "entitlements" USING btree ("workspace_id","package_id");--> statement-breakpoint
CREATE INDEX "entitlements_user_id_idx" ON "entitlements" USING btree ("user_id","package_id");