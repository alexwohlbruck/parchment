import type { LayerSpecification, StyleSpecification } from 'maplibre-gl'
import type { MapStyleId } from '@/types/map.types'
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

/** Self-hosted; see `scripts/build-glyphs.mjs` and `scripts/build-sprite.mjs`. */
const GLYPHS_PATH = '/fonts/{fontstack}/{range}.pbf'
const SPRITE_PATH = '/sprites/parchment'

const OSM_ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap</a>'

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
}

// ---------------------------------------------------------------------------
// Token resolution
// ---------------------------------------------------------------------------

const CATEGORY_PREFIX = '@@category:'

function tokenMap(flavor: FlavorId): Record<string, string> {
  return (flavor === 'dark' ? darkTokens : lightTokens) as Record<string, string>
}

/**
 * Replace every `"@token"` in a value with the flavor's colour.
 *
 * Category tokens resolve one step further, to the live palette, so a POI on
 * the basemap is the same colour as the same place in search results.
 */
function resolve(value: unknown, tokens: Record<string, string>, categories: Record<string, string>): any {
  if (typeof value === 'string') {
    if (!value.startsWith('@')) return value
    const resolved = tokens[value.slice(1)]
    if (resolved === undefined) return value
    if (resolved.startsWith(CATEGORY_PREFIX)) {
      const category = resolved.slice(CATEGORY_PREFIX.length)
      return categories[category] ?? categories.default
    }
    return resolved
  }
  if (Array.isArray(value)) return value.map(v => resolve(v, tokens, categories))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = resolve(v, tokens, categories)
    return out
  }
  return value
}

const specLayers = (spec as { layers: any[] }).layers

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

export function buildLayers(options: {
  flavor: FlavorId
  categoryColors?: Partial<Record<PlaceCategoryId, string>>
  lang?: string
}): LayerSpecification[] {
  const { flavor, categoryColors, lang } = options
  const tokens = tokenMap(flavor)
  const categories = { ...FALLBACK_CATEGORY_COLORS[flavor], ...categoryColors }

  return specLayers
    .map(l => resolve(l, tokens, categories))
    .map(l => localize(l, lang)) as LayerSpecification[]
}

/** The full street basemap. */
export function buildMapStyle(options: BasemapStyleOptions): StyleSpecification {
  const { tileServerUrl, theme, tileKey, mapStyle, lang, categoryColors } = options
  const flavor: FlavorId = theme === 'dark' ? 'dark' : 'light'

  return {
    version: 8,
    name: `Parchment ${flavor}`,
    glyphs: `${origin()}${GLYPHS_PATH}`,
    sprite: `${origin()}${SPRITE_PATH}`,
    sources: { [SOURCE]: vectorSource(tileServerUrl, tileKey) },
    layers: buildLayers({ flavor, categoryColors, lang }),
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
  const { tileServerUrl, hybrid = false, tileKey, mapStyle, lang, categoryColors } = options

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
    glyphs: `${origin()}${GLYPHS_PATH}`,
    sprite: `${origin()}${SPRITE_PATH}`,
    sources,
    layers,
  } as StyleSpecification
}
