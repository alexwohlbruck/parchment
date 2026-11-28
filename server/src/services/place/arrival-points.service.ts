import type { Place } from '../../types/place.types'
import { IntegrationCapabilityId } from '../../types/integration.enums'
import { integrationManager } from '../integrations'
import { searchByCategory } from '../search.service'
import { arrivalCategories, pickArrivalPoints } from '../../lib/place/arrival-points'

// Named children are a minority of a category's results, so fetch well past
// what gets shown.
const FETCH_LIMIT = 60

/** The outline-bearing record: autocomplete hits carry only a centroid. */
async function lookupOutline(placeId: string): Promise<Place | null> {
  const [source, ...rest] = placeId.split('/')
  if (source !== 'osm' || !rest.length) return null
  const record = integrationManager
    .getConfiguredIntegrationsByCapability(IntegrationCapabilityId.PLACE_INFO)
    .find((r) => r.integrationId === 'barrelman')
  const barrelman = record ? integrationManager.getCachedIntegrationInstance(record) : null
  return (await barrelman?.capabilities.placeInfo?.getPlaceInfo(rest.join('/'))) ?? null
}

/** The precise places to arrive at inside a large one: an airport's terminals, a campus's parking. */
export async function getArrivalPoints(
  placeId: string,
  mode: string | undefined,
  deps = { lookupOutline, searchByCategory },
): Promise<Place[]> {
  const place = await deps.lookupOutline(placeId)
  const presetId = place?.icon?.presetId
  const outline = place?.geometry?.value?.bounds
  if (!presetId || !outline) return []

  const bounds = {
    north: outline.maxLat,
    south: outline.minLat,
    east: outline.maxLng,
    west: outline.minLng,
  }
  const lists = await Promise.all(
    arrivalCategories(presetId, mode).map(async (category) =>
      pickArrivalPoints(
        await deps.searchByCategory(category, { bounds, limit: FETCH_LIMIT }),
        bounds,
        placeId,
      ),
    ),
  )
  return lists.flat()
}
