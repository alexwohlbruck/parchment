/**
 * Floor plans of buildings and station complexes from Barrelman's `indoor` bundle,
 * one feature per level, filtered to each venue's shown level through style state.
 */
import type { FlavorId } from './build'
import { combineFilters } from './combine-filters'
import { INDOOR_FIXTURES_STATE, tileBadge } from './fixture-layers'

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
  /** `;`-delimited basemap feature ids of the places floor plans draw on their own level. */
  places: 'indoorPlaces',
} as const

/** Every indoor layer's id starts with this, so the setting can hide them all. */
export const INDOOR_LAYER_PREFIX = 'Indoor '
export const INDOOR_FLOOR_LAYER = 'Indoor floor'
export const INDOOR_AREA_LAYER = 'Indoor rooms'
export const INDOOR_SECURITY_LAYER = 'Indoor security'
export const INDOOR_WALL_LAYER = 'Indoor walls'
export const INDOOR_STEPS_LAYER = 'Indoor steps'
export const INDOOR_TREAD_LAYER = 'Indoor stair treads'
export const INDOOR_STAIR_EDGE_LAYER = 'Indoor stair edges'
export const INDOOR_FLIGHT_LAYER = 'Indoor flights'
export const INDOOR_LABEL_LAYER = 'Indoor room labels'
export const INDOOR_POI_LAYER = 'Indoor places'
export const INDOOR_GATE_LAYER = 'Indoor gates'
/** The stretchable plate a gate's number sits on; drawn by `gatePlate`, not the sprite. */
export const INDOOR_GATE_PLATE = 'indoor-gate-plate'
const GATE_FILL = '#f6c343'
const GATE_EDGE = '#e0a91f'
const GATE_INK = '#3a2a00'
export const INDOOR_FIXTURE_LAYER = 'Indoor fixtures'
export const INDOOR_VENUE_LAYER = 'Indoor venues'
export const INDOOR_UNDERGROUND_LAYER = 'Indoor underground'
export const INDOOR_FOOTPRINT_LAYER = 'Indoor footprints'

/** Heights in metres: the plinth, the rooms inlaid on it, and the walls. */
const FLOOR_HEIGHT = 0.3
const ROOM_HEIGHT = 0.4
const LIFT_HEIGHT = 2.4
const WALL_HEIGHT = 3.5

/** Barrelman's `indoor_features` version; a new one asks past the day-long tile caches. */
const INDOOR_FORMAT = 10

export function indoorSource(tileUrl: (source: string) => string) {
  return {
    type: 'vector' as const,
    tiles: [`${tileUrl(INDOOR_TILES)}&indoor=${INDOOR_FORMAT}`],
    minzoom: 15,
    maxzoom: 17,
  }
}

/** The level state that shows a focused venue's outside: no feature stands on it. */
export const EXTERIOR_LEVEL = 1000

/** The style's initial state: no venue focused, ground level, nothing replaced. */
export function indoorState() {
  return {
    [INDOOR_STATE.venue]: { default: 0 },
    [INDOOR_STATE.level]: { default: 0 },
    [INDOOR_STATE.buildings]: { default: '' },
    [INDOOR_STATE.places]: { default: '' },
    [INDOOR_FIXTURES_STATE]: { default: '' },
  }
}

/** The level a feature's venue is showing: the picked one if focused, else its default unless that is underground. */
const shownLevel = [
  'case',
  ['==', ['get', 'venue'], ['global-state', INDOOR_STATE.venue]],
  ['global-state', INDOOR_STATE.level],
  ['case', ['<', ['get', 'default_level'], 0], EXTERIOR_LEVEL, ['get', 'default_level']],
]

const onShownLevel = ['==', ['get', 'level'], shownLevel]
const kind = (...kinds: string[]) => ['match', ['get', 'kind'], kinds, true, false]
const cls = ['get', 'class']
const sub = ['coalesce', ['get', 'subclass'], '']

const listed = (key: unknown, state: string) => ['in', ['concat', ';', ['to-string', key], ';'], ['global-state', state]]

/** A buildings_3d filter without the buildings a floor plan is showing inside. */
export function withoutIndoorBuildings(filter: unknown): unknown {
  return combineFilters([filter, ['!', listed(['get', 'id'], INDOOR_STATE.buildings)]])
}

/** A basemap label filter without the places a floor plan draws on their own level. */
export function withoutIndoorPlaces(filter: unknown): unknown {
  return combineFilters([filter, ['!', listed(['id'], INDOOR_STATE.places)]])
}

/** Place classes the floor plan badges, but not the facilities the basemap's POI layer already draws. */
export const INDOOR_PLACE_CLASSES = ['shop', 'amenity', 'tourism', 'healthcare', 'leisure', 'office', 'craft']
export const BASEMAP_FACILITIES = ['toilets', 'toilet', 'drinking_water', 'information', 'water_point']

const FOOD = ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'food_court', 'ice_cream', 'bakery', 'biergarten', 'coffee']
const STORE = ['shop', 'kiosk', 'marketplace', 'duty_free', 'retail']
const HEALTH = ['pharmacy', 'clinic', 'doctors', 'dentist', 'hospital', 'first_aid', 'chemist']
const SERVICE = ['toilets', 'toilet', 'shower', 'information', 'ticket', 'atm', 'bank', 'bureau_de_change', 'post_office', 'luggage_locker', 'left_luggage', 'lounge', 'waiting', 'waiting_room']
const BACK_OF_HOUSE = ['technical', 'storage', 'office', 'utility', 'private', 'staff']
const BAGGAGE = ['baggage_claim', 'baggage_carousel', 'luggage_carousel', 'baggage_reclaim']

type IndoorPalette = Record<
  'underground' | 'footprint' | 'escalator' | 'tread' | 'floor' | 'area' | 'room' | 'private' | 'platform' | 'baggage'
  | 'stairs' | 'shaft' | 'column' | 'wall' | 'steps' | 'food' | 'store' | 'health' | 'service' | 'hatch' | 'hatchGap' | 'label'
  | 'jetBridge' | 'lift',
  string
>

/** Mapbox Indoor's palette by day, the basemap's blues by night; a room that is a place takes its category's tint. */
const COLORS: Record<FlavorId, IndoorPalette> = {
  light: {
    underground: 'hsl(222, 16%, 62%)',
    footprint: 'hsl(222, 12%, 52%)',
    floor: 'hsl(27, 82%, 95.7%)',
    area: 'hsl(27, 82%, 95.7%)',
    room: 'hsl(27, 56%, 87.6%)',
    private: 'hsl(27, 40%, 86%)',
    platform: 'hsl(240, 50%, 87.5%)',
    baggage: 'hsl(240, 80%, 92%)',
    stairs: 'hsl(30, 8%, 88%)',
    escalator: 'hsl(222, 40%, 90%)',
    tread: 'hsl(0, 0%, 100%)',
    shaft: 'hsl(30, 8%, 88%)',
    column: 'hsl(27, 20%, 80%)',
    wall: 'hsl(0, 0%, 100%)',
    steps: 'hsl(220, 8%, 66%)',
    food: 'hsl(30, 85%, 82.2%)',
    store: 'hsl(210, 69%, 82.2%)',
    health: 'hsl(352, 66%, 90%)',
    service: 'hsl(30, 8%, 90.6%)',
    hatch: 'hsl(45, 98%, 75%)',
    hatchGap: 'hsl(45, 90%, 99%)',
    label: 'hsl(222, 12%, 42%)',
    jetBridge: 'hsl(220, 10%, 88%)',
    lift: 'hsl(212, 34%, 80%)',
  },
  dark: {
    underground: 'hsl(222, 40%, 8%)',
    footprint: 'hsl(220, 16%, 56%)',
    floor: 'hsl(222, 24%, 27%)',
    area: 'hsl(222, 24%, 27%)',
    room: 'hsl(222, 20%, 33%)',
    private: 'hsl(222, 16%, 31%)',
    platform: 'hsl(240, 26%, 36%)',
    baggage: 'hsl(240, 30%, 42%)',
    stairs: 'hsl(222, 12%, 38%)',
    escalator: 'hsl(222, 26%, 40%)',
    tread: 'hsl(222, 14%, 52%)',
    shaft: 'hsl(222, 12%, 38%)',
    column: 'hsl(222, 12%, 44%)',
    wall: 'hsl(220, 14%, 52%)',
    steps: 'hsl(220, 10%, 60%)',
    food: 'hsl(28, 38%, 36%)',
    store: 'hsl(210, 42%, 40%)',
    health: 'hsl(350, 26%, 38%)',
    service: 'hsl(222, 12%, 36%)',
    hatch: 'hsl(45, 55%, 42%)',
    hatchGap: 'hsl(45, 25%, 30%)',
    label: 'hsl(220, 12%, 80%)',
    jetBridge: 'hsl(222, 14%, 34%)',
    lift: 'hsl(214, 26%, 46%)',
  },
}

function roomColor(c: IndoorPalette) {
  return [
    'match', cls,
    'platform', c.platform,
    'stairs', c.stairs,
    'elevator', c.lift,
    'corridor', ['match', sub, 'jet_bridge', c.jetBridge, c.area],
    'column', c.column,
    'room', ['match', sub,
      FOOD, c.food,
      STORE, c.store,
      HEALTH, c.health,
      SERVICE, c.service,
      BAGGAGE, c.baggage,
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

/** The secondary tier: lifts, stairs and entrances as small squares, read as signage. */
const FIXTURE_ART = [
  'match', ['concat', cls, ':', sub],
  ['elevator:elevator', 'poi:elevator'], 'elevator',
  ['door:main', 'door:entrance', 'door:service', 'door:emergency', 'door:exit'], 'entrance-alt1',
  ['railway:subway_entrance', 'railway:train_station_entrance'], 'entrance',
  ['escalator:forward', 'escalator:backward', 'escalator:reversible', 'escalator:yes'], 'escalator',
  ['steps:'], 'stairs',
  '',
]

const fixtureBadge = tileBadge(FIXTURE_ART)

const isFixture = ['!=', FIXTURE_ART, '']

const underground = ['all', ['!=', ['global-state', INDOOR_STATE.venue], 0], ['<', ['global-state', INDOOR_STATE.level], 0]]

/** Dims everything under the floor plan while a basement shows, so the plan reads as lit. */
export function indoorUndergroundLayer(flavor: FlavorId): any {
  return {
    id: INDOOR_UNDERGROUND_LAYER,
    type: 'background',
    minzoom: INDOOR_MINZOOM,
    paint: {
      'background-color': COLORS[flavor].underground,
      'background-opacity': ['case', underground, 0.5, 0],
      'background-opacity-transition': { duration: 300 },
    },
  }
}

/** While a basement shows, the cleared buildings' footprints, so the blocks above stay readable. */
export function indoorFootprintLayer(flavor: FlavorId, source: string): any {
  return {
    id: INDOOR_FOOTPRINT_LAYER,
    type: 'line',
    source,
    'source-layer': 'building',
    minzoom: INDOOR_MINZOOM,
    paint: {
      'line-color': COLORS[flavor].footprint,
      'line-width': ['interpolate', ['linear'], ['zoom'], 16, 0.5, 19, 1],
      'line-opacity': ['case', underground, 1, 0],
      'line-opacity-transition': { duration: 300 },
    },
  }
}

const steps = ['all', kind('line'), ['match', cls, ['steps', 'escalator'], true, false], onShownLevel]

/** A flight's drawn width, `share` of a 2.4 m stair at mid latitudes. */
const stairWidth = (share: number) =>
  ['interpolate', ['exponential', 2], ['zoom'], 16, 1.3 * share, 22, 85 * share]

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
        'fill-extrusion-height': ['match', cls, 'column', WALL_HEIGHT, 'elevator', LIFT_HEIGHT, ['room', 'stairs'], ROOM_HEIGHT, FLOOR_HEIGHT + 0.02],
        'fill-extrusion-vertical-gradient': false,
      },
    },
    {
      ...base,
      id: INDOOR_SECURITY_LAYER,
      type: 'fill-extrusion',
      filter: ['all', kind('area'), ['==', sub, 'security'], onShownLevel],
      paint: {
        'fill-extrusion-pattern': securityHatchName(flavor),
        'fill-extrusion-base': FLOOR_HEIGHT,
        'fill-extrusion-height': ROOM_HEIGHT + 0.02,
        'fill-extrusion-vertical-gradient': false,
      },
    },
    {
      ...base,
      id: INDOOR_STEPS_LAYER,
      type: 'line',
      filter: steps,
      layout: { 'line-cap': 'butt', 'line-join': 'miter' },
      paint: {
        'line-color': ['match', cls, 'escalator', c.escalator, c.stairs],
        'line-width': stairWidth(1),
        'line-opacity': fadeIn,
      },
    },
    {
      ...base,
      id: INDOOR_STAIR_EDGE_LAYER,
      type: 'line',
      filter: steps,
      layout: { 'line-cap': 'butt', 'line-join': 'miter' },
      paint: {
        'line-color': c.steps,
        'line-width': stairWidth(0.1),
        'line-gap-width': stairWidth(1),
        'line-opacity': fadeIn,
      },
    },
    {
      ...base,
      // A dash across a wide line is a tread: dashes are measured in line widths.
      id: INDOOR_TREAD_LAYER,
      type: 'line',
      filter: steps,
      layout: { 'line-cap': 'butt' },
      paint: {
        'line-color': c.tread,
        'line-width': stairWidth(0.86),
        'line-dasharray': [0.1, 0.22],
        'line-opacity': fadeIn,
      },
    },
    {
      ...base,
      // Each tread of a flight that climbs from this level, rising to the floor above.
      id: INDOOR_FLIGHT_LAYER,
      type: 'fill-extrusion',
      filter: ['all', kind('flight'), onShownLevel],
      paint: {
        'fill-extrusion-color': ['match', cls, 'escalator', c.escalator, c.stairs],
        'fill-extrusion-base': FLOOR_HEIGHT,
        'fill-extrusion-height': ['+', FLOOR_HEIGHT, ['*', ['coalesce', ['get', 'height'], 0], WALL_HEIGHT - FLOOR_HEIGHT]],
        'fill-extrusion-vertical-gradient': true,
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
    {
      ...base,
      id: INDOOR_FIXTURE_LAYER,
      type: 'symbol',
      minzoom: 17,
      filter: ['all', kind('poi'), isFixture, onShownLevel],
      layout: {
        'icon-image': fixtureBadge,
        'icon-size': 0.74,
        'icon-padding': 2,
        'symbol-sort-key': 2,
      },
    },
    {
      ...base,
      id: INDOOR_GATE_LAYER,
      type: 'symbol',
      filter: ['all', kind('poi'), ['==', cls, 'aeroway'], ['has', 'ref'], onShownLevel],
      layout: {
        'icon-image': INDOOR_GATE_PLATE,
        'icon-text-fit': 'both',
        'icon-text-fit-padding': [2, 5, 1, 5],
        'text-field': ['get', 'ref'],
        'text-font': label.font,
        'text-size': 12,
        'text-padding': 2,
        'symbol-sort-key': 0,
      },
      paint: { 'text-color': GATE_INK },
    },
    {
      ...base,
      id: INDOOR_POI_LAYER,
      type: 'symbol',
      filter: [
        'all',
        kind('poi'),
        ['match', cls, INDOOR_PLACE_CLASSES, true, false],
        ['any', ['has', 'name'], ['match', sub, ['atm', 'pharmacy'], true, false]],
        ['!', ['match', sub, BASEMAP_FACILITIES, true, false]],
        ['!', isFixture],
        onShownLevel,
      ],
      layout: {
        'icon-image': poiBadge,
        'text-field': name,
        'text-font': label.font,
        'text-size': 12,
        'text-anchor': 'top',
        'text-offset': [0, 1.1],
        'text-max-width': 7,
        'text-optional': true,
        'text-padding': 4,
        'symbol-sort-key': 1,
      },
      paint: {
        'text-color': categoryToken('poi_ink'),
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

/** The gate plate as an image MapLibre can stretch around the text, at `ratio` device pixels. */
export function gatePlate(ratio: number) {
  const size = Math.round(18 * ratio)
  const radius = 5 * ratio
  const canvas = new OffscreenCanvas(size, size)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = GATE_EDGE
  ctx.beginPath()
  ctx.roundRect(0, 0, size, size, radius)
  ctx.fill()
  ctx.fillStyle = GATE_FILL
  ctx.beginPath()
  ctx.roundRect(ratio, ratio, size - 2 * ratio, size - 2 * ratio, radius - ratio)
  ctx.fill()
  const inset = Math.ceil(radius) + 1
  return {
    image: ctx.getImageData(0, 0, size, size),
    options: {
      pixelRatio: ratio,
      stretchX: [[inset, size - inset]] as [number, number][],
      stretchY: [[inset, size - inset]] as [number, number][],
      content: [inset, inset, size - inset, size - inset] as [number, number, number, number],
    },
  }
}

/** The security hatch's image name; drawn by `securityHatch`, not the sprite. */
export const INDOOR_HATCH_PREFIX = 'indoor-security-hatch-'
export const securityHatchName = (flavor: FlavorId) => `${INDOOR_HATCH_PREFIX}${flavor}`

/** Diagonal stripes rising to the right, a tile that repeats seamlessly, at `ratio` device pixels. */
export function securityHatch(flavor: FlavorId, ratio: number) {
  const size = Math.round(12 * ratio)
  const period = size / 2
  const stripe = period * 0.36
  const ctx = new OffscreenCanvas(size, size).getContext('2d')!
  ctx.fillStyle = COLORS[flavor].hatch
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = COLORS[flavor].hatchGap
  for (let c = 0; c <= 2 * size; c += period) {
    ctx.beginPath()
    ctx.moveTo(c, 0)
    ctx.lineTo(c + stripe, 0)
    ctx.lineTo(c + stripe - size, size)
    ctx.lineTo(c - size, size)
    ctx.fill()
  }
  return { image: ctx.getImageData(0, 0, size, size), options: { pixelRatio: ratio } }
}
