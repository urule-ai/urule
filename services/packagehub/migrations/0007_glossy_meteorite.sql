-- #33 — collapse any pre-existing duplicate (package_id, external_ref) rows that
-- the old SELECT-then-INSERT race could have minted, so the unique index below
-- cannot fail on legacy data. Keep the earliest row per key (tie-broken by id,
-- which is a ULID — monotonic + unique). NULL external_ref (manual grants) is
-- left untouched.
DELETE FROM "entitlements" a
USING "entitlements" b
WHERE a."external_ref" IS NOT NULL
  AND a."package_id" = b."package_id"
  AND a."external_ref" = b."external_ref"
  AND (a."created_at" > b."created_at"
       OR (a."created_at" = b."created_at" AND a."id" > b."id"));
--> statement-breakpoint
CREATE UNIQUE INDEX "entitlements_package_external_ref_uq" ON "entitlements" USING btree ("package_id","external_ref");
