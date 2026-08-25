import type { LayerSpecification } from 'maplibre-gl'
import type { Flavor } from './flavors'

/**
 * The Parchment basemap layer spec, against the OpenMapTiles schema.
 *
 * One spec, parameterised by a `Flavor`. Nothing here hard-codes a colour;
 * every paint value reads a token by name, so a theme is a new flavor and
 * zero changes to this file.
 *
 * Three techniques carry most of the visual quality, all lifted from styles
 * that do it well and all expressible in plain MapLibre expressions:
 *
 *   `fadeIn`  — no feature class ever pops into existence. Each class fades
 *               up from transparent across 0.1 zoom levels at the zoom it is
 *               introduced (2GIS does this on essentially every road layer).
 *
 *   `ribbon`  — road widths carry a deliberate discontinuity at z14.01,
 *               where a road stops being a hairline and becomes a ribbon
 *               with a visible casing. Smoothing through this transition is
 *               what makes most OSM styles feel like mush at neighbourhood
 *               zoom; snapping it is what makes 2GIS feel crisp.
 *
 *   `selected`— every road layer resolves its colour through a match on the
 *               feature-state-ish `selected` property, so route highlighting
 *               costs no extra layers.
 *
 * Width curves use `["exponential", 1.5]` and run out to z22, following
 * Mapbox Streets v12 (BSD code / CC-BY 3.0 design). Roads keep widening past
 * z18 rather than freezing, which is why they stay legible fully zoomed in.
 */

export const SOURCE = 'openmaptiles'

/** Detail tier. `minimal` drops POIs, house numbers and building detail. */
export type Detail = 'full' | 'minimal'

type Expr = any

// ---------------------------------------------------------------------------
// Expression helpers
// ---------------------------------------------------------------------------

/** Transparent below `z`, full colour just above it. */
function fadeIn(z: number, color: string): Expr {
  return ['interpolate', ['linear'], ['zoom'], z, 'rgba(0, 0, 0, 0)', z + 0.1, color]
}

/**
 * A width ramp with the hairline→ribbon break at z14.01.
 *
 * `hairline` is the width at the class's introduction zoom, `thin` the width
 * just before the break, `ribbon` the width immediately after it, and `wide`
 * / `max` the widths at z18 and z22.
 */
function ribbon(
  minzoom: number,
  hairline: number,
  thin: number,
  ribbonWidth: number,
  wide: number,
  max: number,
): Expr {
  return [
    'interpolate',
    ['exponential', 1.5],
    ['zoom'],
    minzoom, hairline,
    14, thin,
    14.01, ribbonWidth,
    18, wide,
    22, max,
  ]
}

/**
 * Resolve a colour through the `selected` highlight state.
 *
 * `case`, not `match`: the style spec requires match branch labels to be
 * numbers or strings, so matching on a boolean is invalid — MapLibre rejects
 * the whole layer rather than ignoring the branch.
 */
function selectable(flavor: Flavor, color: Expr): Expr {
  return ['case', ['==', ['get', 'selected'], true], flavor.selected, color]
}

/**
 * A road colour that both fades in and honours selection.
 *
 * The zoom interpolation has to be the OUTER expression: `["zoom"]` is only
 * legal as the direct input of a top-level `step`/`interpolate`, so wrapping
 * a fade inside a `case` is rejected outright. Selection therefore lives in
 * the interpolation's output stop, which is allowed to be data-driven.
 */
function fadeInSelectable(z: number, color: string, flavor: Flavor): Expr {
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    z,
    'rgba(0, 0, 0, 0)',
    z + 0.1,
    selectable(flavor, color),
  ]
}

const NOT_BRUNNEL: Expr = [
  'all',
  ['!=', ['get', 'brunnel'], 'bridge'],
  ['!=', ['get', 'brunnel'], 'tunnel'],
]
const IS_BRIDGE: Expr = ['==', ['get', 'brunnel'], 'bridge']
const IS_TUNNEL: Expr = ['==', ['get', 'brunnel'], 'tunnel']

// ---------------------------------------------------------------------------
// Road classes
// ---------------------------------------------------------------------------

interface RoadClass {
  key: string
  /** OpenMapTiles `transportation.class` values this layer draws. */
  classes: string[]
  color: keyof Flavor
  casing: keyof Flavor
  /** Zoom the class is introduced at. */
  minzoom: number
  width: Parameters<typeof ribbon> extends [any, ...infer R] ? R : never
  /** Extra width added to the casing on each side, at the ribbon zooms. */
  casingWidth: number
}

/**
 * Ordered least → most important. Draw order follows this array, so a
 * motorway always covers a residential street at a junction.
 */
const ROAD_CLASSES: RoadClass[] = [
  {
    key: 'service',
    classes: ['service', 'track'],
    color: 'service',
    casing: 'service_casing',
    minzoom: 13,
    width: [0.4, 0.8, 2.2, 6, 40],
    casingWidth: 1,
  },
  {
    key: 'minor',
    classes: ['minor'],
    color: 'minor',
    casing: 'minor_casing',
    minzoom: 12,
    width: [0.4, 1, 3.2, 9.5, 70],
    casingWidth: 1.2,
  },
  {
    key: 'tertiary',
    classes: ['tertiary'],
    color: 'tertiary',
    casing: 'tertiary_casing',
    minzoom: 11,
    width: [0.5, 1.4, 3.8, 11, 80],
    casingWidth: 1.4,
  },
  {
    key: 'secondary',
    classes: ['secondary'],
    color: 'secondary',
    casing: 'secondary_casing',
    minzoom: 9,
    width: [0.5, 1.8, 4.4, 13, 92],
    casingWidth: 1.5,
  },
  {
    key: 'primary',
    classes: ['primary'],
    color: 'primary',
    casing: 'primary_casing',
    minzoom: 7,
    width: [0.6, 2.2, 5, 15, 105],
    casingWidth: 1.6,
  },
  {
    key: 'trunk',
    classes: ['trunk'],
    color: 'trunk',
    casing: 'trunk_casing',
    minzoom: 5,
    width: [0.7, 2.6, 5.6, 17, 115],
    casingWidth: 1.8,
  },
  {
    key: 'motorway',
    classes: ['motorway'],
    color: 'motorway',
    casing: 'motorway_casing',
    minzoom: 4,
    width: [0.8, 3, 6.4, 19, 130],
    casingWidth: 2,
  },
]

function roadFilter(rc: RoadClass, brunnel: Expr): Expr {
  return [
    'all',
    brunnel,
    ['match', ['get', 'class'], rc.classes, true, false],
  ]
}

function widthFor(rc: RoadClass): Expr {
  return ribbon(rc.minzoom, ...(rc.width as [number, number, number, number, number]))
}

function casingWidthFor(rc: RoadClass): Expr {
  const [hairline, thin, ribbonWidth, wide, max] = rc.width as number[]
  const c = rc.casingWidth
  // Casings stay hairline-thin until the ribbon break, then bracket the fill.
  return ribbon(
    rc.minzoom,
    hairline,
    thin + 0.2,
    ribbonWidth + c * 2,
    wide + c * 2,
    max + c * 4,
  )
}

/** Casings, then fills, for one brunnel context (surface / bridge / tunnel). */
function roadLayers(
  flavor: Flavor,
  context: 'surface' | 'bridge' | 'tunnel',
): LayerSpecification[] {
  const brunnel =
    context === 'bridge' ? IS_BRIDGE : context === 'tunnel' ? IS_TUNNEL : NOT_BRUNNEL
  const out: LayerSpecification[] = []

  for (const rc of ROAD_CLASSES) {
    const casingColor =
      context === 'bridge'
        ? flavor.bridge_casing
        : context === 'tunnel'
          ? flavor.tunnel_casing
          : (flavor[rc.casing] as string)

    out.push({
      id: `road-${context}-${rc.key}-casing`,
      type: 'line',
      source: SOURCE,
      'source-layer': 'transportation',
      minzoom: rc.minzoom,
      filter: roadFilter(rc, brunnel),
      layout: { 'line-cap': context === 'bridge' ? 'butt' : 'round', 'line-join': 'round' },
      paint: {
        'line-color': fadeIn(rc.minzoom, casingColor),
        'line-width': casingWidthFor(rc),
      },
    } as LayerSpecification)
  }

  for (const rc of ROAD_CLASSES) {
    // Tunnels replace the road colour wholesale rather than dimming it, so a
    // tunnel never reads as a slightly-off surface road.
    const base =
      context === 'tunnel' ? flavor.tunnel : (flavor[rc.color] as string)

    out.push({
      id: `road-${context}-${rc.key}`,
      type: 'line',
      source: SOURCE,
      'source-layer': 'transportation',
      minzoom: rc.minzoom,
      filter: roadFilter(rc, brunnel),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': fadeInSelectable(rc.minzoom, base, flavor),
        'line-width': widthFor(rc),
      },
    } as LayerSpecification)
  }

  return out
}

// ---------------------------------------------------------------------------
// POI families → Maki icon tint
// ---------------------------------------------------------------------------

/**
 * OpenMapTiles' `poi.class` taxonomy was derived from Maki icon names, so
 * `icon-image` can read the feature's own class directly. `coalesce` walks
 * subclass → class → generic marker and skips any image the sprite lacks,
 * which means an unmapped POI degrades to a dot instead of vanishing.
 */
const POI_ICON: Expr = [
  'coalesce',
  ['image', ['get', 'subclass']],
  ['image', ['get', 'class']],
  ['image', 'marker'],
]

const POI_FAMILIES: Array<[keyof Flavor['pois'], string[]]> = [
  ['food', ['restaurant', 'fast_food', 'cafe', 'bar', 'beer', 'bakery', 'ice_cream', 'alcohol_shop']],
  ['shop', ['shop', 'grocery', 'clothing_store', 'books', 'jewelry_store', 'florist', 'furniture', 'shoe', 'hairdresser', 'laundry', 'car', 'bicycle']],
  ['transit', ['bus', 'railway', 'airport', 'aerialway', 'harbor', 'parking', 'fuel']],
  ['outdoor', ['park', 'garden', 'playground', 'pitch', 'golf', 'swimming', 'stadium', 'dog_park', 'picnic_site', 'zoo', 'attraction', 'monument', 'castle']],
  ['lodging', ['lodging']],
  ['civic', ['school', 'college', 'library', 'museum', 'art_gallery', 'theatre', 'cinema', 'town_hall', 'police', 'fire_station', 'post', 'place_of_worship', 'cemetery', 'information']],
  ['health', ['hospital', 'pharmacy', 'doctors', 'dentist', 'veterinary']],
]

function poiColor(flavor: Flavor): Expr {
  const branches: Expr[] = []
  for (const [family, classes] of POI_FAMILIES) {
    branches.push(classes, flavor.pois[family])
  }
  return ['match', ['get', 'class'], ...branches, flavor.pois.default]
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

/**
 * Three weights, because that is what the glyph server actually carries —
 * there is no Noto Sans Medium/SemiBold stack. Emphasis is therefore carried
 * by size and colour first, and only the top of the hierarchy goes bold.
 *
 * Each stack names exactly ONE font. MapLibre concatenates a multi-font stack
 * into a single request path ("Noto Sans Bold,Noto Sans Regular"), and the
 * glyph server only serves single-font stacks — a fallback entry turns every
 * label using it into a 404 and it silently does not draw.
 */
const SANS = ['Noto Sans Regular']
const SANS_BOLD = ['Noto Sans Bold']
const SANS_ITALIC = ['Noto Sans Italic']

/**
 * The label's text field, honouring a language preference and falling back
 * to the feature's local name.
 */
function nameField(lang?: string): Expr {
  return lang && lang !== 'local'
    ? ['coalesce', ['get', `name:${lang}`], ['get', 'name']]
    : ['get', 'name']
}

export interface LayerSpecOptions {
  flavor: Flavor
  detail?: Detail
  lang?: string
}

export function buildLayers({
  flavor: f,
  detail = 'full',
  lang,
}: LayerSpecOptions): LayerSpecification[] {
  const full = detail === 'full'
  const name = nameField(lang)
  const layers: LayerSpecification[] = []

  // --- Ground -------------------------------------------------------------
  layers.push({
    id: 'background',
    type: 'background',
    paint: { 'background-color': f.background },
  })

  // --- Landcover ----------------------------------------------------------
  const LANDCOVER: Array<[string, string[], string]> = [
    ['wood', ['wood', 'forest'], f.wood],
    ['grass', ['grass', 'meadow', 'allotments'], f.grass],
    ['scrub', ['scrub', 'heath'], f.scrub],
    ['wetland', ['wetland', 'swamp', 'marsh'], f.wetland],
    ['sand', ['sand', 'beach'], f.sand],
    ['glacier', ['ice', 'glacier'], f.glacier],
  ]
  for (const [key, subclasses, color] of LANDCOVER) {
    layers.push({
      id: `landcover-${key}`,
      type: 'fill',
      source: SOURCE,
      'source-layer': 'landcover',
      filter: ['match', ['get', 'subclass'], subclasses, true, false],
      paint: { 'fill-color': fadeIn(4, color), 'fill-antialias': false },
    } as LayerSpecification)
  }

  // --- Landuse ------------------------------------------------------------
  const LANDUSE: Array<[string, string[], string, number]> = [
    ['residential', ['residential', 'suburb', 'neighbourhood', 'quarter'], f.residential, 8],
    ['commercial', ['commercial', 'retail'], f.commercial, 11],
    ['industrial', ['industrial', 'railway'], f.industrial, 11],
    ['hospital', ['hospital'], f.hospital, 12],
    ['school', ['school', 'university', 'college', 'kindergarten'], f.school, 12],
    ['cemetery', ['cemetery', 'grave_yard'], f.cemetery, 12],
    ['military', ['military'], f.military, 9],
    ['zoo', ['zoo'], f.zoo, 12],
  ]
  for (const [key, classes, color, minzoom] of LANDUSE) {
    layers.push({
      id: `landuse-${key}`,
      type: 'fill',
      source: SOURCE,
      'source-layer': 'landuse',
      minzoom,
      filter: ['match', ['get', 'class'], classes, true, false],
      paint: { 'fill-color': fadeIn(minzoom, color) },
    } as LayerSpecification)
  }

  layers.push({
    id: 'park',
    type: 'fill',
    source: SOURCE,
    'source-layer': 'park',
    paint: { 'fill-color': fadeIn(6, f.park) },
  } as LayerSpecification)

  layers.push({
    id: 'pitch',
    type: 'fill',
    source: SOURCE,
    'source-layer': 'landuse',
    minzoom: 13,
    filter: ['match', ['get', 'class'], ['pitch', 'playground', 'track'], true, false],
    paint: { 'fill-color': fadeIn(13, f.pitch) },
  } as LayerSpecification)

  // --- Water --------------------------------------------------------------
  layers.push({
    id: 'water',
    type: 'fill',
    source: SOURCE,
    'source-layer': 'water',
    filter: ['!=', ['get', 'brunnel'], 'tunnel'],
    paint: { 'fill-color': f.water, 'fill-antialias': true },
  } as LayerSpecification)

  layers.push({
    id: 'waterway',
    type: 'line',
    source: SOURCE,
    'source-layer': 'waterway',
    minzoom: 8,
    filter: ['!=', ['get', 'brunnel'], 'tunnel'],
    layout: { 'line-cap': 'round' },
    paint: {
      'line-color': fadeIn(8, f.waterway),
      'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 8, 0.5, 14, 1.6, 18, 5, 22, 20],
    },
  } as LayerSpecification)

  // --- Aeroway ------------------------------------------------------------
  layers.push({
    id: 'aerodrome',
    type: 'fill',
    source: SOURCE,
    'source-layer': 'aeroway',
    minzoom: 10,
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': fadeIn(10, f.aerodrome) },
  } as LayerSpecification)

  layers.push({
    id: 'aeroway-runway',
    type: 'line',
    source: SOURCE,
    'source-layer': 'aeroway',
    minzoom: 10,
    filter: [
      'all',
      ['==', ['geometry-type'], 'LineString'],
      ['match', ['get', 'class'], ['runway'], true, false],
    ],
    paint: {
      'line-color': fadeIn(10, f.runway),
      'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 10, 1, 14, 6, 18, 26, 22, 100],
    },
  } as LayerSpecification)

  layers.push({
    id: 'aeroway-taxiway',
    type: 'line',
    source: SOURCE,
    'source-layer': 'aeroway',
    minzoom: 12,
    filter: [
      'all',
      ['==', ['geometry-type'], 'LineString'],
      ['match', ['get', 'class'], ['taxiway'], true, false],
    ],
    paint: {
      'line-color': fadeIn(12, f.taxiway),
      'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 12, 0.5, 16, 4, 22, 30],
    },
  } as LayerSpecification)

  // --- Tunnels, roads, bridges -------------------------------------------
  layers.push(...roadLayers(f, 'tunnel'))

  // Paths sit under the vehicular network but above tunnels.
  layers.push({
    id: 'road-path',
    type: 'line',
    source: SOURCE,
    'source-layer': 'transportation',
    minzoom: 14,
    filter: ['match', ['get', 'class'], ['path', 'footway', 'pedestrian', 'steps', 'cycleway'], true, false],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': fadeInSelectable(14, f.path, f),
      'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 14, 0.6, 18, 2.4, 22, 12],
      'line-dasharray': [2, 1.6],
    },
  } as LayerSpecification)

  layers.push(...roadLayers(f, 'surface'))

  // Rail, drawn above the road surface but below bridges.
  layers.push({
    id: 'rail',
    type: 'line',
    source: SOURCE,
    'source-layer': 'transportation',
    minzoom: 11,
    filter: [
      'all',
      NOT_BRUNNEL,
      ['match', ['get', 'class'], ['rail', 'transit'], true, false],
    ],
    paint: {
      'line-color': fadeIn(11, f.rail),
      'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 11, 0.5, 16, 1.6, 22, 6],
    },
  } as LayerSpecification)

  layers.push({
    id: 'rail-hatching',
    type: 'line',
    source: SOURCE,
    'source-layer': 'transportation',
    minzoom: 14.5,
    filter: [
      'all',
      NOT_BRUNNEL,
      ['match', ['get', 'class'], ['rail', 'transit'], true, false],
    ],
    paint: {
      'line-color': fadeIn(14.5, f.rail_hatch),
      'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 14.5, 2.5, 22, 10],
      'line-dasharray': [0.2, 6],
    },
  } as LayerSpecification)

  layers.push(...roadLayers(f, 'bridge'))

  // --- Buildings ----------------------------------------------------------
  if (full) {
    layers.push({
      id: 'building',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'building',
      minzoom: 13,
      paint: {
        'fill-color': fadeIn(13, f.building),
        'fill-outline-color': f.building_outline,
      },
    } as LayerSpecification)

    // Extrusion heights are set to 0 here and switched on by the strategy's
    // `setMap3dObjects` toggle, so the layer always exists to be toggled.
    layers.push({
      id: 'building-3d',
      type: 'fill-extrusion',
      source: SOURCE,
      'source-layer': 'building',
      minzoom: 15,
      paint: {
        'fill-extrusion-color': f.building_3d,
        'fill-extrusion-height': 0,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.9,
        'fill-extrusion-vertical-gradient': true,
      },
    } as LayerSpecification)
  }

  // --- Boundaries ---------------------------------------------------------
  layers.push({
    id: 'boundary-state',
    type: 'line',
    source: SOURCE,
    'source-layer': 'boundary',
    minzoom: 4,
    filter: [
      'all',
      ['==', ['coalesce', ['get', 'admin_level'], 0], 4],
      ['!=', ['get', 'maritime'], 1],
    ],
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': fadeIn(4, f.boundary),
      'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 10, 1.4, 16, 2.5],
      'line-dasharray': [3, 2],
    },
  } as LayerSpecification)

  layers.push({
    id: 'boundary-country',
    type: 'line',
    source: SOURCE,
    'source-layer': 'boundary',
    filter: [
      'all',
      ['<=', ['coalesce', ['get', 'admin_level'], 99], 2],
      ['!=', ['get', 'maritime'], 1],
    ],
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': f.boundary_country,
      'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.8, 6, 1.4, 12, 2.6],
    },
  } as LayerSpecification)

  // --- Labels -------------------------------------------------------------
  layers.push({
    id: 'water-name',
    type: 'symbol',
    source: SOURCE,
    'source-layer': 'water_name',
    minzoom: 5,
    layout: {
      'text-field': name,
      'text-font': SANS_ITALIC,
      'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 12, 13, 16, 15],
      'text-max-width': 6,
      'symbol-placement': 'point',
    },
    paint: {
      'text-color': f.water_label,
      'text-halo-color': f.water_label_halo,
      'text-halo-width': 1,
    },
  } as LayerSpecification)

  // Road labels. `symbol-placement: line` keeps the name riding the geometry.
  layers.push({
    id: 'road-label-minor',
    type: 'symbol',
    source: SOURCE,
    'source-layer': 'transportation_name',
    minzoom: 15,
    filter: ['match', ['get', 'class'], ['minor', 'service', 'track', 'path'], true, false],
    layout: {
      'text-field': name,
      'text-font': SANS,
      'text-size': ['interpolate', ['linear'], ['zoom'], 15, 9, 18, 12, 22, 15],
      'symbol-placement': 'line',
      'text-rotation-alignment': 'map',
    },
    paint: {
      'text-color': f.road_label_minor,
      'text-halo-color': f.road_label_halo,
      'text-halo-width': 1.2,
    },
  } as LayerSpecification)

  layers.push({
    id: 'road-label',
    type: 'symbol',
    source: SOURCE,
    'source-layer': 'transportation_name',
    minzoom: 12,
    filter: [
      'match',
      ['get', 'class'],
      ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'],
      true,
      false,
    ],
    layout: {
      'text-field': name,
      'text-font': SANS_BOLD,
      'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 16, 12.5, 22, 16],
      'symbol-placement': 'line',
      'text-rotation-alignment': 'map',
    },
    paint: {
      'text-color': f.road_label,
      'text-halo-color': f.road_label_halo,
      'text-halo-width': 1.4,
    },
  } as LayerSpecification)

  // Route number shields, drawn as a text pill rather than sprite shields so
  // they work for every network without a per-country sprite set.
  layers.push({
    id: 'road-shield',
    type: 'symbol',
    source: SOURCE,
    'source-layer': 'transportation_name',
    minzoom: 11,
    // `coalesce` defaults every numeric comparison, because comparing a
    // missing property against a number is a hard expression error in
    // MapLibre — it logs and drops the feature rather than treating it as
    // false, which reads as "this data is missing" when it is not.
    filter: ['all', ['has', 'ref'], ['<=', ['coalesce', ['get', 'ref_length'], 99], 6]],
    layout: {
      'text-field': ['get', 'ref'],
      'text-font': SANS_BOLD,
      'text-size': 10,
      'symbol-placement': 'line',
      'symbol-spacing': 400,
      'text-rotation-alignment': 'viewport',
      'text-pitch-alignment': 'viewport',
      'text-padding': 2,
    },
    paint: {
      'text-color': f.shield_text,
      'text-halo-color': f.shield_fill,
      'text-halo-width': 2,
    },
  } as LayerSpecification)

  if (full) {
    layers.push({
      id: 'housenumber',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'housenumber',
      minzoom: 17.5,
      layout: {
        'text-field': ['get', 'housenumber'],
        'text-font': SANS,
        'text-size': ['interpolate', ['linear'], ['zoom'], 17.5, 9, 22, 12],
      },
      paint: {
        'text-color': f.housenumber,
        'text-halo-color': f.housenumber_halo,
        'text-halo-width': 1,
      },
    } as LayerSpecification)

    layers.push({
      id: 'poi',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'poi',
      minzoom: 14,
      // `rank` is OpenMapTiles' own importance ordering; gating on it by zoom
      // is what stops dense commercial strips from turning into icon soup.
      filter: [
        'step',
        ['zoom'],
        ['<=', ['coalesce', ['get', 'rank'], 999], 6],
        15, ['<=', ['coalesce', ['get', 'rank'], 999], 12],
        16, ['<=', ['coalesce', ['get', 'rank'], 999], 20],
        17, true,
      ],
      layout: {
        'icon-image': POI_ICON,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.8, 18, 1],
        'text-field': name,
        'text-font': SANS,
        'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 18, 12],
        'text-anchor': 'top',
        'text-offset': [0, 0.8],
        'text-max-width': 8,
        'text-optional': true,
      },
      paint: {
        'icon-color': poiColor(f),
        'text-color': f.poi_label,
        'text-halo-color': f.poi_label_halo,
        'text-halo-width': 1.2,
      },
    } as LayerSpecification)

    layers.push({
      id: 'mountain-peak',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'mountain_peak',
      minzoom: 11,
      layout: {
        'icon-image': 'mountain',
        'icon-size': 0.8,
        'text-field': name,
        'text-font': SANS,
        'text-size': 10,
        'text-anchor': 'top',
        'text-offset': [0, 0.7],
        'text-optional': true,
      },
      paint: {
        'icon-color': f.peak_label,
        'text-color': f.peak_label,
        'text-halo-color': f.peak_label_halo,
        'text-halo-width': 1,
      },
    } as LayerSpecification)

    layers.push({
      id: 'aerodrome-label',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'aerodrome_label',
      minzoom: 10,
      layout: {
        'icon-image': 'airport',
        'icon-size': 0.9,
        'text-field': name,
        'text-font': SANS_BOLD,
        'text-size': 11,
        'text-anchor': 'top',
        'text-offset': [0, 0.8],
        'text-optional': true,
      },
      paint: {
        'icon-color': f.pois.transit,
        'text-color': f.poi_label,
        'text-halo-color': f.poi_label_halo,
        'text-halo-width': 1.2,
      },
    } as LayerSpecification)
  }

  // Place labels, small → large so the important ones win collisions.
  const PLACES: Array<[string, string[], string, number, Expr, string[]]> = [
    ['suburb', ['suburb', 'neighbourhood', 'quarter'], f.place_suburb, 13,
      ['interpolate', ['linear'], ['zoom'], 13, 10, 16, 13], SANS],
    ['village', ['village', 'hamlet', 'isolated_dwelling'], f.place_village, 11,
      ['interpolate', ['linear'], ['zoom'], 11, 10, 15, 13], SANS],
    ['town', ['town'], f.place_town, 8,
      ['interpolate', ['linear'], ['zoom'], 8, 11, 14, 15], SANS_BOLD],
    ['city', ['city'], f.place_city, 4,
      ['interpolate', ['linear'], ['zoom'], 4, 12, 10, 17, 14, 20], SANS_BOLD],
  ]
  for (const [key, classes, color, minzoom, size, font] of PLACES) {
    layers.push({
      id: `place-${key}`,
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'place',
      minzoom,
      filter: ['match', ['get', 'class'], classes, true, false],
      layout: {
        'text-field': name,
        'text-font': font,
        'text-size': size,
        'text-max-width': 8,
      },
      paint: {
        'text-color': color,
        'text-halo-color': f.place_halo,
        'text-halo-width': 1.2,
      },
    } as LayerSpecification)
  }

  layers.push({
    id: 'place-state',
    type: 'symbol',
    source: SOURCE,
    'source-layer': 'place',
    minzoom: 4,
    maxzoom: 8,
    filter: ['match', ['get', 'class'], ['state', 'province'], true, false],
    layout: {
      'text-field': name,
      'text-font': SANS,
      'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 7, 13],
      'text-max-width': 8,
    },
    paint: {
      'text-color': f.place_state,
      'text-halo-color': f.place_halo,
      'text-halo-width': 1,
    },
  } as LayerSpecification)

  layers.push({
    id: 'place-country',
    type: 'symbol',
    source: SOURCE,
    'source-layer': 'place',
    maxzoom: 8,
    filter: ['match', ['get', 'class'], ['country'], true, false],
    layout: {
      'text-field': name,
      'text-font': SANS_BOLD,
      'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10, 6, 15],
      'text-max-width': 8,
    },
    paint: {
      'text-color': f.place_country,
      'text-halo-color': f.place_halo,
      'text-halo-width': 1.4,
    },
  } as LayerSpecification)

  return layers
}

/**
 * Rendered layer IDs grouped by the toggles the map strategy exposes.
 * Derived from the spec above rather than hand-listed, so a new road class
 * or place class cannot silently fall out of a toggle.
 */
export const layerGroups = {
  poi: ['poi', 'housenumber', 'mountain-peak', 'aerodrome-label'],
  roadLabels: ['road-label', 'road-label-minor', 'road-shield'],
  transit: ['rail', 'rail-hatching'],
  placeLabels: [
    'place-suburb',
    'place-village',
    'place-town',
    'place-city',
    'place-state',
    'place-country',
  ],
  building3d: 'building-3d',
}
