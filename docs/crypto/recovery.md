# Recovery

Parchment's security model places the user's master key (the 32-byte
seed K_m) on user-owned devices. Losing the seed means losing access to
all E2EE'd data. This document describes the four recovery tiers, in
order of preference.

## Tier 1: OS keychain (desktop Tauri)

**Default on macOS, Windows, and Linux.** On first setup, the seed is
written to the native OS keychain via the `keyring` Rust crate wrapper
(see `server`-style note: actually this lives in
`web/src-tauri/src/keychain.rs`). Service name: `app.parchment`.

- macOS: Apple Keychain, hardware-backed on Secure-Enclave Macs.
- Windows: Credential Manager.
- Linux: libsecret / Secret Service.

Relock follows the OS login. First access on macOS pops the standard
"allow app to access keychain" prompt — Always Allow silences it.

If the OS keychain is unavailable (misconfigured build, mobile Tauri
webview, pure browser) the client falls through to localStorage. See
`web/src/lib/key-storage.ts`.

## Tier 2: Passkey-PRF wrapped K_m slots

**Primary cross-device recovery.** Any WebAuthn passkey with the PRF
extension can recover the seed on a new device:

1. New device presents passkey challenge with `prf.eval.first = salt`
   where `salt = HKDF(userId, "parchment-prf-salt-v1", 32B)`.
2. Authenticator returns a user-bound PRF output (never changes for a
   given passkey+salt pair).
3. New device fetches the matching slot from `/users/me/wrapped-keys`,
   verifies the slot signature against the user's long-term identity
   pub (which the new device gets from the server but the signature
   provides integrity — a malicious server that injects a fake slot
   fails verification).
4. HKDF(PRF output, "parchment-prf-wrap-v1") → AES key → unwraps K_m.
5. New device derives all subkeys from K_m and compares its derived
   signing/encryption pubs against the ones registered on the server.
   If they match, setup completes.

A user can have multiple passkey slots — e.g., hardware security key +
platform authenticator — so losing any one device doesn't lock them
out. Removing a passkey removes its slot AND should trigger K_m
rotation (Part C.7) in case the passkey-holder device leaks its
wrapped slot elsewhere.

Implementation: `web/src/lib/passkey-prf.ts`,
`server/src/schema/wrapped-master-keys.schema.ts`.

## Tier 3: Device-to-device transfer

**Assisted pairing when the user has an existing device and a new one
side-by-side.** The flow:

1. New device generates an ephemeral X25519 keypair; POSTs the pub to
   `/device-transfer`; receives a `sessionId`.
2. New device renders a QR encoding `(sessionId, receiverEphemeralPub)`.
3. Existing device scans the QR, generates its own ephemeral X25519.
4. Both devices derive the 6-digit SAS from both ephemerals + sessionId.
5. User visually verifies the SAS matches on both devices.
6. Existing device requires a biometric confirmation from the user.
7. Existing device:
   - Computes `ECDH(sender_eph_priv, receiver_eph_pub)` → HKDF → AES key.
   - Encrypts the seed, AAD-bound to both ephemerals + sessionId.
   - Signs `(sessionId, receiverEphemeralPub, senderEphemeralPub)` with
     the user's long-term Ed25519 identity key.
   - POSTs `{senderEphemeralPub, sealedSeed, senderSignature}` to
     `/device-transfer/:id/upload`.
8. New device GETs the payload, verifies the signature against the
   user's identity pub, decrypts the seed.

Server-side guards:
- TTL: 60s from session creation.
- One-shot: the GET marks the session `consumed`; subsequent reads
  return 410 Gone.
- Rate limit: 3 transfer sessions per user per hour.

The server never sees plaintext — the payload is ECIES-sealed to the
receiver's ephemeral. The sender signature catches any server attempt
to swap ephemeral pubkeys (which would otherwise be a classic MITM).

Implementation: `web/src/lib/device-transfer.ts`,
`server/src/controllers/device-transfer.controller.ts`.

## Tier 4: Typed base64 recovery key

**Last resort.** At setup, the user sees a base64-encoded 32-byte
recovery key. They save it to a password manager (or print it, or write
it down). To recover, they type it back into the sign-in flow.

This is the full seed in human-readable form. Treat accordingly:
- Never email it, never display it in a screenshot, never log it.
- If compromised, rotate immediately.
- Losing all devices AND losing the recovery key = unrecoverable
  account. E2EE is honest: there is no server-side fallback.

## Rotation triggers

After any recovery that happens because of suspected compromise (lost
device, shared recovery key, passkey removed), perform K_m rotation
(Part C.7):

1. Client generates a new seed.
2. Client re-encrypts all user-owned data under the new seed.
3. Client re-seals K_m into every remaining passkey-PRF slot.
4. Client advances `users.km_version` via the `/users/me/km-version/advance`
   CAS endpoint.

See [key-hierarchy.md](key-hierarchy.md) for the full rotation sequence.
