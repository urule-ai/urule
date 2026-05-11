-- Sigstore preparation. The Sigstore signing path stores a `<issuer>:<subject>`
-- identity (often a long workflow URI such as
-- `https://github.com/owner/repo/.github/workflows/release.yml@refs/heads/main`)
-- in the `pubkey` column and a serialized cosign bundle (a JSON document with
-- the cert chain, signature, and Rekor inclusion proof — kilobytes-scale) in
-- the `signature` column. Both far exceed the Ed25519-era varchar limits, so
-- they migrate to unbounded `text`. Existing values keep working unchanged.
ALTER TABLE "packages" ALTER COLUMN "publisher_pubkey" SET DATA TYPE text;
--> statement-breakpoint
ALTER TABLE "package_pubkeys" ALTER COLUMN "pubkey" SET DATA TYPE text;
--> statement-breakpoint
ALTER TABLE "package_versions" ALTER COLUMN "signature" SET DATA TYPE text;
