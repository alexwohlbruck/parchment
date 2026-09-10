/**
 * Replayable route mutations for the offline sync queue.
 *
 * Like canvases, a route's metadata envelope derives from the id the server
 * mints, so an offline create is deferred whole: the route lives locally
 * under a temporary id until this replays the real create on reconnect.
 */

import { registerMutationHandler } from '@/lib/sync/mutation-registry'
import { useRoutesStore } from '@/stores/library/routes.store'
import { useRoutesService } from '@/services/library/routes.service'
import type { CreateRouteParams, Route, RouteBody } from '@/types/routes.types'

export interface RouteUpdates {
  name?: string
  description?: string
  icon?: string
  iconColor?: string
  mode?: Route['mode']
  isPublic?: boolean
  body?: RouteBody
}

export interface CreateRouteMutation {
  tempId: string
  params: CreateRouteParams
}

export interface UpdateRouteMutation {
  id: string
  updates: RouteUpdates
  previous?: Route
}

export interface DeleteRouteMutation {
  id: string
  previous?: Route
}

registerMutationHandler<CreateRouteMutation>('route:create', {
  async execute({ tempId, params }, ctx) {
    const created = await useRoutesService().replayCreate(params)
    ctx.mapId(tempId, created.id)
    useRoutesStore().replaceRoute(tempId, created)
  },
  rollback({ tempId }) {
    useRoutesStore().removeRoute(tempId)
  },
})

registerMutationHandler<UpdateRouteMutation>('route:update', {
  async execute({ id, updates }, ctx) {
    await useRoutesService().replayUpdate(ctx.resolveId(id), updates)
  },
  rollback({ previous }) {
    if (previous) useRoutesStore().upsertRoute(previous)
  },
})

registerMutationHandler<DeleteRouteMutation>('route:delete', {
  async execute({ id }, ctx) {
    await useRoutesService().replayDelete(ctx.resolveId(id))
  },
  rollback({ previous }) {
    if (previous) useRoutesStore().upsertRoute(previous)
  },
})
