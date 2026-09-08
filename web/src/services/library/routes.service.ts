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
  CreateRouteMutation,
  DeleteRouteMutation,
  RouteUpdates,
  UpdateRouteMutation,
} from './routes.sync'
import { getSeed } from '@/lib/key-storage'
import { useAuthStore } from '@/stores/auth.store'
import { useRoutesStore } from '@/stores/library/routes.store'
import {
  encryptRouteMetadata,
  decryptRouteMetadata,
  encryptRouteBody,
  decryptRouteBody,
  type RouteMetadata,
} from '@/lib/library-crypto'
import type {
  Route,
  RouteBody,
  CreateRouteParams,
} from '@/types/routes.types'

/**
 * Merge decrypted display metadata onto a route in place.
 */
function stampMetadata(route: Route, metadata: RouteMetadata): void {
  if (metadata.name !== undefined) route.name = metadata.name
  if (metadata.description !== undefined) route.description = metadata.description
  if (metadata.icon !== undefined) route.icon = metadata.icon
  if (metadata.iconPack !== undefined) route.iconPack = metadata.iconPack
  if (metadata.iconColor !== undefined) route.iconColor = metadata.iconColor
}

/**
 * Decrypt a route's metadata envelope (always) and, for user-e2ee routes,
 * its body envelope. Mutates + returns the route. Undecryptable routes still
 * flow into the store; they render with a placeholder title.
 */
async function hydrateRoute(
  route: Route,
  userId: string | undefined,
): Promise<Route> {
  if (!userId) return route
  const seed = await getSeed()
  if (!seed) return route

  if (route.metadataEncrypted) {
    try {
      stampMetadata(
        route,
        decryptRouteMetadata({
          envelope: route.metadataEncrypted,
          seed,
          userId,
          routeId: route.id,
        }),
      )
    } catch {
      // wrong seed / tampered / no local seed — leave fields undefined
    }
  }

  // user-e2ee: the cleartext body column is null; decrypt the envelope into
  // `body` so the UI has waypoints + geometry + stats to render.
  if (route.scheme === 'user-e2ee' && route.bodyEncrypted) {
    try {
      route.body = decryptRouteBody<RouteBody>({
        envelope: route.bodyEncrypted,
        seed,
        userId,
        routeId: route.id,
      })
    } catch {
      // leave body null — preview will show "encrypted"
    }
  }

  return route
}

export const useRoutesService = createSharedComposable(() => {
  const syncStore = useSyncStore()
  const t = (key: string, named?: Record<string, unknown>) =>
    (i18n.global as any).t(key, named ?? {})
  const routesStore = useRoutesStore()
  const authStore = useAuthStore()

  function getRouteDisplayName(route: Route | null | undefined): string {
    if (!route) return ''
    return route.name || 'Untitled route'
  }

  async function buildMetadataEnvelope(
    routeId: string,
    metadata: RouteMetadata,
  ): Promise<string> {
    const seed = await getSeed()
    if (!seed) throw new Error('No identity seed — cannot encrypt route metadata')
    const userId = authStore.me?.id
    if (!userId) throw new Error('Not signed in')
    return encryptRouteMetadata({ metadata, seed, userId, routeId })
  }

  async function fetchRoutes(): Promise<Route[]> {
    try {
      const { data } = await api.get('/library/routes')
      const userId = authStore.me?.id
      const hydrated = await Promise.all(
        ((data ?? []) as Route[]).map((r) => hydrateRoute(r, userId)),
      )
      routesStore.setRoutes(hydrated)
      return hydrated
    } catch {
      toast.error('Failed to load routes')
      return []
    }
  }

  async function fetchRouteById(id: string): Promise<Route | null> {
    try {
      const { data } = await api.get(`/library/routes/${id}`)
      const hydrated = await hydrateRoute(data as Route, authStore.me?.id)
      routesStore.upsertRoute(hydrated)
      return hydrated
    } catch {
      toast.error('Failed to load route')
      return null
    }
  }

  /**
   * Build the PUT body that carries a route's content. server-key routes send
   * the body + cleartext stats columns; user-e2ee routes send an encrypted
   * envelope and leave the stat columns null.
   */
  async function buildContentPayload(
    routeId: string,
    scheme: Route['scheme'],
    body: RouteBody,
  ): Promise<Record<string, unknown>> {
    const stats = body.stats
    if (scheme === 'user-e2ee') {
      const seed = await getSeed()
      if (!seed) throw new Error('No identity seed — cannot encrypt route body')
      const userId = authStore.me?.id
      if (!userId) throw new Error('Not signed in')
      return {
        bodyEncrypted: encryptRouteBody({ body, seed, userId, routeId }),
        // null out the cleartext columns explicitly in case of a scheme flip
        body: null,
        distance: null,
        duration: null,
        elevationGain: null,
        elevationLoss: null,
      }
    }
    return {
      body,
      distance: stats?.distance ?? null,
      duration: stats?.duration ?? null,
      elevationGain: stats?.elevationGain ?? null,
      elevationLoss: stats?.elevationLoss ?? null,
    }
  }

  /**
   * The server side of creating a route, with no offline handling. The
   * metadata envelope derives from the id the server mints, so this can
   * only run with a connection — an offline create is deferred whole and
   * replayed from the sync queue.
   */
  async function replayCreate(params: CreateRouteParams): Promise<Route> {
    const scheme = params.scheme ?? 'server-key'
    // 1. Mint the row so we have the id to derive the per-route keys.
    const { data: created } = await api.post('/library/routes', {
      mode: params.mode,
      scheme,
      isPublic: params.isPublic ?? false,
    })
    const route = created as Route

    // 2. Encrypt metadata + package content, then fill the row.
    const metadataEncrypted = await buildMetadataEnvelope(route.id, {
      name: params.name,
      description: params.description,
      icon: params.icon,
      iconColor: params.iconColor,
    })
    const content = await buildContentPayload(route.id, scheme, params.body)

    const { data: updated } = await api.put(`/library/routes/${route.id}`, {
      mode: params.mode,
      metadataEncrypted,
      ...content,
    })

    // Store the local view with decrypted fields + body already in hand
    // (avoid a decrypt round-trip — we have the plaintext here).
    const local = updated as Route
    stampMetadata(local, {
      name: params.name,
      description: params.description,
      icon: params.icon,
      iconColor: params.iconColor,
    })
    local.body = params.body
    routesStore.upsertRoute(local)
    return local
  }

  async function createRoute(params: CreateRouteParams): Promise<Route | null> {
    // Offline: hold the route locally under a temporary id and let the
    // queue create it for real on reconnect.
    function createOffline(): Route {
      const now = new Date().toISOString()
      const route = {
        id: newOfflineId(),
        name: params.name,
        description: params.description,
        icon: params.icon,
        iconColor: params.iconColor,
        mode: params.mode,
        scheme: params.scheme ?? 'server-key',
        isPublic: params.isPublic ?? false,
        userId: authStore.me?.id ?? '',
        createdAt: now,
        updatedAt: now,
        body: params.body,
      } as unknown as Route
      routesStore.upsertRoute(route)
      syncStore.enqueue(
        'route:create',
        { tempId: route.id, params } satisfies CreateRouteMutation,
        t('offline.sync.labels.create', { name: params.name ?? '' }),
      )
      toast.success('Route saved')
      return route
    }

    if (isOffline.value) return createOffline()

    try {
      const local = await replayCreate(params)
      toast.success('Route saved')
      return local
    } catch (error) {
      if (isRetriableNetworkError(getNetworkErrorKind(error))) {
        return createOffline()
      }
      toast.error('Failed to save route')
      return null
    }
  }

  /**
   * Update display metadata and/or the route body. Pass only what changed.
   */
  /** Server side of a route update; replayed from the queue when offline. */
  async function replayUpdate(
    id: string,
    updates: RouteUpdates,
  ): Promise<Route> {
    const current = routesStore.getRouteById(id)
    const scheme = current?.scheme ?? 'server-key'

    const payload: Record<string, unknown> = {}
    if (updates.mode !== undefined) payload.mode = updates.mode
    if (updates.isPublic !== undefined) payload.isPublic = updates.isPublic

    const metadataChanged =
      updates.name !== undefined ||
      updates.description !== undefined ||
      updates.icon !== undefined ||
      updates.iconColor !== undefined
    if (metadataChanged) {
      payload.metadataEncrypted = await buildMetadataEnvelope(id, {
        name: updates.name ?? current?.name,
        description: updates.description ?? current?.description,
        icon: updates.icon ?? current?.icon,
        iconColor: updates.iconColor ?? current?.iconColor,
      })
    }

    if (updates.body !== undefined) {
      Object.assign(payload, await buildContentPayload(id, scheme, updates.body))
    }

    const { data } = await api.put(`/library/routes/${id}`, payload)
    const local = data as Route
    stampMetadata(local, {
      name: updates.name ?? current?.name,
      description: updates.description ?? current?.description,
      icon: updates.icon ?? current?.icon,
      iconColor: updates.iconColor ?? current?.iconColor,
    })
    local.body = updates.body ?? current?.body ?? null
    routesStore.upsertRoute(local)
    return local
  }

  async function updateRoute(
    id: string,
    updates: RouteUpdates,
  ): Promise<Route | null> {
    const existing = routesStore.getRouteById(id)

    // Offline: apply locally and queue the save.
    function updateOffline(): Route | null {
      if (!existing) return null
      const updated = {
        ...existing,
        ...updates,
        body: updates.body ?? existing.body,
        updatedAt: new Date().toISOString(),
      } as Route
      routesStore.upsertRoute(updated)
      syncStore.enqueue(
        'route:update',
        { id, updates, previous: existing } satisfies UpdateRouteMutation,
        t('offline.sync.labels.update', { name: updated.name ?? '' }),
      )
      toast.success('Route updated')
      return updated
    }

    if (isOffline.value) return updateOffline()

    try {
      const current = routesStore.getRouteById(id)
      const scheme = current?.scheme ?? 'server-key'

      const payload: Record<string, unknown> = {}
      if (updates.mode !== undefined) payload.mode = updates.mode
      if (updates.isPublic !== undefined) payload.isPublic = updates.isPublic

      const metadataChanged =
        updates.name !== undefined ||
        updates.description !== undefined ||
        updates.icon !== undefined ||
        updates.iconColor !== undefined
      if (metadataChanged) {
        payload.metadataEncrypted = await buildMetadataEnvelope(id, {
          name: updates.name ?? current?.name,
          description: updates.description ?? current?.description,
          icon: updates.icon ?? current?.icon,
          iconColor: updates.iconColor ?? current?.iconColor,
        })
      }

      if (updates.body !== undefined) {
        Object.assign(
          payload,
          await buildContentPayload(id, scheme, updates.body),
        )
      }

      const { data } = await api.put(`/library/routes/${id}`, payload)
      const local = data as Route
      // Re-apply local plaintext so the store stays decrypted.
      stampMetadata(local, {
        name: updates.name ?? current?.name,
        description: updates.description ?? current?.description,
        icon: updates.icon ?? current?.icon,
        iconColor: updates.iconColor ?? current?.iconColor,
      })
      local.body = updates.body ?? current?.body ?? null
      routesStore.upsertRoute(local)
      toast.success('Route updated')
      return local
    } catch (error) {
      if (isRetriableNetworkError(getNetworkErrorKind(error))) {
        return updateOffline()
      }
      toast.error('Failed to update route')
      return null
    }
  }

  /** Server side of a delete; replayed from the queue when offline. */
  async function replayDelete(id: string): Promise<void> {
    await api.delete(`/library/routes/${id}`)
    routesStore.removeRoute(id)
  }

  async function deleteRoute(id: string): Promise<boolean> {
    const existing = routesStore.getRouteById(id)

    function deleteOffline(): boolean {
      routesStore.removeRoute(id)
      // A route that only ever existed locally just disappears.
      if (!syncStore.cancelPendingCreate('route:create', id)) {
        syncStore.enqueue(
          'route:delete',
          { id, previous: existing } satisfies DeleteRouteMutation,
          t('offline.sync.labels.delete', { name: existing?.name ?? '' }),
        )
      }
      toast.success('Route deleted')
      return true
    }

    if (isOffline.value) return deleteOffline()

    try {
      await replayDelete(id)
      toast.success('Route deleted')
      return true
    } catch (error) {
      if (isRetriableNetworkError(getNetworkErrorKind(error))) {
        return deleteOffline()
      }
      toast.error('Failed to delete route')
      return false
    }
  }

  /** Mint a public share link. server-key routes only. Returns the URL. */
  async function createShareLink(id: string): Promise<string | null> {
    try {
      const { data } = await api.post(`/library/routes/${id}/public-link`)
      const token = data.publicToken as string
      routesStore.upsertRoute({
        ...(routesStore.getRouteById(id) as Route),
        publicToken: token,
        isPublic: true,
      })
      return `${window.location.origin}/r/${token}`
    } catch (err: any) {
      if (err?.response?.status === 400) {
        toast.error('Private (end-to-end encrypted) routes can’t be shared by link')
      } else {
        toast.error('Failed to create share link')
      }
      return null
    }
  }

  async function revokeShareLink(id: string): Promise<boolean> {
    try {
      await api.delete(`/library/routes/${id}/public-link`)
      const current = routesStore.getRouteById(id)
      if (current) {
        routesStore.upsertRoute({ ...current, publicToken: null, isPublic: false })
      }
      return true
    } catch {
      toast.error('Failed to revoke share link')
      return false
    }
  }

  return {
    replayCreate,
    replayUpdate,
    replayDelete,
    getRouteDisplayName,
    fetchRoutes,
    fetchRouteById,
    createRoute,
    updateRoute,
    deleteRoute,
    createShareLink,
    revokeShareLink,
  }
})
