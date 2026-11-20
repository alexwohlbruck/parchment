import { createSharedComposable } from '@vueuse/core'
import { toast } from '@/lib/toast'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.store'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useCategoryPaletteStore } from '@/stores/category-palette.store'
import { useSyncStore } from '@/stores/sync.store'
import { useHistoryStore } from '@/stores/history.store'
import { useThemeStore } from '@/stores/theme.store'
import type { Place } from '@/types/place.types'
import type {
  CreateBookmarkParams,
  Bookmark,
  Collection,
  DecryptedPoint,
} from '@/types/library.types'
import { useCollectionsService } from '@/services/library/collections.service'
import { useEncryptedPointsStore } from '@/stores/library/encrypted-points.store'
import { encryptCollectionPoint } from '@/lib/identity/library-crypto'
import { ref } from 'vue'
import { api } from '@/lib/api'
import { isOffline } from '@/lib/connectivity'
import {
  getNetworkErrorKind,
  isRetriableNetworkError,
} from '@/lib/network-errors'
import { newOfflineId } from '@/lib/sync/offline-id'
import { closestThemeColor } from '@/lib/utils'
import { type FrequentType } from '@/lib/frequents'
import type {
  CreateBookmarkMutation,
  RemoveBookmarkMutation,
  UpdateBookmarkMutation,
} from '@/services/library/bookmarks.sync'
import { isSamePlace } from '@/lib/library/external-ids'
import { canWriteCollection } from '@/lib/library/collection-access'

/** Plain-JSON snapshot of a (possibly reactive) row, for queue payloads. */
function snapshot<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

// TODO: i18n error messages

export const useBookmarksService = createSharedComposable(() => {
  const authStore = useAuthStore()
  const bookmarksStore = useBookmarksStore()
  const collectionsStore = useCollectionsStore()
  const collectionsService = useCollectionsService()
  const encryptedPointsStore = useEncryptedPointsStore()
  const categoryPaletteStore = useCategoryPaletteStore()
  const syncStore = useSyncStore()
  const historyStore = useHistoryStore()
  const themeStore = useThemeStore()
  const { t } = useI18n()
  const isSaving = ref(false)

  /**
   * What a saved copy of `place` records. The POI's own icon and its
   * category colour, snapped to a `ThemeColor`, are stamped once and never
   * edited. Null, after a toast, when the place can't be saved.
   */
  function placeFields(place: Place, name?: string): CreateBookmarkParams | null {
    if (!place.externalIds || Object.keys(place.externalIds).length === 0) {
      toast.error(t('services.bookmarks.saveErrorNoOsmId'))
      return null
    }
    const center = place.geometry?.value?.center
    if (!center) {
      toast.error(t('services.bookmarks.saveErrorNoCoordinates'))
      return null
    }
    const placeIcon = place.icon
    const categoryColor = placeIcon?.category
      ? categoryPaletteStore.getCategoryColor(placeIcon.category, themeStore.isDark)
      : null
    return {
      externalIds: place.externalIds,
      name: name || place.name.value || '',
      address: place.address?.value.formatted,
      lat: center.lat,
      lng: center.lng,
      icon: placeIcon?.icon,
      iconPack: placeIcon?.iconPack,
      iconColor: closestThemeColor(categoryColor),
    }
  }

  /**
   * Save a place into a private collection as an encrypted point. A place
   * already in it is left alone. Resolves to the point, or null on failure.
   */
  async function saveToPrivateCollection(
    collection: Collection,
    fields: CreateBookmarkParams,
  ): Promise<DecryptedPoint | null> {
    const existing = (await collectionsService.fetchAndDecryptPoints(collection)).find(
      p => isSamePlace(fields.externalIds, p.externalIds),
    )
    if (existing) return existing

    try {
      const now = new Date().toISOString()
      const point = await writePrivatePoint(collection, {
        id: crypto.randomUUID(),
        externalIds: fields.externalIds,
        name: fields.name,
        address: fields.address ?? null,
        lat: fields.lat,
        lng: fields.lng,
        icon: fields.icon ?? 'map-pin',
        iconPack: fields.iconPack ?? 'lucide',
        iconColor: fields.iconColor ?? 'cobalt',
        frequentType: null,
        createdAt: now,
        updatedAt: now,
      })
      rememberLastSaved([collection.id])
      let current = point
      historyStore.record(
        {
          label: t('history.savedTo', {
            name: point.name,
            collection: collectionsService.getCollectionDisplayName(collection),
          }),
          undoneLabel: t('history.removedFrom', {
            name: point.name,
            collection: collectionsService.getCollectionDisplayName(collection),
          }),
          undo: () => deletePrivatePoint(collection, current),
          redo: async () => {
            current = await writePrivatePoint(collection, {
              ...current,
              id: crypto.randomUUID(),
            })
          },
        },
        { view: collectionsService.viewCollectionAction(collection.id) },
      )
      return point
    } catch (err) {
      console.error('[bookmarks] private save failed', err)
      toast.error(t('services.bookmarks.saveError'), { cause: err })
      return null
    }
  }

  /** Encrypt `point` into a private collection and hold it locally. */
  async function writePrivatePoint(
    collection: Collection,
    point: DecryptedPoint,
  ): Promise<DecryptedPoint> {
    const source = await collectionsService.collectionKeySource(collection)
    if (!source) throw new Error('No key to this collection on this device')
    await collectionsService.createEncryptedPoint(collection.id, {
      id: point.id,
      encryptedData: encryptCollectionPoint({
        point,
        pointId: point.id,
        source,
        ownerUserId: collection.userId,
        collectionId: collection.id,
        keyVersion: collection.metadataKeyVersion,
      }),
    })
    encryptedPointsStore.addPoint(collection.id, point)
    return point
  }

  async function removeFromPrivateCollection(
    collection: Collection,
    point: DecryptedPoint,
  ): Promise<boolean> {
    try {
      await deletePrivatePoint(collection, point)
      let current = point
      historyStore.record({
        label: t('history.removedFrom', {
          name: point.name,
          collection: collectionsService.getCollectionDisplayName(collection),
        }),
        undoneLabel: t('history.putBackIn', {
          name: point.name,
          collection: collectionsService.getCollectionDisplayName(collection),
        }),
        undo: async () => {
          current = await writePrivatePoint(collection, {
            ...current,
            id: crypto.randomUUID(),
          })
        },
        redo: () => deletePrivatePoint(collection, current),
      })
      return true
    } catch (err) {
      console.error('[bookmarks] private remove failed', err)
      toast.error(t('services.bookmarks.removeFromCollectionError'), { cause: err })
      return false
    }
  }

  async function deletePrivatePoint(collection: Collection, point: DecryptedPoint) {
    await collectionsService.deleteEncryptedPoint(collection.id, point.id)
    encryptedPointsStore.removePoint(collection.id, point.id)
  }

  // Remember the most recently written-to collection so the bookmark
  // button can target it directly on the next save. Last-write-wins across
  // both new bookmarks and picker toggles.
  function rememberLastSaved(collectionIds: string[] | undefined) {
    if (!collectionIds || collectionIds.length === 0) return
    collectionsStore.setLastSavedCollectionId(
      collectionIds[collectionIds.length - 1],
    )
  }

  async function createBookmark(
    place: Place,
    collectionIds?: string[],
    options: {
      frequentType?: FrequentType
      silent?: boolean
      /** Override the bookmark name (used for custom frequents). */
      name?: string
    } = {},
  ) {
    const fields = placeFields(place, options.name)
    if (!fields) return null

    isSaving.value = true

    // Preset saves surface their own "Set as Home" toast (handled by the
    // caller in `setFrequent`), so skip the generic "Saved to collection"
    // one to avoid a double toast.
    //
    // Last element of collectionIds is the one we want to surface in the
    // toast — that's the same collection we just pinned as the target for
    // the next one-tap save, so "Saved {name} to {collection}" matches
    // what the user just did. Fall back to a generic message if the
    // collection can't be resolved (e.g. stale cache).
    function notifySaved(bookmark: Bookmark) {
      if (options.silent) return
      const targetId = collectionIds?.[collectionIds.length - 1]
      recordChange(
        bookmark.id,
        null,
        { bookmark: snapshot(bookmark)!, collectionIds: collectionIds ?? [] },
        { view: collectionsService.viewCollectionAction(targetId) },
      )
    }

    const params: CreateBookmarkParams & { collectionIds?: string[] } = {
      ...fields,
      ...(options.frequentType ? { frequentType: options.frequentType } : {}),
      collectionIds,
    }

    // Offline: save locally under a temp id and queue the create for replay.
    function createOffline(): Bookmark {
      const tempId = newOfflineId()
      const now = new Date().toISOString()
      const bookmark: Bookmark = {
        id: tempId,
        externalIds: params.externalIds,
        name: params.name,
        address: params.address,
        lat: params.lat,
        lng: params.lng,
        icon: params.icon ?? '',
        iconPack: params.iconPack,
        iconColor: params.iconColor ?? '',
        ...(params.frequentType ? { frequentType: params.frequentType } : {}),
        userId: authStore.me?.id ?? '',
        createdAt: now,
        updatedAt: now,
        collectionIds: collectionIds ?? [],
      }
      bookmarksStore.addBookmark(bookmark)
      collectionIds?.forEach(id =>
        collectionsStore.addBookmarkToCollection(id, bookmark),
      )
      rememberLastSaved(collectionIds)
      syncStore.enqueue(
        'bookmark:create',
        { tempId, params: snapshot(params)! } satisfies CreateBookmarkMutation,
        t('offline.sync.labels.save', { name: params.name }),
      )
      notifySaved(bookmark)
      return bookmark
    }

    try {
      if (isOffline.value) return createOffline()

      const response = await api.post('/library/bookmarks', params)
      const bookmark = response.data

      bookmarksStore.addBookmark(bookmark)
      rememberLastSaved(collectionIds)
      notifySaved(bookmark)

      return bookmark
    } catch (error) {
      // The request itself died on the network — treat it like an offline
      // save rather than losing the user's action.
      if (isRetriableNetworkError(getNetworkErrorKind(error))) {
        return createOffline()
      }
      toast.error(t('services.bookmarks.saveError'), { cause: error })
      return null
    } finally {
      isSaving.value = false
    }
  }

  // TODO: Clean this up
  async function updateBookmark(
    id: string,
    updates: Partial<Bookmark> & { collectionIds?: string[] },
    options: {
      silent?: boolean
      // ID of a collection the caller just ADDED this bookmark to —
      // used to render an "Added to X" toast with a View action that
      // jumps straight to that collection. Pass `undefined` for any
      // other update (rename, color change, removing a collection)
      // and the toast falls back to the generic "Bookmark updated".
      addedCollectionId?: string
    } = {},
  ): Promise<Bookmark | null> {
    const before = stateOf(id)

    /** Record the change, unless the caller announces it itself. */
    function announce(result: Bookmark | null) {
      if (options.silent) return
      const after: SavedState = result && {
        bookmark: snapshot(result)!,
        collectionIds: updates.collectionIds ?? before?.collectionIds ?? [],
      }
      const view = result && options.addedCollectionId
        ? collectionsService.viewCollectionAction(options.addedCollectionId)
        : undefined
      recordChange(id, before, after, { view })
    }

    // Offline: apply the change locally and queue the PUT for replay. The
    // server deletes a bookmark whose last collection is removed (the 204
    // branch below), so mirror that locally too.
    function updateOffline(): Bookmark | null {
      const current = bookmarksStore.getBookmarkById(id)
      const previous = snapshot(current)
      const merged = current
        ? ({
            ...previous,
            ...snapshot(updates),
            updatedAt: new Date().toISOString(),
          } as Bookmark)
        : undefined
      const removesBookmark =
        Array.isArray(updates.collectionIds) &&
        updates.collectionIds.length === 0 &&
        !merged?.frequentType

      if (removesBookmark) {
        bookmarksStore.removeBookmark(id)
        collectionsStore.removeBookmarkFromCollections(id)
      } else if (merged) {
        const before = previous?.collectionIds ?? []
        const after = merged.collectionIds ?? before
        bookmarksStore.updateBookmark(id, merged)
        after
          .filter(collectionId => !before.includes(collectionId))
          .forEach(collectionId =>
            collectionsStore.addBookmarkToCollection(collectionId, merged),
          )
        before
          .filter(collectionId => !after.includes(collectionId))
          .forEach(collectionId =>
            collectionsStore.removeBookmarkFromSingleCollection(
              collectionId,
              id,
            ),
          )
      }
      rememberLastSaved(updates.collectionIds)
      syncStore.enqueue(
        'bookmark:update',
        {
          id,
          updates: snapshot(updates)!,
          previous,
        } satisfies UpdateBookmarkMutation,
        t('offline.sync.labels.update', {
          name: current?.name || t('library.entities.bookmarks.title.singular'),
        }),
      )
      announce(removesBookmark ? null : (merged ?? null))
      return removesBookmark ? null : (merged ?? null)
    }

    try {
      if (isOffline.value) return updateOffline()

      // Use PUT method again
      const response = await api.put(`/library/bookmarks/${id}`, updates)

      if (response && response.status === 200 && response.data) {
        // Added or removed collection-bookmark relations
        const updatedBookmark = response.data
        bookmarksStore.updateBookmark(id, updatedBookmark)
        if (updates.collectionIds) {
          collectionsStore.setBookmarkCollections(updatedBookmark, updates.collectionIds)
        }
        rememberLastSaved(updates.collectionIds)
        announce(updatedBookmark)
        return updatedBookmark
      } else if (response && response.status === 204) {
        // Completely removed bookmark from all collections
        bookmarksStore.removeBookmark(id)
        collectionsStore.removeBookmarkFromCollections(id)
        announce(null)
        return null
      } else {
        console.warn('Unexpected success status:', response?.status)
        bookmarksStore.removeBookmark(id)
        if (!options.silent) {
          toast.error(t('services.bookmarks.updateError'))
        }
        return null
      }
    } catch (error: any) {
      if (isRetriableNetworkError(getNetworkErrorKind(error))) {
        return updateOffline()
      }
      if (error.response && error.response.status === 404) {
        toast.error(t('services.bookmarks.updateErrorNotFound'), { cause: error })
        bookmarksStore.removeBookmark(id)
      } else {
        toast.error(t('services.bookmarks.updateError'), { cause: error })
      }
      console.error(`Error updating bookmark ${id}:`, error)
      return null
    }
  }

  // Removes a bookmark from specific collections
  async function removeBookmark(
    bookmarkId: string,
    collectionIds: string[],
    bookmarkName: string,
  ) {
    if (!collectionIds || collectionIds.length === 0) {
      console.warn('No collection IDs provided for removal.')
      return false
    }

    const before = stateOf(bookmarkId)
    const after = before && {
      ...before,
      collectionIds: before.collectionIds.filter(id => !collectionIds.includes(id)),
    }

    function applyRemovalLocally() {
      collectionIds.forEach(collectionId => {
        collectionsStore.removeBookmarkFromSingleCollection(
          collectionId,
          bookmarkId,
        )
      })
      // The server deletes a bookmark left in no collection.
      if (!isKept(after)) bookmarksStore.removeBookmark(bookmarkId)
      recordChange(bookmarkId, before, after)
    }

    // Offline: unlink locally and queue the DELETE for replay.
    function removeOffline(): boolean {
      const bookmark = snapshot(bookmarksStore.getBookmarkById(bookmarkId))
      applyRemovalLocally()
      syncStore.enqueue(
        'bookmark:remove',
        { bookmarkId, collectionIds, bookmark } satisfies RemoveBookmarkMutation,
        t('offline.sync.labels.remove', { name: bookmarkName }),
      )
      return true
    }

    try {
      if (isOffline.value) return removeOffline()

      // Server route is `DELETE /library/bookmarks/:id` with the
      // collectionIds in the body. There's no `/collections` suffix —
      // the URL was inherited from a refactor that consolidated the
      // endpoints, and the wrong path silently 404s back.
      await api.delete(`/library/bookmarks/${bookmarkId}`, {
        data: { collectionIds },
      })

      applyRemovalLocally()
      return true
    } catch (error) {
      if (isRetriableNetworkError(getNetworkErrorKind(error))) {
        return removeOffline()
      }
      toast.error(t('services.bookmarks.removeFromCollectionError'), { cause: error })
      return false
    }
  }

  /** A bookmark as undo puts it back: its row and where it is filed. */
  type SavedState = { bookmark: Bookmark; collectionIds: string[] } | null

  function stateOf(id: string): SavedState {
    const bookmark = snapshot(bookmarksStore.getBookmarkById(id))
    if (!bookmark) return null
    return { bookmark, collectionIds: collectionsStore.getCollectionIdsForBookmark(id) }
  }

  /** The server keeps a bookmark only while it is filed somewhere or is a frequent. */
  function isKept(state: SavedState): state is NonNullable<SavedState> {
    return !!state && (state.collectionIds.length > 0 || !!state.bookmark.frequentType)
  }

  /**
   * Make bookmark `id` match `state`, creating or deleting it as needed.
   * Resolves to its id, which changes when it has to be created again.
   */
  async function putBack(id: string, state: SavedState): Promise<string> {
    const exists = !!bookmarksStore.getBookmarkById(id)
    if (!isKept(state)) {
      if (exists) {
        await updateBookmark(
          id,
          { collectionIds: [], frequentType: null } as unknown as Partial<Bookmark>,
          { silent: true },
        )
      }
      collectionsStore.removeBookmarkFromCollections(id)
      bookmarksStore.removeBookmark(id)
      return id
    }

    const { bookmark, collectionIds } = state
    let current: Bookmark | null
    if (exists) {
      current = await updateBookmark(
        id,
        {
          name: bookmark.name,
          icon: bookmark.icon,
          iconPack: bookmark.iconPack,
          iconColor: bookmark.iconColor,
          frequentType: bookmark.frequentType ?? null,
          collectionIds,
        } as unknown as Partial<Bookmark>,
        { silent: true },
      )
    } else {
      const { data } = await api.post('/library/bookmarks', {
        externalIds: bookmark.externalIds,
        name: bookmark.name,
        address: bookmark.address,
        lat: bookmark.lat,
        lng: bookmark.lng,
        icon: bookmark.icon,
        iconPack: bookmark.iconPack,
        iconColor: bookmark.iconColor,
        ...(bookmark.frequentType ? { frequentType: bookmark.frequentType } : {}),
        collectionIds,
      })
      current = data
      if (current) bookmarksStore.addBookmark(current)
    }
    if (!current) throw new Error(`Could not restore bookmark ${id}`)
    collectionsStore.setBookmarkCollections(current, collectionIds)
    return current.id
  }

  function collectionNames(ids: string[]) {
    return ids
      .map(id => collectionsService.getCollectionDisplayName(collectionsStore.getCollectionById(id) ?? null))
      .join(', ')
  }

  /** A change from one state to another, in words: "Added X to Coffee". */
  function describe(from: SavedState, to: SavedState, undoing: boolean): string {
    const name = (to ?? from)?.bookmark.name || t('library.entities.bookmarks.title.singular')
    if (!isKept(to)) return t('history.removed', { name })
    const added = to.collectionIds.filter(id => !from?.collectionIds.includes(id))
    const removed = (from?.collectionIds ?? []).filter(id => !to.collectionIds.includes(id))
    if (!isKept(from)) {
      if (undoing) {
        return added.length
          ? t('history.putBackIn', { name, collection: collectionNames(added) })
          : t('history.putBack', { name })
      }
      return added.length
        ? t('history.savedTo', { name, collection: collectionNames(added) })
        : t('history.saved', { name })
    }
    if (added.length) {
      return t(undoing ? 'history.putBackIn' : 'history.addedTo', {
        name,
        collection: collectionNames(added),
      })
    }
    if (removed.length) {
      return t('history.removedFrom', { name, collection: collectionNames(removed) })
    }
    return t(undoing ? 'history.changedBack' : 'history.updated', { name })
  }

  /** Put a bookmark change on the undo stack, and toast it. */
  function recordChange(
    id: string,
    before: SavedState,
    after: SavedState,
    options: { label?: string; view?: { label: string; onClick: () => void } } = {},
  ) {
    let current = id
    historyStore.record(
      {
        label: options.label ?? describe(before, after, false),
        undoneLabel: describe(after, before, true),
        undo: async () => {
          current = await putBack(current, before)
        },
        redo: async () => {
          current = await putBack(current, after)
        },
      },
      { view: options.view },
    )
  }

  function isBookmarkSaved(bookmark: Bookmark) {
    if (!bookmark.id) return false

    return bookmarksStore.bookmarks.some(
      existing => existing.id === bookmark.id,
    )
  }

  // ── Frequents (Home / Work / School / Custom) ───────────────────────
  // Frequents are bookmarks tagged with `frequentType`. Unlike ordinary
  // bookmarks they are *standalone* — not linked to any collection — so they
  // have a dedicated fetch since the collection hydrate
  // won't surface them. The same place can still be added to a collection
  // separately. A bookmark carries at most one `frequentType`.

  /** All bookmarks tagged with a frequent type, in save order. */
  function getFrequentBookmarks(): Bookmark[] {
    return bookmarksStore.bookmarks.filter(b => b.frequentType)
  }

  /**
   * Replace the store with the user's full bookmark list.
   *
   * The store is localStorage-backed and otherwise only fills up
   * opportunistically (on create, or when a collection view is opened), so
   * without this a fresh device shows no saved places until the user browses
   * to a collection. Rows come back with `collectionIds`, which the map layer
   * needs to honour per-collection visibility.
   */
  async function fetchBookmarks(): Promise<void> {
    try {
      const { data } = await api.get<Bookmark[]>('/library/bookmarks')
      bookmarksStore.setBookmarks(data ?? [])
    } catch (e) {
      // Non-fatal: the cached store still renders. Logged, not toasted —
      // this runs during boot and the user didn't ask for it.
      console.warn('Failed to fetch bookmarks:', e)
    }
  }

  /**
   * Pick a collection to file a newly-created preset into. Prefers the most
   * recently used collection, else the first writable owned collection.
   * Returns null when the user has no writable collection at all.
   */
  function resolveDefaultCollectionId(): string | null {
    const writable = collectionsStore.collections.filter(
      c => canWriteCollection(c) && !c.archivedAt,
    )
    if (writable.length === 0) return null

    const lastSaved = collectionsStore.lastSavedCollectionId
    if (lastSaved && writable.some(c => c.id === lastSaved)) return lastSaved

    return writable[0].id
  }

  /** Find the id of an already-saved bookmark matching a place's externalIds. */
  function findBookmarkIdForPlace(place: Place): string | undefined {
    if (place.bookmark?.id) return place.bookmark.id
    const ids = place.externalIds
    if (!ids) return undefined
    return bookmarksStore.bookmarks.find(b => isSamePlace(ids, b.externalIds))?.id
  }

  /**
   * Mark a place as a frequent (Home/Work/School/Custom). Updates the tag if
   * the place is already bookmarked; otherwise creates a bookmark in the
   * default collection.
   *
   * A frequent's icon and colour come from its `frequentType` at render time
   * (see `frequentChipMeta`), not from the bookmark row — so nothing about the
   * look is stored here. `custom` takes an optional user-supplied `name` as
   * its label.
   */
  async function setFrequent(
    place: Place,
    frequentType: FrequentType,
    opts: { name?: string } = {},
  ): Promise<Bookmark | null> {
    const targetBookmarkId = findBookmarkIdForPlace(place)
    const name = opts.name?.trim() || undefined
    const before = targetBookmarkId ? stateOf(targetBookmarkId) : null

    let result: Bookmark | null
    if (targetBookmarkId) {
      result = await updateBookmark(
        targetBookmarkId,
        { frequentType, ...(name ? { name } : {}) },
        { silent: true },
      )
    } else {
      // Frequents are standalone — created with no collection. The same place
      // can still be added to a collection separately.
      result = await createBookmark(place, [], {
        frequentType,
        silent: true,
        ...(name ? { name } : {}),
      })
    }

    if (result) {
      recordChange(
        result.id,
        before,
        { bookmark: snapshot(result)!, collectionIds: before?.collectionIds ?? [] },
        {
          label: t('services.bookmarks.frequentSet', {
            label: name || t(`library.types.${frequentType}`),
          }),
        },
      )
    }
    return result
  }

  /** Remove the Home/Work/School tag from a specific bookmark. */
  async function clearFrequent(bookmarkId: string): Promise<void> {
    const current = bookmarksStore.getBookmarkById(bookmarkId)
    if (!current?.frequentType) return
    const label = t(`library.types.${current.frequentType}`)
    const before = stateOf(bookmarkId)
    const result = await updateBookmark(
      bookmarkId,
      { frequentType: null } as unknown as Partial<Bookmark>,
      { silent: true },
    )
    recordChange(
      bookmarkId,
      before,
      result && { bookmark: snapshot(result)!, collectionIds: before?.collectionIds ?? [] },
      { label: t('services.bookmarks.frequentRemoved', { label }) },
    )
  }

  return {
    isSaving,
    placeFields,
    saveToPrivateCollection,
    removeFromPrivateCollection,
    createBookmark,
    updateBookmark,
    removeBookmark,
    isBookmarkSaved,
    getFrequentBookmarks,
    fetchBookmarks,
    setFrequent,
    clearFrequent,
  }
})
