import { integrationManager } from './integrations'
import {
  IntegrationCapabilityId,
  type GeocodingCapability,
} from '../types/integration.types'
import type { Place } from '../types/place.types'
import { logError, logger } from '../lib/logger'

export interface GeocodeOutcome {
  results: Place[]
  /** Integration that produced the results, or null when none are configured. */
  integrationId: string | null
}

/**
 * Run a geocoding operation against every configured geocoding integration in
 * priority order, returning the first non-empty result.
 *
 * Barrelman ranks highest, so geocoding is served from our own OSM + Pelias
 * index — no upstream rate limit, and hits come back hydrated with full OSM
 * geometry and tags. Nominatim and the paid providers sit below it as fallbacks
 * for coverage gaps outside our imported regions. An integration that throws or
 * comes back empty is skipped so the next one gets a turn; only when *every*
 * provider fails does the error propagate, so callers can still tell an outage
 * apart from a coordinate with genuinely nothing at it.
 */
async function runGeocoding(
  operation: (capability: GeocodingCapability) => Promise<Place[]>,
): Promise<GeocodeOutcome> {
  const records = integrationManager.getConfiguredIntegrationsByCapability(
    IntegrationCapabilityId.GEOCODING,
  )

  let firstTried: string | null = null
  let attempted = 0
  let failed = 0
  let lastError: unknown

  for (const record of records) {
    const integration = integrationManager.getCachedIntegrationInstance(record)
    const capability = integration?.capabilities.geocoding
    if (!capability) continue

    firstTried ??= record.integrationId
    attempted++

    try {
      const results = await operation(capability)
      if (results?.length) {
        return { results, integrationId: record.integrationId }
      }
      logger.debug(
        `[geocoding] ${record.integrationId} returned no results, trying next provider`,
      )
    } catch (err) {
      failed++
      lastError = err
      logError(`Geocoding failed with ${record.integrationId}`, err)
    }
  }

  if (attempted > 0 && failed === attempted) throw lastError

  return { results: [], integrationId: firstTried }
}

/** Resolve an address or place query to coordinates. */
export function forwardGeocode(
  query: string,
  lat?: number,
  lng?: number,
): Promise<GeocodeOutcome> {
  return runGeocoding((capability) => capability.geocode(query, lat, lng))
}

/** Resolve a coordinate to the places at that point. */
export function reverseGeocode(
  lat: number,
  lng: number,
): Promise<GeocodeOutcome> {
  return runGeocoding((capability) => capability.reverseGeocode(lat, lng))
}
