# Collection sharing

Parchment's collection sharing system is modelled after the Google Docs
share dialog: an owner can grant people access at specific roles, optionally
mint a public link, and switch between encryption schemes with a clear trust
boundary.

This doc covers the shipping behaviour — the threat model, the two
encryption schemes, and the guarantees each offers.

## Two encryption schemes

Every collection declares a `scheme` — the `collections.scheme` column —
and every saved place inside it is encrypted (or not) according to that
scheme. Users switch schemes via an explicit, confirmed action; it never
flips silently.

| Scheme | Where point data lives | Who can read at rest | Public link allowed |
|---|---|---|---|
| `server-key` | Cleartext in the `bookmarks` table. Server indexes them for search + spatial queries. | Owner, editors + viewers via server-enforced ACL, anyone with a public link (if minted). Server operator can too. | Yes |
| `user-e2ee` | Ciphertext in `encrypted_points` under a per-collection AES key derived from the owner's seed. Server never sees the plaintext. | Owner's devices, friends the owner shared with (rewrapped copy of the content key), and nobody else. | No — cannot mint a public link for an e2ee collection. |

### Choosing a scheme

- **Server-key** is the right default for most use cases. The server needs
  to see the data to search it, render tiles, compute spatial queries, and
  expose it through a public link.
- **User-e2ee** is the right choice for sensitive personal-location data
  the user wants the Parchment operator not to see. Nothing leaks beyond
  the invited friends (who all run the owner's client + hold a wrapped
  copy of the content key). The tradeoff: no public links, no server-side
  search over point contents.

### Scheme switch flow

Direction | Effect
--- | ---
`server-key → user-e2ee` (upgrade) | Owner's device encrypts every cleartext bookmark under a fresh per-collection key, uploads the encrypted points, and the server atomically deletes the cleartext rows. Any existing public link is revoked (user-e2ee cannot have one). Friend shares get rewrapped under the new key.
`user-e2ee → server-key` (downgrade) | Owner's device decrypts every encrypted point, uploads plaintext bookmark rows, and the server atomically deletes the encrypted_points. Metadata envelope + friend shares are rewrapped under the new key version. **The Parchment server can now read every point in the collection.**

Both directions bump `metadata_key_version` so no "old key + new ciphertext"
race can occur. The whole payload is applied in one DB transaction.

Switching is a loud, confirmed action — downgrade shows a destructive
confirmation because it's a trust escalation. See
`web/src/lib/collection-scheme-switch.ts` for the orchestrator and
`server/src/services/library/collections.service.ts::changeCollectionScheme`
for the server-side transaction.

## Roles

Every non-owner share carries a role:

- **Viewer** — can read; cannot write. Can the see the collection in
  their "shared with me" surface.
- **Editor** — can read and write. Subject to the collection's
  `resharing_policy` for whether they can invite others.
- **Owner** (implicit) — the collection's `userId`. Always has full access.

Ownership doesn't have a share row; it comes from the resource itself.
The `getEffectiveRoleOnCollection` helper flattens "owner vs. share vs.
no access" into a single `'owner' | 'editor' | 'viewer' | null` value
used by write-gate enforcement.

## Resharing policy

Collections carry a `resharing_policy`:

- `owner-only` (default) — only the owner can issue new shares or change
  permissions.
- `editors-can-share` — editors may invite others (still subject to their
  own role; viewers can never share).

The check runs server-side on `POST /sharing` for `resource_type = collection`
via `canShareCollection`.

## Public links

When the scheme allows it (server-key only), the owner can mint a public
link. The token is 32 random bytes, base64url-encoded, stored in
`collections.public_token`. The resolver lives at
`GET /public/collections/:token` — no auth, IP rate-limited.

The role on a public link is always `viewer`. Anonymous editor access
would require a session and has no coherent identity to authenticate.

Revoking clears `public_token`; the old URL returns 404 on next fetch.
No rotation — just revoke and mint a new one.

### Why public links aren't allowed for user-e2ee

Anonymous visitors have no keys. They couldn't decrypt an e2ee collection
even if they had the token. Any attempt to mint a public link on a
user-e2ee collection returns 400 with an explicit message; the UI
disables the button and shows an explainer.

## Cross-server shares

Friend shares already go through the existing federation `RESOURCE_SHARE`
message — the sharing controller detects remote recipients and delegates
to `federation.service`. The recipient's server writes the incoming row
to `incoming_shares` with the same `role` value.

Cross-server sharing currently carries the same **snapshot** semantics
that the pre-existing flow used: the recipient's server stores a copy of
the encrypted payload and doesn't auto-re-fetch on the owner's edits.
Live read-through for cross-server server-key shares is a Phase 9 item.

## Security properties

- **Owner is always implicit.** No way to create an "owner" share row;
  ownership is the `userId` column on the resource. Removes a class of
  escalation bugs.
- **Write-gate enforcement is server-side.** Clients disabling their
  write UI is a UX nicety, not a security boundary — every write path
  has a server check.
- **Revocation is durable for server-key shares.** On revoke, the
  server flips the share status and future reads fail the ACL check.
  For user-e2ee, revocation alone is weak (the recipient may have
  cached the content key); the recommended flow is to follow revoke
  with a `rotate-key` call which re-encrypts the collection under a
  fresh key and drops the revoked recipient's rewrap. See
  `web/src/lib/collection-rotation.ts`.
- **Public link unguessable.** 32 random bytes via Node's `crypto.randomBytes`.
- **Scheme switch is atomic.** A single DB transaction swaps the entire
  point set + metadata envelope + every rewrapped share. No observer
  sees a half-rotated collection.

## Implementation pointers

Schema:
- `server/src/schema/library.schema.ts` — `collections` (`scheme`,
  `resharing_policy`, `public_token`, `public_role`,
  `metadata_key_version`)
- `server/src/schema/shares.schema.ts` — `shares` + `incoming_shares`
  (`role` on both)

Server:
- `server/src/services/library/collections.service.ts` —
  `createPublicLink`, `revokePublicLink`, `getPublicCollectionByToken`,
  `rotateCollectionKey`, `changeCollectionScheme`
- `server/src/services/sharing.service.ts` —
  `canShareCollection`, `getEffectiveRoleOnCollection`, `createShare`,
  `revokeShare`
- `server/src/controllers/library/collections.controller.ts` —
  `POST /public-link`, `DELETE /public-link`, `POST /rotate-key`,
  `POST /change-scheme`
- `server/src/controllers/public.controller.ts` —
  `GET /public/collections/:token`

Client:
- `web/src/lib/collection-rotation.ts` — e2ee revoke rotation
- `web/src/lib/collection-scheme-switch.ts` — scheme upgrade/downgrade
- `web/src/services/sharing.service.ts` — HTTP wrappers
- `web/src/components/sharing/ShareDialog.vue` — the dialog
- `web/src/components/sharing/PeopleWithAccessList.vue` — per-row access list
- `web/src/components/sharing/GeneralAccessSection.vue` — public-link section
