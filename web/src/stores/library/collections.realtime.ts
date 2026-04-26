/**
 * Realtime handlers for the collections store.
 *
 * Remote events → store mutations. Each handler is defensively written
 * against arbitrary payloads (runtime validation is light — we trust the
 * server and rely on shape checks here to skip obviously-bad frames
 * without crashing the app).
 *
 * Idempotency is a property of the store methods: `updateCollection` is
 * an upsert by id, `removeCollection` filters by id. So the same event
 * landing twice is harmless.
 */

import { useCollectionsStore } from './collections.store'
import { registerRealtimeHandlers } from '@/lib/realtime-events'
import { useCollectionsService } from '@/services/library/collections.service'
import type { Collection } from '@/types/library.types'

function isCollectionLike(p: unknown): p is Collection {
  return !!p && typeof p === 'object' && typeof (p as { id?: unknown }).id === 'string'
}

function applyUpdated(payload: unknown) {
  if (!isCollectionLike(payload)) return

  const store = useCollectionsStore()
  const existing = store.collections.find((c) => c.id === payload.id)

  // For a collection the caller doesn't own, the event's raw payload is
  // K_m-encrypted metadata that the recipient can't decrypt. Direct
  // upsert would wipe the name/icon we previously stamped from the
  // ECIES share envelope. Refetch instead — `fetchCollectionById` runs
  // the full hydrate pipeline (share-envelope branch included).
  const iAmRecipient =
    existing && existing.role && existing.role !== 'owner'
  if (iAmRecipient) {
    void useCollectionsService().fetchCollectionById(payload.id)
    return
  }

  // Owner path: K_m decrypt works client-side, safe to upsert directly.
  // Preserve any already-decrypted display fields in case the server's
  // payload lacks them (e.g. the row was never fetched via the service
  // that hydrates them).
  const merged: Collection = {
    ...payload,
    name: payload.name ?? existing?.name,
    description: payload.description ?? existing?.description,
    icon: payload.icon ?? existing?.icon,
    iconColor: payload.iconColor ?? existing?.iconColor,
    role: existing?.role ?? payload.role,
  }
  store.updateCollection(merged)
}

function applyDeleted(payload: unknown) {
  const id = (payload as { id?: unknown } | null)?.id
  if (typeof id !== 'string') return
  useCollectionsStore().removeCollection(id)
}

function applyPublicLinkChanged(payload: unknown) {
  // Public-link updates land as a full collection row (matching the
  // server's emit) so we can reuse the upsert path.
  applyUpdated(payload)
}

function applyRotatedOrSchemeChanged(payload: unknown) {
  // Rotation and scheme changes return a fresh collection row. Upserting
  // it is enough for the UI — but we ALSO need to drop any cached
  // encrypted_points / bookmarks that belong to the old scheme, since
  // the next fetch will bring the new ones. Simplest: let the service's
  // refetch handle it when the user next opens the collection.
  applyUpdated(payload)
}

/**
 * On reconnect, our socket missed anything that fired while we were
 * offline. Rather than try to replay events, just refetch the collection
 * list — the response is already upsert-safe.
 */
async function applyReconnected() {
  const service = useCollectionsService()
  await service.fetchCollections()
}

/**
 * The owner reissued the share envelope (usually after a metadata
 * change). Refetch the collection so the new envelope's metadata lands
 * in the store. Payload is the `Share` row with the resourceId we
 * care about.
 */
function applyShareEnvelopeUpdated(payload: unknown) {
  const resourceId = (payload as { resourceId?: unknown } | null)?.resourceId
  if (typeof resourceId !== 'string') return
  void useCollectionsService().fetchCollectionById(resourceId)
}

/**
 * A share was created/revoked/role-changed. The recipient may have gained
 * or lost access to a collection. Refetch the full list: cheap,
 * idempotent, and covers both directions without fragile existence
 * checks. Owners doing the operation also refetch — no-op for them.
 */
function applyShareChanged() {
  void useCollectionsService().fetchCollections()
}

/**
 * A share was revoked. Same handler as applyShareChanged, but for the
 * recipient we can take a fast path: their access to `resourceId`
 * definitely went away, so drop the row immediately. The follow-up
 * fetchCollections still runs for owner-side consistency.
 */
function applyShareRevoked(payload: unknown) {
  const resourceId = (payload as { resourceId?: unknown } | null)?.resourceId
  const store = useCollectionsStore()
  if (typeof resourceId === 'string') {
    const existing = store.collections.find((c) => c.id === resourceId)
    if (existing && existing.role && existing.role !== 'owner') {
      // Only the recipient drops the collection — the owner still has it.
      store.removeCollection(resourceId)
    }
  }
  void useCollectionsService().fetchCollections()
}

registerRealtimeHandlers('collections', {
  'collection:created': applyUpdated,
  'collection:updated': applyUpdated,
  'collection:deleted': applyDeleted,
  'collection:rotated': applyRotatedOrSchemeChanged,
  'collection:scheme-changed': applyRotatedOrSchemeChanged,
  'collection:public-link-changed': applyPublicLinkChanged,
  'share:envelope-updated': applyShareEnvelopeUpdated,
  // Share lifecycle events — the recipient may have just gained or lost
  // a collection in their library, so refetch (and fast-drop on revoke).
  'share:created': applyShareChanged,
  'share:revoked': applyShareRevoked,
  'share:role-updated': applyShareChanged,
  'realtime:reconnected': applyReconnected,
})

// Encrypted-point updates are emitted by the server but they live in the
// bookmarks store (rendered under a collection). We register a thin
// handler here that forwards to the bookmarks store's accessor — not
// ideal co-location, but simpler than adding a whole separate registry
// for encrypted points.
registerRealtimeHandlers('encrypted-points', {
  'encrypted-point:created': (_p) => {
    // Encrypted points need decryption before they're usable, which
    // involves the per-collection key. Simplest correct behavior: fire
    // a refetch on the owning collection so the service path that
    // already handles decryption fills them in.
    void useCollectionsService().fetchCollections()
  },
  'encrypted-point:updated': () => {
    void useCollectionsService().fetchCollections()
  },
  'encrypted-point:deleted': () => {
    void useCollectionsService().fetchCollections()
  },
})
