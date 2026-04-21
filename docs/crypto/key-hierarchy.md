# Key hierarchy

Every symmetric key in Parchment is derived from one of two roots:

1. The user's **master key / seed K_m** (32 bytes of CSPRNG) — the thing
   a user backs up. Only the user's devices ever hold K_m in the clear.
2. The server's **integration KMS key** (32 bytes) — held only by the
   Parchment server process. Used for credentials the server must be
   able to decrypt (bridge-mode third-party integrations).

All derivations use HKDF-SHA256 with distinct `info` strings so that a
compromise of one derived key cannot be used to forge another.

## Client-side keys (derived from K_m)

| Purpose | HKDF `info` | Derivation | Usage |
|---------|-------------|------------|-------|
| Ed25519 signing | `parchment-signing-v1` | 32B output → ed25519 seed | Federation signatures, client intents |
| X25519 encryption (long-term) | `parchment-encryption-v1` | 32B output → x25519 secret | ECDH with friends' long-term pubs, ECIES recipient |
| Personal AES key | `parchment-personal-v1` | 32B output | Search history blobs, friend-pin blobs, metadata-crypto default |
| Metadata AES key | `parchment-metadata-v1` | 32B output | Display-profile field encryption |
| Per-collection AES key | `parchment-collection-<id>` | 32B output | Collection metadata |
| Per-canvas AES key | `parchment-collection-canvas:<id>` | 32B output | Canvas metadata (reuses deriveCollectionKey with `canvas:<id>`) |
| Per-friend shared AES (v1, deprecated) | `parchment-share-v1` | HKDF(ECDH(my_priv, their_pub)) | Legacy static-DH friend encryption |
| Location share AES (v1, deprecated) | `parchment-location-v1` | HKDF(ECDH) | Legacy live-location |
| ECIES friend-share AES (v2) | `parchment-ecies-v1` | HKDF(ECDH(ephemeral_priv, their_long_pub)) | Current live-location and friend shares |
| Device-transfer AES | `parchment-device-transfer-v1` | HKDF(ECDH(my_eph, their_eph)) | Seed transfer to a new device |
| Device-transfer SAS | `parchment-device-sas-v1` | HKDF(sort(both_pubs) \|\| sessionId) → 4B → %1e6 | Short Authentication String for human verification |
| Safety number | `parchment-safety-v1` | HKDF(sort(both_signing_pubs)) → 8B → %1e12 | 12-digit peer verification |

## PRF-wrapped keys (Part C.6)

Passkeys with the PRF extension emit a 32-byte per-credential secret on
each ceremony. That secret is hashed into an AES wrap key and used to
wrap K_m itself:

| Purpose | HKDF `info` | Derivation |
|---------|-------------|------------|
| Per-user PRF salt | `parchment-prf-salt-v1` | HKDF(userId bytes) — fed into `prf.eval.first` |
| PRF wrap key | `parchment-prf-wrap-v1` | HKDF(PRF output) → AES key |

## Server-side keys

| Purpose | Source | Usage |
|---------|--------|-------|
| Server identity (Ed25519) | `SERVER_IDENTITY_PRIVATE_KEY` env var (32B base64 seed) | Signs outbound S2S requests; verified by peers against pinned pub |
| Integration KMS (AES-256) | `PARCHMENT_INTEGRATION_KMS_KEY` env var (32B base64) | Encrypts `integrations.config_ciphertext` |

In production both server-side keys should be supplied by a real secrets
manager (AWS KMS / GCP KMS / Vault) that unwraps them at boot. The code
treats the env-var input as opaque 32-byte key material regardless of
origin.

## Rotation

- **K_m rotation** (Part C.7): advances `users.km_version`. Every
  user-encrypted record carries the version it was written under. Full
  rotation re-encrypts all data and re-seals every wrapped slot.
- **Integration KMS rotation**: `integrations.config_key_version` tracks
  which key encrypted each row. A background worker (not yet shipped)
  can re-encrypt rows in batches while the process holds both old and
  new keys.
- **Server identity rotation**: presents a new pubkey via
  `.well-known/parchment-server`. Peers that pinned the old key will
  hard-reject until re-pinned out of band (intentional — see
  [federation-trust.md](federation-trust.md)).

## Implementation pointers

- `web/src/lib/federation-crypto.ts` — primary key derivation (client)
- `web/src/lib/metadata-crypto.ts`, `library-crypto.ts` — typed wrappers
- `web/src/lib/passkey-prf.ts` — PRF salt + wrap-key derivation
- `web/src/lib/device-transfer.ts` — transfer ECDH + SAS
- `server/src/lib/server-identity.ts` — server Ed25519 identity
- `server/src/lib/integration-kms.ts` — server AES KMS wrapper
