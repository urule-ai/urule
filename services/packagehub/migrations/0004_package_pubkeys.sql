CREATE TABLE "package_pubkeys" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"package_id" varchar(26) NOT NULL,
	"pubkey" varchar(64) NOT NULL,
	"pubkey_kind" varchar(20) DEFAULT 'ed25519' NOT NULL,
	"status" varchar(12) DEFAULT 'active' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "package_pubkeys" ADD CONSTRAINT "package_pubkeys_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "package_pubkeys_package_idx" ON "package_pubkeys" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "package_pubkeys_package_active_idx" ON "package_pubkeys" USING btree ("package_id","status");--> statement-breakpoint
-- Backfill: every existing package with a publisher_pubkey gets an active row in
-- package_pubkeys so the verifier (which now walks this table) keeps working.
-- ULID prefix kept short + monotonic-ish for readability; ts is now() because the
-- exact added_at is unknown for legacy rows.
INSERT INTO "package_pubkeys" ("id", "package_id", "pubkey", "pubkey_kind", "status", "added_at")
SELECT
  '01' || substring(md5(p.id || p.publisher_pubkey) from 1 for 24) AS id,
  p.id,
  p.publisher_pubkey,
  COALESCE(p.pubkey_kind, 'ed25519'),
  'active',
  COALESCE(p.created_at, now())
FROM "packages" p
WHERE p.publisher_pubkey IS NOT NULL;