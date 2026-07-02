import { DefaultLayerTemplate } from '../../types/layers.types'
import { LayerType } from '../../schema/layers.schema'

/**
 * Transit display layers.
 *
 * Sourced from Parchment's own self-hosted vector tiles (Barrelman → Martin),
 * NOT the hosted Transitland tiles. Two route sources:
 *   - `transit_lines`  — LOOM-bundled parallel OFFSET ribbons for feeds/modes
 *      that have a line graph (interlined routes drawn side-by-side).
 *   - `transit_routes` — plain per-route geometry for everything else (bundled
 *      feeds are excluded from this view so nothing is drawn twice).
 *
 * Styling target: Apple Maps — subtle and uncluttered. Rail is prominent with
 * a white casing; buses are heavily de-emphasised (thin, faint, zoom-gated).
 * Stops are coloured by their serving route (white for interchanges), bus stops
 * only at high zoom. `route_color` is hex WITHOUT a leading `#`, with a
 * per-`route_type` fallback. Every layer carries `metadata.transitRole`; the
 * group carries `fadeBasemap` so the basemap dims when transit is shown.
 */

// Render slot. 'top' lifts transit above 3D buildings AND basemap labels in
// Mapbox GL v3 (Standard style slots: bottom|middle|top). MapLibre has no slot
// concept and ignores the key (no error) — its transit already stacks on top by
// insertion order, so this is a Mapbox-only, no-branch change.
const TRANSIT_SLOT = 'top'

// ── Route-type partitioning ─────────────────────────────────────────
const BUS_FILTER: any = ['match', ['get', 'route_type'], [3, 11], true, false]
const RAIL_FILTER: any = ['match', ['get', 'route_type'], [3, 11], false, true]

// ── Shared paint expressions ────────────────────────────────────────
const TYPE_COLOR: any = [
  'match',
  ['get', 'route_type'],
  0, '#ff9966',
  1, '#ff3b30',
  2, '#8a8a8e',
  3, '#3478f6',
  4, '#32ade6',
  5, '#8e24aa',
  6, '#ff7043',
  7, '#795548',
  11, '#3478f6',
  12, '#ab47bc',
  '#007cbf',
]
// Ferries + buses render as thin uniform blue (Apple style), ignoring the
// agency's per-route colour.
const FERRY_BLUE = '#4d9de0'
const BUS_BLUE = '#5b8fc7'

const ROUTE_COLOR: any = [
  'case',
  ['==', ['get', 'route_type'], 4], FERRY_BLUE,
  ['==', ['get', 'route_color'], ''],
  TYPE_COLOR,
  ['concat', '#', ['get', 'route_color']],
]

// RUNTIME OFFSET: the transit_lines_rt source serves one shared centreline per
// bundle run (slot + line_count props); the ribbon is offset per-vertex at draw
// time. line-offset is in SCREEN PIXELS, so the on-screen gap is constant at
// every zoom for free (no per-zoom baking). Centre the bundle around 0:
// slot 0..line_count-1  ->  (slot - (line_count-1)/2) * gap.  line_count 1 -> 0.
// Applied identically on Mapbox AND MapLibre — no taper. Junction convergence
// is deferred to Phase B rt2 transition geometry (off_from_px→off_to_px
// interpolated via the fork's variable line-offset).
const RUNTIME_GAP = 4.4 // px between adjacent ribbons (matches the baked px gap)
const RUNTIME_OFFSET: any = [
  '*',
  ['-', ['get', 'slot'], ['/', ['-', ['get', 'line_count'], 1], 2]],
  RUNTIME_GAP,
]
const STOP_FILL: any = [
  'case',
  ['==', ['get', 'route_color'], ''],
  '#ffffff',
  ['concat', '#', ['get', 'route_color']],
]

// Ferries (route_type 4) are drawn thinner than heavy rail.
const RAIL_WIDTH: any = [
  'interpolate', ['linear'], ['zoom'],
  9, ['match', ['get', 'route_type'], 4, 0.8, 1.1],
  12, ['match', ['get', 'route_type'], 4, 1.2, 2.2],
  14, ['match', ['get', 'route_type'], 4, 1.5, 3],
  16, ['match', ['get', 'route_type'], 4, 2, 4.5],
]
const RAIL_CASING_WIDTH: any = [
  'interpolate', ['linear'], ['zoom'],
  9, ['match', ['get', 'route_type'], 4, 1.6, 2.4],
  12, ['match', ['get', 'route_type'], 4, 2.2, 3.8],
  14, ['match', ['get', 'route_type'], 4, 2.8, 5],
  16, ['match', ['get', 'route_type'], 4, 3.4, 7],
]
const RAIL_HOVER_WIDTH: any = [
  'interpolate', ['linear'], ['zoom'],
  9, 4.4, 12, 5.8, 14, 7, 16, 9,
]

// Bundled offset ribbons are drawn thinner (they sit ~16 m apart on the
// ground, so slim lines + a thin casing let adjacent ribbons separate as you
// zoom in; they merge into a band when zoomed far out — the pre-baked tradeoff).
const OFFSET_WIDTH: any = [
  'interpolate', ['linear'], ['zoom'],
  10, 1.0, 13, 2.0, 15, 3.0, 16, 3.6,
]
const OFFSET_CASING_WIDTH: any = [
  'interpolate', ['linear'], ['zoom'],
  10, 1.9, 13, 3.2, 15, 4.4, 16, 5.2,
]

// Line casing colour, theme-aware. White reads well over the light/faded
// basemap, but is jarring in dark mode — there we use a near-black casing that
// blends into the dark base and just gives a subtle gap between parallel
// ribbons (Apple's dark map has no white casing). measure-light is Mapbox
// GL v3; it strips to the first stop on MapLibre.
const CASING_COLOR: any = [
  'interpolate', ['linear'], ['measure-light', 'brightness'],
  0.25, '#15151a',
  0.3, '#ffffff',
]

const BUS_WIDTH: any = [
  'interpolate', ['linear'], ['zoom'],
  11, 0.4, 13, 0.8, 15, 1.2, 17, 1.8,
]
const BUS_OPACITY: any = [
  'interpolate', ['linear'], ['zoom'],
  10, 0, 11.5, 0.12, 14, 0.3, 16, 0.45, 18, 0.6,
]

// ── Shared sources ──────────────────────────────────────────────────
const ROUTES_SOURCE = {
  id: 'transit-routes',
  type: 'vector' as const,
  tiles: ['{PROXY_URL}/barrelman/transit_routes/{z}/{x}/{y}?v=6'],
  minzoom: 0,
  maxzoom: 16,
}
// Runtime-offset ribbons: one shared centreline per bundle run with slot +
// line_count props (Martin function `transit_lines_rt`). The parallel offset is
// applied per-vertex at draw time (RUNTIME_OFFSET) — constant on-screen gap at
// every zoom without per-zoom baking, identical on both engines. Serves any
// zoom (function source), so maxzoom can be modest + overzoom.
const LINES_SOURCE = {
  id: 'transit-lines',
  type: 'vector' as const,
  tiles: ['{PROXY_URL}/barrelman/transit_lines_rt/{z}/{x}/{y}?v=1'],
  minzoom: 0,
  maxzoom: 16,
}
// Per-zoom baked, pre-OFFSET ribbons (`transit_lines_zoom`). Kept for the
// along-line route bullets only: symbol layers can't be perpendicular-offset, so
// they ride this already-offset geometry instead of stacking on the centreline.
const BAKED_LINES_SOURCE = {
  id: 'transit-lines-baked',
  type: 'vector' as const,
  tiles: ['{PROXY_URL}/barrelman/transit_lines_zoom/{z}/{x}/{y}?v=10'],
  minzoom: 0,
  maxzoom: 18,
}
const STOPS_SOURCE = {
  id: 'transit-stops',
  type: 'vector' as const,
  tiles: ['{PROXY_URL}/barrelman/transit_stops/{z}/{x}/{y}?v=6'],
  minzoom: 0,
  maxzoom: 16,
}
// Per-station points (name + routes JSON). Drives the client's HTML station
// label markers — rendered as an invisible circle query layer only, so
// `queryRenderedFeatures` can feed the DOM markers (name + route bullets).
const STATIONS_SOURCE = {
  id: 'transit-stations',
  type: 'vector' as const,
  tiles: ['{PROXY_URL}/barrelman/transit_stations/{z}/{x}/{y}?v=9'],
  minzoom: 0,
  maxzoom: 16,
}

// OSM-derived station-navigation infrastructure (shown at high zoom).
const vectorSource = (source: string) => ({
  id: `transit-${source}`,
  type: 'vector' as const,
  tiles: [`{PROXY_URL}/barrelman/${source}/{z}/{x}/{y}?v=3`],
  minzoom: 0,
  maxzoom: 16,
})
const STATION_BUILDINGS_SOURCE = vectorSource('transit_station_buildings')
const PLATFORMS_SOURCE = vectorSource('transit_platforms')
const ENTRANCES_SOURCE = vectorSource('transit_entrances')
const ELEVATORS_SOURCE = vectorSource('transit_elevators')
const STAIRS_SOURCE = vectorSource('transit_stairs')

const base = {
  type: LayerType.TRANSIT,
  engine: ['mapbox', 'maplibre'] as ('mapbox' | 'maplibre')[],
  icon: 'TrainIcon',
  showInLayerSelector: false,
  visible: false,
  fadeBasemap: true,
  groupId: 'default:group:transit',
  isSubLayer: true,
  integrationId: 'barrelman',
}

export const TRANSIT_LAYER_TEMPLATES: DefaultLayerTemplate[] = [
  // Station footprint (paid area) — subtle fill under the lines, high zoom.
  {
    ...base,
    templateId: 'default:transit-station-buildings',
    name: 'Station Buildings',
    order: 0,
    configuration: {
      id: 'transit-station-buildings',
      metadata: { transitRole: 'stations' },
      type: 'fill',
      slot: TRANSIT_SLOT,
      source: STATION_BUILDINGS_SOURCE,
      'source-layer': 'transit_station_buildings',
      minzoom: 14,
      paint: {
        'fill-color': '#eda78f',
        'fill-opacity': [
          'interpolate', ['linear'], ['zoom'],
          14, 0.18, 15, 0.38, 16, 0.5,
        ],
        'fill-outline-color': '#d98b72',
        'fill-emissive-strength': 1,
      },
    },
  },
  {
    ...base,
    templateId: 'default:transit-platforms',
    name: 'Platforms',
    order: 0,
    configuration: {
      id: 'transit-platforms',
      metadata: { transitRole: 'stations' },
      type: 'fill',
      slot: TRANSIT_SLOT,
      source: PLATFORMS_SOURCE,
      'source-layer': 'transit_platforms',
      minzoom: 15,
      paint: {
        'fill-color': '#e59178',
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0.6, 16, 0.85],
        'fill-outline-color': '#cf7658',
        'fill-emissive-strength': 1,
      },
    },
  },

  // Bus lines — bottom of the stack, thin + faint + zoom-gated.
  {
    ...base,
    templateId: 'default:transit-routes-bus',
    name: 'Bus Routes',
    order: 1,
    configuration: {
      id: 'transit-routes-bus',
      metadata: { transitRole: 'routes' },
      type: 'line',
      slot: TRANSIT_SLOT,
      source: ROUTES_SOURCE,
      'source-layer': 'transit_routes',
      filter: BUS_FILTER,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': BUS_BLUE,
        'line-width': BUS_WIDTH,
        'line-opacity': BUS_OPACITY,
        'line-emissive-strength': 1,
      },
    },
  },

  // Bundled offset ribbons — white casing.
  {
    ...base,
    templateId: 'default:transit-lines-casing',
    name: 'Bundled Casing',
    order: 2,
    configuration: {
      id: 'transit-lines-casing',
      metadata: { transitRole: 'routes' },
      type: 'line',
      slot: TRANSIT_SLOT,
      source: LINES_SOURCE,
      'source-layer': 'transit_lines',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': CASING_COLOR,
        'line-width': OFFSET_CASING_WIDTH,
        'line-offset': RUNTIME_OFFSET,
        'line-emissive-strength': 1,
      },
    },
  },

  // Bundled offset ribbons — route colour.
  {
    ...base,
    templateId: 'default:transit-lines',
    name: 'Bundled Routes',
    order: 3,
    configuration: {
      id: 'transit-lines',
      metadata: { transitRole: 'routes' },
      type: 'line',
      slot: TRANSIT_SLOT,
      source: LINES_SOURCE,
      'source-layer': 'transit_lines',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ROUTE_COLOR,
        'line-width': OFFSET_WIDTH,
        'line-offset': RUNTIME_OFFSET,
        'line-emissive-strength': 1,
      },
    },
  },

  // Non-bundled rail casing.
  {
    ...base,
    templateId: 'default:transit-routes-casing',
    name: 'Route Casing',
    order: 4,
    configuration: {
      id: 'transit-routes-casing',
      metadata: { transitRole: 'routes' },
      type: 'line',
      slot: TRANSIT_SLOT,
      source: ROUTES_SOURCE,
      'source-layer': 'transit_routes',
      filter: RAIL_FILTER,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': CASING_COLOR,
        'line-width': RAIL_CASING_WIDTH,
        'line-emissive-strength': 1,
      },
    },
  },

  // Non-bundled rail line (route colour).
  {
    ...base,
    templateId: 'default:transit-routes-line',
    name: 'Routes',
    order: 5,
    configuration: {
      id: 'transit-routes-line',
      metadata: { transitRole: 'routes' },
      type: 'line',
      slot: TRANSIT_SLOT,
      source: ROUTES_SOURCE,
      'source-layer': 'transit_routes',
      filter: RAIL_FILTER,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ROUTE_COLOR,
        'line-width': RAIL_WIDTH,
        'line-emissive-strength': 1,
      },
    },
  },

  // Hover highlight (feature-state driven; inert until hover wiring is added).
  {
    ...base,
    templateId: 'default:transit-routes-hover',
    name: 'Route Hover',
    order: 6,
    configuration: {
      id: 'transit-routes-hover',
      metadata: { transitRole: 'hover' },
      type: 'line',
      slot: TRANSIT_SLOT,
      source: ROUTES_SOURCE,
      'source-layer': 'transit_routes',
      filter: RAIL_FILTER,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ROUTE_COLOR,
        'line-width': RAIL_HOVER_WIDTH,
        'line-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          0.35,
          0,
        ],
        'line-emissive-strength': 1,
      },
    },
  },

  // Bus stops — faint, small, only at high zoom.
  {
    ...base,
    templateId: 'default:transit-stops-bus',
    name: 'Bus Stops',
    order: 7,
    configuration: {
      id: 'transit-stops-bus',
      metadata: { transitRole: 'stops' },
      type: 'circle',
      slot: TRANSIT_SLOT,
      source: STOPS_SOURCE,
      'source-layer': 'transit_stops',
      filter: ['!', ['get', 'is_rail']],
      minzoom: 14,
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          14, 1, 16, 1.8, 18, 3,
        ],
        'circle-color': STOP_FILL,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 0.6,
        'circle-opacity': [
          'interpolate', ['linear'], ['zoom'],
          14, 0.35, 16, 0.6, 18, 0.85,
        ],
        'circle-stroke-opacity': [
          'interpolate', ['linear'], ['zoom'],
          14, 0.35, 16, 0.6,
        ],
        'circle-emissive-strength': 1,
        'circle-pitch-alignment': 'map',
      },
    },
  },

  // NOTE: rail station dots are rendered CLIENT-SIDE as custom HTML markers
  // (TransitStationMarker.vue via TransitStationsLayer) for full control over
  // the look — the old baked `transit-stops-rail` circle layer (big GTFS
  // circles) was removed in favour of them.

  // Rail route designation labels along the line (sparse, restrained).
  {
    ...base,
    templateId: 'default:transit-route-labels',
    name: 'Route Labels',
    order: 9,
    configuration: {
      id: 'transit-route-labels',
      metadata: { transitRole: 'routes' },
      type: 'symbol',
      slot: TRANSIT_SLOT,
      source: ROUTES_SOURCE,
      'source-layer': 'transit_routes',
      filter: RAIL_FILTER,
      minzoom: 12,
      layout: {
        'symbol-placement': 'line',
        'text-field': [
          'case',
          ['!=', ['get', 'route_short_name'], ''],
          ['get', 'route_short_name'],
          ['get', 'route_long_name'],
        ],
        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
        'text-size': 11,
        'text-max-angle': 30,
        'symbol-spacing': 400,
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': ROUTE_COLOR,
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5,
        'text-emissive-strength': 1,
      },
    },
  },

  // Route bullets along the bundled lines — Apple-style coloured circles with
  // the route designation (tinted SDF circle + white text via icon-text-fit).
  {
    ...base,
    templateId: 'default:transit-lines-bullets',
    name: 'Route Bullets',
    order: 9,
    configuration: {
      id: 'transit-lines-bullets',
      metadata: { transitRole: 'routes' },
      type: 'symbol',
      slot: TRANSIT_SLOT,
      // Baked (pre-offset) geometry so bullets sit ON the ribbons, not stacked on
      // the shared centreline (symbols have no perpendicular line-offset).
      source: BAKED_LINES_SOURCE,
      'source-layer': 'transit_lines',
      minzoom: 12,
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 550,
        'icon-image': 'transit-bullet',
        'icon-text-fit': 'both',
        'icon-text-fit-padding': [3, 5, 3, 5],
        'icon-rotation-alignment': 'viewport',
        'text-rotation-alignment': 'viewport',
        'text-field': ['get', 'route_short_name'],
        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
        'text-size': 10,
        'icon-allow-overlap': false,
        'text-allow-overlap': false,
      },
      paint: {
        'icon-color': ROUTE_COLOR,
        'text-color': '#ffffff',
        'icon-emissive-strength': 1,
        'text-emissive-strength': 1,
      },
    },
  },

  // Station query layer — an INVISIBLE symbol layer over the per-station
  // points. Not a visual layer: the client `queryRenderedFeatures` it and draws
  // Apple-style HTML label markers (station name + a row of coloured route
  // bullets) via TransitStationsLayer. Baked name labels were removed in favour
  // of those DOM markers.
  //
  // It returns EVERY in-view station (`*-allow-overlap: true`,
  // `*-ignore-placement: true`) rather than letting the engine's own collision
  // thin them — because that collision also competes with basemap street/POI
  // labels, which unpredictably culled real stations (e.g. Kingston Av). The
  // decluttering is done client-side in TransitStationsLayer, in screen space,
  // against the real marker footprint and prioritising big interchanges. A tiny
  // 1px transparent circle is the queryable geometry.
  {
    ...base,
    templateId: 'default:transit-stations-query',
    name: 'Station Labels',
    order: 10,
    configuration: {
      id: 'transit-stations-query',
      metadata: { transitRole: 'stations' },
      type: 'circle',
      slot: TRANSIT_SLOT,
      source: STATIONS_SOURCE,
      'source-layer': 'transit_stations',
      minzoom: 11,
      paint: {
        'circle-radius': 1,
        'circle-opacity': 0,
        'circle-color': '#000000',
      },
    },
  },

  // Station stairs (very high zoom).
  {
    ...base,
    templateId: 'default:transit-stairs',
    name: 'Stairs',
    order: 11,
    configuration: {
      id: 'transit-stairs',
      metadata: { transitRole: 'stations' },
      type: 'line',
      slot: TRANSIT_SLOT,
      source: STAIRS_SOURCE,
      'source-layer': 'transit_stairs',
      minzoom: 16,
      paint: {
        'line-color': '#b0a99e',
        'line-width': 1.4,
        'line-dasharray': [1, 1],
        'line-emissive-strength': 1,
      },
    },
  },

  // Stair glyph along the stair lines (very high zoom, sparse).
  {
    ...base,
    templateId: 'default:transit-stairs-glyph',
    name: 'Stairs Glyph',
    order: 11,
    configuration: {
      id: 'transit-stairs-glyph',
      metadata: { transitRole: 'stations' },
      type: 'symbol',
      slot: TRANSIT_SLOT,
      source: STAIRS_SOURCE,
      'source-layer': 'transit_stairs',
      minzoom: 17,
      layout: {
        'symbol-placement': 'line-center',
        'icon-image': 'transit-glyph-stair',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 17, 0.5, 19, 0.85],
        'icon-rotation-alignment': 'viewport',
        'icon-allow-overlap': false,
      },
      paint: {
        'icon-color': '#8f8578',
        'icon-halo-color': '#ffffff',
        'icon-halo-width': 1.2,
        'icon-emissive-strength': 1,
      },
    },
  },

  // Station elevators (accessibility) — wheelchair/elevator glyph, blue.
  {
    ...base,
    templateId: 'default:transit-elevators',
    name: 'Elevators',
    order: 12,
    configuration: {
      id: 'transit-elevators',
      metadata: { transitRole: 'stations' },
      type: 'symbol',
      slot: TRANSIT_SLOT,
      source: ELEVATORS_SOURCE,
      'source-layer': 'transit_elevators',
      minzoom: 15,
      layout: {
        'icon-image': 'transit-glyph-elevator',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 15, 0.55, 18, 0.95],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-pitch-alignment': 'map',
      },
      paint: {
        'icon-color': '#4d9de0',
        'icon-halo-color': '#ffffff',
        'icon-halo-width': 1.4,
        'icon-emissive-strength': 1,
      },
    },
  },

  // Station entrances — descend glyph; Apple orange, accessibility blue when
  // the entrance is wheelchair-accessible. Clickable for navigation.
  {
    ...base,
    templateId: 'default:transit-entrances',
    name: 'Entrances',
    order: 13,
    configuration: {
      id: 'transit-entrances',
      metadata: { transitRole: 'stations' },
      type: 'symbol',
      slot: TRANSIT_SLOT,
      source: ENTRANCES_SOURCE,
      'source-layer': 'transit_entrances',
      minzoom: 15,
      layout: {
        'icon-image': 'transit-glyph-entrance',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 15, 0.6, 18, 1.0],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-pitch-alignment': 'map',
      },
      paint: {
        'icon-color': [
          'case',
          ['==', ['get', 'wheelchair'], 'yes'], '#4d9de0',
          '#ff8c42',
        ],
        'icon-halo-color': '#ffffff',
        'icon-halo-width': 1.4,
        'icon-emissive-strength': 1,
      },
    },
  },
]
