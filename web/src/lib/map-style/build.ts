import type { StyleSpecification } from 'maplibre-gl'
import type { MapStyleId } from '@/types/map.types'
import { getFlavor, type Flavor } from './flavors'
import { buildLayers, layerGroups, SOURCE, type Detail } from './layers'

/**
 * Assembles a complete MapLibre style from a flavor and a tile server.
 *
 * Everything visual lives in `flavors.ts` and `layers.ts`; this module only
 * wires in the source URLs, sprite, glyphs and attribution.
 */

/**
 * Session-stable cache-buster: changes on each page load to bypass stale
 * cached tile responses, but stays constant within a session so MapLibre's
 * in-memory tile cache works normally.
 */
const cacheBuster = String(Date.now())

/**
 * Glyphs are served from OpenFreeMap's public font CDN, which carries the
 * Noto Sans Regular/Bold/Italic stacks this style uses. Point this at our own
 * origin to self-host — the style needs no other change.
 */
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'

/** Maki sprite, built by `web/scripts/build-sprite.sh` into `public/sprites`. */
const SPRITE_PATH = '/sprites/parchment'

const OSM_ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap</a>'

/**
 * Road ramps and label sizing are ported from Mapbox Streets v12, whose
 * visual design is licensed CC-BY 3.0. The licence asks only that attribution
 * be reachable from the map, which the attribution control satisfies.
 */
const DESIGN_ATTRIBUTION =
  'Cartography after <a href="https://github.com/mapbox/mapbox-gl-styles" target="_blank">Mapbox Open Styles</a> (CC BY 3.0)'

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
}

/** Detail tier per style variant. */
const DETAIL: Record<MapStyleId, Detail> = {
  parchment: 'full',
  'parchment-minimal': 'minimal',
}

function detailFor(mapStyle?: MapStyleId): Detail {
  return (mapStyle && DETAIL[mapStyle]) || 'full'
}

/**
 * Build a tile URL template for the server-side Barrelman proxy.
 * The proxy route handles auth + caching server-side.
 */
function buildTileUrl(
  tileServerUrl: string,
  tileKey?: string,
  source = 'basemap',
): string {
  const params = new URLSearchParams()
  if (tileKey) params.set('token', tileKey)
  params.set('v', cacheBuster)
  return `${tileServerUrl}/${source}/{z}/{x}/{y}?${params.toString()}`
}

function spriteUrl(): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}${SPRITE_PATH}`
}

function vectorSource(tileServerUrl: string, tileKey?: string) {
  return {
    type: 'vector' as const,
    tiles: [buildTileUrl(tileServerUrl, tileKey)],
    maxzoom: 14,
    attribution: `${OSM_ATTRIBUTION} | ${DESIGN_ATTRIBUTION}`,
  }
}

/** The full street basemap. */
export function buildMapStyle(
  options: BasemapStyleOptions,
): StyleSpecification {
  const { tileServerUrl, theme, tileKey, mapStyle, lang } = options
  const flavor = getFlavor(theme)

  return {
    version: 8,
    name: `Parchment ${flavor.id}`,
    glyphs: GLYPHS,
    sprite: spriteUrl(),
    sources: {
      [SOURCE]: vectorSource(tileServerUrl, tileKey),
    },
    layers: buildLayers({ flavor, detail: detailFor(mapStyle), lang }),
  } as StyleSpecification
}

/**
 * Satellite / hybrid: ESRI World Imagery, with the vector label and road
 * layers laid over it in hybrid mode.
 *
 * Hybrid reuses the dark flavor's label tokens regardless of app theme,
 * because the ground here is imagery — always busy and mid-to-dark — not the
 * flavor's own background.
 */
export function buildSatelliteStyle(
  options: BasemapStyleOptions & { hybrid?: boolean },
): StyleSpecification {
  const { tileServerUrl, hybrid = false, tileKey, mapStyle, lang } = options

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

    const flavor = getFlavor('dark')
    const overlay = buildLayers({
      flavor,
      detail: detailFor(mapStyle),
      lang,
    }).filter(
      l =>
        l.type === 'symbol' ||
        // Keep the arterial network visible so the imagery stays navigable.
        /^road-surface-(motorway|trunk|primary)$/.test(l.id),
    )

    layers.push(...overlay)
  }

  return {
    version: 8,
    name: hybrid ? 'Parchment hybrid' : 'Parchment satellite',
    glyphs: GLYPHS,
    sprite: spriteUrl(),
    sources,
    layers,
  } as StyleSpecification
}

export { layerGroups, getFlavor, SOURCE }
export type { Flavor, Detail }
