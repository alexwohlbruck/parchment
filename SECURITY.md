# Parchment Security Model

This document describes Parchment's security and privacy posture: threat model,
what is (and isn't) encrypted, and what an attacker with various levels of
access can and cannot see. It is intentionally specific — vague marketing
language is worse than no documentation.

Cross-references:

- [docs/crypto/envelope.md](docs/crypto/envelope.md) — byte-level ciphertext format
- [docs/crypto/key-hierarchy.md](docs/crypto/key-hierarchy.md) — every HKDF
  context string and key derivation
- [docs/crypto/federation-protocol.md](docs/crypto/federation-protocol.md) —
  wire format, versioning, safety numbers
- [docs/crypto/federation-trust.md](docs/crypto/federation-trust.md) — what
  each federation actor sees
- [docs/crypto/recovery.md](docs/crypto/recovery.md) — the four recovery tiers

## Inviolable rules

These are the hard constraints every PR is checked against. If code would
violate one of these, it doesn't ship.

1. **Sensitive user location data MUST be encrypted when stored at rest.**
   No cleartext lat/lng, no cleartext history, no cleartext place IDs linked
   to a user, in any table or on disk anywhere server-side.
2. **Sensitive data may transit through the server in memory and over SSL,
   but MUST NEVER be persisted unencrypted.** If data hits disk (DB, cache,
   log, tempfile, backup) it must either be encrypted or not be there at all.
3. **E2EE is the default.** The server deviates only where a feature is
   genuinely infeasible under E2EE (e.g. calling a third-party API on the
   user's behalf from server memory). Each exception is documented below
   with the trust trade-off.

"Sensitive" means: locations, place identifiers tied to a user, trip routes,
search queries, friend handles, device names, display names. It does **not**
include: user email (needed for OTP routing), profile picture URL, federation
public keys, opaque relationship IDs, session tokens.

## Threat model

We design for the following threats, in descending likelihood and impact:

### A. Server-side DB dump / backup leak
An attacker obtains a `pg_dump`, logical replica, or raw disk image of the
Parchment database but **not** the server's running process memory.

- What they see: email addresses, picture URLs, public keys, opaque
  relationship IDs, session tokens, encrypted blobs, encrypted metadata,
  federation nonces, pinned peer-server keys, friend-invitation rows
  (references by handle), aggregate segment-stat counts.
- What they do NOT see: locations, search history, friend display names,
  device names, saved place details, third-party API credentials, seeds,
  collection/canvas metadata.
- Gates: AES-256-GCM envelopes under per-user / per-record keys; integration
  credentials under the server's master encryption key (separate env var,
  not in the DB); user metadata (first/last name) under the user's personal
  key derived from their seed, which the server never holds.

### B. Single-server compromise
An attacker gets RCE on the Parchment server (process memory access, can
read env, can intercept live traffic in-flight).

- What they see: plaintexts of integration credentials during active calls
  (decrypted into RAM at fetch time), federation messages decrypted during
  S2S verification but not decrypted user data — user-E2EE'd content stays
  opaque because the server has no user seeds.
- Gates preventing total loss: user master keys (K_m / seed) never leave the
  client; wrapped-K_m slots are encrypted under passkey-PRF outputs the
  server cannot reproduce. The integration master encryption key itself is
  a plain env var in the default config; operators who want hardware- or
  service-isolated key storage can unseal it from a hosted key service
  (AWS KMS, GCP KMS, HashiCorp Vault, etc.) before startup — the code
  treats the env var as opaque 32 bytes regardless of origin. No cloud
  dependency is required.

### C. Hostile peer federation server
An attacker runs `evil.example.com` and Alice on `parchment.example.com`
adds Bob (who claims to be on `evil.example.com`) as a friend.

- What the evil peer can attempt: inject a fake public key for "bob" via
  its `.well-known/user/bob`; MITM S2S requests; replay old messages.
- Gates: Parchment pins peer server identity keys on first contact
  (`federated_server_keys`); every federation message is S2S-signed under
  the sender's pinned server key AND client-signed under the user's
  Ed25519 identity; 5-minute timestamp skew window plus per-sender nonce
  cache reject replays; a changed peer pubkey hard-rejects until a manual
  re-pin; clients maintain their own friend-key pins and surface a safety-
  number flow for out-of-band verification.
- See [docs/crypto/federation-trust.md](docs/crypto/federation-trust.md)
  for the per-actor capability matrix.

### D. Lost or stolen device
An attacker gains physical access to an unlocked Parchment device.

- What they see: everything that device would show its owner. Seed is
  accessible because the device is already authenticated.
- Gates: on desktop Tauri, the seed is stored in the OS keychain (Apple
  Keychain / Windows Credential Manager / libsecret) — protected by the
  OS login, hardware-backed on modern Macs. Lock-screen bypass remains the
  only gate for that window.
- Recovery: the legitimate user rotates their keys (K_m rotation, Part C.7)
  and removes the passkey slot for that device; see
  [docs/crypto/recovery.md](docs/crypto/recovery.md).

### E. Nation-state passive traffic observer
An adversary watches network traffic between Parchment clients and the
server, and between federation peers.

- What they see: TLS metadata (host, size, timing) — we use standard HTTPS.
- What they do NOT see: ciphertexts inside TLS — they're already opaque to
  the server; payload contents inside TLS are the concern of specific
  features, not the wire.
- Caveat: the aggregate-segment-stats endpoint (Part C.5d) is unauthenticated
  but transits TLS. See §aggregates below for its specific posture.

## What's encrypted, at what scope

| Data | Storage shape | Key | Scope |
|------|---------------|-----|-------|
| User identity seed (32B) | OS keychain (desktop) or localStorage (browser/mobile) | — | Client only |
| User first/last name | `users.first_name_encrypted`, `users.last_name_encrypted` | Metadata key = HKDF(seed, `parchment-metadata-v1`) | User-E2EE |
| Live friend location | `encrypted_locations.encrypted_location` (ECIES v2 blob) | Ephemeral X25519 → HKDF(`parchment-ecies-v1`) | Per-message forward-secret, sender-signed |
| Collection metadata | `collections.metadata_encrypted` (v2 envelope) | HKDF(seed, `parchment-collection-<id>`) | User-E2EE per collection |
| Canvas metadata | `canvases.metadata_encrypted` (v2 envelope) | HKDF(seed, `canvas:<id>`) | User-E2EE per canvas |
| Search history (blob) | `encrypted_user_blobs` (type `search-history`) | Personal key = HKDF(seed, `parchment-personal-v1`) | User-E2EE |
| Friend-key pins (blob) | `encrypted_user_blobs` (type `friend-pins`) | Personal key | User-E2EE |
| Third-party integration creds | `integrations.config_ciphertext` (AES-GCM) | Server master key from `PARCHMENT_INTEGRATION_ENCRYPTION_KEY` | Server-held (see §integrations) |
| Passkey-PRF wrapped K_m | `wrapped_master_keys.wrapped_km` + signed slot | AES under HKDF(PRF output, `parchment-prf-wrap-v1`) | Bound to a specific passkey |
| Device-transfer sealed seed | `device_transfer_sessions.sealed_seed` (≤60s TTL) | ECIES between receiver/sender ephemeral X25519s | One-shot, sender-signed |

### What's NOT encrypted (deliberately)

- **Email**: we need cleartext email to route OTP sign-in.
- **Federation alias** (`users.alias`): routing identifier. Derivable from the
  handle in any case.
- **Federation public keys**: by definition public.
- **Profile picture URL**: if the user sets one, they've chosen to point to
  a public URL.
- **Session tokens** (`sessions.id`): opaque server-issued values; session
  compromise is bounded by TTL and standard CSRF defenses.
- **Opaque relationship IDs**: internal keys with no semantic content.
- **Friend invitation rows** (`friend_invitations`): the (fromHandle,
  toHandle) pair is visible to both home servers — this is a necessary
  consequence of how federation routing works.
- **Aggregate segment stats**: designed to be non-attributable; see §aggregates.

## Feature-by-feature detail

### Live location sharing (feature 1a)
ECIES: sender generates a per-message ephemeral X25519 keypair, computes
`ECDH(eph_priv, friend_long_term_pub)`, derives an AES-GCM key via HKDF,
encrypts the location, signs `ephemeral_pub || envelope` with the sender's
long-term Ed25519 identity key, and discards the ephemeral private.

- AAD binds sender handle, recipient handle, `relationshipId = sort(pair)`,
  and the `sentAt` RFC 3339 timestamp.
- Server sees ciphertext only. One row per `(userId, forFriendHandle)`,
  overwritten per broadcast. No history.
- See `web/src/lib/federation-crypto.ts` `encryptForFriendV2` /
  `decryptForFriendV2`.

Forward secrecy trade-off: compromise of the RECEIVER's long-term
encryption key retroactively allows an attacker who captured the wire to
decrypt past messages. This is NOT Double Ratchet and we state that
explicitly — the per-message ephemeral + signed handshake is the right
level for 60-second broadcast cadence; Double Ratchet's complexity is not
warranted.

### 3rd-party trackers (feature 1b) and timeline ingestion (feature 4) — bridge mode
Credentials for third-party APIs (Tile, car trackers, Dawarich, etc.)
need to be usable by a scheduled server-side worker. That requires the
server to hold decryption-capable key material, which is the opposite of
E2EE. We accept this trade-off for these specific features and:

- Store credentials encrypted at rest under the server's master encryption
  key (`PARCHMENT_INTEGRATION_ENCRYPTION_KEY`, AES-256-GCM, separate from
  the database, loaded from env at boot). This is a plain 32-byte value —
  no cloud service required. Operators on AWS/GCP/Vault can substitute an
  envelope-decrypt at boot; the rest of the code is indifferent.
- Decrypt only in-process at fetch time. Do not cache cleartext on disk.
- Do not persist tracker locations server-side — relay in memory to the
  connected client over the existing WebSocket/SSE path.
- Never log config contents or cleartext credentials.

Rule-3 exception justification: a scheduled fetch can't run while the
user's device is offline; E2EE'ing the server-held credential would
require the user to be present at each fetch, defeating the purpose.

Direct mode (feature 4, non-bridge): where a 3rd-party supports CORS +
bearer auth, the user can opt for direct client→API calls with the
credential held locally (encrypted under the personal key, synced via the
personal-blob channel). Implementation lives behind a per-integration
toggle surfaced in the UI. See `docs/crypto/direct-integration.md`
(pending follow-up).

### Search history (feature 2)
Client maintains the full history in memory; after each new entry, a
debounced flush encrypts the whole list and PUTs it to
`/users/me/blobs/search-history`. Server stores an opaque envelope.

- FIFO capped at 10k entries so the blob stays bounded.
- Dedupe against the last entry.
- No server-side query path; typeahead runs locally against the decrypted
  in-memory list.
- See `web/src/lib/search-history.ts`.

### Frequently visited places / automatic favorites (feature 3)
Deferred. When built, will use an on-device encrypted index over
ephemeral live-location observations; nothing about the detection leaves
the device.

### Saved places + collections (feature 5)
Every collection's metadata (name, description, icon, etc.) is encrypted
under a collection-specific key derived from the user's seed + collection
id via HKDF. The storage transition leaves the old cleartext columns in
place temporarily until all UI reads switch to the encrypted envelope —
tracked as a follow-up PR.

Sensitive-points (the items themselves) flow through the existing
`encrypted_points` table for sensitive-mode collections today. The plan
is to unify all collections onto this path; the schema step landed in
Part C.5c, the UI migration is next.

### Custom maps / canvases (feature 6)
New table `canvases` with fully encrypted metadata from day 1. Canvas
AES key is derived from seed + `canvas:<id>` context — different from
collections even for identical ids.

Multi-user collab (future): the canvas key will be sealed to each
collaborator's X25519 long-term pub using the same ECIES pattern as
friend shares. Revocation rotates the canvas key and re-seals to
remaining collaborators. Tombstones of old sealed copies are kept for
audit but cannot be re-opened.

Yjs/CRDT integration: reserved field `canvases.future_crdt_format_version`
anticipates this; no code yet.

### Navigational trip data + aggregates (feature 7) {#aggregates}
**Active trips** stay client-local: state lives in RAM (and in encrypted
local scratch on desktop) for the duration of the trip, then is discarded
unless the user explicitly saves it into a collection (→ feature 5 path,
user-E2EE).

**Opt-in aggregate contribution** is off by default. When enabled, after
a trip the client computes coarse buckets per segment — `(segmentId,
speedBucket_10kmh, hourOfWeek_0to167)` — dedupes, shuffles, and posts
anonymously to `/segment-stats/contribute`. The server increments
running counts in `segment_stats`; individual contributions are never
stored.

Ops posture:
- The contribute endpoint is **unauthenticated** by design; sending a
  session cookie would attribute the contribution to a user.
- Request-level logging on this route must be disabled in deployment.
  The standard request logger currently logs all routes; setting up a
  selective-skip filter is a deploy-time task. See `server/src/middleware/
  logger.middleware.ts`.
- A zero-log relay / onion ingress in front of this endpoint is an
  operational hardening that should land before the feature is exposed to
  real users. Tracked as a follow-up.
- Differential-privacy noise on published aggregates is a hook for later
  — not added to the MVP ingest path. When public APIs expose segment
  stats, Laplace noise should be applied at read time.

## Server-side key material (operator guide)

Parchment has exactly two server-side keys, both plain 32-byte values
injected as environment variables:

| Env var | What it protects | Required in prod |
|---------|------------------|------------------|
| `SERVER_IDENTITY_PRIVATE_KEY` | Ed25519 seed for this server's federation identity (signs S2S requests, published pubkey at `.well-known/parchment-server`) | Yes |
| `PARCHMENT_INTEGRATION_ENCRYPTION_KEY` | AES-256 master key for third-party integration credentials at rest | Yes |

Generate two **independent** values — one per env var:

```bash
openssl rand -base64 32  # → SERVER_IDENTITY_PRIVATE_KEY
openssl rand -base64 32  # → PARCHMENT_INTEGRATION_ENCRYPTION_KEY
```

**They must NOT share the same bytes.** One is an Ed25519 signing seed
whose public half is published at `.well-known/parchment-server`; the
other is an AES-256 key for symmetric encryption of server-held secrets.
Reusing key material across signing and encryption primitives is a
classic cryptographic anti-pattern and defeats rotation independence
(you might want to rotate one without breaking every peer's pin of the
other).

**No cloud or key-management service is required.** The code holds these
as 32-byte buffers in process memory; where you get the 32 bytes from is
an operational choice:

- **Simplest:** plain env var injection from your process supervisor /
  docker-compose / systemd unit. Works fine.
- **Hardened (optional):** unseal from a hosted service — AWS KMS,
  GCP KMS, HashiCorp Vault, 1Password, Bitwarden, whatever you already
  run — as part of startup, and inject the decrypted value as the env
  var. The code is indifferent to the source.

**The server refuses to start if either env var is unset** — in every
environment, not just production. An ephemeral key silently lost at
restart is worse than a hard boot failure, so we fail loud. The error
message points at this file and includes the `openssl rand -base64 32`
command. Set both values once, commit to `.env` (locally) or your
secrets manager (in prod), and the server starts clean.

**If you run the server in Docker**, setting the values in your local
`.env` isn't enough on its own — the compose file explicitly lists which
env vars to forward into the container. The dev / prod compose files in
this repo already include `SERVER_IDENTITY_PRIVATE_KEY` and
`PARCHMENT_INTEGRATION_ENCRYPTION_KEY` in their `environment:` blocks,
so values in your `.env` at the repo root will be picked up by compose
substitution (`${VAR_NAME}`) and passed through. If you fork or customize
the compose file, make sure both vars stay in the forwarded list.

Neither key should ever be committed, logged, or transmitted. Rotation
for `PARCHMENT_INTEGRATION_ENCRYPTION_KEY` is via the `config_key_version`
column — deploy a new key, a background worker re-encrypts rows and bumps
versions (worker not yet shipped; primitives in place). Rotation for
`SERVER_IDENTITY_PRIVATE_KEY` breaks pinning on all peers until re-pin
out of band — do it only when you mean it.

## K_m rotation (Part C.7)

The user's master key (seed) can be rotated for any of:
- A passkey slot is removed (invalidate anything that slot might have seen).
- User-requested "rotate keys" in settings.
- Compromise-response playbook.

Rotation is client-orchestrated:
1. Client decrypts all its user-encrypted data under the old seed.
2. Client generates a new seed.
3. Client re-encrypts all data under the new seed, tagging each record
   with the new `kmVersion`.
4. Client re-seals every `wrapped_master_keys` slot under the new seed.
5. Client calls `POST /users/me/km-version/advance` with the expected
   current version. Server advances iff CAS matches, otherwise rejects
   (another device rotated first).

While rotation is in flight, devices may see a mix of old and new
`kmVersion` rows. Readers must handle both. The server's `users.km_version`
column is the authoritative "current" version.

Full batch re-encrypt worker is not yet implemented; the primitives
(`km-rotation.service.ts`) are shipped.

## Recovery

Four tiers, in order of fallback:
1. **OS keychain** on desktop Tauri (primary). See Part C.2.
2. **Passkey-PRF wrapped K_m slots** — any registered passkey can unwrap
   the seed on a new device. See Part C.6.
3. **Device-to-device transfer** — existing-device-assisted pairing with
   SAS + biometric + signed handshake, via the `/device-transfer/*`
   endpoints. See Part C.8.
4. **Typed base64 recovery key** (last resort) — the user prints or
   password-manager-saves the 32-byte seed as base64. Lose this and the
   account's encrypted data is unrecoverable.

See [docs/crypto/recovery.md](docs/crypto/recovery.md) for flow details.

## Known deferred items (tracked)

Each of these is real work, broken out for visibility rather than hidden:

- Wiring the search-history UI into the search input. Crypto + sync
  exists; UI hook-up is a follow-up.
- Full collections UI migration to read the encrypted metadata envelope
  and drop the legacy cleartext columns.
- Multi-user canvas collaboration (key sharing + revocation ceremony).
- Yjs document-level encryption for real-time canvas collab.
- Device-name + type encryption (`user_device.device_name`, `.device_type`).
- Location-sharing-config opaque `relationship_id` refactor (Part C.4 item).
- Direct-mode integration path (feature 4 non-bridge) — the personal-blob
  channel is shipped; the per-integration UI toggle is not.
- Full K_m rotation batch-re-encrypt worker.
- UI for passkey-PRF slot management (enroll / remove / list).
- UI for device-to-device transfer (QR display + scan).
- Zero-log relay in front of `/segment-stats/contribute`.
- Selective request-log filter that skips `/segment-stats/contribute`.
- Key-transparency anchor — `.well-known/parchment-server` reserves the
  `key_transparency_anchor` field; CONIKS / Key Transparency log
  integration is out of scope for now.

## Reporting a vulnerability

Parchment is still an unreleased project. Until we have a published
security contact, please open an issue on GitHub tagged `security` or
reach the maintainers directly.
