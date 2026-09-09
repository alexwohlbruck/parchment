import { createSharedComposable } from '@vueuse/core'
import { toast } from '@/lib/toast'
import { api } from '@/lib/api'
import { isOffline } from '@/lib/connectivity'
import {
  getNetworkErrorKind,
  isRetriableNetworkError,
} from '@/lib/network-errors'
import { newOfflineId } from '@/lib/sync/offline-id'
import { useSyncStore } from '@/stores/sync.store'
import { i18n } from '@/lib/i18n'
import type {
  CreateCanvasMutation,
  DeleteCanvasMutation,
  SaveCanvasBodyMutation,
  UpdateCanvasMutation,
} from '@/services/library/canvases.sync'
import { getSeed } from '@/lib/identity/key-storage'
import { useAuthStore } from '@/stores/auth.store'
import { useCanvasesStore } from '@/stores/library/canvases.store'
import {
  encryptCanvasMetadata,
  decryptCanvasMetadata,
  encryptCanvasBody,
  decryptCanvasBody,
  type CanvasMetadata,
} from '@/lib/identity/library-crypto'
import {
  emptyCanvasBody,
  type Canvas,
  type CanvasBody,
  type CanvasScheme,
  type CreateCanvasParams,
} from '@/types/canvas.types'

/**
 * Canvases service — fetch, decrypt, and persist user-built maps.
 *
 * The scheme decides what goes on the wire. A `server-key` canvas sends its
 * name and layer stack as they are; a `user-e2ee` one sends two envelopes and
 * explicitly nulls the cleartext columns, so a switch can never leave readable
 * leftovers behind. Callers upstream see one shape either way.
 *
 * Creation is two steps — mint the row to learn its id, then write the payload
 * derived from that id. Only the e2ee path actually needs the id first, but
 * one path is worth more than the round trip saved.
 */

/** Shown when an e2ee action is attempted on a device with no identity key. */
const IDENTITY_REQUIRED =
  'This device has no identity key yet — import your recovery key first.'

function stampMetadata(canvas: Canvas, metadata: CanvasMetadata): void {
  if (metadata.name !== undefined) canvas.name = metadata.name
  if (metadata.description !== undefined) canvas.description = metadata.description
  if (metadata.icon !== undefined) canvas.icon = metadata.icon
  if (metadata.iconPack !== undefined) canvas.iconPack = metadata.iconPack
  if (metadata.iconColor !== undefined) canvas.iconColor = metadata.iconColor
}

/**
 * Fill in a canvas's display fields and body.
 *
 * A server-key canvas already carries them, so this is a no-op; a user-e2ee
 * one has to be decrypted. One that won't decrypt still flows into the store,
 * flagged, so it renders with a placeholder rather than vanishing.
 */
async function hydrateCanvas(
  canvas: Canvas,
  userId: string | undefined,
): Promise<Canvas> {
  if (canvas.scheme === 'server-key') {
    if (!canvas.body) canvas.body = emptyCanvasBody()
    return canvas
  }
  if (!userId) return canvas
  const seed = await getSeed()
  if (!seed) {
    canvas.undecryptable = true
    return canvas
  }

  if (canvas.metadataEncrypted) {
    try {
      stampMetadata(
        canvas,
        decryptCanvasMetadata({
          envelope: canvas.metadataEncrypted,
          seed,
          userId,
          canvasId: canvas.id,
        }),
      )
    } catch {
      canvas.undecryptable = true
    }
  }

  if (canvas.bodyEncrypted) {
    try {
      canvas.body = decryptCanvasBody<CanvasBody>({
        envelope: canvas.bodyEncrypted,
        seed,
        userId,
        canvasId: canvas.id,
      })
    } catch {
      canvas.undecryptable = true
    }
  }

  if (!canvas.body) canvas.body = emptyCanvasBody()
  return canvas
}

export const useCanvasesService = createSharedComposable(() => {
  const syncStore = useSyncStore()
  const t = (key: string, named?: Record<string, unknown>) =>
    (i18n.global as any).t(key, named ?? {})
  const canvasesStore = useCanvasesStore()
  const authStore = useAuthStore()

  function displayName(canvas: Canvas | null | undefined): string {
    if (!canvas) return ''
    return canvas.name || 'Untitled canvas'
  }

  async function requireIdentity() {
    const seed = await getSeed()
    if (!seed) throw new Error('No identity seed — cannot encrypt canvas')
    const userId = authStore.me?.id
    if (!userId) throw new Error('Not signed in')
    return { seed, userId }
  }

  /**
   * The wire form of a canvas's display fields. Nulls the side it isn't
   * using, so a scheme switch can't leave a readable name behind.
   */
  async function buildMetadataPayload(
    canvasId: string,
    scheme: CanvasScheme,
    metadata: CanvasMetadata,
  ): Promise<Record<string, unknown>> {
    if (scheme === 'user-e2ee') {
      const { seed, userId } = await requireIdentity()
      return {
        metadataEncrypted: encryptCanvasMetadata({
          metadata,
          seed,
          userId,
          canvasId,
        }),
        name: null,
        description: null,
        icon: null,
        iconColor: null,
      }
    }
    return {
      name: metadata.name ?? null,
      description: metadata.description ?? null,
      icon: metadata.icon ?? null,
      iconColor: metadata.iconColor ?? null,
      metadataEncrypted: null,
    }
  }

  /** The wire form of a canvas's layer stack. */
  async function buildContentPayload(
    canvasId: string,
    scheme: CanvasScheme,
    body: CanvasBody,
  ): Promise<Record<string, unknown>> {
    if (scheme === 'user-e2ee') {
      const { seed, userId } = await requireIdentity()
      return {
        bodyEncrypted: encryptCanvasBody({ body, seed, userId, canvasId }),
        body: null,
      }
    }
    return { body, bodyEncrypted: null }
  }

  async function fetchCanvases(): Promise<Canvas[]> {
    try {
      const { data } = await api.get('/library/canvases')
      const userId = authStore.me?.id
      const hydrated = await Promise.all(
        ((data ?? []) as Canvas[]).map(c => hydrateCanvas(c, userId)),
      )
      canvasesStore.setCanvases(hydrated)
      return hydrated
    } catch {
      toast.error('Failed to load canvases')
      return []
    }
  }

  async function fetchCanvasById(id: string): Promise<Canvas | null> {
    try {
      const { data } = await api.get(`/library/canvases/${id}`)
      const hydrated = await hydrateCanvas(data as Canvas, authStore.me?.id)
      canvasesStore.upsertCanvas(hydrated)
      return hydrated
    } catch {
      toast.error('Failed to load canvas')
      return null
    }
  }

  /**
   * The server side of creating a canvas, with no offline handling — used
   * directly when online, and replayed from the sync queue for one created
   * offline. The metadata envelope derives from the id the server mints, so
   * this can only run with a connection; that's why an offline create is
   * deferred whole rather than partially prepared.
   */
  async function replayCreate(
    params: CreateCanvasParams,
  ): Promise<Canvas> {
    const scheme = params.scheme ?? 'server-key'
      // An e2ee canvas can't be finished without a key, and failing after the
      // POST would leave an unnamed orphan row behind — so check first.
    // An e2ee canvas can't be finished without a key, and failing after the
    // POST would leave an unnamed orphan row behind — so check first.
    if (scheme === 'user-e2ee') await requireIdentity()

    // 1. Mint the row — the id is what the per-canvas keys derive from.
    const { data: created } = await api.post('/library/canvases', { scheme })
    const canvas = created as Canvas

    // 2. Fill it with the metadata and an empty body.
    const metadata = await buildMetadataPayload(canvas.id, scheme, {
      name: params.name,
      description: params.description,
      icon: params.icon,
      iconColor: params.iconColor,
    })
    const content = await buildContentPayload(
      canvas.id,
      scheme,
      emptyCanvasBody(),
    )
    const { data: filled } = await api.put(
      `/library/canvases/${canvas.id}`,
      { ...metadata, ...content },
    )

    const hydrated = await hydrateCanvas(filled as Canvas, authStore.me?.id)
    canvasesStore.upsertCanvas(hydrated)
    return hydrated
  }

  /** Build the local stand-in for a canvas created without a connection. */
  function localCanvas(params: CreateCanvasParams): Canvas {
    const now = new Date().toISOString()
    return {
      id: newOfflineId(),
      name: params.name,
      description: params.description,
      icon: params.icon,
      iconColor: params.iconColor,
      scheme: params.scheme ?? 'server-key',
      userId: authStore.me?.id ?? '',
      createdAt: now,
      updatedAt: now,
      body: emptyCanvasBody(),
    } as unknown as Canvas
  }

  async function createCanvas(
    params: CreateCanvasParams,
  ): Promise<Canvas | null> {
    // Offline: keep the canvas locally under a temporary id and let the
    // queue create it for real on reconnect.
    function createOffline(): Canvas {
      const canvas = localCanvas(params)
      canvasesStore.upsertCanvas(canvas)
      syncStore.enqueue(
        'canvas:create',
        { tempId: canvas.id, params } satisfies CreateCanvasMutation,
        t('offline.sync.labels.create', { name: params.name }),
      )
      return canvas
    }

    if (isOffline.value) return createOffline()

    try {
      return await replayCreate(params)
    } catch (error) {
      if (isRetriableNetworkError(getNetworkErrorKind(error))) {
        return createOffline()
      }
      console.error('Failed to create canvas', error)
      toast.error(
        error instanceof Error && error.message.includes('seed')
          ? IDENTITY_REQUIRED
          : 'Failed to create canvas',
      )
      return null
    }
  }

  /** Rename / re-icon a canvas. Rewrites the metadata envelope. */
  /** Server side of a metadata save; replayed from the queue when offline. */
  async function replayUpdateMetadata(
    canvasId: string,
    metadata: CanvasMetadata,
  ): Promise<Canvas> {
    const canvas =
      canvasesStore.canvases.find(c => c.id === canvasId) ??
      ({ id: canvasId, scheme: 'server-key' } as Canvas)
    const merged: CanvasMetadata = {
      name: canvas.name,
      description: canvas.description,
      icon: canvas.icon ?? undefined,
      iconColor: canvas.iconColor ?? undefined,
      ...metadata,
    }
    const payload = await buildMetadataPayload(canvas.id, canvas.scheme, merged)
    const { data } = await api.put(`/library/canvases/${canvas.id}`, payload)
    const hydrated = await hydrateCanvas(data as Canvas, authStore.me?.id)
    // The server sends back only what it stores, so the decrypted body we
    // already hold has to be carried across.
    hydrated.body = canvas.body
    canvasesStore.upsertCanvas(hydrated)
    return hydrated
  }

  async function updateMetadata(
    canvas: Canvas,
    metadata: CanvasMetadata,
  ): Promise<Canvas | null> {
    // Offline: apply the rename locally and queue the save.
    function updateOffline(): Canvas {
      const updated = {
        ...canvas,
        ...metadata,
        updatedAt: new Date().toISOString(),
      } as Canvas
      canvasesStore.upsertCanvas(updated)
      syncStore.enqueue(
        'canvas:update',
        { id: canvas.id, metadata, previous: canvas } satisfies UpdateCanvasMutation,
        t('offline.sync.labels.update', { name: updated.name ?? '' }),
      )
      return updated
    }

    if (isOffline.value) return updateOffline()

    try {
      const merged: CanvasMetadata = {
        name: canvas.name,
        description: canvas.description,
        icon: canvas.icon ?? undefined,
        iconColor: canvas.iconColor ?? undefined,
        ...metadata,
      }
      const payload = await buildMetadataPayload(
        canvas.id,
        canvas.scheme,
        merged,
      )
      const { data } = await api.put(`/library/canvases/${canvas.id}`, payload)
      const hydrated = await hydrateCanvas(data as Canvas, authStore.me?.id)
      // The server sends back only what it stores, so the decrypted body we
      // already hold has to be carried across.
      hydrated.body = canvas.body
      canvasesStore.upsertCanvas(hydrated)
      return hydrated
    } catch (error) {
      if (isRetriableNetworkError(getNetworkErrorKind(error))) {
        return updateOffline()
      }
      toast.error('Failed to save canvas')
      return null
    }
  }

  /** Persist the layer stack. */
  /** Server side of a body save; replayed from the queue when offline. */
  async function replaySaveBody(
    canvasId: string,
    body: CanvasBody,
  ): Promise<Canvas> {
    const canvas =
      canvasesStore.canvases.find(c => c.id === canvasId) ??
      ({ id: canvasId, scheme: 'server-key' } as Canvas)
    const content = await buildContentPayload(canvas.id, canvas.scheme, body)
    const { data } = await api.put(`/library/canvases/${canvas.id}`, content)
    const hydrated = await hydrateCanvas(data as Canvas, authStore.me?.id)
    hydrated.body = body
    canvasesStore.upsertCanvas(hydrated)
    return hydrated
  }

  async function saveBody(
    canvas: Canvas,
    body: CanvasBody,
  ): Promise<Canvas | null> {
    // Offline: the edit lives in the (persisted) store, and one queued save
    // per canvas carries the latest body to the server on reconnect.
    function saveOffline(): Canvas {
      const updated = {
        ...canvas,
        body,
        updatedAt: new Date().toISOString(),
      } as Canvas
      canvasesStore.upsertCanvas(updated)
      syncStore.enqueueLatest(
        'canvas:saveBody',
        `canvas:saveBody:${canvas.id}`,
        { id: canvas.id, body } satisfies SaveCanvasBodyMutation,
        t('offline.sync.labels.update', { name: canvas.name ?? '' }),
      )
      return updated
    }

    if (isOffline.value) return saveOffline()

    try {
      const content = await buildContentPayload(canvas.id, canvas.scheme, body)
      const { data } = await api.put(
        `/library/canvases/${canvas.id}`,
        content,
      )
      const hydrated = await hydrateCanvas(data as Canvas, authStore.me?.id)
      hydrated.body = body
      canvasesStore.upsertCanvas(hydrated)
      return hydrated
    } catch (error) {
      if (isRetriableNetworkError(getNetworkErrorKind(error))) {
        return saveOffline()
      }
      toast.error('Failed to save canvas')
      return null
    }
  }

  /**
   * Move a canvas between schemes.
   *
   * The client re-packages the whole record — it holds the only keys — and
   * the server swaps it in atomically. The body comes from the copy already
   * in memory, which is the decrypted one either way, so nothing has to be
   * fetched and re-decrypted first.
   */
  async function changeScheme(
    canvas: Canvas,
    targetScheme: CanvasScheme,
  ): Promise<Canvas | null> {
    if (canvas.scheme === targetScheme) return canvas
    try {
      if (targetScheme === 'user-e2ee') await requireIdentity()

      const metadata = await buildMetadataPayload(canvas.id, targetScheme, {
        name: canvas.name,
        description: canvas.description,
        icon: canvas.icon ?? undefined,
        iconColor: canvas.iconColor ?? undefined,
      })
      const content = await buildContentPayload(
        canvas.id,
        targetScheme,
        canvas.body ?? emptyCanvasBody(),
      )

      const { data } = await api.post(
        `/library/canvases/${canvas.id}/change-scheme`,
        { targetScheme, ...metadata, ...content },
      )
      const hydrated = await hydrateCanvas(data as Canvas, authStore.me?.id)
      canvasesStore.upsertCanvas(hydrated)
      return hydrated
    } catch (error) {
      console.error('Failed to change canvas scheme', error)
      toast.error(
        error instanceof Error && error.message.includes('seed')
          ? IDENTITY_REQUIRED
          : 'Could not change the privacy of this canvas',
      )
      return null
    }
  }

  /**
   * Mint a public share link. Shareable canvases only — a private one has
   * nothing the server could render to a visitor. Idempotent server-side, so
   * re-opening the dialog returns the URL already handed out.
   */
  async function createShareLink(canvas: Canvas): Promise<string | null> {
    try {
      const { data } = await api.post(
        `/library/canvases/${canvas.id}/public-link`,
      )
      const token = data.publicToken as string
      canvasesStore.upsertCanvas({ ...canvas, publicToken: token, isPublic: true })
      return `${window.location.origin}/c/${token}`
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status
      toast.error(
        status === 400
          ? 'Private canvases can’t be shared by link'
          : 'Could not create a share link',
      )
      return null
    }
  }

  async function revokeShareLink(canvas: Canvas): Promise<boolean> {
    try {
      await api.delete(`/library/canvases/${canvas.id}/public-link`)
      canvasesStore.upsertCanvas({
        ...canvas,
        publicToken: null,
        isPublic: false,
      })
      return true
    } catch {
      toast.error('Could not revoke the share link')
      return false
    }
  }

  /** Fetch a canvas by public-link token. No authentication required. */
  async function fetchPublicCanvas(token: string): Promise<Canvas | null> {
    try {
      const { data } = await api.get(`/public/canvases/${token}`)
      const canvas = data.canvas as Canvas
      if (!canvas.body) canvas.body = emptyCanvasBody()
      return canvas
    } catch {
      return null
    }
  }

  /** Server side of a delete; replayed from the queue when offline. */
  async function replayDelete(id: string): Promise<void> {
    await api.delete(`/library/canvases/${id}`)
    canvasesStore.removeCanvas(id)
  }

  async function deleteCanvas(id: string): Promise<boolean> {
    const existing = canvasesStore.canvases.find(c => c.id === id)

    function deleteOffline(): boolean {
      canvasesStore.removeCanvas(id)
      // A canvas that only ever existed locally just disappears — its
      // create is dropped from the queue rather than round-tripped.
      if (!syncStore.cancelPendingCreate('canvas:create', id)) {
        syncStore.enqueue(
          'canvas:delete',
          { id, previous: existing } satisfies DeleteCanvasMutation,
          t('offline.sync.labels.delete', { name: existing?.name ?? '' }),
        )
      }
      return true
    }

    if (isOffline.value) return deleteOffline()

    try {
      await replayDelete(id)
      return true
    } catch (error) {
      if (isRetriableNetworkError(getNetworkErrorKind(error))) {
        return deleteOffline()
      }
      toast.error('Failed to delete canvas')
      return false
    }
  }

  return {
    displayName,
    fetchCanvases,
    fetchCanvasById,
    createCanvas,
    replayCreate,
    replayUpdateMetadata,
    replaySaveBody,
    replayDelete,
    updateMetadata,
    saveBody,
    changeScheme,
    createShareLink,
    revokeShareLink,
    fetchPublicCanvas,
    deleteCanvas,
  }
})
