/**
 * Transit Alerts Store
 *
 * Service alerts are shared across surfaces — a route page, the stop board on
 * a place, and every transit leg of a planned trip can all be asking about the
 * same line at the same moment. Each fetch is cached by exactly what was asked
 * for and shared, so opening a trip with four legs on two lines makes two
 * requests, not four, and revisiting a route page inside the TTL makes none.
 *
 * Alerts are prose an agency wrote minutes ago, not a position that ticks, so
 * the TTL here is generous. Barrelman caches per feed for a minute behind us.
 */

import { ref } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/lib/api'
import type { ServiceAlert, ServiceAlertsResponse } from '@/types/transit.types'
import { sortAlerts } from '@/lib/transit-alerts'

/** How long a cached answer stands before we ask again. */
const TTL_MS = 60_000

export interface AlertQuery {
  /** Feed the ids below belong to. Ids are feed-local and mean nothing without it. */
  feedId?: string
  routeIds?: string[]
  stopIds?: string[]
  tripIds?: string[]
  /** Also return alerts whose active period hasn't opened yet. */
  includeUpcoming?: boolean
}

interface CacheEntry {
  alerts: ServiceAlert[]
  fetchedAt: number
}

/** Stable key for a query, so the same question hits the same cache slot. */
export function alertQueryKey(query: AlertQuery): string {
  const list = (ids?: string[]) => [...(ids ?? [])].sort().join(',')
  return [
    query.feedId ?? '',
    list(query.routeIds),
    list(query.stopIds),
    list(query.tripIds),
    query.includeUpcoming ? 'u' : '',
  ].join('|')
}

/** Nothing to ask about — every surface passes ids it may not have yet. */
function isEmpty(query: AlertQuery): boolean {
  return !query.routeIds?.length && !query.stopIds?.length && !query.tripIds?.length
}

export const useTransitAlertsStore = defineStore('transit-alerts', () => {
  const cache = ref(new Map<string, CacheEntry>())
  /** In-flight requests, so concurrent callers share one round trip. */
  const inFlight = new Map<string, Promise<ServiceAlert[]>>()

  /**
   * Alerts for a query, from cache when fresh. Never throws: a feed that is
   * down or an endpoint an older server doesn't have yields no alerts, and the
   * surface renders as though there were none.
   */
  async function fetchAlerts(query: AlertQuery): Promise<ServiceAlert[]> {
    if (isEmpty(query)) return []

    const key = alertQueryKey(query)

    const cached = cache.value.get(key)
    if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.alerts

    const existing = inFlight.get(key)
    if (existing) return existing

    const request = (async () => {
      try {
        const params: Record<string, string> = {}
        if (query.feedId) params.feedId = query.feedId
        if (query.routeIds?.length) params.routeIds = query.routeIds.join(',')
        if (query.stopIds?.length) params.stopIds = query.stopIds.join(',')
        if (query.tripIds?.length) params.tripIds = query.tripIds.join(',')
        if (query.includeUpcoming) params.includeUpcoming = 'true'

        const response = await api.get<ServiceAlertsResponse>('/transit/alerts', { params })
        const alerts = sortAlerts(response.data?.alerts ?? [])
        cache.value.set(key, { alerts, fetchedAt: Date.now() })
        return alerts
      } catch {
        // Cache the empty answer briefly too — a route with no alert feed
        // shouldn't re-ask on every scroll that remounts the panel.
        cache.value.set(key, { alerts: [], fetchedAt: Date.now() })
        return []
      } finally {
        inFlight.delete(key)
      }
    })()

    inFlight.set(key, request)
    return request
  }

  /** Cached answer without asking, for render paths that can't await. */
  function peek(query: AlertQuery): ServiceAlert[] {
    return cache.value.get(alertQueryKey(query))?.alerts ?? []
  }

  function clear() {
    cache.value = new Map()
  }

  return { fetchAlerts, peek, clear }
})
