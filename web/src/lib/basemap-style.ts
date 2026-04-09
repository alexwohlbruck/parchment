import type { StyleSpecification } from 'maplibre-gl'
import type { MapStyleId } from '@/types/map.types'
import { hexToHsl, hslToHex } from '@/lib/utils'
import osmLibertyStyle from '@/assets/map-styles/osm-liberty.json'
import osmOpenMapTilesStyle from '@/assets/map-styles/openmaptiles-default.json'

// Session-stable cache-buster: changes on each page load to bypass stale
// cached tile responses, but stays constant within a session so MapLibre's
// in-memory tile cache works normally.
const _cacheBuster = String(Date.now())

/** Map of style ID → raw style JSON */
const styleJsonMap: Record<MapStyleId, any> = {
  'osm-liberty': osmLibertyStyle,
  'osm-openmaptiles': osmOpenMapTilesStyle,
}

export interface BasemapStyleOptions {
  /** Base URL of the tile server (e.g. "http://localhost:5001") */
  tileServerUrl: string
  /** Theme for the basemap */
  theme: 'light' | 'dark'
  /** Which style to use */
  mapStyle?: MapStyleId
  /** Language code for labels (e.g. "en") */
  lang?: string
  /** Auth token for tile requests (appended as query parameter) */
  tileKey?: string
}

/**
 * Build a tile URL for our basemap proxy with optional auth token and cache-buster.
 */
function buildTileUrl(tileServerUrl: string, tileKey?: string): string {
  const base = `${tileServerUrl}/tiles/basemap/{z}/{x}/{y}`
  const params = new URLSearchParams()
  if (tileKey) params.set('token', tileKey)
  params.set('v', _cacheBuster)
  return `${base}?${params.toString()}`
}

/**
 * Deep-clone a style JSON and replace the openmaptiles source
 * with our tile server.
 */
function cloneStyleWithSource(
  tileServerUrl: string,
  tileKey?: string,
  mapStyle: MapStyleId = 'osm-liberty',
): StyleSpecification {
  const baseJson = styleJsonMap[mapStyle] ?? styleJsonMap['osm-liberty']
  const style: StyleSpecification = JSON.parse(JSON.stringify(baseJson))

  // Replace the openmaptiles source with our tile server
  style.sources = {
    openmaptiles: {
      type: 'vector',
      tiles: [buildTileUrl(tileServerUrl, tileKey)],
      maxzoom: 14,
      attribution:
        '<a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap</a>',
    },
  }

  // Resolve sprite URL placeholder for self-hosted sprites
  if (typeof style.sprite === 'string' && style.sprite.includes('__SPRITE_BASE__')) {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    style.sprite = style.sprite.replace('__SPRITE_BASE__', origin)
  }

  // Remove layers that reference sources we don't serve (e.g. natural_earth raster)
  const keptSourceIds = new Set(Object.keys(style.sources))
  style.layers = style.layers.filter((l: any) => {
    if (!l.source) return true // background layers etc.
    return keptSourceIds.has(l.source)
  })

  return style
}

// ---------------------------------------------------------------------------
// Dark-theme colour transformation
// ---------------------------------------------------------------------------

/**
 * Darken a colour for dark-theme use.  Keeps the hue, reduces lightness.
 * Returns the original value unchanged for non-simple-hex colours
 * (expressions, interpolation arrays, etc.).
 */
function darkenColor(value: unknown, targetL = 18): string | unknown {
  if (typeof value !== 'string') return value
  const hex = value.match(/^#([0-9a-f]{3,8})$/i)
  if (!hex) return value
  const hsl = hexToHsl(value)
  // Compress lightness toward `targetL` – keep water/parks slightly distinct
  const newL = targetL + (hsl.l - targetL) * 0.15
  return hslToHex(hsl.h, Math.max(hsl.s * 0.7, 5), Math.max(newL, 5))
}

/**
 * Lighten a colour for labels on a dark background.
 */
function lightenColor(value: unknown, minL = 78): string | unknown {
  if (typeof value !== 'string') return value
  const hex = value.match(/^#([0-9a-f]{3,8})$/i)
  if (!hex) return value
  const hsl = hexToHsl(value)
  const newL = Math.max(hsl.l, minL)
  return hslToHex(hsl.h, Math.min(hsl.s, 60), newL)
}

/**
 * Apply dark-theme transformations to a cloned style in-place.
 * Works generically with any OpenMapTiles-based style by operating on
 * layer *types* rather than hard-coded layer IDs.
 */
function applyDarkTheme(style: StyleSpecification): void {
  for (const layer of style.layers as any[]) {
    if (!layer.paint) layer.paint = {}
    const id: string = layer.id?.toLowerCase() ?? ''
    const sl: string = (layer['source-layer'] ?? '').toLowerCase()

    switch (layer.type) {
      case 'background':
        layer.paint['background-color'] = '#1c1c2e'
        break

      case 'fill': {
        // Water fills – dark navy
        if (sl === 'water' || id.includes('water')) {
          layer.paint['fill-color'] = '#1a2744'
          break
        }
        // Parks & green areas
        if (sl === 'park' || sl === 'landcover' ||
            id.includes('park') || id.includes('grass') ||
            id.includes('wood') || id.includes('forest') ||
            id.includes('wetland') || id.includes('green')) {
          layer.paint['fill-color'] = '#1e2e22'
          layer.paint['fill-opacity'] = 0.6
          break
        }
        // Buildings
        if (sl === 'building' || id.includes('building')) {
          layer.paint['fill-color'] = '#2a2a3e'
          if (layer.paint['fill-outline-color'])
            layer.paint['fill-outline-color'] = '#3a3a52'
          break
        }
        // Generic land / landuse fills
        const fc = layer.paint['fill-color']
        if (fc) layer.paint['fill-color'] = darkenColor(fc, 16)
        break
      }

      case 'fill-extrusion': {
        // 3D buildings
        layer.paint['fill-extrusion-color'] = '#2a2a3e'
        break
      }

      case 'line': {
        // Water lines
        if (sl === 'waterway' || id.includes('waterway') || id.includes('water')) {
          layer.paint['line-color'] = '#1f3050'
          break
        }
        // Boundaries
        if (sl === 'boundary' || id.includes('boundary') || id.includes('admin')) {
          layer.paint['line-color'] = '#555577'
          break
        }
        // Road/transport casings – dark edges
        if (sl === 'transportation' || sl === 'transportation_name' ||
            id.includes('road') || id.includes('highway') || id.includes('street') ||
            id.includes('tunnel') || id.includes('bridge') || id.includes('trunk') ||
            id.includes('motorway') || id.includes('primary') || id.includes('secondary') ||
            id.includes('tertiary') || id.includes('path') || id.includes('rail') ||
            id.includes('link') || id.includes('service') || id.includes('track')) {
          if (id.includes('casing') || id.includes('outline')) {
            layer.paint['line-color'] = '#1c1c2e'
          } else if (id.includes('motorway') || id.includes('highway')) {
            layer.paint['line-color'] = '#5e5e8a'
          } else if (id.includes('trunk') || id.includes('primary')) {
            layer.paint['line-color'] = '#4e4e78'
          } else if (id.includes('secondary') || id.includes('tertiary')) {
            layer.paint['line-color'] = '#42425e'
          } else if (id.includes('rail')) {
            layer.paint['line-color'] = '#505070'
          } else {
            // Minor roads
            layer.paint['line-color'] = '#383852'
          }
          break
        }
        // Generic lines – darken
        const lc = layer.paint['line-color']
        if (lc) layer.paint['line-color'] = darkenColor(lc, 22)
        break
      }

      case 'symbol': {
        // Lighten all text for dark background
        layer.paint['text-color'] = lightenColor(
          layer.paint['text-color'] ?? '#c8c8d8',
          78,
        ) as string
        layer.paint['text-halo-color'] = 'rgba(20, 20, 40, 0.85)'
        layer.paint['text-halo-width'] = 1.5

        // Water labels – subtle blue
        if (sl === 'water_name' || id.includes('water')) {
          layer.paint['text-color'] = '#7799bb'
        }
        // Icon tint – lighten if present
        if (layer.paint['icon-color']) {
          layer.paint['icon-color'] = lightenColor(layer.paint['icon-color'], 70)
        }
        break
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a full MapLibre style specification using an OpenMapTiles-based
 * style, served from Martin via the Barrelman tile proxy.
 */
export function buildMapStyle(
  options: BasemapStyleOptions,
): StyleSpecification {
  const { tileServerUrl, theme, tileKey, mapStyle = 'osm-liberty' } = options
  const style = cloneStyleWithSource(tileServerUrl, tileKey, mapStyle)

  if (theme === 'dark') {
    applyDarkTheme(style)
  }

  return style
}

/**
 * Build a satellite/hybrid style using ESRI World Imagery raster tiles
 * with optional OSM Liberty label overlay.
 */
export function buildSatelliteStyle(
  options: BasemapStyleOptions & { hybrid?: boolean },
): StyleSpecification {
  const { tileServerUrl, hybrid = false, tileKey, mapStyle = 'osm-liberty' } = options

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

  const styleLayers: StyleSpecification['layers'] = [
    {
      id: 'satellite-raster',
      type: 'raster',
      source: 'satellite-raster',
    },
  ]

  // For hybrid mode, add vector labels on top of satellite imagery
  if (hybrid) {
    const tileUrl = buildTileUrl(tileServerUrl, tileKey)
    sources['openmaptiles'] = {
      type: 'vector',
      tiles: [tileUrl],
      maxzoom: 14,
    }

    // Get label layers from the active style (symbol type only)
    const baseJson = styleJsonMap[mapStyle] ?? styleJsonMap['osm-liberty']
    const baseStyle: StyleSpecification = JSON.parse(JSON.stringify(baseJson))
    const labelLayers = baseStyle.layers.filter(
      (l: any) => l.type === 'symbol',
    )

    // Apply dark styling to labels for readability on satellite imagery
    for (const layer of labelLayers as any[]) {
      if (!layer.paint) layer.paint = {}
      layer.paint['text-color'] = '#e0e0f0'
      layer.paint['text-halo-color'] = 'rgba(0, 0, 0, 0.8)'
      layer.paint['text-halo-width'] = 2
    }

    styleLayers.push(...(labelLayers as StyleSpecification['layers']))
  }

  // Use sprite/glyphs from the active style for symbol layers
  const styleRef = (styleJsonMap[mapStyle] ?? styleJsonMap['osm-liberty']) as any

  return {
    version: 8,
    glyphs: styleRef.glyphs,
    sprite: styleRef.sprite,
    sources,
    layers: styleLayers,
  }
}
