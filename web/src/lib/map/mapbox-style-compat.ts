import { Layer, MaplibreLayerType } from '@/types/map.types'

// List of Mapbox paint properties that are not supported by Maplibre
const MAPBOX_PAINT_PROPERTIES = [
  'fill-emissive-strength',
  'line-emissive-strength',
  'raster-emissive-strength',
  'icon-emissive-strength',
  'text-emissive-strength',
  'line-occlusion-opacity',
  'circle-emissive-strength',
] as const

// List of Mapbox layout properties that are not supported by Maplibre
// NOTE: Only include truly Mapbox-only properties here. Standard MapLibre
// properties like symbol-placement, text-field, text-size etc. are valid
// and should NOT be stripped — their Mapbox expression values (config,
// measure-light) are already handled by stripMapboxExpressions().
const MAPBOX_LAYOUT_PROPERTIES = [
  'symbol-z-elevate',
] as const

/**
 * Mapbox Standard's font names → the stacks we actually serve.
 *
 * Every name on the right has to be a directory under `public/fonts`, because
 * MapLibre asks our own glyph endpoint for it and a miss is silent: the request
 * falls through to the SPA's index.html and the labels just do not draw.
 * `Noto Sans Regular` used to sit here and was never one of them — Noto is
 * composited *inside* each stack as the non-Latin fallback, not served alone.
 *
 * Matched by weight on the page rather than by weight in the name: DIN Pro is
 * squarer and more open, and holds its colour at label sizes where Geist at
 * the same nominal weight goes thin. Each name therefore lands a notch heavier
 * — which is also what puts an overlay's labels on the same rung as the
 * basemap's own, since those are SemiBold (see `TYPOGRAPHY` in
 * `convert-basemap-style.mjs`).
 */
const MAPBOX_TO_MAPLIBRE_FONTS: Record<string, string> = {
  'DIN Pro Medium':         'Geist SemiBold',
  'DIN Pro':                'Geist Medium',
  'DIN Pro Bold':           'Geist Bold',
  // Geist has no italic face; see build-glyphs.mjs.
  'DIN Pro Italic':         'Geist Regular',
  'Arial Unicode MS Bold':  'Geist Bold',
  'Arial Unicode MS Regular': 'Geist Regular',
}

/**
 * Recursively strip Mapbox-only expressions that MapLibre doesn't understand.
 * - `measure-light`: resolved against the app theme; see below.
 * - `config`: replaced with a sensible default string.
 * Returns the cleaned value, or the original if no Mapbox expressions found.
 *
 * `measure-light` reads the basemap's light preset, which Mapbox alone has.
 * The app sets that preset from the theme and nothing else — `day` or `night`,
 * never `dawn` or `dusk` (see `setMapTheme` in `mapbox.strategy.ts`) — so on
 * MapLibre the theme answers the same question exactly, and a ramp over it
 * collapses to whichever end the theme picks.
 *
 * It used to collapse to the bright end unconditionally, which is why every
 * light/dark pair written this way — search-result label colours, the ring
 * around a saved place — came out in daylight colours on the night map.
 */
function stripMapboxExpressions(value: unknown, isDark: boolean): unknown {
  if (!Array.isArray(value)) return value

  const [op, ...rest] = value

  // ['measure-light', 'brightness'] → the brightness the theme implies. Mostly
  // it appears inside an interpolate, which is handled below, but a bare one
  // still has to answer with something.
  if (op === 'measure-light') {
    return isDark ? 0 : 1
  }

  // ['config', 'font'] → return default font family
  if (op === 'config') {
    return 'Geist'
  }

  // ['concat', ...args] with config inside → evaluate with defaults
  if (op === 'concat') {
    const resolved = rest.map(a => stripMapboxExpressions(a, isDark))
    // If all parts resolved to strings, return the concatenated result
    if (resolved.every(v => typeof v === 'string')) {
      return resolved.join('')
    }
  }

  // ['interpolate', ['linear'], ['measure-light', ...], stop1, val1, stop2, val2]
  // → the darkest stop's value at night, the brightest one's by day. The stops
  // are ordered by brightness, so those are the first and last values.
  if (op === 'interpolate' && Array.isArray(rest[1]) && rest[1][0] === 'measure-light') {
    const chosen = isDark ? value[4] : value[value.length - 1]
    return stripMapboxExpressions(chosen, isDark)
  }

  // Recurse into all array elements
  return value.map(v => stripMapboxExpressions(v, isDark))
}

/**
 * Clean a paint or layout object by stripping Mapbox-only expressions
 * from all property values.
 */
function stripMapboxExpressionsFromObject(
  obj: Record<string, any>,
  isDark: boolean,
): Record<string, any> {
  const result: Record<string, any> = {}
  for (const [key, val] of Object.entries(obj)) {
    result[key] = stripMapboxExpressions(val, isDark)
  }
  return result
}

// TODO: Fix any types
export function mapboxLayerToMaplibreLayer(
  layer: Layer,
  isDark = false,
): MaplibreLayerType {
  // IMPORTANT: deep clone the configuration before mutating. A shallow spread
  // preserves references to nested paint/layout/source objects, which means
  // the `delete` statements below would permanently strip Mapbox-only keys
  // from the original layer object — so switching back to Mapbox after a
  // MapLibre pass would silently lose properties like `line-emissive-strength`.
  // We use JSON clone rather than structuredClone because layers come from a
  // Pinia store whose reactive proxies may contain values that structuredClone
  // refuses to copy (functions, symbols, etc.). Layer configs are plain JSON
  // data so JSON.parse/JSON.stringify is a safe round-trip.
  const maplibreConfig: any = JSON.parse(JSON.stringify(layer.configuration))

  // Remove Mapbox-specific paint properties, then strip unsupported expressions
  if (maplibreConfig.paint) {
    MAPBOX_PAINT_PROPERTIES.forEach(prop => {
      if (prop in maplibreConfig.paint) {
        delete maplibreConfig.paint[prop]
      }
    })
    maplibreConfig.paint = stripMapboxExpressionsFromObject(maplibreConfig.paint, isDark)
  }

  // Remove Mapbox-specific layout properties, then strip unsupported expressions
  if (maplibreConfig.layout) {
    MAPBOX_LAYOUT_PROPERTIES.forEach(prop => {
      if (prop in maplibreConfig.layout) {
        delete maplibreConfig.layout[prop]
      }
    })
    maplibreConfig.layout = stripMapboxExpressionsFromObject(maplibreConfig.layout, isDark)

    // Translate text-font: replace Mapbox font names with MapLibre equivalents.
    // Handle both flat arrays (['DIN Pro', ...]) and arrays that contained
    // expressions which were resolved to strings by stripMapboxExpressions.
    //
    // Down to ONE name, always. A Mapbox stack lists its non-Latin fallback
    // after the face, and MapLibre asks our glyph endpoint for the whole stack
    // joined into a single `encodeURIComponent`d path segment — so a two-name
    // stack becomes `Geist%20SemiBold%2CGeist%20Regular`, which is no directory
    // under `public/fonts`, falls through to index.html, and takes every label
    // on the layer with it. Noto is composited inside each stack already, so
    // the fallback has nothing left to do here; see `build-glyphs.mjs`.
    if (Array.isArray(maplibreConfig.layout['text-font'])) {
      const stack = maplibreConfig.layout['text-font']
        .filter((entry: unknown) => typeof entry === 'string')
        .map((font: string) => MAPBOX_TO_MAPLIBRE_FONTS[font] ?? 'Geist Regular')
      maplibreConfig.layout['text-font'] = [stack[0] ?? 'Geist Regular']
    } else if (maplibreConfig.type === 'symbol') {
      // No text-font specified — inject a known-good default so MapLibre doesn't
      // fall back to the basemap style's default (e.g. "Open Sans Regular") which
      // may not exist on the glyph server.
      if (!maplibreConfig.layout) maplibreConfig.layout = {}
      maplibreConfig.layout['text-font'] = ['Geist Regular']
    }
  }

  // Handle special source cases
  if (
    typeof maplibreConfig.source === 'string' &&
    maplibreConfig.source.startsWith('mapbox://')
  ) {
    ;(maplibreConfig as { [key: string]: any })['source'] = undefined
  }

  return {
    ...layer,
    configuration: maplibreConfig,
  } as any
}
