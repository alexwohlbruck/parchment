/**
 * Rideshare Service
 *
 * Thin delegation layer (like TransitRoutingService) that queries ALL
 * configured rideshare providers in parallel. Users want to compare
 * Uber vs Lyft prices side by side, so we don't pick a single
 * highest-priority provider.
 *
 * Brief in-memory cache (~4 min TTL) avoids hammering APIs on rapid
 * re-fetches when the user tweaks waypoints.
 */

import {
  IntegrationCapabilityId,
  type RideshareEstimateRequest,
  type RideshareEstimateResponse,
} from '../types/integration.types'
import { integrationManager } from './integrations'

interface CachedEstimate {
  responses: RideshareEstimateResponse[]
  cachedAt: number
}

const CACHE_TTL_MS = 4 * 60 * 1000 // 4 minutes

export class RideshareService {
  private cache = new Map<string, CachedEstimate>()

  /**
   * Get rideshare estimates from ALL configured providers in parallel.
   */
  async getEstimates(
    request: RideshareEstimateRequest,
  ): Promise<RideshareEstimateResponse[]> {
    const integrations = integrationManager.getConfiguredIntegrationsByCapability(
      IntegrationCapabilityId.RIDESHARE_ESTIMATE,
    )

    if (integrations.length === 0) return []

    // Check cache
    const cacheKey = this.buildCacheKey(request)
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.responses
    }

    // Query all providers in parallel
    const results = await Promise.allSettled(
      integrations.map(async (record) => {
        const instance = integrationManager.getCachedIntegrationInstance(record)
        if (!instance?.capabilities.rideshareEstimate) return null
        return instance.capabilities.rideshareEstimate.getRideshareEstimates(request)
      }),
    )

    const estimates: RideshareEstimateResponse[] = []
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        estimates.push(result.value)
      }
    }

    // Cache
    if (estimates.length > 0) {
      this.cache.set(cacheKey, { responses: estimates, cachedAt: Date.now() })
      // Lazy eviction: prune old entries
      if (this.cache.size > 100) {
        const now = Date.now()
        for (const [key, val] of this.cache) {
          if (now - val.cachedAt > CACHE_TTL_MS) this.cache.delete(key)
        }
      }
    }

    return estimates
  }

  /**
   * Check if any rideshare provider is configured.
   */
  isRideshareAvailable(): boolean {
    try {
      return integrationManager.getConfiguredIntegrationsByCapability(
        IntegrationCapabilityId.RIDESHARE_ESTIMATE,
      ).length > 0
    } catch {
      return false
    }
  }

  private buildCacheKey(req: RideshareEstimateRequest): string {
    // Round to ~11m precision for cache grouping
    const oLat = req.origin.lat.toFixed(4)
    const oLng = req.origin.lng.toFixed(4)
    const dLat = req.destination.lat.toFixed(4)
    const dLng = req.destination.lng.toFixed(4)
    return `${oLat},${oLng}->${dLat},${dLng}`
  }
}

export const rideshareService = new RideshareService()
