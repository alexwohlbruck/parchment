# Federation protocol (v2)

Parchment federation is cross-server: each user lives on a home server
(`alice@parchment.example`) and interacts with users on other servers
(`bob@other.example`) via signed messages exchanged over HTTPS.

This document specifies the on-wire format; for what the different actors
can observe, see [federation-trust.md](federation-trust.md).

## Server identity

Every Parchment server holds a long-lived Ed25519 keypair. The private
half is the `SERVER_IDENTITY_PRIVATE_KEY` env var (base64 32B seed); the
public half is published at:

```
GET https://{host}/.well-known/parchment-server
→ {
    "server_id": "parchment.example.com",
    "public_key": "<ed25519 base64>",
    "protocol_versions": [2],
    "minimum_protocol_version": 2,
    "capabilities": ["location-live", "metadata-encryption-v1", …],
    "key_transparency_anchor": null
  }
```

The `server_id` equals the server's hostname (including port if non-443).

## Peer pinning (TOFU)

First contact: a Parchment server fetches the manifest of each peer it
talks to and records the key in `federated_server_keys`. Subsequent
contacts fetch again and compare. A changed key is **rejected** — no
silent acceptance. An operator must delete the pinned row out of band
after verifying the change (e.g., the peer operator rotated their
identity and the change was announced on a mutually trusted channel).

Implementation: `server/src/services/federation-auth.service.ts`.

## Inbound request format

Every S2S request carries these headers:

| Header | Meaning |
|--------|---------|
| `X-Parchment-Server-Id` | Sender's `server_id` |
| `X-Parchment-Protocol-Version` | integer, currently `2` |
| `X-Parchment-Nonce` | 16 bytes base64, per-request |
| `X-Parchment-Timestamp` | RFC 3339 |
| `X-Parchment-Server-Signature` | base64 Ed25519 over the canonical wrapper |

The canonical wrapper (what the server signature covers) is produced by
`buildServerSignableWrapper` in `server/src/lib/federation-canonical.ts`:

```
JSON.stringify(sortKeys({
  method:            "POST",
  path:              "/federation/inbox",
  body_hash:         base64(sha256(canonicalJsonStringify(body))),
  nonce:             "…",
  timestamp:         "…",
  peer_server_id:    "{recipient hostname}",
  sender_server_id:  "{sender hostname}",
  protocol_version:  2,
}))
```

`canonicalJsonStringify` recursively sorts object keys before
`JSON.stringify`. Both sender and receiver apply the SAME canonical
function so the hash is stable regardless of JSON parser behavior.

## Replay protection

The receiver rejects a request if any of:
- Timestamp is outside ±300s of server clock.
- Sender's pinned pubkey can't verify the signature.
- The `(senderServerId, nonce)` pair has been seen in the past 10 minutes
  (tracked in `federation_nonces`, swept opportunistically).
- Protocol version is not in the receiver's supported set.

Nonces are recorded **after** signature verification, so an
unauthenticated attacker cannot poison the nonce cache.

## Federation message body (v2 envelope)

Once S2S is verified, the inbox processes the message body. Body shape:

```ts
{
  protocol_version: 2,
  message_type: "FRIEND_INVITE" | "FRIEND_ACCEPT" | "FRIEND_REJECT"
              | "LOCATION_UPDATE" | "LOCATION_REQUEST"
              | "RESOURCE_SHARE"  | "RELATIONSHIP_REVOKE",
  message_version: 1,
  nonce: "<16B base64>",
  timestamp: "…",
  from: "alice@a.example",
  to:   "bob@b.example",
  signature: "<base64 Ed25519>",
  payload: { … }
}
```

`signature` is the user's (not the server's) Ed25519 signature over
`buildClientSignableV2(envelope)` — a sorted-keys JSON of exactly the
fields above minus `signature`. Every field in that set is bound: a
receiver who cares about any of them can trust its value if the
signature verifies.

### v1 compatibility

Legacy messages (`type` field, no `protocol_version`) are still accepted
for a transition window. The canonical form for v1 is
`buildLegacySignableV1` — `{"type": "X", ...sortedPayloadKeys}`
with `type` placed first. Both the client and server use the same shape.

## Key-change detection (client-side)

Servers pin other SERVERS (per above). Clients pin other USERS in
`user_friend_pins` — encrypted under the user's personal key. The
structure per friend is:

```
{ handle, signingKey, encryptionKey, firstSeenAt, verified }
```

Resolving a friend hits the pin. A mismatch **hard-blocks** further
encrypted exchanges with that friend until the user explicitly
re-verifies. Verification typically uses a 12-digit safety number
derived from both users' long-term signing pubs (commutative).

Implementation: `web/src/lib/key-pinning.ts`.

## Revocation

Unfriending a remote user emits a signed `RELATIONSHIP_REVOKE` message.
The recipient server deletes the friendship row and associated
location-sharing state. Client pins are also dropped locally. Already-
captured ciphertext can't be un-leaked, but the ECIES forward-secrecy
shape limits the window.

## Rate limits

- `/.well-known/*`: 60/min per IP.
- `/federation/inbox`: 120/min per IP.

Implementation: `server/src/middleware/rate-limit.middleware.ts`.

## Versioning

Breaking protocol changes bump `protocol_version`. Capability
negotiation works by selecting the highest mutually-supported version
from the manifest. Non-breaking additions use message-type-specific
`message_version` fields in the envelope.
