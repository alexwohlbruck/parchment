import { defineStore } from 'pinia'
import { computed } from 'vue'
import { useStorage } from '@vueuse/core'
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
    routes.value = newRoutes
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
    removeRoute,
  }
})
