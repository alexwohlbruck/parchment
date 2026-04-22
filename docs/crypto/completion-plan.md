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

### 1. Passkey-PRF enrollment + slot management UI
**Why it's P0:** without this, the ONLY recovery method is typing a 44-char
base64 recovery key. Every real user will lose access at some point if
that's the only option.

**Primitives ready:** `web/src/lib/passkey-prf.ts`,
`server/src/controllers/wrapped-master-keys.controller.ts`,
`server/src/schema/wrapped-master-keys.schema.ts`.

**What's needed:**
- Settings screen: "Passkeys" section showing current slots.
- "Add passkey for recovery" flow: run WebAuthn with `prf.eval.first =
  derivePrfSalt(userId)`, call `buildWrappedKmSlot(...)` with the
  returned PRF output + seed, POST to `/users/me/wrapped-keys`.
- "Remove" action: DELETE `/users/me/wrapped-keys/:credentialId`. Should
  trigger K_m rotation (see #3) if the removed slot might have been
  seen on a lost device.
- Sign-in flow on a new device: fetch the slot list, prompt user to
  tap a passkey, run WebAuthn PRF, verify signature against server-
  stored identity pub, unwrap K_m.
- Browser compatibility probe — not every browser implements the PRF
  extension. UI should detect + fall back cleanly to the base64
  recovery key path.

**Rough shape:** 1 settings component + 1 sign-in component + hook into
existing auth flow. Estimated ~2 focused sessions.

### 2. Device-to-device transfer UI
**Why it's P0:** complementary to #1. When a user gets a new device and
doesn't want to mess with passkeys or type the recovery key, they
should be able to just "scan this QR." Standard recovery UX today.

**Primitives ready:** `web/src/lib/device-transfer.ts`,
`server/src/controllers/device-transfer.controller.ts`.

**What's needed:**
- New-device flow: on setup screen, "I have another logged-in device."
  Generate ephemeral keypair, POST to create a session, render QR
  containing `(sessionId, receiverEphemeralPub)`.
- Existing-device flow: in Settings → Security, "Transfer identity to a
  new device" opens a camera scanner. Parse QR. Show SAS on both screens
  ("Confirm this 6-digit code matches on both screens").
- Biometric confirmation on sender (via WebAuthn user verification or a
  platform-specific prompt).
- Sender: `sealSeedForTransfer(...)` → POST to `/device-transfer/:id/upload`.
- Receiver: poll `/device-transfer/:id`, call `openTransferredSeed(...)`,
  store the recovered seed via `storeSeed(...)`.
- Polling UX: status updates ("Waiting for sender to confirm..." →
  "Transferring..." → "Done").

**Rough shape:** QR render lib + QR scanner component + 2-step wizard on
each side + biometric gate. ~2 focused sessions.

### 3. K_m rotation orchestrator
**Why it's P0:** "rotate keys after compromise" is one of the main
security promises. Without the orchestrator, the keys are cryptographically
rotatable but nothing actually rotates them.

**Primitives ready:** `server/src/services/km-rotation.service.ts`,
`users.km_version` column, per-record `kmVersion` tags.

**What's needed:**
- Client-side rotation worker that:
  1. Fetches all encrypted data for the current user under old seed.
  2. Generates new seed.
  3. Re-encrypts every record, tagging with new `kmVersion`.
  4. Re-seals K_m in every passkey-PRF slot.
  5. Calls `/users/me/km-version/advance` with CAS on `expectedCurrent`.
  6. On CAS conflict, re-fetches and retries with latest data.
- Progress UI: "Rotating keys... 40% done. Do not close this tab."
- Rotation triggers:
  - User-initiated from Settings ("Rotate all keys").
  - Automatic after removing a passkey slot.
  - Part of a post-breach playbook (manual trigger).
- Resumable: store local progress so an interrupted rotation can continue.
- Safety: don't allow the client to start a rotation if any passkey slot
  is missing or signature-invalid.

**Rough shape:** orchestrator service + progress UI + trigger hooks.
Edge cases around partial-rotation recovery add complexity. ~3 sessions.

### 4. Display-name set/edit form
**Why it's P0:** today, every user's display name is blank. The encrypted
*write* path exists (`setMyDisplayName(...)`), just nothing calls it.

**Primitives ready:** `web/src/services/user.service.ts` — `setMyDisplayName`,
`getMyProfile`, `updateMyProfile`. Server endpoints: GET / PATCH
`/users/me/profile`.

**What's needed:**
- Settings → Account screen: editable "First name" and "Last name" fields.
- Submit encrypts locally (`setMyDisplayName`), uploads envelopes via
  PATCH.
- Refresh the in-store `me` object with the newly-set decrypted values.
- Inline validation (max length, trimming).

**Rough shape:** ~half a session. Small form + save handler.

### 5. Collections UI read-through encrypted columns
**Why it's P0:** we have `metadata_encrypted` columns on `collections` AND
the legacy cleartext columns. All UI still reads cleartext. New
collections are being created without encrypted metadata. The end state
is: UI reads the encrypted envelope, drops the legacy columns.

**Primitives ready:** `web/src/lib/library-crypto.ts`:
`encryptCollectionMetadata` / `decryptCollectionMetadata`.

**What's needed:**
- Create-collection path: encrypt name/description/icon locally, send
  only the envelope + key_version to the server.
- Edit-collection path: same, encrypt + upload envelope.
- Read path: fetch collection row, decrypt envelope client-side, render.
- Server: remove cleartext name/description/icon columns (new migration
  — can drop since app unreleased).
- Existing rows: need re-encryption for any real data (same pattern as
  integrations — delete or migrate in a script).

**Rough shape:** UI sweep + schema drop + migration script if any dev
collections exist. ~1-2 sessions.

### 6. Mobile Tauri OS-keystore
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

### 7. Search history UI wiring
The primitive (`recordSearchEntry` / `getSearchHistory`) exists and is
tested. Nothing in the search input calls `recordSearchEntry`. Adding
typeahead from decrypted history is maybe half a session of work. Not
blocking — just a feature that's currently invisible.

### 8. Cross-device friend-pin sync via personal-blob
Pins live only on one device today. On a new device you start fresh
(every friend re-TOFU's), which temporarily weakens the anti-server-
key-swap story. Infrastructure ready (`web/src/lib/personal-blob.ts`);
needs a wrapper service that packs/unpacks the pin list. ~half session.

---

## P2 — Polish / cleanup

### 9. Remove legacy v1 crypto paths
`encryptForFriend` / `decryptLocationFromFriend` (static-DH) are still
exported but no longer called anywhere. Sweep + delete.

### 10. Production secrets-manager wiring
Optional hardening — unseal `SERVER_IDENTITY_PRIVATE_KEY` and
`PARCHMENT_INTEGRATION_ENCRYPTION_KEY` from a real KMS / Vault at boot.
Env-var injection is fine for hobby / self-host deploys.

---

## Suggested sequencing

Rough order (each item branches off a fresh PR):

1. **Display-name form** — smallest, quickest win. Gives the UI something
   to show so testing other crypto features feels less weird.
2. **Collections encrypted read-through** — unblocks the most-used feature
   (saved places). Schema drop + UI sweep.
3. **Passkey-PRF enrollment UI** — recovery option #1. Prerequisite for
   good rotation UX (rotation triggers after slot removal).
4. **K_m rotation orchestrator** — security-critical, depends on slots.
5. **Device-to-device transfer UI** — recovery option #2. Can land in
   parallel with rotation work.
6. **Mobile OS-keystore** — platform hardening. Probably the last major
   piece; can be deferred until mobile is ready for users.

Parallel tracks: search history wiring + friend-pin sync can happen
anywhere since they're both small and independent.
