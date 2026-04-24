# Handoff: Wrap browser/mobile seed under revocable device secret

> Drop this into a fresh Claude Code session. All prior conversation context
> is baked in. Everything below is what the new session needs to execute.

---

## Your task

You are working on **Parchment**, an unreleased Vue 3 + Tauri map/navigation
app with a TypeScript/Elysia backend, PostgreSQL (Drizzle ORM), and
cross-server federation. Repo root: `/Users/alexwohlbruck/Documents/code/parchment`.
The user prefers **bun** over npm; use `bun` / `bun run` / `bun test` /
`bun run drizzle-kit generate` throughout.

A prior session designed and shipped a broad set of crypto primitives
(envelope + AAD, ECIES friend sharing, federation hardening, passkey-PRF
wrap slots, device-to-device transfer, per-collection keys, integration
credential encryption, etc.). See `SECURITY.md` and `docs/crypto/*` for
the full picture.

**Your task here is narrow:** implement a server-revocable wrap for the
user's master seed as it sits in browser / mobile-Tauri `localStorage`.
Desktop Tauri (OS keychain) is NOT part of this task — that path stays
exactly as it is.

This is item **P0 #2** in `docs/crypto/completion-plan.md` under the
rescoped name "Wrap browser/mobile `localStorage` seed under a revocable
device secret."

---

## Why (design rationale — don't re-litigate)

Parchment is a **maps app**. The UX requirement is that cold-open is
instant — the map appears the moment the tab loads, same as Google Maps
or Apple Maps. So the seed **has to persist on the device**. Requiring a
passkey tap or a typed recovery key on every tab-open is wrong for this
product.

Today the seed sits in `localStorage` as plain base64. That's vulnerable
to any passive filesystem read, accidental disk leak, badly-scoped
browser extension, or dev-tools peek.

This task closes that gap **without adding a single tap of friction to
cold-open**. We wrap the `localStorage` seed under a key derived from a
server-held "device secret." Cold-open = one small authenticated fetch
+ one AES-GCM decrypt. Still effectively instant.

Crucially, this gives us a real **server-side revocation** lever: when
the user clicks "Sign out of all devices," the server rotates all device
secrets, every cached seed on every device becomes un-unwrappable, and
each device forces a re-unlock through the existing setup flow.

---

## Inviolable rules (check every change against these)

1. **Any sensitive user data must be encrypted when stored at rest.**
2. **Sensitive data may transit through the server in memory and over
   SSL, but must never be persisted unencrypted.**
3. **E2EE is the default.** The server holds the device wrap secret —
   this is an exception to strict E2EE, documented in SECURITY.md. The
   trade-off is deliberate: it buys us revocation and passive-read
   protection while preserving instant cold-open.
4. **Cold-open must stay effectively instant.** Any design change that
   adds user-visible friction on app open is out of scope for this PR.

---

## Decisions already locked in (do not reopen)

1. **Keep `localStorage` persistence on web / mobile Tauri webview.** We
   do NOT move to IndexedDB, do NOT require re-auth per session, do NOT
   switch to an iframe-isolated secret origin. If you think one of those
   is worth doing, file a follow-up — not part of this PR.
2. **Desktop Tauri OS-keychain path stays unchanged.** Detection happens
   via the existing `buildTauriBackend()` in `web/src/lib/key-storage.ts`.
   Only the browser/mobile fallback branch gets the wrap.
3. **Server holds the device secret.** We considered client-derived
   schemes (PBKDF2 off a password, cookie-bound keys) — rejected because
   we want server-side revocation as the kill switch.
4. **Revocation = rotate all secrets for a user.** No per-device
   revocation in this PR (that's a later feature).
5. **`deviceId` is client-generated** (random UUID) and not sensitive —
   it's just a handle for looking up the wrap secret. Stored in
   `localStorage` alongside the wrapped envelope.
6. **XSS in the Parchment origin is an accepted limitation.** Same-origin
   scripts can fetch the wrap secret + unwrap. Architectural mitigations
   (origin isolation) are out of scope. Document this, don't fight it.
7. **Paranoid mode** (settings toggle: "require passkey on every open")
   is explicitly OUT of scope for this PR. Gets its own follow-up after
   passkey-PRF enrollment ships.

---

## What you're building

### Server side

1. **New schema** `server/src/schema/device-wrap-secrets.schema.ts`:
   ```
   device_wrap_secrets:
     user_id: text (fk to users, cascade delete)
     device_id: text (client-generated UUID; up to 64 chars)
     secret: text (base64-encoded 32 random bytes)
     created_at: timestamp
     rotated_at: timestamp
     primary key: (user_id, device_id)
   ```
   Index on `user_id` alone so "rotate all for this user" is efficient.

2. **New service** `server/src/services/device-wrap-secrets.service.ts`
   with:
   - `getOrCreateDeviceWrapSecret(userId, deviceId): Promise<string>`
     — upsert; if row exists return its secret, otherwise create with a
     fresh 32-byte secret. Returns the base64 secret.
   - `rotateAllForUser(userId): Promise<void>` — regenerate `secret`
     for every row matching `userId`. Bump `rotated_at`.
   - `deleteForDevice(userId, deviceId): Promise<void>` — per-device
     revocation helper (not used this PR but small enough to include).

3. **New controller** `server/src/controllers/device-wrap-secrets.controller.ts`:
   - `GET /users/me/devices/:deviceId/wrap-secret` — authenticated;
     idempotent upsert via the service; returns `{ secret }`.
   - `POST /users/me/device-wrap-secrets/rotate` — authenticated;
     rotates all for `user.id`. Called from the existing "Sign out of
     all devices" flow (wiring the call into that flow is in scope,
     but the UI for "sign out all" probably already exists — hook in).
   - Rate-limit the GET endpoint to something sane (e.g. 60/min/user)
     so a compromised page can't spam it.
   - Validate `deviceId` shape (alphanumeric + dashes, ≤64 chars).

4. **Hook into sign-out-all.** Find the existing "sign out all sessions"
   logic (check `server/src/controllers/auth.controller.ts` and the
   sessions service). After invalidating sessions, call
   `rotateAllForUser(userId)`. Note in a comment that this is what
   renders every cached seed on the user's other devices unreadable.

5. **Migration** via `bun run drizzle-kit generate --name device_wrap_secrets`,
   then `bun src/migrate.ts` to apply.

6. **Register controller** in `server/src/controllers/index.ts` and
   `server/src/index.ts` alongside the other controllers.

### Client side

1. **Device ID helper** `web/src/lib/device-id.ts`:
   - `getOrCreateDeviceId(): string` — read from `localStorage` key
     `parchment-device-id`. If missing, generate `crypto.randomUUID()`,
     persist, return. Non-sensitive; a leaked `deviceId` alone is
     useless without the session cookie.

2. **Modify** `web/src/lib/key-storage.ts`:
   - In the browser/mobile backend path (NOT the Tauri keychain path):
     - Wrap flow on `storeSeed(seed)`:
       1. `deviceId = getOrCreateDeviceId()`
       2. `secret = await fetchDeviceWrapSecret(deviceId)` — authenticated
          GET to `/users/me/devices/:deviceId/wrap-secret`.
       3. Derive `wrapKey = HKDF(base64ToBytes(secret),
          info="parchment-seed-wrap-v1", 32B)`.
       4. Encrypt seed via `encryptEnvelopeBytes` from
          `crypto-envelope.ts` with AAD:
          `{userId: deviceId, recordType: "seed-wrap",
            recordId: "local", keyContext: "parchment-seed-wrap-v1"}`.
          (We don't know `userId` at this layer — using `deviceId` as
          the AAD userId slot is fine; the AAD binding value only needs
          to be stable, not globally unique.)
       5. Store the base64 envelope in `localStorage` under
          `parchment-identity-seed` (replacing the current plain seed).
       6. Clear the cleartext wrap key from memory after the store
          (fine-print: JS doesn't guarantee memory wipe, but explicitly
          dropping the reference communicates intent).
     - Unwrap flow on `getSeed()`:
       1. Read the envelope from `localStorage`.
       2. If absent → return `null` (no setup yet).
       3. `deviceId = getOrCreateDeviceId()`.
       4. `secret = await fetchDeviceWrapSecret(deviceId)`.
       5. Derive wrap key, decrypt envelope, return 32-byte seed.
       6. On decrypt failure (AEAD tag mismatch → secret was rotated):
          delete the stale `localStorage` envelope, return `null` so the
          app falls through to the setup / import flow.
     - `clearIdentity()` deletes the envelope. It does NOT need to call
       the server (sign-out flow is the right place to trigger
       rotation-for-all).
   - Cache the wrap key in a module-scoped variable for the lifetime of
     the session to avoid re-fetching the device secret on every
     `getSeed()` call. Invalidate the cache on `clearIdentity()` and on
     any explicit re-auth.

3. **Update** the backend-interface type so tests can probe whether
   the persistent backend is `localStorage` (plain) or
   `localStorage-wrapped`. Add a third `name` variant or a version
   field — your choice, but the existing `getActiveStorageBackend()`
   should report it so ops / support can diagnose.

4. **Failure modes to think through:**
   - GET `/wrap-secret` returns 401 → session expired. `getSeed` returns
     null; app should route to sign-in.
   - GET returns 5xx / network error → cached wrap key in memory
     (if present) should still work. If no cache and a fetch fails, the
     app should show an error state, not silently lose the seed.
   - After rotation, the envelope exists but can't decrypt → must treat
     as "no seed," not as "crash." The client-side flow is: user signs
     in again, re-imports (recovery key or passkey), `storeSeed`
     wraps under the new secret.

### Tests

Expand `web/src/lib/key-storage.test.ts`:
- New tests exercising the wrap path with a mocked `@tauri-apps/api/core`
  absent (browser path) and a mocked axios/fetch for the wrap-secret
  endpoint.
- Round-trip: `storeSeed → getSeed → match`.
- Rotation simulation: store under secret A, swap mock to return secret
  B, `getSeed` returns null AND clears the stale envelope.
- `localStorage` alone (no session cookie = 401 from mocked fetch) →
  `getSeed` returns null without throwing.
- The envelope in `localStorage` is NOT the plain seed bytes — it starts
  with version byte `0x02` (v2 crypto-envelope).

Server tests:
- `device-wrap-secrets.service.test.ts` — upsert, rotate-all, per-device
  delete. Mock DB like the other service tests do (patterns in
  `server/src/services/*.test.ts`).

### Verification

- `bun test` (server) + `bun run vitest run` (web) — everything green
  except the one pre-existing `location-e2ee.service.test.ts` mock
  failure that's been in the codebase for a while.
- `bunx vue-tsc --noEmit` clean on web.
- `bunx tsc --noEmit --ignoreDeprecations 6.0` on server — the baseline
  has around 189 pre-existing type errors (Elysia `t`/`user` inference
  issues you'll see on many controllers). Your work should not increase
  this count.
- Manual: run the dev stack (`bun run dev` in server, `bun run dev` in
  web), sign in, reload the page — you should see a single GET to
  `/users/me/devices/:deviceId/wrap-secret` in the network tab and the
  app should come up fully initialized with no user interaction. Then:
  call the sign-out-all endpoint from another tab → reload → app should
  force re-sign-in.

---

## What's NOT in scope

- Passkey-PRF enrollment UI (separate P0 item).
- "Paranoid mode" Settings toggle that skips the cache (separate P0).
- Mobile native keystore plugin (Android Keystore / iOS Keychain —
  separate P0).
- Per-device revocation UI (list of my devices + revoke one) — punted.
- Moving anything off `localStorage` (IndexedDB etc.).
- Architectural XSS mitigations (origin isolation).

If you find yourself reaching into any of those, STOP and scope it out.

---

## Key files to touch

**Server:**
- `server/src/schema/device-wrap-secrets.schema.ts` (new)
- `server/src/services/device-wrap-secrets.service.ts` (new)
- `server/src/services/device-wrap-secrets.service.test.ts` (new)
- `server/src/controllers/device-wrap-secrets.controller.ts` (new)
- `server/src/controllers/index.ts` (add export)
- `server/src/index.ts` (register controller)
- `server/src/controllers/auth.controller.ts` and/or whatever sessions
  service owns sign-out-all (wire the rotation call)
- `server/drizzle/004X_device_wrap_secrets.sql` (generated)

**Web:**
- `web/src/lib/device-id.ts` (new)
- `web/src/lib/key-storage.ts` (modify browser/mobile backend)
- `web/src/lib/key-storage.test.ts` (expand)

**Docs:**
- `SECURITY.md` — update §recovery-key-storage-by-platform to mark this
  item shipped and describe the wrap.
- `docs/crypto/completion-plan.md` — mark P0 #2 as done.
- `docs/crypto/key-hierarchy.md` — add `parchment-seed-wrap-v1` to the
  HKDF context table under a new "Device-level keys" section.

---

## Operating rules

- Use `bun`, not `npm`. Migrations via `bun run drizzle-kit generate`.
- Don't amend previous commits; make new ones with 5-15 word subjects.
  Do NOT add a Claude co-author footer (past convention in this repo).
- After each logical step, run the relevant test file and typecheck.
- Never commit secrets. The only new env var you might need is none —
  this feature uses existing session auth.
- If a design decision in this prompt conflicts with something in the
  code, ask before resolving. The contradictions usually indicate a
  stale doc — but don't silently paper over.
- Before opening the PR, sanity-check against the Inviolable Rules. If
  you can't articulate how the PR honors all four (including "cold-open
  must stay effectively instant"), it's not done.

---

## Final checks before declaring done

1. Cold-open with an existing session = one GET to `/wrap-secret` +
   one AES-GCM decrypt. No user interaction.
2. `localStorage.getItem('parchment-identity-seed')` returns base64
   that starts with `0x02` version byte (confirm by decoding in dev
   tools).
3. Signing out of all devices on account A makes every other tab on
   account A force a re-auth on its next reload.
4. Desktop Tauri build still works exactly as before — OS keychain
   path untouched.
5. All new tests pass. No increase in pre-existing type-error count.
