import type { Place, TransitDeparture, TransitStopInfo, WidgetDescriptor, WidgetResponse, SourceReference } from '../types/place.types'
import { WidgetType } from '../types/place.types'
import { SOURCE } from '../lib/constants'
import { integrationManager } from './integrations'
import { IntegrationCapabilityId } from '../types/integration.types'
import { TransitlandIntegration } from './integrations/transitland-integration'

/**
 * Inspect a place and return the list of widget descriptors that apply.
 * These descriptors tell the client which widgets to render and what
 * params to pass when fetching widget data.
 */
export function resolveWidgetDescriptors(place: Place): WidgetDescriptor[] {
  const descriptors: WidgetDescriptor[] = []

  // Transit widget: applicable if place has transit stop info with an onestop ID
  if (place.transit?.value?.onestopId) {
    const transit = place.transit.value
    const onestopIds = transit.onestopIds || [transit.onestopId]

    descriptors.push({
      type: WidgetType.TRANSIT,
      title: transit.name || 'Transit Departures',
      estimatedHeight: 200,
      params: {
        onestopIds: onestopIds.join(','),
      },
    })
  }

  return descriptors
}

/**
 * Fetch transit departure data for the given onestop IDs.
 * Extracted from the former enrichPlaceWithTransitData() in place.service.ts.
 */
async function fetchTransitDepartures(
  onestopIds: string[],
  options?: { next?: number; limit?: number },
): Promise<{ departures: TransitDeparture[]; sources: SourceReference[] }> {
  const { next = 3600, limit = 20 } = options || {}

  const transitlandRecord = integrationManager.getConfiguredIntegrationForSource(
    SOURCE.TRANSITLAND,
    IntegrationCapabilityId.TRANSIT_DATA,
  )

  if (!transitlandRecord) {
    console.debug('🚫 [Widget/Transit] Transitland integration not configured')
    return { departures: [], sources: [] }
  }

  const transitland = integrationManager.getCachedIntegrationInstance(transitlandRecord) as TransitlandIntegration
  if (!transitland) {
    console.debug('🚫 [Widget/Transit] Transitland integration instance not found')
    return { departures: [], sources: [] }
  }

  const allDepartures: TransitDeparture[] = []

  for (const onestopId of onestopIds) {
    try {
      console.debug(`🌐 [Widget/Transit] Fetching departures for ${onestopId}`)
      const departures = await transitland.getDepartures(onestopId, { next, limit })

      if (departures?.length) {
        console.debug(`✅ [Widget/Transit] Found ${departures.length} departures for ${onestopId}`)
        allDepartures.push(...departures)
      } else {
        console.debug(`🚫 [Widget/Transit] No departures for ${onestopId}`)
      }
    } catch (error) {
      console.error(`❌ [Widget/Transit] Error fetching departures for ${onestopId}:`, error)
    }
  }

  // Sort by departure time
  allDepartures.sort((a, b) => {
    const timeA = a.departureTime || a.arrivalTime || ''
    const timeB = b.departureTime || b.arrivalTime || ''
    return timeA.localeCompare(timeB)
  })

  const sources: SourceReference[] = allDepartures.length > 0
    ? [{
        id: SOURCE.TRANSITLAND,
        name: 'Transitland',
        url: `https://www.transit.land/stops/${onestopIds[0]}`,
      }]
    : []

  return { departures: allDepartures, sources }
}

/**
 * Fetch widget data by type. Dispatches to the appropriate handler.
 */
export async function fetchWidgetData(
  type: WidgetType,
  params: Record<string, string>,
): Promise<WidgetResponse> {
  switch (type) {
    case WidgetType.TRANSIT: {
      const onestopIds = (params.onestopIds || '').split(',').filter(Boolean)
      const next = params.next ? parseInt(params.next, 10) : undefined
      const limit = params.limit ? parseInt(params.limit, 10) : undefined

      if (!onestopIds.length) {
        throw new Error('Missing onestopIds parameter for transit widget')
      }

      const { departures, sources } = await fetchTransitDepartures(onestopIds, { next, limit })

      const transitInfo: TransitStopInfo = {
        onestopId: onestopIds[0],
        onestopIds: onestopIds.length > 1 ? onestopIds : undefined,
        departures,
      }

      return {
        type: WidgetType.TRANSIT,
        data: {
          value: transitInfo,
          sourceId: SOURCE.TRANSITLAND,
          timestamp: new Date().toISOString(),
        },
        sources,
      }
    }

    default:
      throw new Error(`Unknown widget type: ${type}`)
  }
}
