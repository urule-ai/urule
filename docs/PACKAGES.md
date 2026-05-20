# Packages: signing + license tiers + rollback

Urule's package system has three concerns this doc covers:

1. **Signing** — proving that the version of `@some/pkg` you're about to install was actually published by the holder of the publisher's private key. Default is unsigned (anonymous); authors opt in by attaching a public key on first publish.
2. **License tiers** — `free` (default), `paid` (one-shot purchase), `subscription` (recurring). Authors opt in. The packages service consults packagehub before install and refuses with HTTP 402 Payment Required if the consumer has no entitlement.
3. **Rollback** — reverting an installation to its immediately-previous version. Built on top of the packages service's in-memory version history; survives upgrades but resets across service restarts (entitled to a follow-up that persists history).

---

## Signing

### Mechanism

Ed25519 keypair per package, set on first publish. All subsequent version publishes for that package must include a signature over the canonical digest of (manifest, readme, version), verifiable against the recorded public key. The verifier ([services/packagehub/src/services/signing.ts](../services/packagehub/src/services/signing.ts)) uses Node's built-in `crypto.verify(null, digest, pubkey, signature)` — no external dependencies.

Why Ed25519 and not GitHub Sigstore / C2PA: see ROADMAP §6.3 — short version is "Node has it built-in, works for CLI publishes from a laptop, no platform lock-in". GitHub Sigstore OIDC is a planned follow-up alongside the Ed25519 floor (the schema's `pubkey_kind` column dispatches to the right verifier).

### Generating a keypair

```bash
node -e "
const c = require('crypto');
const { publicKey, privateKey } = c.generateKeyPairSync('ed25519');
const spki = publicKey.export({ format: 'der', type: 'spki' });
const raw = spki.subarray(spki.length - 32);
console.log('PUBLIC_KEY_BASE64:', raw.toString('base64'));
console.log('PRIVATE_KEY_PEM:');
console.log(privateKey.export({ format: 'pem', type: 'pkcs8' }).toString());
"
```

Save the private key somewhere safe — losing it means you can't publish updates to this package (the floor design has no key rotation; tracked as a follow-up).

### Publishing the package + first version

```bash
# 1. Register the package, attaching the public key. Once set, immutable.
curl -X POST http://localhost:3009/api/v1/packages \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "my-package",
    "type": "personality",
    "author": "you",
    "publisherPubkey": "PUBLIC_KEY_BASE64_FROM_ABOVE",
    "pubkeyKind": "ed25519"
  }'

# 2. Compute the digest + sign it locally:
node -e "
const c = require('crypto');
const manifest = { name: 'my-package', version: '0.1.0', type: 'personality' };
const readme = '# My Package';
const version = '0.1.0';
const json = JSON.stringify(manifest, Object.keys(manifest).sort());
const digest = c.createHash('sha256').update(json).update(readme).update(version).digest();
const privateKey = c.createPrivateKey({ key: process.env.PRIVATE_KEY_PEM, format: 'pem' });
console.log('SIGNATURE_BASE64:', c.sign(null, digest, privateKey).toString('base64'));
"

# 3. Publish the version with the signature:
curl -X POST http://localhost:3009/api/v1/packages/my-package/versions \
  -H 'Content-Type: application/json' \
  -d '{
    "version": "0.1.0",
    "manifest": { "name": "my-package", "version": "0.1.0", "type": "personality" },
    "readme": "# My Package",
    "signature": "SIGNATURE_BASE64_FROM_ABOVE"
  }'
```

Once a package has `publisherPubkey` set, the API rejects unsigned version publishes with HTTP 400 (`SIGNATURE_REQUIRED`) and bad signatures with HTTP 401 (`SIGNATURE_INVALID`). Anonymous (no-pubkey) packages stay unsigned for back-compat.

### Verifying before installing

```bash
curl http://localhost:3009/api/v1/packages/my-package/versions/0.1.0/verify
# { "verified": true, "kind": "ed25519", "publisher": "PUBLIC_KEY_BASE64" }
```

`reason: "unsigned"` for legacy/anonymous packages; `reason: "signature_invalid"` if a stored signature no longer verifies (manifest tampered post-publish).

### Sigstore OIDC (alternate signing path)

For repositories that publish via CI rather than from a developer laptop, `pubkey_kind: 'sigstore-oidc'` lets the publisher prove identity via a transparency-log-witnessed cosign signature instead of a long-lived Ed25519 key. The verifier delegates to [`@sigstore/verify`](https://www.npmjs.com/package/@sigstore/verify) which checks the Fulcio cert chain (TUF-pinned root), the Rekor inclusion proof, and the signature itself, then matches the cert's identity against the registered `<issuer>:<subject>`.

#### Registering a Sigstore-signed package

The "pubkey" in this kind is the expected identity, JSON-encoded:

```bash
curl -X POST http://localhost:3009/api/v1/packages \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "ci-published-pkg",
    "type": "skill",
    "author": "release-bot",
    "publisherPubkey": "{\"issuer\":\"https://token.actions.githubusercontent.com\",\"subject\":\"https://github.com/owner/repo/.github/workflows/release.yml@refs/heads/main\"}",
    "pubkeyKind": "sigstore-oidc"
  }'
```

`subject` is the OIDC SAN — for a GitHub Actions workflow it's the workflow URI; for a personal Google account it's an email. `issuer` is the OIDC issuer URL.

#### Publishing a version with a cosign bundle

In CI, sign the canonical digest (NOT the manifest bytes — same digest function as the Ed25519 path) and capture the `--bundle` output:

```bash
# Compute the canonical digest exactly as packagehub's verifier does:
node -e '
const { createHash } = require("crypto");
const fs = require("fs");
const manifest = JSON.parse(fs.readFileSync("manifest.json","utf8"));
const readme = fs.readFileSync("README.md","utf8");
const version = "0.1.0";
const json = JSON.stringify(manifest, Object.keys(manifest).sort());
process.stdout.write(createHash("sha256").update(json).update(readme).update(version).digest());
' > digest.bin

# Sign with cosign (uses the workflow's OIDC token automatically in GitHub Actions):
cosign sign-blob \
  --bundle ci-pkg-0.1.0.bundle.json \
  --yes \
  digest.bin

# Publish — the `signature` field carries the bundle JSON directly:
curl -X POST http://localhost:3009/api/v1/packages/ci-published-pkg/versions \
  -H 'Content-Type: application/json' \
  -d "$(jq -n \
    --arg sig "$(cat ci-pkg-0.1.0.bundle.json)" \
    --slurpfile manifest manifest.json \
    '{
      version: "0.1.0",
      manifest: $manifest[0],
      readme: $ENV.README,
      signature: $sig
    }')"
```

Verifier output is the same shape as the Ed25519 path:

```bash
curl http://localhost:3009/api/v1/packages/ci-published-pkg/versions/0.1.0/verify
# { "verified": true, "kind": "sigstore-oidc", "publisher": "<the matching identity JSON>" }
```

#### Rotation under sigstore-oidc

The rotation flow ([rotation digest](#canonical-digest) for `add` / `revoke`) works the same way: the publisher generates a fresh cosign bundle over the rotation digest with their existing identity. The verifier walks active keys and accepts when one matches. Loss of the OIDC identity (e.g., GitHub account compromise) is recoverable by registering a new identity via the standard rotation flow as long as one previous identity is still trusted.

#### Optional TUF mirror configuration

`@sigstore/verify` fetches Sigstore's trust root via TUF on first verification. To pin a private mirror (air-gapped deployments) or skip the network refresh:

| Env var | Effect |
|---|---|
| `SIGSTORE_TUF_MIRROR_URL` | Override the default `https://tuf-repo-cdn.sigstore.dev` |
| `SIGSTORE_TUF_CACHE_PATH` | Pin the on-disk cache directory |
| `SIGSTORE_TUF_FORCE_CACHE` | `true` skips refresh entirely (use a pre-warmed cache) |

### Canonical digest

```text
digest = SHA256( JSON.stringify(manifest, sortedKeys) || readme || version )
```

`sortedKeys` is the array of top-level keys sorted lexicographically (passed to `JSON.stringify` as the 2nd argument). Top-level shuffle doesn't change the digest; deeper objects rely on V8's insertion-order property. Same function used by publisher and verifier — see [services/packagehub/src/services/signing.ts](../services/packagehub/src/services/signing.ts). Don't change without coordinating across all in-flight signatures.

---

## License tiers

A package's `licenseTier` is one of `free` (default), `paid`, or `subscription`. Authors set it at publish time. The packages service consults [services/packagehub/src/routes/entitlements.routes.ts](../services/packagehub/src/routes/entitlements.routes.ts) before every install:

- `free` — short-circuits `allowed: true, reason: 'free'`. No table lookup.
- `paid` / `subscription` — looks up the `entitlements` table for an active row matching the consumer (`workspaceId` or `userId`) and the package. If found, `allowed: true`. If not, returns:
  ```json
  {
    "allowed": false,
    "reason": "requires_purchase",
    "licenseTier": "paid",
    "priceCents": 999,
    "paymentProvider": "stripe",
    "paymentLink": "https://example.test/checkout/pkg"
  }
  ```
  The packages service translates this into HTTP 402 Payment Required with the `paymentLink` in the body, and the caller (office-ui) renders a "purchase to install" CTA.

### Publishing a paid package

```bash
curl -X POST http://localhost:3009/api/v1/packages \
  -d '{
    "name": "pro-personality",
    "type": "personality",
    "author": "vendor",
    "licenseTier": "paid",
    "priceCents": 1999,
    "paymentProvider": "stripe",
    "paymentLink": "https://buy.stripe.com/..."
  }'
```

### Granting an entitlement

For testing or as a manual override (e.g. in-house licenses, free trials, refunds-after-purchase):

```bash
# Workspace-scoped grant (covers all members)
curl -X POST http://localhost:3009/api/v1/entitlements \
  -d '{
    "packageName": "pro-personality",
    "workspaceId": "01ABC...",
    "kind": "grant"
  }'

# Subscription with expiry
curl -X POST http://localhost:3009/api/v1/entitlements \
  -d '{
    "packageName": "pro-personality",
    "workspaceId": "01ABC...",
    "kind": "subscription",
    "externalRef": "stripe_sub_abc123",
    "expiresAt": "2027-01-01T00:00:00Z"
  }'
```

Idempotent on `(packageId, externalRef)` — re-posting the same external ref returns the existing row. This is the contract Stripe/Lemonsqueezy webhook receivers will use (planned follow-up).

### Revoking

```bash
curl -X DELETE http://localhost:3009/api/v1/entitlements/<id>
```

For refunds. The next install attempt by that consumer falls back to `requires_purchase`.

### Payment provider integration

Not built yet. The data model is ready: a Stripe `checkout.session.completed` webhook receiver maps the session metadata to `POST /api/v1/entitlements`. Lemonsqueezy is structurally the same. The webhook lives outside this doc — see ROADMAP §6.3 follow-ups.

---

## Rollback

```bash
# After install + upgrade(s), revert to the previous version:
curl -X POST http://localhost:3008/api/v1/packages/<installId>/rollback
```

Returns the new installation row pointing at the previous version. If no prior version exists (fresh install only, never upgraded), returns HTTP 404 with `code: 'NO_HISTORY'`.

The version history is held in-memory by the packages service today and resets across restarts. Persisting history to a Drizzle table is a follow-up. For now: rollback is reliable within a single service lifetime; a restart wipes the stack and returns 404 on the next rollback attempt for any installation.

---

## Open follow-ups (tracked in ROADMAP §6.3)

- **Stripe / Lemonsqueezy webhook receivers** that mint entitlement rows on `checkout.session.completed` / equivalent.
- **Persisted version history** — add an `installation_history` Drizzle table so rollback survives restarts.
- **Key rotation** — the floor design is one-pubkey-per-package, immutable. Rotation requires a "this key supersedes that one" story.
- **CLI tooling** (`urule-cli generate-key`, `urule-cli publish`) wrapping the HTTP API. The bash recipes above work today; a CLI is convenience.
- **Marketplace UI** in office-ui (browse paid packages, click-to-purchase, manage entitlements). §6.5 territory.
- **Ratings + reviews**, **dependency tree visualization**, **auto-update notifications** — existing §6.3 bullets, independent of signing/marketplace.
