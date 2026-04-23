# Encryption-completion plan

Primitives are shipped; what's left to ship a *user-facing* E2EE product
is almost entirely UI + orchestration. This doc enumerates the pieces
required for the encryption story to actually work end-to-end for a
real user — excluding "new feature" work like custom canvases or
direct-mode integrations.

Everything in this plan has its crypto already written (and tested) in
the respective library files; the remaining work is surface area on top.

## Priority tiers

- **P0** — blocking for a usable E2EE product. Without these, encryption
  is technically correct but users can't recover from lost devices,
  can't set a name, or can't trust the security story on their phone.
- **P1** — important for a complete experience but not blocking.
- **P2** — polish / nice-to-have on top.

---

## P0 — Must ship for working encryption

### 1. Passkey-PRF enrollment + slot management UI — **SHIPPED**
**Status:** shipped. Setup flow offers passkey enrollment right after
recovery-key save. Settings → Add Passkey enrolls a PRF slot when the
authenticator supports it. New-device import flow prefers passkey
unlock over typing the base64 recovery key whenever any slot exists.

**Code:**
- Server: `server/src/lib/passkey-prf.ts` (salt derivation),
  `server/src/services/auth.service.ts` (`generateWebauthnOptions`
  includes PRF extension in registration; new `generatePrfAssertionOptions`
  for recovery), `server/src/controllers/auth.controller.ts`
  (`POST /auth/passkeys/prf-assert/options`).
- Web: `web/src/lib/passkey-prf-support.ts` (detection + PRF output
  extraction), `web/src/services/auth.service.ts` (`registerPasskey`
  now returns `{ passkey, attestationResponse }`, new
  `assertPasskeyForPrf`), `web/src/services/identity.service.ts`
  (`enrollPasskeySlot`, `unlockSeedWithPasskey`, `fetchWrappedKeySlots`,
  `hasAnyWrappedKeySlot`), `web/src/stores/identity.store.ts`
  (`enrollPasskey`, `unlockWithPasskey`, `refreshSlotAvailability`,
  `hasAnyPasskeySlot`),
  `web/src/components/auth/Passkeys.vue` (Add Passkey now enrolls slot
  when local identity present),
  `web/src/components/friends/RecoveryKeyDialog.vue` (setup adds a
  "passkey offer" step; import prefers passkey unlock with typed-key
  fallback).

**Still outstanding (follow-ups):**
- Delete-passkey rotation hook — right now the `DELETE /auth/passkeys/:id`
  cascade also deletes the wrapped slot (schema FK `ON DELETE CASCADE`)
  but does NOT trigger K_m rotation. Wire it up as part of #3 below.
- Single-ceremony PRF fallback — today we register the passkey first,
  then if the authenticator didn't evaluate PRF in-band we do a
  follow-up assertion. Works in Chrome/iCloud Keychain; Safari users
  see a second tap. Acceptable for now.

### 2. Device-to-device transfer UI — **SHIPPED**
**Status:** shipped. Single `TransferIdentityDialog` component handles
both sides (chooser → receive or send). Entry points:
- Settings → Identity → "Transfer to another device" (chooser).
- Import flow → "Transfer from another device" (receive mode, skips
  chooser).

**Code:**
- `web/src/components/friends/TransferIdentityDialog.vue` (QR render via
  `qrcode`, camera scan via `jsqr` + `getUserMedia`, polling loop, SAS
  derivation + visual verify on both sides, seed sealing / opening).
- Wired in `web/src/components/friends/IdentitySettings.vue` (sender
  trigger), `web/src/components/friends/RecoveryKeyDialog.vue` (receiver
  option in import mode).

**Deps added:** `qrcode`, `jsqr`, `@types/qrcode` (via bun).

**Flow:**
1. Receiver generates X25519 ephemeral, POSTs `/device-transfer`, gets
   sessionId. Renders QR `{v, sessionId, receiverPub}`.
2. Sender's camera reads QR, derives SAS, generates own ephemeral,
   seals seed under ECDH'd key + signs with long-term identity priv,
   uploads.
3. Receiver polls `/device-transfer/:id` every 2s until payload arrives,
   computes SAS, displays.
4. User cross-verifies the two 6-digit codes; if match, receiver taps
   confirm → `openTransferredSeed` (verifies signature + AAD before
   unsealing) → double-checks the derived signing pubkey matches server
   identity → `storeSeed`.

**Known limitations (follow-ups, not blockers):**
- **No biometric gate on the sender.** The plan called for WebAuthn
  userVerification before sealing; today it relies on session + user
  confirm. Add an `assertPasskeyForPrf()`-style gate before the upload
  step when any passkey is registered.
- **Camera access is web-only.** Tauri mobile webview can access
  `getUserMedia` on modern iOS/Android. Native Tauri plugin not wired.
- **Sealed payload uploaded before SAS confirm.** Anti-MITM is enforced
  by AES-GCM + receiver-pub binding; a MITM can't unseal, only observe
  that a transfer happened.

### 3. K_m rotation orchestrator — **SHIPPED (core)**
**Status:** core orchestrator shipped. Covers personal blobs + passkey-PRF
slots + public-key re-registration + CAS-advance + local seed replacement.
Settings → Identity → "Rotate keys" invokes it. Deleting a passkey
surfaces a toast offering rotation.

**Code:**
- Client: `web/src/lib/km-rotation.ts` (orchestrator),
  `web/src/stores/identity.store.ts` (`rotateKeys`),
  `web/src/components/friends/RotateKeysDialog.vue` (progress UI),
  `web/src/components/friends/IdentitySettings.vue` (trigger),
  `web/src/components/auth/Passkeys.vue` (post-delete rotation toast).
- Server: `server/src/services/personal-blob.service.ts`
  (`listPersonalBlobTypes`), `server/src/controllers/personal-blob.controller.ts`
  (`GET /me/blobs`).

**Flow:**
1. Fetch `GET /users/me/km-version` → `currentKmVersion`.
2. Generate new seed + keys.
3. `GET /me/blobs` → list types. For each: decrypt under old personal
   key, re-encrypt under new personal key, PUT back with
   `kmVersion + 1`.
4. `GET /users/me/wrapped-keys` → list slots. For each: run PRF
   assertion (user tap), build new slot with new seed + sign under new
   identity key, POST (upsert).
5. PUT `/users/me/keys` with new public keys.
6. POST `/users/me/km-version/advance { expectedCurrent }`. Server
   CAS-advances; 409 → surface as "another device rotated first."
7. `storeSeed(newSeed)` locally.

**Known limitations / follow-ups:**
- **Collections + canvas metadata re-encryption not yet wired.** Those
  keys derive per-entity from the seed, so they also become unreadable
  post-rotation. Needs P0 #6 to land first (UI reading the encrypted
  metadata column).
- **Concurrent-rotation handling is best-effort.** On CAS conflict we
  throw — no automatic re-fetch + retry. User needs to sign out / back
  in to pick up the winning device's state. Good enough for the
  single-active-device case; two users rotating simultaneously is an
  edge case.
- **Not resumable.** If the browser tab closes mid-rotation, blobs may
  be partially under the new seed with no kmVersion advance. User
  recovers via passkey unlock.
- **Auto-trigger on passkey delete is a toast prompt, not fully
  automatic.** User still needs to confirm — protects against
  accidental rotation from mis-clicks.

### 4. Wrap browser/mobile `localStorage` seed under a revocable device secret — **SHIPPED**
**Status:** shipped. `localStorage` seed is now persisted as a v2
envelope wrapped under a per-device server-held secret
(`parchment-seed-wrap-v1`). `DELETE /auth/sessions/all` rotates every
such secret for the user, invalidating every cached seed across every
device atomically.

**Code:**
- Server: `server/src/schema/device-wrap-secrets.schema.ts`,
  `server/src/services/device-wrap-secrets.service.ts`,
  `server/src/controllers/device-wrap-secrets.controller.ts`,
  `server/src/services/auth.service.ts` (`destroyAllSessions`),
  `server/src/controllers/auth.controller.ts`
  (`DELETE /auth/sessions/all`).
- Web: `web/src/lib/key-storage.ts` (wrap + unwrap paths),
  `web/src/lib/device-id.ts`.

**Endpoints:**
- `GET /users/me/devices/:deviceId/wrap-secret` — idempotent; creates
  lazily. 60/min/user.
- `POST /users/me/device-wrap-secrets/rotate` — explicit rotate for the
  current user. 10/min/user.
- `DELETE /auth/sessions/all` — invalidates every session row, then
  rotates every wrap secret.

**Properties:**
- Cold-open is still instant (one small GET + one AES-GCM decrypt).
- `localStorage` at rest holds ciphertext only — a passive filesystem
  read without the session cookie yields nothing useful.
- Server-side revocation works: sign-out-all wipes every cached
  envelope across the network.
- XSS in the page can still fetch the secret and unwrap — unavoidable
  on browser without architectural isolation. Same-origin scripts can
  always read cookies + fetch same-origin endpoints. Documented
  limitation; hardening targets passive filesystem reads, not active
  page compromise.

**Still outstanding (tracked separately):**
- **Opt-in paranoid mode** — a Settings toggle to skip the cache
  entirely and require passkey-PRF on every cold-open. Depends on P0
  #1 (passkey enrollment UI); deferred until that lands.
- UI affordance for "Sign out of every device" — the endpoint exists
  but no Settings button wires to it yet.

### 5. Display-name set/edit form — **SHIPPED**
**Status:** shipped. `web/src/views/settings/pages/Account.vue` now has
an inline edit (pencil icon) for first + last name. Saves via the
existing `PATCH /users/me/profile` endpoint and updates `authStore.me`
locally so the account dropdown, friend-facing handle, etc., refresh
without a round-trip.

### 6. Collections UI read-through encrypted columns — **SHIPPED**
**Status:** shipped. Migration `0041_mixed_wallflower.sql` drops the
cleartext `name`, `description`, `icon`, `icon_color` columns from
`collections`. Only `metadata_encrypted` remains for display metadata.

**Code:**
- Server: `server/src/schema/library.schema.ts` (columns dropped),
  `server/src/controllers/library/collections.controller.ts` (create +
  update body now expect `metadataEncrypted`),
  `server/src/services/library/collections.service.ts`
  (`ensureDefaultCollection` creates rows with no metadata; client fills
  in on first edit), `server/src/types/library.types.ts`
  (`CreateCollectionParams`).
- Web: `web/src/services/library/collections.service.ts` (encrypts
  before POST/PUT via `encryptCollectionMetadata`, decrypts on fetch via
  `hydrateDecryptedMetadata` helper), `web/src/types/library.types.ts`
  (`Collection` now treats `name/description/icon/iconColor` as
  client-populated post-decrypt), `web/src/components/library/CollectionForm.vue`
  (tolerates undefined fields before decrypt).
- Rotation: `web/src/lib/km-rotation.ts` now also re-encrypts every
  collection's metadata envelope under the new per-collection key during
  rotation (new `reencrypt-collection` progress phase).

**Existing-data behaviour:** Pre-migration collections lose their
display metadata (cleartext columns are dropped). In the unreleased app
this only affects dev/test data; users re-edit to repopulate via the
encrypted envelope.

**Still outstanding:** Canvas UI doesn't exist yet, so canvas metadata
re-encryption on rotation remains a TODO. Not blocking; wire it in
alongside the canvas feature.

### 7. Mobile Tauri OS-keystore
**Why it's P0 for mobile users:** today mobile seeds sit in WebView
`localStorage` — same security as regular browser (low). The E2EE
promise doesn't hold on mobile until this lands.

**Primitives partially ready:** desktop path exists (`keychain.rs`
with `keyring` crate). Mobile needs different Rust crates (per-platform)
because the desktop `keyring` crate doesn't target mobile.

**What's needed:**
- Android: Android Keystore via JNI through a Tauri plugin.
  Options: `tauri-plugin-biometric` + Android `KeyStore` API, or a
  custom Rust JNI bridge.
- iOS: iOS Keychain via Swift through a Tauri plugin.
  Can extend the existing `keyring` crate's mobile support path (exists,
  but maturity varies), or write a small native command.
- Web-facing contract stays the same (`storeSeed` / `getSeed`). The
  detection in `key-storage.ts` already probes for command availability;
  register the mobile commands and the probe will pick them up.
- Handle biometric gating (FaceID / fingerprint) for read access on
  sensitive platforms.

**Rough shape:** platform-specific Rust code + probe. ~2-3 sessions,
a lot of it platform-specific debugging.

---

## P1 — Important but not blocking

### 8. Search history UI wiring
The primitive (`recordSearchEntry` / `getSearchHistory`) exists and is
tested. Nothing in the search input calls `recordSearchEntry`. Adding
typeahead from decrypted history is maybe half a session of work. Not
blocking — just a feature that's currently invisible.

### 9. Cross-device friend-pin sync via personal-blob
Pins live only on one device today. On a new device you start fresh
(every friend re-TOFU's), which temporarily weakens the anti-server-
key-swap story. Infrastructure ready (`web/src/lib/personal-blob.ts`);
needs a wrapper service that packs/unpacks the pin list. ~half session.

### 10. Dual-scheme integrations (server-key + user-e2ee) — **PHASE 1 SHIPPED**
Integration configs can now be encrypted either under the server master
key (existing system integrations: Mapbox, OSM, etc.) or under the
user's personal key (new: Dawarich). The `integrations` table carries a
`scheme` column and a `supportedSchemes` field on each definition picks
which modes it accepts. User-e2ee configs live in
`encrypted_user_blobs` under `integration-config:<integrationId>` — K_m
rotation sweeps them automatically via the personal-blob channel.

Phase 1 ships the plumbing + Dawarich as a plumbing-only integration
(no capabilities, no upstream calls). Phase 2 (server-as-passthrough
with bearer-per-request headers, for CORS-blocked or public-API
use cases) remains TODO — design is documented in the handoff plan.

---

## P2 — Polish / cleanup

### 10. Remove legacy v1 crypto paths
`encryptForFriend` / `decryptLocationFromFriend` (static-DH) are still
exported but no longer called anywhere. Sweep + delete.

### 11. Production secrets-manager wiring
Optional hardening — unseal `SERVER_IDENTITY_PRIVATE_KEY` and
`PARCHMENT_INTEGRATION_ENCRYPTION_KEY` from a real KMS / Vault at boot.
Env-var injection is fine for hobby / self-host deploys.

---

## Suggested sequencing

Rough order (each item branches off a fresh PR):

1. **Display-name form** — smallest, quickest win. Gives the UI something
   to show so testing other features feels less weird.
2. ~~**Wrap seed under revocable device secret** (#4)~~ — **SHIPPED**.
3. ~~**Passkey-PRF enrollment UI** (#1)~~ — **SHIPPED**.
4. ~~**K_m rotation orchestrator** (#3)~~ — **SHIPPED**. Collections re-encryption wired after #6 landed; canvas remains TODO until canvas UI exists.
5. ~~**Display-name form** (#5)~~ — **SHIPPED**.
6. ~~**Collections encrypted read-through** (#6)~~ — **SHIPPED**.
7. ~~**Device-to-device transfer UI** (#2)~~ — **SHIPPED**.
3. **Collections encrypted read-through** — unblocks the most-used
   feature (saved places). Schema drop + UI sweep.
4. **Passkey-PRF enrollment UI** — recovery option #1. Prerequisite for
   good rotation UX and for opt-in paranoid mode.
5. **K_m rotation orchestrator** — security-critical, depends on #4.
6. **Device-to-device transfer UI** — recovery option #2. Can land in
   parallel with rotation work.
7. **Mobile OS-keystore** — platform hardening. Probably the last major
   piece; can be deferred until mobile is ready for users.

Parallel tracks: search history wiring + friend-pin sync can happen
anywhere since they're both small and independent.
