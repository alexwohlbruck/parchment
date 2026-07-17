import type { StreetImageryPreview } from '../types/place.types'
import { IntegrationId } from '../types/integration.enums'
import { integrationManager } from './integrations'
import { MapillaryIntegration } from './integrations/mapillary-integration'

function getMapillaryInstance(): MapillaryIntegration | null {
  const record = integrationManager
    .getConfiguredIntegrations()
    .find((r) => r.integrationId === IntegrationId.MAPILLARY)
  return record
    ? (integrationManager.getCachedIntegrationInstance(record) as MapillaryIntegration | null)
    : null
}

/**
 * Resolve the nearest street-level image to a coordinate via the configured
 * Mapillary integration. Returns null when no integration is configured or no
 * imagery exists nearby.
 */
export async function fetchNearestStreetImage(
  lat: number,
  lng: number,
): Promise<StreetImageryPreview | null> {
  const mapillary = getMapillaryInstance()
  if (!mapillary) return null

  try {
    return await mapillary.findNearestImage(lat, lng)
  } catch (error) {
    console.error('[StreetImagery] Mapillary lookup failed:', error)
    return null
  }
}
