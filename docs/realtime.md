# Realtime updates

Parchment pushes live updates to connected clients over a single WebSocket
per browser tab. When a user mutates a resource the server can reach
(collections, bookmarks, shares, friendships, profile fields), every
affected user's connected clients receive a JSON frame and update their
local Pinia state without a refetch.

This doc explains how the pieces fit together so you can trace an event
from "Alice clicks Save" to "Bob's card updates 300ms later", plus the
three-step recipe for adding a new event type.

## The path of one event

```
  ┌───────────────┐   REST      ┌──────────────────────────────────────┐
  │ Alice's tab 1 │────────────>│ Server                               │
  │ PUT /library  │             │  ┌──────────────────────────────┐    │
  └───────────────┘             │  │ collections.service          │    │
                                │  │   updateCollection(...)      │    │
                                │  │   emit.collection(           │    │
                                │  │     'collection:updated',    │    │
                                │  │     row, id)                 │    │
                                │  └──────────────────────────────┘    │
                                │          │                           │
                                │  ┌──────────────────────────────┐    │
                                │  │ recipients.service           │    │
                                │  │   → { localUserIds: [A,B],   │    │
                                │  │       remoteHandles: [C@x]}  │    │
                                │  └──────────────────────────────┘    │
                                │          │                           │
                                │  ┌──────────────────────────────┐    │
                                │  │ event-bus.service.publish    │    │
                                │  │   queues microtask dispatch  │    │
                                │  └──────────────────────────────┘    │
                                │      │           │                   │
                                │      ▼           ▼                   │
                                │  localSocket   federation            │
                                │  subscriber    subscriber            │
                                └──────┬─────────────┬─────────────────┘
                                       │             │ REALTIME_EVENT
                                       │             │ (federation HTTP)
                                       ▼             ▼
                             ┌───────────────┐  ┌───────────────┐
                             │ Alice's tab 2 │  │ Peer server x │
                             │ Bob's laptop  │  │ (dispatches   │
                             └───────────────┘  │  to C locally)│
                                                └───────────────┘
```

## Primary surfaces

### Server (all under `server/src/services/realtime/`)

- **`registry.service.ts`** — in-memory `Map<userId, Map<connectionId, Connection>>`.
  The only place live WebSocket refs live. Keyed by a stable connection id
  we mint per upgrade (Elysia creates a fresh `ElysiaWS` wrapper per
  handler call, so object identity isn't reliable for close lookup).
- **`event-bus.service.ts`** — generic pub/sub. `publish` is
  fire-and-forget; subscribers run on the microtask queue and never
  throw back to the publisher.
- **`local-socket.subscriber.ts`** — default subscriber. For every local
  recipient, serializes one JSON frame and sends to all their connections.
  Drops the connection from the registry on send failure (bad-socket
  cleanup happens here rather than on an explicit heartbeat).
- **`federation.subscriber.ts`** — outbound. Groups `remoteHandles` by
  peer host, sends one `REALTIME_EVENT` federation message per peer.
- **`federation-inbound.ts`** — inbound handler for `REALTIME_EVENT`.
  Validates sender ↔ recipient friendship, then republishes locally
  with empty `remoteHandles` (prevents forwarding cycles).
- **`recipients.service.ts`** — one resolver per resource type. Returns
  `{ localUserIds, remoteHandles }`.
- **`emit.ts`** — sugar over `publish` + resolvers so call sites read
  as `emit.collection('collection:updated', row, id)`.
- **`ticket.service.ts`** — short-lived single-use upgrade tokens
  (30 second TTL) so the client can authenticate the WS handshake via
  query string (browsers can't set Authorization headers on the
  WebSocket upgrade).
- **`bootstrap.ts`** — registers subscribers at startup.

### Server controller

- **`controllers/realtime.controller.ts`** — three endpoints on one prefix:
  - `POST /realtime/ticket` — mint
  - `GET /realtime/stats` — diagnostic counters
  - `WS /realtime?ticket=…` — the socket itself

The WS route lives on a separate Elysia instance from the HTTP endpoints
because `.use(requireAuth)` mutates the instance globally; attaching it
before the WS route would 401 every upgrade.

### Client (all under `web/src/lib/` and `web/src/stores/*/`)

- **`realtime.ts`** — socket manager. Connect on auth, disconnect on
  signout, reconnect with exponential backoff (cap 30s) on drop. A
  reconnect after any successful open fires a synthetic
  `realtime:reconnected` event so stores can refetch.
- **`realtime-events.ts`** — in-process dispatch registry. Keyed by
  `ownerKey` (one per store) so HMR can replace a store's handler set
  atomically.
- **`realtime-bootstrap.ts`** — side-effect import that pulls in each
  store's `.realtime.ts` sidecar, making sure handlers are registered
  before the socket opens.
- **`stores/*/*.realtime.ts`** — one sidecar file per Pinia store.
  Registers handlers via `registerRealtimeHandlers`; each handler calls
  a store method to apply the mutation locally.

## Event catalog

| Event | Payload shape | Recipients |
|---|---|---|
| `collection:created` | full `Collection` | owner |
| `collection:updated` | full `Collection` | owner + shared + remote |
| `collection:deleted` | `{ id }` | owner + shared + remote (resolved pre-delete) |
| `collection:rotated` | full `Collection` | owner + shared + remote |
| `collection:scheme-changed` | full `Collection` | owner + shared + remote |
| `collection:public-link-changed` | full `Collection` | owner |
| `bookmark:created` | full `Bookmark` | recipients of every target collection |
| `bookmark:updated` | full `Bookmark` | recipients of the bookmark's collections |
| `bookmark:deleted` | `{ id, collectionIds }` | recipients of the former collections |
| `bookmark:unlinked` | `{ id, collectionIds }` | recipients of the affected collections |
| `encrypted-point:created` | full `EncryptedPoint` | recipients of its collection |
| `encrypted-point:updated` | full `EncryptedPoint` | recipients of its collection |
| `encrypted-point:deleted` | `{ id, collectionId }` | recipients of its collection |
| `share:created` | full outgoing `Share` | owner + recipient |
| `share:revoked` | `{ id, resourceId }` | owner + recipient |
| `share:role-updated` | full `Share` | owner + recipient |
| `incoming-share:accepted` | `IncomingShare` | recipient only |
| `incoming-share:rejected` | `IncomingShare` | recipient only |
| `incoming-share:deleted` | `{ id, resourceId }` | recipient only |
| `friendship:created` | `{ fromHandle, toHandle }` | both users |
| `friendship:removed` | `{ userId, friendHandle }` | both users |
| `friend-invitation:created` | `FriendInvitation` | both users |
| `friend-invitation:rejected` | `{ id, fromHandle, toHandle }` | both users |
| `friend-invitation:cancelled` | `{ id, fromHandle, toHandle }` | both users |
| `user:profile-updated` | `{ id, alias?, firstName?, lastName? }` | user's own devices + all friends |
| `realtime:reconnected` | `{}` (synthetic, client-only) | local — fires after reconnect |

All events have a stable server-assigned `id` (`evt_<uuid>`) and
`timestamp`. Clients can use `id` for consumer-side dedup (webhook
subscribers especially will need this).

## Adding a new event

Three steps.

1. **Pick a recipient resolver** in `server/src/services/realtime/recipients.service.ts`
   (or add one if yours is a novel shape).
2. **Emit at the write site** in the service function that does the
   DB write:
   ```ts
   await emit.collection('collection:foo-happened', row, row.id)
   ```
   Emit AFTER the transaction commits so a rollback doesn't leak an
   event for state that didn't actually change.
3. **Handle on the client** in the relevant store's `.realtime.ts`:
   ```ts
   registerRealtimeHandlers('collections', {
     'collection:foo-happened': (payload) => {
       useCollectionsStore().applyRemoteFoo(payload as Foo)
     },
   })
   ```
   Make the store method idempotent (upsert by id, remove by id). Events
   can arrive twice after a reconnect refetch.

## Scaling notes

**Today (single-node):** the registry is an in-memory `Map`. Connected
user count sits comfortably in the low thousands on one host.

**Multi-node upgrade path:** swap the registry for Redis pub/sub. The
one file that owns all socket refs makes this tractable — the event bus
API doesn't change, and subscribers don't know whether their target
socket lives on the same process.

**Webhook subscribers:** the plan calls for user-registered HTTP URLs
that receive the same events with HMAC signatures. Each event already
has a stable `id` for idempotency and the `publish` → subscriber shape
is designed for this. Add a new `webhookSubscriber` in `bootstrap.ts`
and the rest falls into place.

## Known limitations (v1)

- **No retry queue for federated events.** A transient network failure
  between peers means the receiving user won't see the event live; they
  catch up on their next REST fetch or `realtime:reconnected`.
- **Federated events aren't payload-signed.** The S2S wrapper
  authenticates that SOME trusted peer sent the message, but an
  attacker controlling a peer could spoof events for any user on that
  peer. Upgrade: sign payload with the originating user's Ed25519 key
  (same pattern as `RESOURCE_SHARE`).
- **Friends-store updates refetch rather than delta-apply.** The store
  doesn't currently expose upsert/delete-by-id methods. Refetch is
  idempotent and cheap for small friend lists; add delta paths if this
  becomes a bottleneck.
- **No rate limiting.** A compromised client can't escalate permissions
  (they can only receive events for their own resources) but could
  thrash the event bus. Add per-user quotas if abused.
