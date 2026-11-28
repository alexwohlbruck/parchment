import type { Place } from '../../types/place.types'
import { IntegrationCapabilityId } from '../../types/integration.enums'
import { integrationManager } from '../integrations'
import { searchByCategory } from '../search.service'
import {
  arrivalCategories,
  arrivalRule,
  hasArrivalPoints,
  pickArrivalPoints,
  pickChildren,
} from '../../lib/place/arrival-points'

// Named destinations are a minority of what a search or an "Inside" list
// returns — roads and paths crowd a campus — so fetch well past what gets shown.
const FETCH_LIMIT = 60
// Barrelman serves at most 200 children a page, and roads take most of them.
const CHILDREN_PAGE = 200
const CHILDREN_PAGES = 3

function barrelman(capability: IntegrationCapabilityId) {
  const record = integrationManager
    .getConfiguredIntegrationsByCapability(capability)
    .find((r) => r.integrationId === 'barrelman')
  return record ? integrationManager.getCachedIntegrationInstance(record) : null
}

/** The outline-bearing record: autocomplete hits and containment results carry only a centroid. */
async function lookupOutline(placeId: string): Promise<Place | null> {
  const [source, ...rest] = placeId.split('/')
  if (source !== 'osm' || !rest.length) return null
  const info = barrelman(IntegrationCapabilityId.PLACE_INFO)?.capabilities.placeInfo
  return (await info?.getPlaceInfo(rest.join('/'))) ?? null
}

/** What the place page lists as "Inside" an area, named places first. */
async function listChildren(parent: Place): Promise<Place[]> {
  const children = barrelman(IntegrationCapabilityId.SPATIAL_CHILDREN)?.capabilities.spatialChildren
  const osmId = parent.externalIds?.osm ?? parent.id.replace(/^osm\//, '')
  if (!children) return []
  const pages = await Promise.all(
    Array.from({ length: CHILDREN_PAGES }, (_, page) =>
      children.getChildren(osmId, [], CHILDREN_PAGE, page * CHILDREN_PAGE)),
  )
  return pages.flat()
}

/** Areas around a point, smallest first. */
async function containingAreas(lat: number, lng: number): Promise<Place[]> {
  const parents = barrelman(IntegrationCapabilityId.SPATIAL_PARENTS)?.capabilities.spatialParents
  return (await parents?.getContainingAreas(lat, lng)) ?? []
}

function qualifies(place: Place | null | undefined): boolean {
  return !!place?.geometry?.value?.bounds && hasArrivalPoints(place.icon?.presetId)
}

export interface ArrivalPointsTarget {
  id?: string
  lat?: number
  lng?: number
}

/**
 * The large place a destination sits in or is: the place itself when it is
 * an airport or campus, otherwise the smallest such area around it — so a
 * pin dropped on a runway, or a terminal already chosen, leads back to the airport.
 */
async function resolveParent(
  { id, lat, lng }: ArrivalPointsTarget,
  deps: ArrivalPointsDeps,
): Promise<Place | null> {
  const place = id ? await deps.lookupOutline(id) : null
  if (place && qualifies(place)) return place

  // The stop's own point beats its place's centre: a pin that geocoded to
  // "Queens" is still on the runway.
  const center = lat != null && lng != null ? { lat, lng } : place?.geometry?.value?.center
  if (!center) return null
  const area = (await deps.containingAreas(center.lat, center.lng))
    .find((a) => hasArrivalPoints(a.icon?.presetId))
  if (!area) return null
  return qualifies(area) ? area : deps.lookupOutline(area.id)
}

const defaultDeps = { lookupOutline, containingAreas, listChildren, searchByCategory }
type ArrivalPointsDeps = typeof defaultDeps

/** The precise places to arrive at in a large place: an airport's terminals, a campus's parking. */
export async function getArrivalPoints(
  target: ArrivalPointsTarget,
  mode: string | undefined,
  deps: ArrivalPointsDeps = defaultDeps,
): Promise<{ parent: Place | null; places: Place[] }> {
  const parent = await resolveParent(target, deps)
  const outline = parent?.geometry?.value?.bounds
  if (!parent || !outline) return { parent: null, places: [] }

  if (arrivalRule(parent.icon?.presetId)?.source === 'children') {
    return { parent, places: pickChildren(await deps.listChildren(parent), mode, parent.id) }
  }

  const bounds = {
    north: outline.maxLat,
    south: outline.minLat,
    east: outline.maxLng,
    west: outline.minLng,
  }
  const lists = await Promise.all(
    arrivalCategories(parent.icon!.presetId!, mode).map(async (category) =>
      pickArrivalPoints(
        await deps.searchByCategory(category, { bounds, limit: FETCH_LIMIT }),
        bounds,
        parent.id,
      ),
    ),
  )
  return { parent, places: lists.flat() }
}
