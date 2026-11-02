/**
 * Floor plans of buildings and station complexes from Barrelman's `indoor` bundle,
 * one feature per level, filtered to each venue's shown level through style state.
 */
import type { FlavorId } from './build'
import { combineFilters } from './combine-filters'

export const INDOOR_SOURCE = 'indoor'
/** Barrelman's bundle name; see `TILE_BUNDLES` there. */
export const INDOOR_TILES = 'indoor'
export const INDOOR_VENUE_TILES = 'indoor_venues'
export const INDOOR_MAP_TILES = 'indoor_map'

/** Where floor plans take over from the building they are inside. */
export const INDOOR_MINZOOM = 16

/** Style `state` keys the floor picker drives; see `indoorState`. */
export const INDOOR_STATE = {
  venue: 'indoorVenue',
  level: 'indoorLevel',
  /** `;`-delimited ids of the buildings_3d outlines floor plans stand in. */
  buildings: 'indoorBuildings',
} as const

/** Every indoor layer's id starts with this, so the setting can hide them all. */
export const INDOOR_LAYER_PREFIX = 'Indoor '
export const INDOOR_FLOOR_LAYER = 'Indoor floor'
export const INDOOR_AREA_LAYER = 'Indoor rooms'
export const INDOOR_WALL_LAYER = 'Indoor walls'
export const INDOOR_STEPS_LAYER = 'Indoor steps'
export const INDOOR_LABEL_LAYER = 'Indoor room labels'
export const INDOOR_POI_LAYER = 'Indoor places'
export const INDOOR_FIXTURE_LAYER = 'Indoor fixtures'
export const INDOOR_VENUE_LAYER = 'Indoor venues'
export const INDOOR_VEIL_LAYER = 'Indoor underground veil'

/** Heights in metres: the plinth, the rooms inlaid on it, and the walls. */
const FLOOR_HEIGHT = 0.3
const ROOM_HEIGHT = 0.4
const WALL_HEIGHT = 1.8

export function indoorSource(tileUrl: (source: string) => string) {
  return {
    type: 'vector' as const,
    tiles: [tileUrl(INDOOR_TILES)],
    minzoom: 15,
    maxzoom: 17,
  }
}

/** The style's initial state: no venue focused, ground level, nothing replaced. */
export function indoorState() {
  return {
    [INDOOR_STATE.venue]: { default: 0 },
    [INDOOR_STATE.level]: { default: 0 },
    [INDOOR_STATE.buildings]: { default: '' },
  }
}

/** The level a feature's venue is showing: the picked one if focused, else its default. */
const shownLevel = [
  'case',
  ['==', ['get', 'venue'], ['global-state', INDOOR_STATE.venue]],
  ['global-state', INDOOR_STATE.level],
  ['get', 'default_level'],
]

const onShownLevel = ['==', ['get', 'level'], shownLevel]
const kind = (...kinds: string[]) => ['match', ['get', 'kind'], kinds, true, false]
const cls = ['get', 'class']
const sub = ['coalesce', ['get', 'subclass'], '']

/** A buildings_3d filter without the buildings a floor plan is showing inside. */
export function withoutIndoorBuildings(filter: unknown): unknown {
  return combineFilters([
    filter,
    ['!', ['in', ['concat', ';', ['to-string', ['get', 'id']], ';'], ['global-state', INDOOR_STATE.buildings]]],
  ])
}

const FOOD = ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'food_court', 'ice_cream', 'bakery', 'biergarten', 'coffee']
const STORE = ['shop', 'kiosk', 'marketplace', 'duty_free', 'retail']
const HEALTH = ['pharmacy', 'clinic', 'doctors', 'dentist', 'hospital', 'first_aid', 'chemist']
const SERVICE = ['toilets', 'toilet', 'shower', 'information', 'ticket', 'atm', 'bank', 'bureau_de_change', 'post_office', 'luggage_locker', 'left_luggage', 'lounge', 'waiting', 'waiting_room']
const BACK_OF_HOUSE = ['technical', 'storage', 'office', 'utility', 'private', 'staff']

type IndoorPalette = Record<
  'veil' | 'floor' | 'area' | 'room' | 'private' | 'platform' | 'stairs' | 'shaft' | 'column' | 'wall' | 'steps'
  | 'food' | 'store' | 'health' | 'service' | 'label',
  string
>

/** Warm paper by day, the basemap's blues by night; a room that is a place takes a wash of its category. */
const COLORS: Record<FlavorId, IndoorPalette> = {
  light: {
    veil: 'hsl(48, 16%, 94.5%)',
    floor: 'hsl(36, 48%, 95.5%)',
    area: 'hsl(36, 42%, 93.5%)',
    room: 'hsl(32, 34%, 88%)',
    private: 'hsl(32, 12%, 86%)',
    platform: 'hsl(222, 22%, 90%)',
    stairs: 'hsl(32, 16%, 83%)',
    shaft: 'hsl(222, 16%, 85%)',
    column: 'hsl(32, 10%, 74%)',
    wall: 'hsl(30, 12%, 79%)',
    steps: 'hsl(30, 10%, 60%)',
    food: 'hsl(28, 80%, 87%)',
    store: 'hsl(214, 72%, 90%)',
    health: 'hsl(352, 62%, 91%)',
    service: 'hsl(222, 26%, 90%)',
    label: 'hsl(30, 10%, 40%)',
  },
  dark: {
    veil: 'hsl(216, 37%, 24%)',
    floor: 'hsl(217, 30%, 30%)',
    area: 'hsl(217, 28%, 32%)',
    room: 'hsl(217, 26%, 38%)',
    private: 'hsl(217, 18%, 34%)',
    platform: 'hsl(222, 26%, 36%)',
    stairs: 'hsl(217, 16%, 42%)',
    shaft: 'hsl(222, 20%, 41%)',
    column: 'hsl(217, 16%, 50%)',
    wall: 'hsl(217, 22%, 56%)',
    steps: 'hsl(217, 16%, 64%)',
    food: 'hsl(26, 34%, 38%)',
    store: 'hsl(214, 40%, 43%)',
    health: 'hsl(350, 26%, 40%)',
    service: 'hsl(222, 22%, 41%)',
    label: 'hsl(220, 12%, 82%)',
  },
}

function roomColor(c: IndoorPalette) {
  return [
    'match', cls,
    'platform', c.platform,
    'stairs', c.stairs,
    'elevator', c.shaft,
    'column', c.column,
    'room', ['match', sub,
      FOOD, c.food,
      STORE, c.store,
      HEALTH, c.health,
      SERVICE, c.service,
      BACK_OF_HOUSE, c.private,
      c.room,
    ],
    c.area,
  ]
}

/** The basemap's POI category for a tag value, so an indoor badge matches the street's. */
const POI_CATEGORY = [
  'match', sub,
  FOOD, 'food_and_drink',
  ['pharmacy', 'clinic', 'doctors', 'dentist', 'first_aid', 'hospital', 'chemist'], 'medical',
  ['library', 'school', 'university', 'college'], 'education',
  ['cinema', 'theatre', 'museum', 'arts_centre', 'gallery', 'nightclub', 'casino'], 'arts_and_entertainment',
  ['fitness_centre', 'sports_centre', 'swimming_pool'], 'sport_and_leisure',
  ['match', cls, 'shop', 'store', 'commercial_services'],
]

const categoryToken = (prefix: string) => [
  'match', POI_CATEGORY,
  'food_and_drink', `@${prefix}_food_and_drink`,
  'medical', `@${prefix}_medical`,
  'education', `@${prefix}_education`,
  'arts_and_entertainment', `@${prefix}_arts_and_entertainment`,
  'sport_and_leisure', `@${prefix}_sport_and_leisure`,
  'store', `@${prefix}_store`,
  `@${prefix}_commercial_services`,
]

/** Sprite glyphs for tag values not named in it; anything else takes its category's glyph. */
const ART_ALIASES: Record<string, string> = {
  toilet: 'toilets',
  chemist: 'pharmacy',
  newsagent: 'shop',
  kiosk: 'shop',
  duty_free: 'shop',
  bureau_de_change: 'bank',
  luggage_locker: 'suitcase',
  left_luggage: 'suitcase',
  ticket: 'information',
  waiting_room: 'shelter',
  lounge: 'bar',
}

/** Tag values the sprite has a badge for under the same name. */
export const POI_ART = [
  'restaurant', 'cafe', 'bar', 'pub', 'bakery', 'food_court', 'ice_cream', 'fast_food', 'coffee',
  'pharmacy', 'clinic', 'doctors', 'dentist', 'hospital', 'atm', 'bank', 'toilets', 'shower',
  'information', 'post_office', 'clothes', 'shoes', 'books', 'convenience', 'supermarket', 'jewelry',
  'florist', 'optician', 'hairdresser', 'mobile_phone', 'confectionery', 'deli', 'gift', 'wine',
  'cinema', 'theatre', 'museum', 'library', 'nightclub', 'fitness_centre', 'police', 'charging_station',
  'drinking_water', 'telephone', 'bicycle_parking', 'parking', 'car_rental', 'taxi', 'shop',
]

const CATEGORY_ART: Record<string, string> = {
  food_and_drink: 'restaurant',
  medical: 'pharmacy',
  education: 'library',
  arts_and_entertainment: 'attraction',
  sport_and_leisure: 'fitness',
  store: 'shop',
  commercial_services: 'commercial',
}

const poiArt = [
  'match', sub,
  POI_ART, sub,
  ...Object.entries(ART_ALIASES).flat(),
  ['match', POI_CATEGORY, ...Object.entries(CATEGORY_ART).flat(), 'commercial'],
]

/** The basemap's badge, composited by `poi-badge.ts` from the name. */
const poiBadge = [
  'concat', 'poi|badge-', poiArt,
  '|', categoryToken('poi_plate'),
  '|', categoryToken('poi_ink'),
  '|', categoryToken('poi_ring'),
  '|', '@poi_lift',
]

/** The secondary tier: lifts, stairs, entrances and toilets as small squares, read as signage. */
const FIXTURE_ART = [
  'match', ['concat', cls, ':', sub],
  ['elevator:elevator', 'poi:elevator'], 'elevator',
  ['door:main', 'door:entrance', 'door:service', 'door:emergency', 'door:exit'], 'entrance-alt1',
  ['railway:subway_entrance', 'railway:train_station_entrance'], 'entrance',
  ['amenity:toilets', 'room:toilets', 'room:toilet'], 'toilet',
  ['amenity:drinking_water'], 'drinking-water',
  ['amenity:information', 'tourism:information'], 'information',
  ['escalator:forward', 'escalator:backward', 'escalator:reversible', 'escalator:yes'], 'escalator',
  ['steps:'], 'stairs',
  '',
]

const fixtureBadge = [
  'concat', 'poi|tile-', FIXTURE_ART, '|@poi_transit_plate|@poi_transit_ink|@poi_transit_ring|@poi_lift',
]

const isFixture = ['!=', FIXTURE_ART, '']

/** Fades the street over a venue while it shows a basement; sits under the buildings. */
export function indoorVeilLayer(flavor: FlavorId): any {
  return {
    id: INDOOR_VEIL_LAYER,
    type: 'fill',
    source: INDOOR_SOURCE,
    'source-layer': INDOOR_VENUE_TILES,
    minzoom: INDOOR_MINZOOM,
    filter: ['==', ['get', 'venue'], ['global-state', INDOOR_STATE.venue]],
    paint: {
      'fill-color': COLORS[flavor].veil,
      'fill-opacity': ['case', ['<', ['global-state', INDOOR_STATE.level], 0], 0.72, 0],
      'fill-opacity-transition': { duration: 300 },
    },
  }
}

/** The floor plan itself: the floor, its rooms, steps and walls. */
export function indoorLayers(flavor: FlavorId): any[] {
  const c = COLORS[flavor]
  const base = {
    source: INDOOR_SOURCE,
    'source-layer': INDOOR_MAP_TILES,
    minzoom: INDOOR_MINZOOM,
  }
  const fadeIn = ['interpolate', ['linear'], ['zoom'], INDOOR_MINZOOM, 0, INDOOR_MINZOOM + 0.5, 1]
  return [
    {
      // Never drawn: keeps venue outlines loading so the floor picker can find them.
      id: INDOOR_VENUE_LAYER,
      type: 'fill',
      source: INDOOR_SOURCE,
      'source-layer': INDOOR_VENUE_TILES,
      minzoom: 15,
      paint: { 'fill-opacity': 0 },
    },
    {
      ...base,
      id: INDOOR_FLOOR_LAYER,
      type: 'fill-extrusion',
      filter: ['all', kind('floor'), onShownLevel],
      paint: {
        'fill-extrusion-color': c.floor,
        'fill-extrusion-height': FLOOR_HEIGHT,
        'fill-extrusion-opacity': 1,
        'fill-extrusion-vertical-gradient': false,
      },
    },
    {
      ...base,
      id: INDOOR_AREA_LAYER,
      type: 'fill-extrusion',
      filter: ['all', kind('area'), ['!=', cls, 'level'], onShownLevel],
      paint: {
        'fill-extrusion-color': roomColor(c),
        'fill-extrusion-base': FLOOR_HEIGHT,
        'fill-extrusion-height': ['match', cls, 'column', WALL_HEIGHT, ['room', 'elevator', 'stairs'], ROOM_HEIGHT, FLOOR_HEIGHT + 0.02],
        'fill-extrusion-vertical-gradient': false,
      },
    },
    {
      ...base,
      id: INDOOR_STEPS_LAYER,
      type: 'line',
      filter: ['all', kind('line'), ['match', cls, ['steps', 'escalator'], true, false], onShownLevel],
      layout: { 'line-cap': 'butt' },
      paint: {
        'line-color': c.steps,
        'line-width': ['interpolate', ['exponential', 2], ['zoom'], 17, 4, 20, 26],
        'line-dasharray': [0.12, 0.18],
        'line-opacity': fadeIn,
      },
    },
    {
      ...base,
      id: INDOOR_WALL_LAYER,
      type: 'fill-extrusion',
      filter: ['all', kind('wall'), onShownLevel],
      paint: {
        'fill-extrusion-color': c.wall,
        'fill-extrusion-base': FLOOR_HEIGHT,
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], INDOOR_MINZOOM, FLOOR_HEIGHT, INDOOR_MINZOOM + 1, WALL_HEIGHT],
        'fill-extrusion-vertical-gradient': true,
      },
    },
  ]
}

/** Badges and names; `@token` colours are resolved by `build.ts` against the live POI palette. */
export function indoorLabelLayers(
  flavor: FlavorId,
  label: { font: unknown; halo: string; haloWidth: number; haloBlur: number },
): any[] {
  const c = COLORS[flavor]
  const base = {
    source: INDOOR_SOURCE,
    'source-layer': INDOOR_MAP_TILES,
    minzoom: INDOOR_MINZOOM,
  }
  const name = ['coalesce', ['get', 'name'], ['get', 'ref'], '']
  return [
    ...(['point', 'line'] as const).map(placement => ({
      ...base,
      id: placement === 'point' ? INDOOR_FIXTURE_LAYER : `${INDOOR_FIXTURE_LAYER} (steps)`,
      type: 'symbol',
      minzoom: 17,
      filter: ['all', kind(placement === 'point' ? 'poi' : 'line'), isFixture, onShownLevel],
      layout: {
        'icon-image': fixtureBadge,
        'icon-size': 0.62,
        'symbol-placement': placement === 'point' ? 'point' : 'line-center',
        'icon-rotation-alignment': 'viewport',
        'icon-padding': 2,
        'symbol-sort-key': 2,
      },
    })),
    {
      ...base,
      id: INDOOR_POI_LAYER,
      type: 'symbol',
      filter: [
        'all',
        kind('poi'),
        ['match', cls, ['shop', 'amenity', 'aeroway', 'tourism', 'healthcare', 'leisure', 'office', 'craft'], true, false],
        ['any', ['has', 'name'], ['has', 'ref'], ['match', sub, ['atm', 'pharmacy'], true, false]],
        ['!', isFixture],
        onShownLevel,
      ],
      layout: {
        'icon-image': ['case', ['==', cls, 'aeroway'], '', poiBadge],
        'text-field': name,
        'text-font': label.font,
        'text-size': 12,
        'text-anchor': ['case', ['==', cls, 'aeroway'], 'center', 'top'],
        'text-offset': ['case', ['==', cls, 'aeroway'], ['literal', [0, 0]], ['literal', [0, 1.1]]],
        'text-max-width': 7,
        'text-optional': true,
        'text-padding': 4,
        'symbol-sort-key': 1,
      },
      paint: {
        'text-color': ['case', ['==', cls, 'aeroway'], '@label_ink_strong', categoryToken('poi_ink')],
        'text-halo-color': label.halo,
        'text-halo-width': label.haloWidth,
        'text-halo-blur': label.haloBlur,
      },
    },
    {
      ...base,
      id: INDOOR_LABEL_LAYER,
      type: 'symbol',
      minzoom: 17,
      filter: ['all', kind('poi'), ['match', cls, ['room', 'platform'], true, false], ['!', isFixture], ['has', 'name'], onShownLevel],
      layout: {
        'text-field': name,
        'text-font': label.font,
        'text-size': ['interpolate', ['linear'], ['zoom'], 17, 10.5, 19, 12.5],
        'text-max-width': 8,
        'text-padding': 3,
        'symbol-sort-key': 3,
      },
      paint: {
        'text-color': c.label,
        'text-halo-color': label.halo,
        'text-halo-width': label.haloWidth,
        'text-halo-blur': label.haloBlur,
      },
    },
  ]
}
