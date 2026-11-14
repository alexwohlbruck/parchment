import type { PlaceCategory } from '../types/place.types'
import type enUS from './i18n/locales/en-US.json'

/** OSM tags a place must all carry to match one way of having an attribute. */
export type TagSet = Record<string, string>

/**
 * Something a place has rather than something it is — outdoor seating, a
 * restroom, takeout. Searching one browses every nearby place whose tags match
 * any of `tagSets`, whatever kind of place it is.
 */
export interface PlaceAttribute {
  id: string
  nameKey: keyof typeof enUS.placeAttributes
  icon: string
  category: PlaceCategory
  tagSets: TagSet[]
  aliases: string[]
}

const valuesOf = (key: string, values: string[]): TagSet[] =>
  values.map((value) => ({ [key]: value }))

export const PLACE_ATTRIBUTES: PlaceAttribute[] = [
  {
    id: 'outdoor_seating/yes',
    nameKey: 'outdoorSeating',
    icon: 'Umbrella',
    category: 'food_and_drink',
    tagSets: valuesOf('outdoor_seating', [
      'yes', 'terrace', 'garden', 'patio', 'sidewalk', 'pedestrian_zone', 'roof',
    ]),
    aliases: [
      'outdoor dining', 'outside seating', 'eat outside', 'patio', 'terrace',
      'garden seating', 'beer garden', 'sidewalk seating', 'al fresco', 'rooftop',
    ],
  },
  {
    id: 'wheelchair/yes',
    nameKey: 'wheelchair',
    icon: 'Accessibility',
    category: 'commercial_services',
    tagSets: valuesOf('wheelchair', ['yes', 'designated']),
    aliases: ['accessible', 'wheelchair access', 'step free', 'step-free', 'handicap accessible', 'ada'],
  },
  {
    id: 'toilets:wheelchair/yes',
    nameKey: 'accessibleRestroom',
    icon: 'Accessibility',
    category: 'commercial_services',
    tagSets: valuesOf('toilets:wheelchair', ['yes', 'designated']),
    aliases: ['accessible toilet', 'accessible bathroom', 'wheelchair toilet', 'wheelchair restroom', 'disabled toilet'],
  },
  {
    id: 'internet_access:fee/no',
    nameKey: 'freeWifi',
    icon: 'Wifi',
    category: 'commercial_services',
    tagSets: [
      { internet_access: 'wlan', 'internet_access:fee': 'no' },
      { internet_access: 'yes', 'internet_access:fee': 'no' },
    ],
    aliases: ['free wi-fi', 'free internet', 'free wireless'],
  },
  {
    id: 'takeaway/yes',
    nameKey: 'takeout',
    icon: 'ShoppingBag',
    category: 'food_and_drink',
    tagSets: valuesOf('takeaway', ['yes', 'only']),
    aliases: ['take out', 'take-out', 'takeaway', 'take away', 'to go', 'carry out', 'carryout', 'pickup'],
  },
  {
    id: 'delivery/yes',
    nameKey: 'delivery',
    icon: 'Truck',
    category: 'food_and_drink',
    tagSets: valuesOf('delivery', ['yes', 'only']),
    aliases: ['food delivery', 'delivers'],
  },
  {
    id: 'drive_through/yes',
    nameKey: 'driveThrough',
    icon: 'Car',
    category: 'food_and_drink',
    tagSets: valuesOf('drive_through', ['yes']),
    aliases: ['drive thru', 'drive through', 'drive-through', 'drivethru'],
  },
  {
    id: 'air_conditioning/yes',
    nameKey: 'airConditioning',
    icon: 'AirVent',
    category: 'commercial_services',
    tagSets: valuesOf('air_conditioning', ['yes']),
    aliases: ['ac', 'a/c', 'air conditioned', 'aircon', 'cool place'],
  },
  {
    id: 'bar/yes',
    nameKey: 'bar',
    icon: 'Martini',
    category: 'food_and_drink',
    tagSets: valuesOf('bar', ['yes']),
    aliases: ['bar inside', 'full bar', 'restaurant with bar', 'serves alcohol'],
  },
  {
    id: 'dog/yes',
    nameKey: 'dogFriendly',
    icon: 'Dog',
    category: 'commercial_services',
    tagSets: valuesOf('dog', ['yes', 'leashed']),
    aliases: ['dogs allowed', 'dogs welcome', 'pet friendly', 'pets allowed', 'dog-friendly'],
  },
  {
    id: 'diet:vegan/yes',
    nameKey: 'vegan',
    icon: 'Vegan',
    category: 'food_and_drink',
    tagSets: valuesOf('diet:vegan', ['yes', 'only']),
    aliases: ['vegan', 'vegan food', 'plant based', 'plant-based'],
  },
  {
    id: 'diet:vegetarian/yes',
    nameKey: 'vegetarian',
    icon: 'Salad',
    category: 'food_and_drink',
    tagSets: valuesOf('diet:vegetarian', ['yes', 'only']),
    aliases: ['vegetarian', 'vegetarian food', 'veggie'],
  },
  {
    id: 'diet:gluten_free/yes',
    nameKey: 'glutenFree',
    icon: 'WheatOff',
    category: 'food_and_drink',
    tagSets: valuesOf('diet:gluten_free', ['yes', 'only']),
    aliases: ['gluten free', 'gluten-free', 'celiac', 'coeliac'],
  },
  {
    id: 'diet:halal/yes',
    nameKey: 'halal',
    icon: 'Beef',
    category: 'food_and_drink',
    tagSets: valuesOf('diet:halal', ['yes', 'only']),
    aliases: ['halal', 'halal food'],
  },
  {
    id: 'changing_table/yes',
    nameKey: 'babyChanging',
    icon: 'Baby',
    category: 'commercial_services',
    tagSets: valuesOf('changing_table', ['yes']),
    aliases: ['changing table', 'baby change', 'diaper change', 'nappy change'],
  },
  {
    id: 'live_music/yes',
    nameKey: 'liveMusic',
    icon: 'Music',
    category: 'arts_and_entertainment',
    tagSets: valuesOf('live_music', ['yes']),
    aliases: ['live band', 'gig', 'music venue'],
  },
  {
    id: 'reservation/yes',
    nameKey: 'reservations',
    icon: 'CalendarCheck',
    category: 'food_and_drink',
    tagSets: valuesOf('reservation', ['yes', 'recommended', 'required']),
    aliases: ['reservation', 'book a table', 'booking', 'reserve a table'],
  },
  {
    id: 'opening_hours/24_7',
    nameKey: 'open24Hours',
    icon: 'Clock',
    category: 'commercial_services',
    tagSets: valuesOf('opening_hours', ['24/7']),
    aliases: ['24/7', '24 hours', '24h', 'open all night', 'always open', 'open 24/7'],
  },
  {
    id: 'lgbtq/welcome',
    nameKey: 'lgbtqFriendly',
    icon: 'Rainbow',
    category: 'commercial_services',
    tagSets: valuesOf('lgbtq', ['welcome', 'primary', 'only', 'yes']),
    aliases: ['lgbtq', 'lgbt', 'gay friendly', 'queer friendly', 'gay bar'],
  },
]

/**
 * Places that carry a facility as a tag, browsed alongside a schema preset for
 * the same thing: a cafe tagged `toilets=yes` answers a search for restrooms
 * just as well as a standalone `amenity=toilets`.
 */
export const PRESET_EXTRA_TAG_SETS: Record<string, TagSet[]> = {
  'amenity/toilets': [{ toilets: 'yes' }],
}

const attributesById = new Map(PLACE_ATTRIBUTES.map((a) => [a.id, a]))

export function getPlaceAttribute(id: string): PlaceAttribute | undefined {
  return attributesById.get(id)
}
