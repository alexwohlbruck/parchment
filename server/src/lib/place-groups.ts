import type { PlaceCategory } from '../types/place.types'
import type { CategoryResult } from '../types/search.types'
import type { TagSet } from './place-attributes'
import type enUS from './i18n/locales/en-US.json'

/**
 * Kinds of place that answer the same need without sharing an OSM tag:
 * benches, picnic tables and bleachers are all somewhere to sit. Searching a
 * group browses every member at once.
 *
 * A member is a category id (a schema preset or a place attribute) or a raw tag
 * set for places that carry the thing as a tag rather than being mapped as it.
 */
export interface PlaceGroup {
  id: string
  nameKey: keyof typeof enUS.placeGroups
  icon: string
  category: PlaceCategory
  members: Array<string | TagSet>
  aliases: string[]
  /** A member preset the group stands in for in search, so one name doesn't show twice. */
  replaces?: string
}

export const PLACE_GROUPS: PlaceGroup[] = [
  {
    id: 'group/restrooms',
    nameKey: 'restrooms',
    icon: 'Toilet',
    category: 'commercial_services',
    replaces: 'amenity/toilets',
    members: ['amenity/toilets', { toilets: 'yes' }],
    aliases: ['bathrooms', 'toilets', 'public restroom', 'public bathroom'],
  },
  {
    id: 'group/seating',
    nameKey: 'seating',
    icon: 'Armchair',
    category: 'park',
    members: [
      'amenity/bench', 'leisure/picnic_table', 'tourism/picnic_site',
      'amenity/shelter/picnic_shelter', 'leisure/outdoor_seating',
      'leisure/bleachers', 'amenity/lounger',
    ],
    aliases: ['seats', 'place to sit', 'somewhere to sit', 'sit down', 'benches', 'picnic'],
  },
  {
    id: 'group/pizza',
    nameKey: 'pizza',
    icon: 'Pizza',
    category: 'food_and_drink',
    // Barrelman files every listed cuisine as its own category, so this also
    // finds places serving `pizza;italian`, which a cuisine=pizza tag filter misses.
    members: [{ cuisine: 'pizza' }],
    aliases: ['pizzeria', 'pizza place', 'pizza shop', 'slice', 'pizza delivery'],
  },
  {
    id: 'group/pet_facilities',
    nameKey: 'petFacilities',
    icon: 'PawPrint',
    category: 'park',
    members: [
      'leisure/dog_park', 'amenity/dog_toilet',
      'amenity/vending_machine/excrement_bags', 'amenity/waste/dog_excrement',
    ],
    aliases: [
      'dog facilities', 'pet area', 'pet relief', 'dog relief area', 'poop bags',
      'dog bags', 'dog poop', 'dog waste', 'dog bin',
    ],
  },
  {
    id: 'group/trash_and_recycling',
    nameKey: 'trashAndRecycling',
    icon: 'Trash2',
    category: 'commercial_services',
    members: ['amenity/waste_basket', 'amenity/waste_disposal', { amenity: 'recycling' }],
    aliases: ['trash', 'garbage', 'rubbish', 'litter', 'waste', 'bins', 'recycling', 'dumpsters'],
  },
  {
    id: 'group/swimming',
    nameKey: 'swimming',
    icon: 'Waves',
    category: 'sport_and_leisure',
    members: [
      'natural/beach', 'leisure/swimming_pool', 'leisure/sports_centre/swimming',
      'leisure/water_park', 'leisure/swimming_area', 'leisure/bathing_place',
    ],
    aliases: ['swim', 'place to swim', 'swimming spot', 'aquatic center', 'aquatics center', 'natatorium'],
  },
]

const groupsById = new Map(PLACE_GROUPS.map((g) => [g.id, g]))

export function getPlaceGroup(id: string): PlaceGroup | undefined {
  return groupsById.get(id)
}

export function isPlaceGroup(id: string): boolean {
  return groupsById.has(id)
}

/**
 * The tie-break search adds for a short name. A group gets the most, so it
 * leads a member matching the query just as well: "garbage" opens every bin
 * before trash cans alone.
 */
export function nameLengthBonus(category: Pick<CategoryResult, 'id' | 'name'>): number {
  return isPlaceGroup(category.id) ? 50 : Math.max(0, 50 - category.name.length)
}

const replacedPresets = new Set(PLACE_GROUPS.flatMap((g) => g.replaces ?? []))

/** Leaves out presets a group answers for, keeping the rest in order. */
export function withoutReplacedPresets<T extends { category: Pick<CategoryResult, 'id'> }>(
  matches: T[],
): T[] {
  return matches.filter((m) => !replacedPresets.has(m.category.id))
}
