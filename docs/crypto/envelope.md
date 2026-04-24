# Ciphertext envelope (v2)

All user-encrypted Parchment ciphertexts produced after Part C.1 use this
self-describing envelope format. The version byte lets the read path
dispatch on format so we can rotate algorithms without a data migration.

## Byte layout

```
[version: 1B] [algo: 1B] [nonce: 12B] [ciphertext: n B] [tag: 16B]
```

- `version`: currently `0x02`. `0x01` is reserved for the legacy
  `{ciphertext, nonce}` pair shape; anything else is rejected on decrypt.
- `algo`: currently `0x01` (AES-256-GCM). Reserved for future AEAD
  upgrades.
- `nonce`: 12 bytes of cryptographically random data, fresh per encrypt.
- `ciphertext || tag`: AES-256-GCM output. The 16-byte authentication
  tag is appended to the ciphertext (standard practice).

The envelope bytes are typically base64-encoded when stored in a text
column or transported over JSON.

## Authenticated data (AAD)

AAD is passed alongside the ciphertext into AES-GCM. The tag covers both
the plaintext and the AAD, so tampering with AAD on decrypt throws.

```
AAD (encoded) = concat(
  big-endian u16 length of userId,      userId (UTF-8 bytes),
  big-endian u16 length of recordType,  recordType,
  big-endian u16 length of recordId,    recordId,
  big-endian u16 length of keyContext,  keyContext,
)
```

Fields are **length-prefixed**, not delimited. This makes the encoding
unambiguous — field values can contain any bytes (null, colon, newline)
with no escaping. Each field is capped at 65535 bytes.

Field semantics:
- `userId`: the owner of the record from the decrypting user's perspective.
  For personal blobs, the current user's id. For ECIES friend shares, the
  recipient's handle.
- `recordType`: application-level discriminator.
  Examples: `user-metadata`, `collection-metadata`, `canvas-metadata`,
  `personal-blob`, `friend-share-v2`, `wrapped-master-key`,
  `device-transfer`.
- `recordId`: the primary key / identifier of the record. Empty string
  when a record type is singleton-per-user.
- `keyContext`: the HKDF `info` string the key was derived under. Binding
  this into AAD prevents cross-context key misuse — a key derived for
  purpose A can't decrypt a ciphertext intended for purpose B.

## Why AAD matters

AAD is defense-in-depth, not a primary security boundary. It catches:
- A rotation job that accidentally shuffles rows between users.
- A key reuse mistake across record types.
- A bug in a future feature that feeds a wrong field into decrypt.

In any of those cases, the result is a clean AEAD failure (thrown
exception) instead of silent wrong-plaintext.

## Reference

Implementation: `web/src/lib/crypto-envelope.ts`

Structural inspector for the server (version byte only, no decrypt):
`server/src/lib/crypto-envelope.ts`
