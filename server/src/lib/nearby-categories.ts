import type { Place, NearbyCategory, PlaceCategory } from '../types/place.types'
import { categoryService } from '../services/category.service'
import { getPlaceCategory, resolveIcon } from './place-categories'

/**
 * A rule that maps a place type pattern to a list of relevant nearby category preset IDs.
 * Rules are evaluated in order; the first match wins.
 */
interface NearbyCategoryRule {
  /** Human label for debugging */
  label: string
  /** Returns true if this rule applies to the given place */
  match: (place: Place) => boolean
  /** OSM preset IDs for nearby categories to suggest */
  categories: string[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function presetStartsWith(...prefixes: string[]) {
  return (place: Place) => {
    const presetId = place.icon?.presetId || ''
    return prefixes.some((p) => presetId.startsWith(p))
  }
}

function placeTypeIs(...types: string[]) {
  return (place: Place) => {
    const pt = place.placeType?.value || ''
    return types.includes(pt)
  }
}

// ─── Rules ────────────────────────────────────────────────────────────────────
// Order matters: more specific rules first. First match wins.

const rules: NearbyCategoryRule[] = [
  {
    label: 'Airports',
    match: presetStartsWith('aeroway/aerodrome'),
    categories: [
      'aeroway/gate',
      'amenity/restaurant',
      'amenity/cafe',
      'shop',
      'amenity/toilets',
      'amenity/car_rental',
      'tourism/hotel',
      'amenity/parking',
      'amenity/atm',
    ],
  },
  {
    label: 'Transit stations',
    match: presetStartsWith(
      'railway/station',
      'railway/halt',
      'public_transport/station',
      'amenity/bus_station',
    ),
    categories: [
      'amenity/cafe',
      'amenity/restaurant',
      'shop',
      'amenity/toilets',
      'amenity/parking',
      'amenity/bicycle_parking',
    ],
  },
  {
    label: 'Universities & Colleges',
    match: presetStartsWith('amenity/university', 'amenity/college'),
    categories: [
      'amenity/library',
      'amenity/cafe',
      'amenity/restaurant',
      'amenity/food_court',
      'building/university',
      'building/dormitory',
      'amenity/parking',
      'leisure/sports_centre',
      'amenity/bicycle_parking',
    ],
  },
  {
    label: 'Hospitals',
    match: presetStartsWith('amenity/hospital'),
    categories: [
      'amenity/pharmacy',
      'amenity/parking',
      'amenity/cafe',
      'amenity/atm',
      'amenity/toilets',
    ],
  },
  {
    label: 'Shopping malls & Retail areas',
    match: presetStartsWith('shop/mall', 'shop/department_store', 'landuse/retail', 'landuse/commercial'),
    categories: [
      'amenity/restaurant',
      'amenity/cafe',
      'shop/clothes',
      'shop/supermarket',
      'shop',
      'amenity/toilets',
      'amenity/parking',
      'amenity/atm',
    ],
  },
  {
    label: 'Parks',
    match: presetStartsWith('leisure/park', 'leisure/garden', 'leisure/nature_reserve'),
    categories: [
      'amenity/toilets',
      'amenity/drinking_water',
      'amenity/bench',
      'leisure/playground',
      'leisure/pitch',
      'amenity/parking',
      'amenity/bicycle_parking',
    ],
  },
  {
    label: 'Hotels & Lodging',
    match: presetStartsWith('tourism/hotel', 'tourism/motel', 'tourism/hostel', 'tourism/guest_house'),
    categories: [
      'amenity/restaurant',
      'amenity/cafe',
      'amenity/parking',
      'amenity/atm',
      'shop',
    ],
  },
  {
    label: 'Cities & Towns',
    match: placeTypeIs('city', 'town', 'village'),
    categories: [
      'tourism/attraction',
      'tourism/museum',
      'leisure/park',
      'amenity/restaurant',
      'amenity/cafe',
      'tourism/hotel',
      'aeroway/aerodrome',
      'amenity/hospital',
    ],
  },
  {
    label: 'Neighbourhoods & Suburbs',
    match: placeTypeIs('suburb', 'neighbourhood', 'borough', 'quarter'),
    categories: [
      'amenity/restaurant',
      'amenity/cafe',
      'leisure/park',
      'shop/supermarket',
      'shop',
      'amenity/school',
      'amenity/place_of_worship',
    ],
  },
  {
    label: 'Counties & Regions',
    match: placeTypeIs('county', 'state', 'country'),
    categories: [
      'tourism/attraction',
      'aeroway/aerodrome',
      'leisure/park',
      'tourism/museum',
      'amenity/hospital',
      'amenity/university',
    ],
  },
  {
    label: 'Food Courts & Dining Halls',
    match: presetStartsWith('amenity/food_court'),
    categories: [
      'amenity/restaurant',
      'amenity/cafe',
      'amenity/fast_food',
      'amenity/ice_cream',
      'amenity/toilets',
    ],
  },
  {
    label: 'Stadiums & Sports venues',
    match: presetStartsWith('leisure/stadium', 'leisure/sports_centre'),
    categories: [
      'amenity/restaurant',
      'amenity/cafe',
      'amenity/parking',
      'amenity/toilets',
      'amenity/atm',
    ],
  },
  {
    label: 'Museums & Attractions',
    match: presetStartsWith('tourism/museum', 'tourism/attraction', 'historic'),
    categories: [
      'amenity/cafe',
      'amenity/restaurant',
      'amenity/toilets',
      'shop',
      'amenity/parking',
    ],
  },
  {
    label: 'Apartment Complexes',
    match: presetStartsWith('building/apartments', 'building/residential', 'landuse/residential', 'residential'),
    categories: [
      'building/apartments',
      'office/estate_agent',
      'amenity/parking',
      'amenity/bicycle_parking',
      'leisure/swimming_pool',
      'leisure/dog_park',
    ],
  },
  {
    label: 'Schools & Lower Education',
    match: presetStartsWith('amenity/school', 'amenity/kindergarten', 'amenity/childcare'),
    categories: [
      'leisure/playground',
      'leisure/pitch',
      'amenity/bicycle_parking',
      'amenity/parking',
      'amenity/library',
      'amenity/toilets',
    ],
  },
  {
    label: 'Places of Worship',
    match: presetStartsWith('amenity/place_of_worship'),
    categories: [
      'amenity/parking',
      'amenity/bicycle_parking',
      'amenity/community_centre',
      'amenity/cafe',
      'amenity/toilets',
      'landuse/cemetery',
      'shop/books',
    ],
  },
]

// ─── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Resolve nearby categories for a place based on its type/tags.
 * Returns enriched NearbyCategory objects with name, icon, and color info.
 * This is a fast synchronous operation (no API calls) — safe to call during enrichment.
 */
export function resolveNearbyCategories(place: Place): NearbyCategory[] {
  // Find the first matching rule
  const matchedRule = rules.find((rule) => rule.match(place))
  if (!matchedRule) return []

  // Resolve each preset ID to a full NearbyCategory
  const resolved: NearbyCategory[] = []

  for (const presetId of matchedRule.categories) {
    const preset = categoryService.getCategoryById(presetId)

    if (preset) {
      resolved.push({
        presetId: preset.id,
        name: preset.name,
        icon: preset.iconName,
        iconPack: preset.iconPack,
        iconCategory: preset.iconCategory as PlaceCategory | undefined,
      })
    } else {
      // Preset not found in category service — build a minimal entry
      // This handles generic presets like "shop" that may not have an exact match
      const icon = resolveIcon('maki-marker')
      resolved.push({
        presetId,
        name: presetId.split('/').pop()?.replace(/_/g, ' ') || presetId,
        icon: icon.icon,
        iconPack: icon.iconPack,
        iconCategory: getPlaceCategory(presetId),
      })
    }
  }

  return resolved
}
