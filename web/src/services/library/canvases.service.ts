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
 * Shaped exactly like the routes service, because the storage model is the
 * same: metadata always travels encrypted, and the body is cleartext for
 * `server-key` canvases and an envelope for `user-e2ee` ones. Creation is two
 * steps — mint the row to learn its id, then write the encrypted payload
 * derived from that id.
 */

function stampMetadata(canvas: Canvas, metadata: CanvasMetadata): void {
  if (metadata.name !== undefined) canvas.name = metadata.name
  if (metadata.description !== undefined) canvas.description = metadata.description
  if (metadata.icon !== undefined) canvas.icon = metadata.icon
  if (metadata.iconPack !== undefined) canvas.iconPack = metadata.iconPack
  if (metadata.iconColor !== undefined) canvas.iconColor = metadata.iconColor
}

/**
 * Decrypt a canvas's metadata envelope (always) and, for user-e2ee canvases,
 * its body. Mutates and returns the canvas. A canvas that won't decrypt still
 * flows into the store, flagged, so it renders with a placeholder rather than
 * vanishing.
 */
async function hydrateCanvas(
  canvas: Canvas,
  userId: string | undefined,
): Promise<Canvas> {
  if (!userId) return canvas
  const seed = await getSeed()
  if (!seed) return canvas

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

  if (canvas.scheme === 'user-e2ee' && canvas.bodyEncrypted) {
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

  async function buildMetadataEnvelope(
    canvasId: string,
    metadata: CanvasMetadata,
  ): Promise<string> {
    const { seed, userId } = await requireIdentity()
    return encryptCanvasMetadata({ metadata, seed, userId, canvasId })
  }

  /**
   * The PUT payload carrying a canvas's content. e2ee canvases send an
   * envelope and explicitly null the cleartext column, so a scheme flip can
   * never leave readable leftovers behind.
   */
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
      // 1. Mint the row — the id is what the per-canvas keys derive from.
      const { data: created } = await api.post('/library/canvases', { scheme })
      const canvas = created as Canvas

      // 2. Fill it with the encrypted metadata and an empty body.
      const metadataEncrypted = await buildMetadataEnvelope(canvas.id, {
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
        { metadataEncrypted, ...content },
      )

      const hydrated = await hydrateCanvas(filled as Canvas, authStore.me?.id)
      canvasesStore.upsertCanvas(hydrated)
      return hydrated
    } catch (error) {
      console.error('Failed to create canvas', error)
      toast.error('Failed to create canvas')
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
      const metadataEncrypted = await buildMetadataEnvelope(canvas.id, merged)
      const { data } = await api.put(`/library/canvases/${canvas.id}`, {
        metadataEncrypted,
      })
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
    deleteCanvas,
  }
})
