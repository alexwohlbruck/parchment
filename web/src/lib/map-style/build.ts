import type { LayerSpecification, StyleSpecification } from 'maplibre-gl'
import type { MapStyleId } from '@/types/map.types'
import { getCustomColorTint } from '@/lib/color-tint'
import spec from './spec.json'
import lightTokens from './tokens.light.json'
import darkTokens from './tokens.dark.json'

/**
 * Assembles the basemap style from the converted layer spec and a flavor's
 * colour tokens.
 *
 * `spec.json` holds MapTiler Streets v2's layers — same filters, ramps and
 * draw order — with every colour replaced by an `"@token"` reference.
 * `tokens.light.json` / `tokens.dark.json` hold what those tokens resolve to;
 * both come from MapTiler's own Streets and Streets Dark, so dark is real
 * cartography rather than light run through a transform. Regenerate all three
 * with `bun run build:style`.
 */

export type FlavorId = 'light' | 'dark'

/**
 * How POIs are drawn.
 *
 * `badge` — a category-coloured disc with the glyph knocked out of it, the
 * same marker search results and saved places use.
 * `glyph` — a tinted glyph on a halo and nothing else, replicating MapTiler
 * Streets v4. Colours come from their family palette rather than Parchment's
 * categories, so it reads as their map does.
 */
export type PoiStyleId = 'badge' | 'glyph'

export const POI_STYLES: PoiStyleId[] = ['badge', 'glyph']

/** Place categories, matching `server/src/lib/place-categories.ts`. */
export type PlaceCategoryId =
  | 'food_and_drink' | 'education' | 'medical' | 'sport_and_leisure'
  | 'store' | 'arts_and_entertainment' | 'commercial_services' | 'park'
  | 'default'

/**
 * Fallback POI tints, used until the category palette loads. Mirrors the
 * fallback in `category-palette.store.ts`; callers should pass the live
 * palette so the basemap tracks whatever the server serves.
 */
const FALLBACK_CATEGORY_COLORS: Record<FlavorId, Record<PlaceCategoryId, string>> = {
  light: {
    food_and_drink: '#FF9933',
    education: 'hsl(30, 50%, 38%)',
    medical: 'hsl(0, 90%, 60%)',
    sport_and_leisure: 'hsl(190, 75%, 38%)',
    store: 'hsl(210, 75%, 53%)',
    arts_and_entertainment: 'hsl(320, 85%, 60%)',
    commercial_services: 'hsl(250, 75%, 60%)',
    park: 'hsl(110, 70%, 28%)',
    default: 'hsl(210, 20%, 43%)',
  },
  dark: {
    food_and_drink: '#FBCB6A',
    education: 'hsl(30, 50%, 70%)',
    medical: 'hsl(0, 70%, 70%)',
    sport_and_leisure: 'hsl(190, 60%, 70%)',
    store: 'hsl(210, 70%, 75%)',
    arts_and_entertainment: 'hsl(320, 70%, 75%)',
    commercial_services: 'hsl(260, 70%, 75%)',
    park: 'hsl(110, 55%, 65%)',
    default: 'hsl(210, 20%, 70%)',
  },
}

/**
 * Session-stable cache-buster: changes on each page load to bypass stale
 * cached tile responses, but stays constant within a session so MapLibre's
 * in-memory tile cache works normally.
 */
const cacheBuster = String(Date.now())

export const SOURCE = 'openmaptiles'

/**
 * How far the camera may tilt.
 *
 * Both engines default to 60, and past that MapLibre calls it experimental —
 * the far half of the view is a shallow sliver of ground, so tile counts climb
 * and label placement gets crowded. 85 is the ceiling Mapbox Standard uses and
 * the value the compass control was already written against (it clamps its own
 * drag to 85), so raising it makes the control mean what it says.
 *
 * Above roughly 70 the horizon comes into view, which is what `sky` is for.
 */
export const MAX_PITCH = 85

/**
 * What sits above the horizon once the camera can see it.
 *
 * Unspecified, MapLibre's sky is fully transparent and a steep view ends in
 * whatever is behind the canvas. These are the map's own colours rather than a
 * photographic sky: the horizon takes the land it meets so the ground fades
 * into it instead of ending on a line, and the sky above is a few steps toward
 * blue in daylight and toward black at night.
 *
 * `fog-color` is the haze drawn onto the far ground, which is what stops the
 * last few tiles reading as a hard edge.
 */
const SKY: Record<FlavorId, Record<string, string | number>> = {
  light: {
    'sky-color': 'hsl(205, 80%, 78%)',
    'horizon-color': 'hsl(47, 60%, 92%)',
    'fog-color': 'hsl(47, 79%, 94%)',
    'fog-ground-blend': 0.72,
    'horizon-fog-blend': 0.6,
    'sky-horizon-blend': 0.85,
  },
  dark: {
    'sky-color': 'hsl(217, 45%, 10%)',
    'horizon-color': 'hsl(216, 34%, 22%)',
    'fog-color': 'hsl(216, 37%, 24%)',
    'fog-ground-blend': 0.72,
    'horizon-fog-blend': 0.6,
    'sky-horizon-blend': 0.85,
  },
}

/** Self-hosted; see `scripts/build-glyphs.mjs` and `scripts/build-sprite.mjs`. */
const GLYPHS_PATH = '/fonts/{fontstack}/{range}.pbf'
const SPRITE_PATH = '/sprites/parchment'

/**
 * OpenStreetMap for the data, MapTiler for the cartography: the layer spec is
 * derived from their Streets v2, and the glyph-only POI treatment from their
 * Streets v4. Both are credited whichever POI style is showing.
 */
const OSM_ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap</a> ' +
  '<a href="https://www.maptiler.com/copyright/" target="_blank">&copy; MapTiler</a>'

export interface BasemapStyleOptions {
  /** Base URL of the tile server (e.g. "http://localhost:5001") */
  tileServerUrl: string
  /** Theme for the basemap */
  theme: 'light' | 'dark'
  /** Which style variant to use */
  mapStyle?: MapStyleId
  /** Language code for labels (e.g. "en") */
  lang?: string
  /** Auth token for tile requests (appended as query parameter) */
  tileKey?: string
  /** Live category palette, so basemap POIs match search-result markers. */
  categoryColors?: Partial<Record<PlaceCategoryId, string>>
  /** How POIs are drawn; defaults to the category badge. */
  poiStyle?: PoiStyleId
}

// ---------------------------------------------------------------------------
// Token resolution
// ---------------------------------------------------------------------------

const CATEGORY_PREFIX = '@@category:'
/** A palette colour run through the icon-tile treatment; see `tintOf`. */
const CATEGORY_TINT_PREFIX = /^@@category-(plate|ink):/
/** A literal colour run through the same treatment. */
const TINT_PREFIX = /^@@tint-(plate|ink):/

function tokenMap(flavor: FlavorId): Record<string, string> {
  return (flavor === 'dark' ? darkTokens : lightTokens) as Record<string, string>
}

/**
 * The pale plate and the deep glyph a colour tints to — the same pair the
 * place header's icon tile wears, from the same function, so the two cannot
 * drift. `poi-badge.ts` composites the badge from them.
 *
 * Falls back to the colour itself if it will not parse, which draws a flat
 * badge rather than none at all.
 */
function tintOf(color: string, kind: string, flavor: FlavorId): string {
  const tint = getCustomColorTint(color, 'solid', flavor === 'dark')
  if (!tint) return color
  return kind === 'ink' ? tint.foreground : tint.background ?? color
}

/**
 * Replace every `"@token"` in a value with the flavor's colour.
 *
 * Category tokens resolve one step further, to the live palette, so a POI on
 * the basemap is the same colour as the same place in search results.
 */
function resolve(
  value: unknown,
  tokens: Record<string, string>,
  categories: Record<string, string>,
  flavor: FlavorId,
): any {
  if (typeof value === 'string') {
    if (!value.startsWith('@')) return value
    const resolved = tokens[value.slice(1)]
    if (resolved === undefined) return value
    if (resolved.startsWith(CATEGORY_PREFIX)) {
      const category = resolved.slice(CATEGORY_PREFIX.length)
      return categories[category] ?? categories.default
    }
    const tinted = CATEGORY_TINT_PREFIX.exec(resolved)
    if (tinted) {
      const category = resolved.slice(tinted[0].length)
      return tintOf(categories[category] ?? categories.default, tinted[1], flavor)
    }
    const literal = TINT_PREFIX.exec(resolved)
    if (literal) return tintOf(resolved.slice(literal[0].length), literal[1], flavor)
    return resolved
  }
  if (Array.isArray(value)) return value.map(v => resolve(v, tokens, categories, flavor))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = resolve(v, tokens, categories, flavor)
    return out
  }
  return value
}

const specLayers = (spec as { layers: any[] }).layers
type LayerOverrides = Record<
  string,
  { layout?: Record<string, unknown>; paint?: Record<string, unknown> }
>
const poiStyles = (spec as any).poiStyles as Record<'glyph', LayerOverrides>
const flavorStyles = (spec as any).flavorStyles as Record<FlavorId, LayerOverrides>

/**
 * Layer groups the map strategy toggles, derived from the spec rather than
 * hand-listed, so a regenerated spec cannot silently drop one out of a toggle.
 */
function idsWhere(pred: (l: any) => boolean): string[] {
  return specLayers.filter(pred).map(l => l.id)
}

export const layerGroups = {
  poi: idsWhere(
    l => l.type === 'symbol' && ['poi', 'housenumber', 'aerodrome_label', 'mountain_peak'].includes(l['source-layer']),
  ),
  roadLabels: idsWhere(l => l.type === 'symbol' && l['source-layer'] === 'transportation_name'),
  transit: idsWhere(l => /rail|transit|subway|tram|funicular/i.test(l.id)),
  placeLabels: idsWhere(l => l.type === 'symbol' && l['source-layer'] === 'place'),
  building3d: specLayers.find(l => l.type === 'fill-extrusion')?.id ?? 'Building 3D',
}

/**
 * The building layer's height and base as the spec defines them, zoom ramp and
 * all — so anything that switches 3D buildings back on restores exactly what
 * the style had rather than a hand-rolled copy that can drift from it.
 */
const buildingLayer = specLayers.find(l => l.type === 'fill-extrusion')
export const BUILDING_HEIGHT_EXPRESSION = buildingLayer?.paint?.['fill-extrusion-height']
export const BUILDING_BASE_EXPRESSION = buildingLayer?.paint?.['fill-extrusion-base']

/** The footprint outline that stands in for the roofline looking straight down. */
export const BUILDING_ROOF_EDGE_LAYER = 'Building roof edge'

/** OpenMapTiles property names for building extrusion height. */
export const BUILDING_HEIGHT_PROPERTY = 'render_height'
export const BUILDING_MIN_HEIGHT_PROPERTY = 'render_min_height'

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function buildTileUrl(tileServerUrl: string, tileKey?: string, source = 'basemap'): string {
  const params = new URLSearchParams()
  if (tileKey) params.set('token', tileKey)
  params.set('v', cacheBuster)
  return `${tileServerUrl}/${source}/{z}/{x}/{y}?${params.toString()}`
}

function origin(): string {
  return typeof window !== 'undefined' ? window.location.origin : ''
}

function vectorSource(tileServerUrl: string, tileKey?: string) {
  return {
    type: 'vector' as const,
    tiles: [buildTileUrl(tileServerUrl, tileKey)],
    maxzoom: 14,
    attribution: OSM_ATTRIBUTION,
  }
}

/**
 * Rewrite the label field to a language preference, leaving the spec's own
 * `{name:latin}` style fallbacks alone when no language is asked for.
 */
function localize(layer: any, lang?: string): any {
  if (!lang || lang === 'local' || layer.type !== 'symbol') return layer
  const field = layer.layout?.['text-field']
  if (!field) return layer
  return {
    ...layer,
    layout: {
      ...layer.layout,
      'text-field': ['coalesce', ['get', `name:${lang}`], ['get', 'name']],
    },
  }
}

/**
 * Merge a set of per-layer paint/layout overrides into the layer list.
 *
 * Both variant mechanisms in the spec — the glyph-only POI treatment and the
 * per-flavor tweaks — are keyed by layer id and hold only the properties that
 * differ, rather than a second copy of the layer. Filters and draw order stay
 * defined exactly once, in the layer list itself.
 */
function applyOverrides(
  layers: any[],
  overrides: Record<string, { layout?: Record<string, unknown>; paint?: Record<string, unknown> }>,
): any[] {
  return layers.map(l => {
    const o = overrides?.[l.id]
    if (!o) return l
    return {
      ...l,
      layout: { ...l.layout, ...o.layout },
      paint: { ...l.paint, ...o.paint },
    }
  })
}

export function buildLayers(options: {
  flavor: FlavorId
  categoryColors?: Partial<Record<PlaceCategoryId, string>>
  lang?: string
  poiStyle?: PoiStyleId
}): LayerSpecification[] {
  const { flavor, categoryColors, lang, poiStyle = 'badge' } = options
  const tokens = tokenMap(flavor)
  const categories = { ...FALLBACK_CATEGORY_COLORS[flavor], ...categoryColors }

  let base = specLayers
  if (poiStyle === 'glyph') base = applyOverrides(base, poiStyles.glyph)
  base = applyOverrides(base, flavorStyles[flavor])

  return base
    .map(l => resolve(l, tokens, categories, flavor))
    .map(l => localize(l, lang)) as LayerSpecification[]
}

/** The full street basemap. */
export function buildMapStyle(options: BasemapStyleOptions): StyleSpecification {
  const { tileServerUrl, theme, tileKey, mapStyle, lang, categoryColors, poiStyle } = options
  const flavor: FlavorId = theme === 'dark' ? 'dark' : 'light'

  return {
    version: 8,
    name: `Parchment ${flavor}`,
    glyphs: `${origin()}${GLYPHS_PATH}`,
    sprite: `${origin()}${SPRITE_PATH}`,
    sources: { [SOURCE]: vectorSource(tileServerUrl, tileKey) },
    sky: SKY[flavor],
    layers: buildLayers({ flavor, categoryColors, lang, poiStyle }),
  } as StyleSpecification
}

/**
 * Satellite / hybrid: ESRI World Imagery, with the basemap's labels and
 * arterial network over it in hybrid mode.
 *
 * Hybrid always uses the dark flavor's labels regardless of app theme: the
 * ground here is imagery, always busy and mid-to-dark, not a flavor's own
 * background.
 */
export function buildSatelliteStyle(
  options: BasemapStyleOptions & { hybrid?: boolean },
): StyleSpecification {
  const { tileServerUrl, hybrid = false, tileKey, mapStyle, lang, categoryColors, poiStyle } = options

  const sources: StyleSpecification['sources'] = {
    'satellite-raster': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        '&copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    },
  }

  const layers: StyleSpecification['layers'] = [
    { id: 'satellite-raster', type: 'raster', source: 'satellite-raster' },
  ]

  if (hybrid) {
    sources[SOURCE] = vectorSource(tileServerUrl, tileKey)
    const overlay = buildLayers({
      flavor: 'dark',
      categoryColors,
      lang,
      poiStyle,
    }).filter(
      l =>
        l.type === 'symbol' ||
        // Keep the arterial network so the imagery stays navigable.
        /^(Highway|Major road)$/.test(l.id),
    )
    layers.push(...overlay)
  }

  return {
    version: 8,
    name: hybrid ? 'Parchment hybrid' : 'Parchment satellite',
    // Daylight regardless of app theme, for the same reason hybrid's labels are
    // fixed: the ground here is aerial photography, taken in the day.
    sky: SKY.light,
    glyphs: `${origin()}${GLYPHS_PATH}`,
    sprite: `${origin()}${SPRITE_PATH}`,
    sources,
    layers,
  } as StyleSpecification
}
