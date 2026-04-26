/**
 * Realtime handlers for the bookmarks store.
 *
 * Payload shapes mirror what the server emits in bookmarks.service.ts:
 *   - bookmark:created  → full Bookmark row
 *   - bookmark:updated  → full Bookmark row
 *   - bookmark:deleted  → { id, collectionIds }
 *   - bookmark:unlinked → { id, collectionIds }  (removed from a subset
 *                         of collections; the bookmark may still exist)
 *
 * All apply-remote methods upsert/remove by id so same event delivered
 * twice is a no-op.
 */

import { useBookmarksStore } from './bookmarks.store'
import { useCollectionsStore } from './collections.store'
import { registerRealtimeHandlers } from '@/lib/realtime-events'
import type { Bookmark } from '@/types/library.types'

/**
 * Server emits carry `collectionIds` alongside the bookmark payload so
 * recipients can update both stores (bookmarks + collections pivot) in
 * one apply. The field is stripped before handing the payload to
 * `addBookmark` / `updateBookmark` so it doesn't pollute the Bookmark
 * type downstream.
 */
interface BookmarkPayloadWithCollections extends Bookmark {
  collectionIds?: string[]
}

function isBookmarkLike(p: unknown): p is BookmarkPayloadWithCollections {
  return !!p && typeof p === 'object' && typeof (p as { id?: unknown }).id === 'string'
}

/**
 * Link a bookmark into a collection if it isn't already there. The
 * underlying store method pushes without dedup, so we check first —
 * realtime events can re-arrive after a reconnect and land twice.
 */
function linkIfAbsent(cid: string, bookmark: Bookmark) {
  const store = useCollectionsStore()
  const collection = store.collections.find((c) => c.id === cid)
  if (collection?.bookmarkIds?.includes(bookmark.id)) return
  store.addBookmarkToCollection(cid, bookmark)
}

function applyCreated(payload: unknown) {
  if (!isBookmarkLike(payload)) return
  const { collectionIds, ...bookmark } = payload
  useBookmarksStore().addBookmark(bookmark as Bookmark)

  if (collectionIds && collectionIds.length > 0) {
    for (const cid of collectionIds) {
      linkIfAbsent(cid, bookmark as Bookmark)
    }
  }
}

function applyUpdated(payload: unknown) {
  if (!isBookmarkLike(payload)) return
  const { collectionIds, ...bookmark } = payload
  const bookmarksStore = useBookmarksStore()
  bookmarksStore.updateBookmark(bookmark.id, bookmark)

  // Sync collection membership. If the owner moved the bookmark between
  // collections, the recipient's view should reflect the new set without
  // a round-trip. Drop from every collection first, then add to the
  // authoritative new list.
  if (collectionIds) {
    const collectionsStore = useCollectionsStore()
    collectionsStore.removeBookmarkFromCollections(bookmark.id)
    for (const cid of collectionIds) {
      linkIfAbsent(cid, bookmark as Bookmark)
    }
  }
}

function applyDeleted(payload: unknown) {
  const id = (payload as { id?: unknown } | null)?.id
  if (typeof id !== 'string') return
  useBookmarksStore().removeBookmark(id)
  useCollectionsStore().removeBookmarkFromCollections(id)
}

/**
 * Unlinking means the bookmark was dropped from these specific
 * collections but may still exist under others. Remove the link only
 * from the listed collections — the bookmark row stays in the
 * bookmarks store.
 */
function applyUnlinked(payload: unknown) {
  const p = payload as { id?: unknown; collectionIds?: unknown } | null
  const id = p?.id
  const collectionIds = p?.collectionIds
  if (typeof id !== 'string' || !Array.isArray(collectionIds)) return

  const store = useCollectionsStore()
  for (const cid of collectionIds) {
    if (typeof cid !== 'string') continue
    const collection = store.collections.find((c) => c.id === cid)
    if (collection?.bookmarkIds) {
      collection.bookmarkIds = collection.bookmarkIds.filter((x) => x !== id)
    }
  }
}

registerRealtimeHandlers('bookmarks', {
  'bookmark:created': applyCreated,
  'bookmark:updated': applyUpdated,
  'bookmark:deleted': applyDeleted,
  'bookmark:unlinked': applyUnlinked,
})
