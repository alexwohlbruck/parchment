import type { Place } from '../../types/place.types'
import { getPlaceOsmTags } from '../place-tags'

export interface ArrivalBounds {
  north: number
  south: number
  east: number
  west: number
}

interface ArrivalRule {
  /** Preset ID prefixes of the large places this rule covers. */
  presets: string[]
  /** Child categories worth arriving at, whatever the mode. */
  categories: string[]
  /** Child categories that only matter with a car. */
  drivingCategories: string[]
}

const PARKING = 'amenity/parking'

const rules: ArrivalRule[] = [
  {
    presets: ['aeroway/aerodrome'],
    categories: ['aeroway/terminal'],
    drivingCategories: [PARKING],
  },
  {
    presets: [
      'amenity/university',
      'amenity/college',
      'education/university',
      'education/college',
      'amenity/hospital',
      'leisure/stadium',
      'shop/mall',
      'tourism/theme_park',
      'tourism/zoo',
    ],
    categories: [],
    drivingCategories: [PARKING],
  },
]

const DRIVING_MODES = new Set(['driving', 'multi'])

/** Whether a place is big enough to hold precise destinations, in any mode. */
export function hasArrivalPoints(presetId: string | undefined): boolean {
  return !!presetId && rules.some((r) => r.presets.some((p) => presetId.startsWith(p)))
}

/** Child categories to offer as precise destinations inside a place, in display order. */
export function arrivalCategories(presetId: string, mode?: string): string[] {
  const rule = rules.find((r) => r.presets.some((p) => presetId.startsWith(p)))
  if (!rule) return []
  return DRIVING_MODES.has(mode ?? '')
    ? [...rule.categories, ...rule.drivingCategories]
    : rule.categories
}

const MAX_PER_CATEGORY = 8

const CLOSED_ACCESS = new Set(['private', 'no', 'permit', 'employees', 'delivery'])

function isOpenToPublic(place: Place): boolean {
  return !CLOSED_ACCESS.has(getPlaceOsmTags(place).access ?? '')
}

const STRUCTURED_PARKING = new Set(['multi-storey', 'underground'])

/** Garages and decks before surface lots: they are the ones signposted for visitors. */
function prominence(place: Place): number {
  return STRUCTURED_PARKING.has(getPlaceOsmTags(place).parking ?? '') ? 0 : 1
}

function isInside(place: Place, bounds: ArrivalBounds): boolean {
  const center = place.geometry?.value?.center
  return center != null
    && center.lat >= bounds.south && center.lat <= bounds.north
    && center.lng >= bounds.west && center.lng <= bounds.east
}

/**
 * Reduce one category's raw results to the named places inside the parent,
 * one per name: garages first, then natural name order ("Terminal 4" before "Terminal 10").
 */
export function pickArrivalPoints(
  places: Place[],
  bounds: ArrivalBounds,
  excludeId?: string,
): Place[] {
  const byName = new Map<string, Place>()
  for (const place of places) {
    const name = place.name?.value?.trim()
    if (!name || place.id === excludeId) continue
    if (!isInside(place, bounds) || !isOpenToPublic(place)) continue
    if (!byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), place)
  }
  return [...byName.entries()]
    .sort(([a, pa], [b, pb]) =>
      prominence(pa) - prominence(pb) || a.localeCompare(b, undefined, { numeric: true }))
    .slice(0, MAX_PER_CATEGORY)
    .map(([, place]) => place)
}
