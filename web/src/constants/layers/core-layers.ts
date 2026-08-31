import {
  LayerType,
  MapEngine,
  MapboxLayerType,
  SourceType,
} from '@/types/map.types'
import type { Layer } from '@/types/map.types'
import {
  getPlacePolygonFillColor,
  getPlacePolygonStrokeColor,
} from './helpers'
import { getCustomColorTint } from '@/lib/color-tint'

// Search results layer constants - these are internal and not user-modifiable
export const SEARCH_RESULTS_LAYER_ID = 'search-results-internal'
export const SEARCH_RESULTS_SOURCE_ID = 'search-results-source-internal'
export const SEARCH_RESULTS_LABELS_LAYER_ID = 'search-results-labels-internal'

// Saved places (bookmarks) layer constants - internal, driven by the virtual
// "Saved places" group in the layer selector rather than toggled directly.
export const BOOKMARKS_SOURCE_ID = 'bookmarks-source-internal'
export const BOOKMARKS_CIRCLES_LAYER_ID = 'bookmarks-circles-internal'
export const BOOKMARKS_ICONS_LAYER_ID = 'bookmarks-icons-internal'

// Place polygon layer constants - these are internal and not user-modifiable
export const PLACE_POLYGON_LAYER_ID = 'place-polygon-internal'
export const PLACE_POLYGON_SOURCE_ID = 'place-polygon-source-internal'
export const PLACE_POLYGON_FILL_LAYER_ID = 'place-polygon-fill-internal'
export const PLACE_POLYGON_STROKE_LAYER_ID = 'place-polygon-stroke-internal'

// Search results layer configuration - this layer is always present but hidden when no results
export const SEARCH_RESULTS_LAYER_CONFIG: Omit<
  Layer,
  'id' | 'userId' | 'createdAt' | 'updatedAt'
> = {
  name: 'Search Results (Internal)',
  type: LayerType.CUSTOM,
  engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
  showInLayerSelector: false, // Hidden from user - not user-modifiable
  visible: false, // Hidden by default
  icon: null,
  order: 9999, // Very high order to ensure it's on top
  groupId: null,
  configuration: {
    id: SEARCH_RESULTS_LABELS_LAYER_ID,
    type: MapboxLayerType.SYMBOL,
    source: SEARCH_RESULTS_SOURCE_ID,
    // No minzoom: labels show at every zoom. The engine's built-in collision
    // (text-allow-overlap: false, below) hides any label that would overlap
    // another, so clutter is prevented without a hard zoom cutoff.
    filter: ['has', 'name'],
    layout: {
      'symbol-z-elevate': true,
      'text-size': 13,
      'text-field': ['get', 'name'],
      // Matches Mapbox Standard's native POI label font stack
      'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
      'text-padding': ['interpolate', ['linear'], ['zoom'], 16, 6, 17, 4],
      'text-offset': [0, 1],
      'text-anchor': 'top',
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      // Per-result rank (0 = nearest/best). Lower sort keys are placed first, so
      // the top results win collisions and their labels stay visible.
      'symbol-sort-key': ['get', 'sortKey'],
    },
  },
}

/**
 * The halo behind a POI label, per flavor. Mirrors the `poi_halo` token the
 * basemap resolves for its own labels — a search result and the basemap POI
 * under it are the same place, so they get the same treatment.
 */
const POI_LABEL_HALO = { light: '#FFFFFF', dark: '#0D0D0D' }

/**
 * What a search-result label is painted with.
 *
 * Built per call rather than baked into the config above, because it depends
 * on two things the config cannot see: the app theme, and the live category
 * palette the server serves. It used to be a hand-written `measure-light` ramp
 * per category — a second copy of the palette, at lightnesses that were never
 * the basemap's — and on MapLibre it never reached its night half at all:
 * `stripMapboxExpressions` collapses a `measure-light` interpolation to its
 * brightest stop, so the night map drew daylight-orange labels with a white
 * halo over dark ground.
 *
 * The ink is the same tint the basemap's POI labels wear (`@poi_ink_*`, which
 * is `getCustomColorTint(...).foreground`), out of the same function, so the
 * two cannot drift again.
 */
export function searchResultLabelPaint(options: {
  isDark: boolean
  categories: string[]
  categoryColor: (category: string) => string
}): Record<string, unknown> {
  const { isDark, categories, categoryColor } = options
  const ink = (category: string) => {
    const color = categoryColor(category)
    return getCustomColorTint(color, 'solid', isDark)?.foreground ?? color
  }

  // `default` is the fallback arm rather than a case of its own, which is also
  // what happens to a result whose category the palette does not name. A
  // `match` needs at least one real arm, so a palette carrying nothing else
  // has to come out as the bare colour instead.
  const named = categories.filter(c => c !== 'default')

  return {
    'text-halo-width': 1,
    'text-halo-blur': 0,
    'text-halo-color': isDark ? POI_LABEL_HALO.dark : POI_LABEL_HALO.light,
    'text-color': named.length
      ? ['match', ['get', 'category'], ...named.flatMap(c => [c, ink(c)]), ink('default')]
      : ink('default'),
  }
}

// Default empty GeoJSON for the search results source
export const EMPTY_SEARCH_RESULTS_GEOJSON = {
  type: 'FeatureCollection' as const,
  features: [],
}

// ---------------------------------------------------------------------------
// Saved places (bookmarks)
//
// Two native layers over one GeoJSON source, so the number of saved places
// on screen is a GPU concern rather than a DOM one:
//
//   circles  — every place, at every zoom. The low-zoom overview.
//   icons    — the collection's glyph, once the dot is big enough to hold one.
//
// There is deliberately no label layer: a dot's colour and glyph say which
// collection it belongs to, and naming every saved place buries the basemap.
//
// Written in the Mapbox dialect (`measure-light`, `symbol-z-elevate`); the
// MapLibre conversion in `map.utils.ts` strips what that engine can't read, so
// these must be added through `mapStrategy.addLayer` rather than the raw map.
// ---------------------------------------------------------------------------

/**
 * The dot, its ring and its glyph are one object drawn as two layers, so all
 * three sizes key off the same zoom breakpoints. They were drifting apart
 * every time one was tuned in isolation — a ring too heavy for its dot, a
 * glyph that kept its size while the circle under it shrank — so they are
 * derived here instead of hand-written three times.
 *
 *   full      — 9.5px radius + 1.5px ring = ~22px, the size of a native
 *               Mapbox POI marker. Held flat above this, since the basemap's
 *               own POI sprites don't scale with zoom either.
 *   marker    — still marker-shaped, glyph fully opaque.
 *   collapsed — a plain dot. The glyph has finished fading and shrinking by
 *               exactly this zoom, so the circle never sits around as an
 *               empty disc.
 *   min       — a pinprick. The low-zoom view answers "where have I saved
 *               things", which reads as dots, not markers.
 *   hidden    — gone entirely. Zoomed out past a metro area, a scatter of
 *               pinpricks is noise rather than information, so saved places
 *               fade out instead of speckling a continent.
 */
const DOT = {
  zoom: { hidden: 10, min: 10.5, collapsed: 13.5, marker: 14, full: 15 },
  radius: { min: 1, collapsed: 2.5, marker: 6, full: 9.5 },
} as const

/**
 * Glyph size for a given dot radius. Images are registered at 24 logical px,
 * and `1.14r / 24` holds the glyph at ~57% of the dot's diameter — the
 * glyph-to-circle ratio the basemap's POI sprites use.
 */
const glyphSize = (radius: number) =>
  Math.round(((radius * 1.14) / 24) * 1000) / 1000

/** Glyphs appear once the dot is big enough to hold one legibly. */
export const BOOKMARKS_ICON_MINZOOM = DOT.zoom.collapsed

/**
 * NB: a `['zoom']` interpolate has to be the OUTERMOST expression of a paint
 * property. Wrapping this in arithmetic (as an earlier revision did, to add a
 * hover bump) makes both engines reject the layer outright, which shows up as
 * a glyph floating with no circle under it rather than as an obvious error.
 */
const BOOKMARK_CIRCLE_RADIUS = [
  'interpolate',
  ['linear'],
  ['zoom'],
  DOT.zoom.min,
  DOT.radius.min,
  DOT.zoom.collapsed,
  DOT.radius.collapsed,
  DOT.zoom.marker,
  DOT.radius.marker,
  DOT.zoom.full,
  DOT.radius.full,
]

/**
 * Fades out below `hidden` rather than cutting off at the layer's minzoom, so
 * saved places dissolve as you zoom out instead of vanishing between frames.
 * The ring carries its own opacity — `circle-opacity` only covers the fill, so
 * without this the outline would hang around after the dot had gone.
 */
const BOOKMARK_CIRCLE_OPACITY = [
  'interpolate',
  ['linear'],
  ['zoom'],
  DOT.zoom.hidden,
  0,
  DOT.zoom.min,
  1,
]

/** Hairline while it's a dot, full ring once it's a marker. */
const BOOKMARK_CIRCLE_STROKE_WIDTH = [
  'interpolate',
  ['linear'],
  ['zoom'],
  DOT.zoom.collapsed,
  0.5,
  DOT.zoom.full,
  1.5,
]

/** Tracks the circle exactly, so the glyph shrinks as its dot does. */
const BOOKMARK_ICON_SIZE = [
  'interpolate',
  ['linear'],
  ['zoom'],
  DOT.zoom.collapsed,
  glyphSize(DOT.radius.collapsed),
  DOT.zoom.marker,
  glyphSize(DOT.radius.marker),
  DOT.zoom.full,
  glyphSize(DOT.radius.full),
]

/**
 * Fades across the same window the circle collapses in, so the glyph is gone
 * at the moment the dot reaches its small size — rather than popping out at a
 * threshold of its own while the circle is still mid-shrink.
 */
const BOOKMARK_ICON_OPACITY = [
  'interpolate',
  ['linear'],
  ['zoom'],
  DOT.zoom.collapsed,
  0,
  DOT.zoom.marker,
  1,
]

/**
 * Halo/stroke color that flips with the map's light preset — dark at night,
 * white by day. Same treatment the search-result labels use.
 */
const BOOKMARK_CONTRAST_COLOR = [
  'interpolate',
  ['linear'],
  ['measure-light', 'brightness'],
  0.25,
  '#0D0D0D',
  0.3,
  '#FFFFFF',
]

export const BOOKMARKS_CIRCLES_LAYER_CONFIG: Omit<
  Layer,
  'id' | 'userId' | 'createdAt' | 'updatedAt'
> = {
  name: 'Saved Places Circles (Internal)',
  type: LayerType.CUSTOM,
  engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
  showInLayerSelector: false,
  visible: false,
  icon: null,
  order: 9996,
  groupId: null,
  configuration: {
    id: BOOKMARKS_CIRCLES_LAYER_ID,
    type: MapboxLayerType.CIRCLE,
    source: BOOKMARKS_SOURCE_ID,
    // Fully transparent by this zoom anyway; the cutoff just stops the engine
    // drawing thousands of invisible circles at continent scale.
    minzoom: DOT.zoom.hidden,
    layout: {},
    paint: {
      'circle-color': ['get', 'iconColor'],
      'circle-radius': BOOKMARK_CIRCLE_RADIUS,
      'circle-stroke-width': BOOKMARK_CIRCLE_STROKE_WIDTH,
      'circle-opacity': BOOKMARK_CIRCLE_OPACITY,
      'circle-stroke-opacity': BOOKMARK_CIRCLE_OPACITY,
      'circle-stroke-color': BOOKMARK_CONTRAST_COLOR,
      // Both 'viewport' so a saved place behaves like the basemap's POI
      // symbols under a tilted camera: `map` alignment lays the circle flat on
      // the ground plane, where pitch foreshortens it into an ellipse, and
      // `map` scaling grows the near ones with perspective. The glyph on top
      // is a symbol layer, which is viewport-aligned by default — so leaving
      // these as 'map' made the circle distort out from under a glyph that
      // didn't.
      'circle-pitch-alignment': 'viewport',
      'circle-pitch-scale': 'viewport',
      'circle-emissive-strength': 1,
    },
  },
}

export const BOOKMARKS_ICONS_LAYER_CONFIG: Omit<
  Layer,
  'id' | 'userId' | 'createdAt' | 'updatedAt'
> = {
  name: 'Saved Places Icons (Internal)',
  type: LayerType.CUSTOM,
  engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
  showInLayerSelector: false,
  visible: false,
  icon: null,
  order: 9997,
  groupId: null,
  configuration: {
    id: BOOKMARKS_ICONS_LAYER_ID,
    type: MapboxLayerType.SYMBOL,
    source: BOOKMARKS_SOURCE_ID,
    minzoom: BOOKMARKS_ICON_MINZOOM,
    layout: {
      // Deliberately NOT `symbol-z-elevate`: that lifts a symbol to the
      // elevation of whatever is beneath it (terrain, buildings) while the
      // circle layer stays on the ground plane, so a tilted camera pulls the
      // glyph off its dot. Right for labels that should ride on top of
      // buildings; wrong for a glyph that belongs to a specific circle.
      //
      // Pinned to the viewport for the same reason the circle is — both have
      // to be drawn in the same space or they separate under pitch.
      'icon-pitch-alignment': 'viewport',
      'icon-rotation-alignment': 'viewport',
      // Image ids are registered by `map-icon-images.ts` under this scheme.
      'icon-image': ['concat', 'bm-', ['get', 'iconPack'], '-', ['get', 'icon']],
      // The glyph belongs to its circle, not to the label collision system:
      // letting it be culled would leave an empty dot behind.
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-size': BOOKMARK_ICON_SIZE,
    },
    paint: {
      'icon-opacity': BOOKMARK_ICON_OPACITY,
    },
  },
}

// Default empty GeoJSON for the saved places source
export const EMPTY_BOOKMARKS_GEOJSON = {
  type: 'FeatureCollection' as const,
  features: [],
}

// Place geometry layer configurations - used for showing place boundaries and lines
export const PLACE_POLYGON_FILL_LAYER_CONFIG: Omit<
  Layer,
  'id' | 'userId' | 'createdAt' | 'updatedAt'
> = {
  name: 'Place Polygon Fill (Internal)',
  type: LayerType.CUSTOM,
  engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
  showInLayerSelector: false, // Hidden from user - not user-modifiable
  visible: false, // Hidden by default
  icon: null,
  order: 9998, // High order to ensure it's visible but below search results
  groupId: null,
  configuration: {
    id: PLACE_POLYGON_FILL_LAYER_ID,
    type: MapboxLayerType.FILL,
    source: PLACE_POLYGON_SOURCE_ID,
    slot: 'middle',
    filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]], // Only render polygons
    layout: {},
    paint: {
      'fill-color': getPlacePolygonFillColor(), // Will be updated reactively by updatePlacePolygonColors
      'fill-opacity': 0.08,
      'fill-emissive-strength': 1,
    },
  },
}

export const PLACE_POLYGON_STROKE_LAYER_CONFIG: Omit<
  Layer,
  'id' | 'userId' | 'createdAt' | 'updatedAt'
> = {
  name: 'Place Geometry Stroke (Internal)',
  type: LayerType.CUSTOM,
  engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
  showInLayerSelector: false, // Hidden from user - not user-modifiable
  visible: false, // Hidden by default
  icon: null,
  order: 9999, // Highest order to ensure stroke is on top
  groupId: null,
  configuration: {
    id: PLACE_POLYGON_STROKE_LAYER_ID,
    type: MapboxLayerType.LINE,
    source: PLACE_POLYGON_SOURCE_ID,
    slot: 'top',
    // No filter - renders all geometry types (Polygon, MultiPolygon, LineString)
    layout: {
      'line-join': 'round',
      'line-cap': 'round',
    },
    paint: {
      'line-color': getPlacePolygonStrokeColor(), // Will be updated reactively by updatePlacePolygonColors
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        10,
        0.2,
        18,
        3,
        21,
        6,
      ],
      'line-opacity': 0.75,
      'line-emissive-strength': 1,
    },
  },
}

// Empty GeoJSON for when no place polygon exists
export const EMPTY_PLACE_POLYGON_GEOJSON = {
  type: 'FeatureCollection' as const,
  features: [],
}

// Core layer IDs - these layers are managed entirely by the application
export const CORE_LAYER_IDS = {
  SEARCH_RESULTS: 'core:search-results',
  SEARCH_RESULTS_LABELS: 'core:search-results-labels',
  PLACE_GEOMETRY_FILL: 'core:place-geometry-fill',
  PLACE_GEOMETRY_STROKE: 'core:place-geometry-stroke',
} as const

// Core layers that are essential for app functionality
export const CORE_LAYERS: Omit<
  Layer,
  'id' | 'userId' | 'createdAt' | 'updatedAt'
>[] = [
  // Search results layer (for showing search results on map)
  {
    ...SEARCH_RESULTS_LAYER_CONFIG,
    name: 'Search Results (Core)',
    showInLayerSelector: false, // Hidden from UI
    order: 99998,
  },

  // Place geometry fill layer (for highlighting selected places)
  {
    ...PLACE_POLYGON_FILL_LAYER_CONFIG,
    name: 'Place Geometry Fill (Core)',
    showInLayerSelector: false, // Hidden from UI
    order: 99997,
  },

  // Place geometry stroke layer (for highlighting selected places)
  {
    ...PLACE_POLYGON_STROKE_LAYER_CONFIG,
    name: 'Place Geometry Stroke (Core)',
    showInLayerSelector: false, // Hidden from UI
    order: 99999,
  },
]
