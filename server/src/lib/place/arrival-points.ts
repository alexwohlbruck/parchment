import type { Place } from '../../types/place.types'
import { getPlaceOsmTags, isAreaPlace, isDestination } from '../place-tags'

export interface ArrivalBounds {
  north: number
  south: number
  east: number
  west: number
}

/**
 * Where a large place's precise destinations come from.
 *
 * `categories` searches named features of a few kinds inside the outline. An
 * airport needs this: everything inside its fence is taxiways and fire
 * stations, and the terminals are lost among them.
 *
 * `children` lists what the place page shows as "Inside": the buildings, lots
 * and attractions of a campus or a zoo.
 */
type ArrivalRule =
  | { presets: string[]; source: 'categories'; categories: string[]; drivingCategories: string[] }
  | { presets: string[]; source: 'children' }

const PARKING = 'amenity/parking'

const rules: ArrivalRule[] = [
  {
    presets: ['aeroway/aerodrome'],
    source: 'categories',
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
    source: 'children',
  },
]

const DRIVING_MODES = new Set(['driving', 'multi'])
const isDriving = (mode?: string) => DRIVING_MODES.has(mode ?? '')

export function arrivalRule(presetId: string | undefined): ArrivalRule | undefined {
  return presetId ? rules.find((r) => r.presets.some((p) => presetId.startsWith(p))) : undefined
}

/** Whether a place is big enough to hold precise destinations, in any mode. */
export function hasArrivalPoints(presetId: string | undefined): boolean {
  return !!arrivalRule(presetId)
}

/** Whether a place has precise destinations worth listing in this mode. */
export function offersArrivalPointsIn(presetId: string | undefined, mode?: string): boolean {
  const rule = arrivalRule(presetId)
  return !!rule && (rule.source === 'children' || arrivalCategories(presetId!, mode).length > 0)
}

/** For a `categories` place, the kinds of feature to search for, in display order. */
export function arrivalCategories(presetId: string, mode?: string): string[] {
  const rule = arrivalRule(presetId)
  if (rule?.source !== 'categories') return []
  return isDriving(mode) ? [...rule.categories, ...rule.drivingCategories] : rule.categories
}

const MAX_PER_CATEGORY = 8
const MAX_CHILDREN = 40

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

/** Named, public and not yet listed under that name. */
function keepFirstNamed(excludeId?: string) {
  const seen = new Set<string>()
  return (place: Place): boolean => {
    const name = place.name?.value?.trim().toLowerCase()
    if (!name || place.id === excludeId || seen.has(name) || !isOpenToPublic(place)) return false
    seen.add(name)
    return true
  }
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
  return places
    .filter((place) => isInside(place, bounds))
    .filter(keepFirstNamed(excludeId))
    .sort((a, b) =>
      prominence(a) - prominence(b)
      || (a.name?.value ?? '').localeCompare(b.name?.value ?? '', undefined, { numeric: true }))
    .slice(0, MAX_PER_CATEGORY)
}

/** Named features inside a place that nobody travels to: its paths, rivers, tracks and signboards. */
const NOT_ARRIVED_AT = [
  'aeroway',
  'barrier',
  'landuse',
  'man_made',
  'natural',
  'power',
  'railway',
  'tourism/information',
  'waterway',
]

/**
 * Reduce a place's "Inside" list to the ones a trip can end at, keeping its
 * order. Parking only makes the list when a car is involved.
 */
export function pickChildren(places: Place[], mode?: string, excludeId?: string): Place[] {
  const driving = isDriving(mode)
  return places
    .filter((place) => {
      const presetId = place.icon?.presetId ?? ''
      if (!isDestination(place) || isAreaPlace(place)) return false
      if (place.id.startsWith('osm/intersection/')) return false
      if (NOT_ARRIVED_AT.some((prefix) => presetId.startsWith(prefix))) return false
      return driving || !presetId.startsWith(PARKING)
    })
    .filter(keepFirstNamed(excludeId))
    .slice(0, MAX_CHILDREN)
}
