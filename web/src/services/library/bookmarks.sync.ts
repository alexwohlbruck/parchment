/**
 * Replayable bookmark mutations for the offline sync queue.
 *
 * The service applies each change optimistically and enqueues one of these;
 * `execute` performs the deferred server write once connectivity returns and
 * reconciles local state with the server's answer, `rollback` undoes the
 * optimistic change when the user cancels or the server definitively refuses.
 *
 * Imported for its side effects from `bookmarks.service.ts` — handlers must
 * be registered at module load so queue entries persisted by a previous
 * session can replay in this one.
 */

import { api } from '@/lib/api'
import { registerMutationHandler } from '@/lib/sync/mutation-registry'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import { useCollectionsStore } from '@/stores/library/collections.store'
import type { Bookmark, CreateBookmarkParams } from '@/types/library.types'

export interface CreateBookmarkMutation {
  tempId: string
  params: CreateBookmarkParams & { collectionIds?: string[] }
}

export interface UpdateBookmarkMutation {
  id: string
  updates: Partial<Bookmark> & { collectionIds?: string[] }
  /** Snapshot taken before the optimistic update, for rollback. */
  previous?: Bookmark
}

export interface RemoveBookmarkMutation {
  bookmarkId: string
  collectionIds: string[]
  /** Snapshot for restoring the links on rollback. */
  bookmark?: Bookmark
}

registerMutationHandler<CreateBookmarkMutation>('bookmark:create', {
  async execute({ tempId, params }, ctx) {
    const { data } = await api.post('/library/bookmarks', {
      ...params,
      collectionIds: params.collectionIds?.map(ctx.resolveId),
    })
    ctx.mapId(tempId, data.id)
    useBookmarksStore().replaceBookmark(tempId, {
      ...data,
      collectionIds: data.collectionIds ?? params.collectionIds,
    })
  },
  rollback({ tempId }) {
    useBookmarksStore().removeBookmark(tempId)
    useCollectionsStore().removeBookmarkFromCollections(tempId)
  },
})

registerMutationHandler<UpdateBookmarkMutation>('bookmark:update', {
  async execute({ id, updates }, ctx) {
    const realId = ctx.resolveId(id)
    const response = await api.put(`/library/bookmarks/${realId}`, {
      ...updates,
      ...(updates.collectionIds
        ? { collectionIds: updates.collectionIds.map(ctx.resolveId) }
        : {}),
    })
    const bookmarksStore = useBookmarksStore()
    if (response.status === 200 && response.data) {
      bookmarksStore.updateBookmark(realId, response.data)
    } else if (response.status === 204) {
      // Removing the last collection deletes the bookmark server-side.
      bookmarksStore.removeBookmark(realId)
      useCollectionsStore().removeBookmarkFromCollections(realId)
    }
  },
  rollback({ id, previous }) {
    if (!previous) return
    const bookmarksStore = useBookmarksStore()
    if (bookmarksStore.getBookmarkById(id)) {
      bookmarksStore.updateBookmark(id, previous)
    } else {
      bookmarksStore.addBookmark(previous)
    }
  },
})

registerMutationHandler<RemoveBookmarkMutation>('bookmark:remove', {
  async execute({ bookmarkId, collectionIds }, ctx) {
    await api.delete(`/library/bookmarks/${ctx.resolveId(bookmarkId)}`, {
      data: { collectionIds: collectionIds.map(ctx.resolveId) },
    })
  },
  rollback({ bookmarkId, collectionIds, bookmark }) {
    if (!bookmark) return
    const collectionsStore = useCollectionsStore()
    collectionIds.forEach(collectionId =>
      collectionsStore.addBookmarkToCollection(collectionId, bookmark),
    )
  },
})
