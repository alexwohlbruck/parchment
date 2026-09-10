/**
 * Replayable canvas mutations for the offline sync queue.
 *
 * A canvas can't be encrypted before it exists — its metadata envelope
 * derives from the id the server mints — so an offline create is deferred
 * whole: the canvas lives locally under a temporary id, and this replays
 * the real two-step create on reconnect, then swaps the id everywhere.
 */

import { registerMutationHandler } from '@/lib/sync/mutation-registry'
import { useCanvasesStore } from '@/stores/library/canvases.store'
import { useCanvasesService } from '@/services/library/canvases.service'
import type { CanvasMetadata } from '@/lib/identity/library-crypto'
import type { Canvas, CanvasBody, CreateCanvasParams } from '@/types/canvas.types'

export interface CreateCanvasMutation {
  tempId: string
  params: CreateCanvasParams
}

export interface UpdateCanvasMutation {
  id: string
  metadata: CanvasMetadata
  previous?: Canvas
}

export interface SaveCanvasBodyMutation {
  id: string
  body: CanvasBody
}

export interface DeleteCanvasMutation {
  id: string
  previous?: Canvas
}

registerMutationHandler<CreateCanvasMutation>('canvas:create', {
  async execute({ tempId, params }, ctx) {
    const created = await useCanvasesService().replayCreate(params)
    ctx.mapId(tempId, created.id)
    useCanvasesStore().replaceCanvas(tempId, created)
  },
  rollback({ tempId }) {
    useCanvasesStore().removeCanvas(tempId)
  },
})

registerMutationHandler<UpdateCanvasMutation>('canvas:update', {
  async execute({ id, metadata }, ctx) {
    await useCanvasesService().replayUpdateMetadata(ctx.resolveId(id), metadata)
  },
  rollback({ previous }) {
    if (previous) useCanvasesStore().upsertCanvas(previous)
  },
})

registerMutationHandler<SaveCanvasBodyMutation>('canvas:saveBody', {
  async execute({ id, body }, ctx) {
    await useCanvasesService().replaySaveBody(ctx.resolveId(id), body)
  },
  // No rollback: the body in the store is what the user drew, and losing
  // their edit would be worse than a canvas the server hasn't caught up on.
})

registerMutationHandler<DeleteCanvasMutation>('canvas:delete', {
  async execute({ id }, ctx) {
    await useCanvasesService().replayDelete(ctx.resolveId(id))
  },
  rollback({ previous }) {
    if (previous) useCanvasesStore().upsertCanvas(previous)
  },
})
