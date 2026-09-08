import { defineStore } from 'pinia'
import { computed } from 'vue'
import { useStorage } from '@vueuse/core'
import { isOfflineId } from '@/lib/sync/offline-id'
import type { Route } from '@/types/routes.types'

/**
 * Saved custom routes. Holds the full route objects (with decrypted display
 * fields + decrypted body merged on by the routes service). Persisted to
 * localStorage so the library renders instantly on reload before the
 * network refetch lands.
 */
export const useRoutesStore = defineStore('routes', () => {
  const routes = useStorage<Route[]>('routes', [])

  const getRouteById = computed(() => {
    return (id: string) => routes.value.find((r) => r.id === id)
  })

  function setRoutes(newRoutes: Route[]) {
    // Routes created offline aren't on the server yet, so a refresh must not
    // drop them; their queued create replaces them once it replays.
    const pending = routes.value.filter(
      r => isOfflineId(r.id) && !newRoutes.some(n => n.id === r.id),
    )
    routes.value = [...pending, ...newRoutes]
  }

  /**
   * Swap an offline-created route for the server's version.
   *
   * The replayed create has already upserted the server row, so drop that
   * copy first — otherwise the temp row becomes a second, identical entry.
   */
  function replaceRoute(oldId: string, route: Route) {
    const rest = routes.value.filter((r) => r.id !== route.id)
    const index = rest.findIndex((r) => r.id === oldId)
    if (index !== -1) {
      rest[index] = route
      routes.value = rest
    } else {
      routes.value = [route, ...rest]
    }
  }

  function upsertRoute(route: Route) {
    const index = routes.value.findIndex((r) => r.id === route.id)
    if (index !== -1) {
      routes.value[index] = route
    } else {
      routes.value.unshift(route)
    }
  }

  function removeRoute(id: string) {
    routes.value = routes.value.filter((r) => r.id !== id)
  }

  return {
    routes,
    getRouteById,
    setRoutes,
    upsertRoute,
    replaceRoute,
    removeRoute,
  }
})
