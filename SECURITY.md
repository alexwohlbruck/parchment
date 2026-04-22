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
- [docs/crypto/completion-plan.md](docs/crypto/completion-plan.md) —
  remaining UI + orchestration work needed for a fully usable E2EE
  product (primitives are shipped; UI is mostly what's left)

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
search queries, friend handles, device names. It does **not** include: user
email (needed for OTP routing), display names (shown to friends + peers on
purpose), profile picture URL, federation public keys, opaque relationship
IDs, session tokens.

## Crypto primitives in plain English

For anyone reading this who doesn't come from a crypto background, here
is what each building block actually does. Detail lives in the linked
`docs/crypto/*` pages; this table is a pointer.

| Primitive | What it actually does |
|---|---|
| **v2 ciphertext envelope + AAD** | A standard "encrypted package" format with a version stamp (so we can upgrade later without breaking old data), a fresh random value each time (same plaintext produces different ciphertext), and a label the encryption is bound to. If anyone flips a bit in the ciphertext OR messes with the label, decryption refuses to open the package. |
| **Tauri OS-keychain seed storage** | Your master recovery key gets stored in your OS's native password vault — Apple Keychain, Windows Credential Manager, Linux libsecret — instead of a plain file. Hardware-protected on modern Macs. |
| **ECIES forward-secret friend shares** | For each message sent to a friend, generate a brand-new throwaway key, use it once, then destroy it. If your long-term key leaks later, messages you sent before the leak stay secret. |
| **Metadata encryption key + wrapper** | A separate key — derived from your master seed — available for encrypting any user-owned metadata that we decide is sensitive enough to protect (e.g. device names when that ships). Domain-separated so a bug in one system can't accidentally decrypt data from another. |
| **Personal-blob sync channel** | Generic "here's a client-encrypted blob, hold onto it for me" service. The server stores opaque bytes with no idea what's inside. Used for search history, will be used for friend pins and direct-integration creds. |
| **Per-collection / per-canvas keys** | Each collection and canvas gets its own unique key. A compromised key for one folder doesn't expose others. Cheap — single HKDF call each. Makes future per-collection sharing / revocation possible. |
| **Passkey-PRF wrapped K_m** | A passkey can secretly derive a value that's reproducible only with that exact passkey. We use that value to encrypt your master key, store the encrypted copy on the server. New device + passkey = can recover master key. Signed so a hacked server can't slip you a fake wrapped key. |
| **Device-to-device transfer** | New phone shows a QR code, old phone scans it, both derive a 6-digit code from the handshake. You check the codes match on both screens (human proof). Old phone asks for biometric, hands over the master key via a one-shot server relay that self-destructs after 60s. |
| **Server-side master encryption key** | One AES key held in the server's memory (from env var). Third-party API keys the server needs to call on schedule (e.g. Mapbox) are encrypted under this key before hitting disk. Database dump = useless ciphertext. |
| **Federation: server identity, S2S signing, TOFU pinning, replay protection** | Every message between Parchment servers is signed. Servers pin each other's identity keys on first contact. Unexpected key changes = hard reject. Duplicate messages within 5 minutes = rejected. |
| **Client-side friend-key pins + 12-digit safety numbers** | Your device remembers each friend's actual keys. If a hostile server tries to swap in a fake key, your device catches it. The 12-digit safety number is a human-checkable fingerprint — read it to your friend over the phone; match = verified. |
| **K_m version counter + CAS rotation** | When you rotate your master key, every record is tagged with the version that encrypted it. Compare-and-swap stops two devices from rotating at once and corrupting each other. |

## Recovery-key storage by platform

The master seed is the most important secret in the system. Where it
lives depends on where you are:

| Platform | Backing store | Security |
|----------|---------------|----------|
| Desktop Tauri (macOS / Windows / Linux) | Native OS keychain (Apple Keychain, Credential Manager, libsecret) via the `keyring` crate | ✓ Protected by OS login; hardware-backed on modern Macs |
| Browser / regular web | `localStorage`, wrapped under a server-held device secret | ✓ Ciphertext at rest; passive filesystem read yields no usable seed. Server-side revocation via sign-out-all. XSS still a concern (see below). |
| Tauri on iOS / Android | Webview `localStorage`, same wrap as browser | ✓ Same ciphertext-at-rest protection. Future native Keystore/Keychain plugin (tracked in Reserved below) would add biometric gating on top. |

**How the wrap works** (shipped — see `web/src/lib/key-storage.ts`,
`server/src/services/device-wrap-secrets.service.ts`):

- On first use, the client generates a random `deviceId` (UUID, stored
  alongside the seed in `localStorage` — not sensitive) and GETs
  `/users/me/devices/:deviceId/wrap-secret`. The server lazily creates a
  32-byte random secret keyed by `(userId, deviceId)` and returns it.
- The client derives a wrap key via
  `HKDF-SHA256(secret, "parchment-seed-wrap-v1") → 32B` and uses it to
  encrypt the seed as a v2 AEAD envelope with AAD
  `{userId: deviceId, recordType: "seed-wrap", recordId: "local",
  keyContext: "parchment-seed-wrap-v1"}`.
- The wrap key is cached in memory for the session but never persisted.
  The raw server secret is discarded after deriving.
- Cold-open cost: one authenticated GET + one AES-GCM decrypt —
  effectively instant.
- "Sign out of all devices" (`DELETE /auth/sessions/all`) deletes every
  session row for the user and rotates every `device_wrap_secrets` row
  they own. Every cached envelope on every device then fails AEAD on
  next open, clears itself, and routes the user back through unlock.
- Desktop Tauri stays on OS keychain (hardware-backed, OS-login
  protected). Already secure, unchanged.

**What this doesn't protect against:** active XSS in the page. A script
running in the Parchment origin can fetch the device secret and unwrap
the seed — same-origin scripts can always read cookies and call
same-origin endpoints. Architectural mitigations (origin isolation,
iframed secret store) are possible but require significant restructuring
and aren't planned.

**Opt-in "paranoid mode"**: a Settings toggle for users who want to
trade instant-open for strictly-in-memory seeds. When enabled, no
persistence — each cold-open unlocks via passkey-PRF or typed recovery
key. Off by default.

### How production E2EE apps handle this, for reference

- **Signal / WhatsApp Web**: don't persist the seed at all. QR link
  from a phone each session; web is a thin proxy. High security, heavy
  UX cost. Not the right model for a maps app.
- **Proton Mail, Bitwarden, 1Password**: server stores an encrypted
  copy of the seed, unlocked client-side with a master password run
  through Argon2id / PBKDF2. Users type the password each session.
  Good for password managers where re-auth is expected.
- **Matrix / Element**: "Secure Secret Storage" — server holds
  encrypted cross-signing keys, unlocked by a passphrase or WebAuthn
  PRF passkey. Similar ceremony per session.
- **Parchment** (this plan): Matrix-style server-held wrap secret, but
  fetched automatically on cold-open instead of requiring user
  interaction. Trade-off documented above.

## Feature status snapshot

For each feature, what's currently built, what's currently encrypted,
and what's still plaintext.

### Encrypted and live in the app
| Feature | Primitives | Why |
|---|---|---|
| Live location sharing (feature 1a) | ECIES v2, v2 envelope, federation protocol | Per-message forward secrecy; AAD binding blocks replay |
| Third-party integration credentials at rest (feature 1b, 4-bridge) | Server master encryption key | Server must hold API keys to call scheduled third-party fetches; encryption protects DB-dump leaks |
| Cross-server federation | Server identity signing, TOFU pinning, replay protection, canonical v2 envelope | Anti-MITM; anti-replay; hostile-peer defense |
| Identity seed on desktop | Tauri OS-keychain | Hardware-backed, OS-login protected |
| Identity seed on browser / mobile webview | v2 envelope wrapped under server-held per-device secret (`parchment-seed-wrap-v1`) | Ciphertext at rest; sign-out-all rotates secrets → every cached seed unreadable |

### Encrypted, live, but UI-wiring still thin
These have working crypto + working flows, but the front-door UI that
users will actually see is still minimal.

| Feature | Primitives | What's thin |
|---|---|---|
| Search history | Personal-blob channel, v2 envelope, personal key | `recordSearchEntry()` exists; search input doesn't call it |
| Saved places / collections (feature 5) | Per-collection key, v2 envelope | Server-side legacy cleartext columns dropped (migration 0041); UI reads encrypted envelope |
| Custom canvases (feature 6, single-user) | Per-canvas key, v2 envelope | No canvas UI yet |
| Direct-mode integrations (feature 4 non-bridge) | Personal-blob channel, personal key | No per-integration "bridge vs direct" UI toggle |

### Shipped end-to-end
Crypto + orchestration + user-facing UI all in place.

| Feature | What exists |
|---|---|
| Passkey-PRF recovery | Enroll (new passkey or promote existing), list, delete slots in Settings → Passkeys. PRF support detected per-passkey; unsupported passkeys show a clear "can't be used for recovery" hint |
| Device-to-device transfer | QR send/receive pair in Settings → Identity. Ed25519-signed handshake, SAS digit comparison, ≤60s server relay TTL, one-shot sealed-seed consumption |
| Master-key rotation | Client orchestrator (`web/src/lib/km-rotation.ts`) builds the full post-rotation state (new keys, re-encrypted blobs + collections, re-sealed slots) and commits atomically via `POST /users/me/km-version/commit`. Server runs a single DB transaction gated by CAS on `kmVersion` — if another device rotated first, the commit 409s and nothing is written |
| Sign out of all / other devices | `DELETE /auth/sessions/all` and `DELETE /auth/sessions/others`. Sign-out-all also rotates every `device_wrap_secrets` row, atomically revoking every browser/mobile cached seed |
| Identity reset (last resort) | `POST /users/me/identity/reset` with typed confirmation. Single DB transaction wipes every user-encrypted data row and nulls the federation identity; user can re-run setup |

### Plaintext by design (not a bug)
| Field | Why cleartext |
|---|---|
| Email | Needed to route OTP sign-in |
| Federation alias (`alice@server`) | Routing identifier |
| Display names (first/last) | Shown to friends and federation peers on purpose — so receiving a friend invite says "John Smith" not a raw alias. Not sensitive enough to warrant encryption here; the alias is available for users who want pseudonymity. |
| Federation public keys | Public by definition |
| Profile picture URL | User chose to point at a public URL |
| Session tokens | Bounded by TTL + CSRF defenses |
| Opaque relationship IDs | No semantic content |
| Friend-invitation rows (handle pair) | Required for server-side routing |

### Reserved for future
- Frequently visited places (feature 3) — explicitly deferred
- Multi-user canvas collaboration — extend per-canvas key sealing; big protocol work
- Yjs / CRDT document encryption — downstream of multi-user collab
- Device-name / device-type encryption — would use the metadata-crypto primitive
- Location-sharing config opaque `relationship_id` refactor
- Per-relationship encrypted config blob
- Key Transparency log — field reserved, not yet populated
- Cross-device friend-pin sync via personal-blob channel
- Mobile Tauri OS-keystore (Android Keystore / iOS Keychain)
- Anonymous trip-data contribution path (design pending — see §navigational-trip-data)
- Production secrets-manager wiring for server keys (optional hardening)

## Threat model

We design for the following threats, in descending likelihood and impact:

### A. Server-side DB dump / backup leak
An attacker obtains a `pg_dump`, logical replica, or raw disk image of the
Parchment database but **not** the server's running process memory.

- What they see: email addresses, picture URLs, public keys, opaque
  relationship IDs, session tokens, encrypted blobs, encrypted metadata,
  federation nonces, pinned peer-server keys, friend-invitation rows
  (references by handle).
- What they do NOT see: locations, search history, device names, saved
  place details, third-party API credentials, seeds, collection/canvas
  metadata.
- Gates: AES-256-GCM envelopes under per-user / per-record keys; integration
  credentials under the server's master encryption key (separate env var,
  not in the DB). User display names are intentionally cleartext — see
  the "Plaintext by design" table below for the trade-off.

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

## What's encrypted, at what scope

| Data | Storage shape | Key | Scope |
|------|---------------|-----|-------|
| User identity seed (32B) | OS keychain (desktop) or localStorage (browser/mobile) | — | Client only |
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

### Navigational trip data (feature 7)
**Active trips** stay client-local: state lives in RAM (and in encrypted
local scratch on desktop) for the duration of the trip, then is discarded
unless the user explicitly saves it into a collection (→ feature 5 path,
user-E2EE).

**Anonymous trip contribution** (future design): if and when Parchment
adds a community-contribution path to improve traffic data, uploads must
be un-linkable to the contributing user — no session cookies, no stable
device identifiers, routed through a zero-log relay, and scrubbed of
anything that could correlate contributions over time. The specific wire
format (full traces, coarse bucketed observations, or something in
between) is deliberately unspecified here — we removed the earlier
bucketing primitive because the design wasn't final yet. Whatever ships
here, it must not allow the server to attribute a contribution to a
user, and it must be opt-in.

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

**The server refuses to start if either env var is unset or invalid**
— in every environment, not just production. `server/src/index.ts`
calls `getServerIdentity()` and `assertIntegrationKeyConfigured()`
before the HTTP listener starts, so an ephemeral key silently lost at
restart becomes a hard boot failure instead of a latent time-bomb.
Startup also rejects the case where both env vars hold the same 32
bytes — a classic anti-pattern that defeats rotation independence. The
error message points at this file and includes the
`openssl rand -base64 32` command.

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
- User-requested "rotate keys" in Settings → Identity.
- Compromise-response playbook.

Rotation is client-orchestrated, atomically committed server-side. The
full flow lives in `web/src/lib/km-rotation.ts` and
`server/src/services/km-rotation.service.ts`:

1. Client reads `kmVersion` (server's view).
2. Client generates a new seed + new Ed25519/X25519 public keys.
3. Client lists every personal blob, re-decrypts under the old seed,
   re-encrypts under the new personal key, tags each with the new
   `kmVersion`.
4. Client lists every collection, re-decrypts + re-encrypts the
   metadata envelope under the new per-collection key.
5. For each registered passkey slot, client runs a PRF assertion and
   rebuilds a fresh wrapped-K_m slot signed under the new identity key.
6. Client calls `POST /users/me/km-version/commit` with the full
   post-rotation state (new pubkeys + rebuilt blobs + rebuilt
   collections + rebuilt slots + `expectedCurrent`).
7. Server opens a single DB transaction. It re-reads `kmVersion` and
   aborts with 409 if it no longer equals `expectedCurrent` (another
   device rotated first — **nothing is written**). Otherwise it writes
   the new pubkeys, upserts every blob, updates every collection
   (scoped to this user), upserts every slot, and bumps `kmVersion`,
   all inside the same transaction.
8. Only after a successful 200 does the client persist the new seed
   locally (so a crash mid-commit leaves the old working seed on disk
   rather than a post-rotation seed pointing at pre-rotation server
   state).

There is no window where the server has mixed-version state for a
single user. Readers still tolerate `kmVersion` on records vs the
user's current `kmVersion` only for cross-device staleness detection.

## Recovery

Five tiers, in order of fallback:
1. **OS keychain** on desktop Tauri (primary on desktop).
2. **Wrapped localStorage seed** on browser / mobile webview — cold-open
   unwraps automatically via the server-held device-wrap secret. Only
   the legitimate signed-in user can fetch the secret; "sign out of all
   devices" rotates every secret and atomically revokes every cached
   seed.
3. **Passkey-PRF wrapped K_m slots** — any registered passkey with PRF
   support can unwrap the seed on a new device.
4. **Device-to-device transfer** — existing-device-assisted pairing
   with SAS digit comparison + sender-signed handshake + ≤60s server
   relay + one-shot sealed-seed delivery, via `/device-transfer/*`.
5. **Typed base64 recovery key** (last resort) — the user prints or
   password-manager-saves the 32-byte seed as base64.
6. **Identity reset** (nuclear) — `POST /users/me/identity/reset` with
   typed confirmation. Deletes every user-encrypted row and nulls the
   federation identity. All previously-encrypted data is gone forever;
   the user can immediately run setup fresh and keep the account.

See [docs/crypto/recovery.md](docs/crypto/recovery.md) for flow details.

## Known deferred items (tracked)

Each of these is real work, broken out for visibility rather than hidden:

- Wiring the search-history UI into the search input. Crypto + sync
  exists; UI hook-up is a follow-up.
- Multi-user canvas collaboration (key sharing + revocation ceremony).
- Yjs document-level encryption for real-time canvas collab.
- Device-name + type encryption (`user_device.device_name`, `.device_type`).
- Location-sharing-config opaque `relationship_id` refactor.
- Direct-mode integration path (feature 4 non-bridge) — the personal-blob
  channel is shipped; the per-integration UI toggle is not.
- Paranoid-mode Settings toggle (no localStorage wrap; passkey-only cold
  open). Primitives all exist; the toggle + branch doesn't.
- Mobile-native keystore plugin (Android Keystore / iOS Keychain) to
  gate the seed behind biometric on top of the current webview-wrap.
- Anonymous trip-data contribution path (see §navigational-trip-data).
- Key-transparency anchor — `.well-known/parchment-server` reserves the
  `key_transparency_anchor` field; CONIKS / Key Transparency log
  integration is out of scope for now.

## Reporting a vulnerability

Parchment is still an unreleased project. Until we have a published
security contact, please open an issue on GitHub tagged `security` or
reach the maintainers directly.
