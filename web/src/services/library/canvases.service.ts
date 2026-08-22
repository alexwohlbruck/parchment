import { createSharedComposable } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import { getSeed } from '@/lib/key-storage'
import { useAuthStore } from '@/stores/auth.store'
import { useCanvasesStore } from '@/stores/library/canvases.store'
import {
  encryptCanvasMetadata,
  decryptCanvasMetadata,
  encryptCanvasBody,
  decryptCanvasBody,
  type CanvasMetadata,
} from '@/lib/library-crypto'
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

  async function createCanvas(
    params: CreateCanvasParams,
  ): Promise<Canvas | null> {
    try {
      const scheme = params.scheme ?? 'server-key'
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
    } catch (error) {
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
  async function updateMetadata(
    canvas: Canvas,
    metadata: CanvasMetadata,
  ): Promise<Canvas | null> {
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
    } catch {
      toast.error('Failed to save canvas')
      return null
    }
  }

  /** Persist the layer stack. */
  async function saveBody(
    canvas: Canvas,
    body: CanvasBody,
  ): Promise<Canvas | null> {
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
    } catch {
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

  async function deleteCanvas(id: string): Promise<boolean> {
    try {
      await api.delete(`/library/canvases/${id}`)
      canvasesStore.removeCanvas(id)
      return true
    } catch {
      toast.error('Failed to delete canvas')
      return false
    }
  }

  return {
    displayName,
    fetchCanvases,
    fetchCanvasById,
    createCanvas,
    updateMetadata,
    saveBody,
    changeScheme,
    createShareLink,
    revokeShareLink,
    fetchPublicCanvas,
    deleteCanvas,
  }
})
