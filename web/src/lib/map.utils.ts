import { Layer, MaplibreLayerType } from '@/types/map.types'
import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'

// Initialize the plugin
dayjs.extend(localizedFormat)

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

// Font name translation table: Mapbox Standard → MapLibre (OSM Liberty) equivalents
// OSM Liberty uses Roboto + Noto Sans via CDN glyphs.
const MAPBOX_TO_MAPLIBRE_FONTS: Record<string, string> = {
  'DIN Pro Medium':         'Roboto Medium',
  'DIN Pro':                'Roboto Regular',
  'DIN Pro Bold':           'Roboto Bold',
  'DIN Pro Italic':         'Roboto Italic',
  'Arial Unicode MS Bold':  'Noto Sans Regular',
  'Arial Unicode MS Regular': 'Noto Sans Regular',
}

/**
 * Recursively strip Mapbox-only expressions that MapLibre doesn't understand.
 * - `measure-light`: replaced with its "day" fallback (the last value in the
 *   interpolation, i.e. the highest-brightness stop).
 * - `config`: replaced with a sensible default string.
 * Returns the cleaned value, or the original if no Mapbox expressions found.
 */
function stripMapboxExpressions(value: unknown): unknown {
  if (!Array.isArray(value)) return value

  const [op, ...rest] = value

  // ['measure-light', 'brightness'] → not directly useful, but it appears
  // inside interpolate expressions.  We handle it at the interpolate level.
  if (op === 'measure-light') {
    // Return a neutral brightness value (day mode = high brightness)
    return 1
  }

  // ['config', 'font'] → return default font family
  if (op === 'config') {
    return 'Roboto'
  }

  // ['concat', ...args] with config inside → evaluate with defaults
  if (op === 'concat') {
    const resolved = rest.map(a => stripMapboxExpressions(a))
    // If all parts resolved to strings, return the concatenated result
    if (resolved.every(v => typeof v === 'string')) {
      return resolved.join('')
    }
  }

  // ['interpolate', ['linear'], ['measure-light', ...], stop1, val1, stop2, val2]
  // → use the last value (highest brightness = day mode)
  if (op === 'interpolate' && Array.isArray(rest[1]) && rest[1][0] === 'measure-light') {
    const lastVal = value[value.length - 1]
    return stripMapboxExpressions(lastVal)
  }

  // Recurse into all array elements
  return value.map(v => stripMapboxExpressions(v))
}

/**
 * Clean a paint or layout object by stripping Mapbox-only expressions
 * from all property values.
 */
function stripMapboxExpressionsFromObject(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {}
  for (const [key, val] of Object.entries(obj)) {
    result[key] = stripMapboxExpressions(val)
  }
  return result
}

// ── Progress-driven line-offset (transit v3 junction transitions) ──────────
// The transit transition-layer templates carry
//   ['interpolate', ['cubic-bezier', .4, 0, .6, 1], ['line-progress'],
//     0, ['get', 'off_from_px'], 1, ['get', 'off_to_px']]
// in `line-offset`. Evaluating ['line-progress'] inside `line-offset` is a
// capability of the LOCAL MapLibre fork only (transit/variable-line-offset —
// per-vertex offsets via an ext buffer attribute). Stock MapLibre and Mapbox
// GL reject/ignore the expression, so those engines must substitute a
// constant offset instead ("step" degradation: each transition piece holds
// its from-offset; steady corridors are untouched and remain full fidelity).

/**
 * True iff the running `maplibre-gl` is the local variable-line-offset fork.
 * Compile-time constant injected by Vite (`__MAPLIBRE_FORK__`, set from the
 * same check that installs the fork alias in web/vite.config.ts) — the alias
 * IS the capability, so no runtime probing is needed. The `typeof` guard
 * keeps non-Vite consumers (e.g. plain ts-node tooling) from throwing.
 */
export const MAPLIBRE_SUPPORTS_PROGRESS_OFFSET: boolean =
  typeof __MAPLIBRE_FORK__ !== 'undefined' && __MAPLIBRE_FORK__

/** Deep check: does an expression reference ['line-progress'] anywhere? */
function usesLineProgress(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  if (value[0] === 'line-progress') return true
  return value.some(v => usesLineProgress(v))
}

/**
 * Rewrite every `['interpolate', <curve>, ['line-progress'], 0, X, ...]` node
 * anywhere in an expression tree to its progress-0 output X. The transit
 * templates wrap the line-progress interpolate in a top-level ['zoom']
 * interpolate (low-zoom gap squeeze), so the rewrite must recurse rather than
 * assume the progress interpolate sits at the top.
 */
function replaceLineProgressInterpolates(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  const [op, , input] = value as any[]
  if (
    op === 'interpolate' &&
    Array.isArray(input) &&
    input[0] === 'line-progress' &&
    value.length >= 5
  ) {
    return replaceLineProgressInterpolates(value[4]) // offset at progress 0
  }
  return (value as any[]).map(v => replaceLineProgressInterpolates(v))
}

/**
 * Replace a progress-driven `line-offset` with its progress-0 outputs — for
 * the transit transition layers that is ['get', 'off_from_px'] (still inside
 * the zoom-squeeze wrapper), the approved constant "step" degradation for
 * engines without the fork. Mutates `paint` in place; a no-op when
 * `line-offset` doesn't reference line-progress, so it is safe to run over
 * every layer. Any line-progress usage outside an interpolate (nothing we
 * emit, but engines would reject it) falls back to 0.
 */
export function degradeProgressLineOffset(paint?: Record<string, any>): void {
  const offset = paint?.['line-offset']
  if (!paint || !usesLineProgress(offset)) return
  const replaced = replaceLineProgressInterpolates(offset)
  paint['line-offset'] = usesLineProgress(replaced) ? 0 : replaced
}

// TODO: Fix any types
export function mapboxLayerToMaplibreLayer(layer: Layer): MaplibreLayerType {
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
    maplibreConfig.paint = stripMapboxExpressionsFromObject(maplibreConfig.paint)

    // Stock MapLibre cannot drive line-offset from line-progress (fork-only
    // capability) — degrade transit transition layers to their constant
    // from-offset. On the fork this is skipped and the smooth junction
    // interpolation reaches the engine untouched.
    if (!MAPLIBRE_SUPPORTS_PROGRESS_OFFSET) {
      degradeProgressLineOffset(maplibreConfig.paint)
    }
  }

  // Remove Mapbox-specific layout properties, then strip unsupported expressions
  if (maplibreConfig.layout) {
    MAPBOX_LAYOUT_PROPERTIES.forEach(prop => {
      if (prop in maplibreConfig.layout) {
        delete maplibreConfig.layout[prop]
      }
    })
    maplibreConfig.layout = stripMapboxExpressionsFromObject(maplibreConfig.layout)

    // Translate text-font: replace Mapbox font names with MapLibre equivalents.
    // Handle both flat arrays (['DIN Pro', ...]) and arrays that contained
    // expressions which were resolved to strings by stripMapboxExpressions.
    if (Array.isArray(maplibreConfig.layout['text-font'])) {
      maplibreConfig.layout['text-font'] = maplibreConfig.layout['text-font']
        .filter((entry: unknown) => typeof entry === 'string')
        .map((font: string) => MAPBOX_TO_MAPLIBRE_FONTS[font] ?? 'Roboto Regular')
      // Ensure at least one font remains
      if (maplibreConfig.layout['text-font'].length === 0) {
        maplibreConfig.layout['text-font'] = ['Roboto Regular']
      }
    } else if (maplibreConfig.type === 'symbol') {
      // No text-font specified — inject a known-good default so MapLibre doesn't
      // fall back to the basemap style's default (e.g. "Open Sans Regular") which
      // may not exist on the glyph server.
      if (!maplibreConfig.layout) maplibreConfig.layout = {}
      maplibreConfig.layout['text-font'] = ['Roboto Regular']
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

export function parseMapboxToOsmId(featureId: string | number): {
  osmId: string
  poiType: 'node' | 'way' | 'relation' | 'unknown'
} {
  const typeCode = String(featureId).slice(-1)
  const osmId = String(featureId).slice(0, -1)

  const poiTypeCodeMap: {
    [key: string]: 'node' | 'way' | 'relation' | 'unknown'
  } = {
    '0': 'node',
    '1': 'way',
    '2': 'unknown',
    '3': 'unknown',
    '4': 'relation',
  }

  return {
    osmId,
    poiType: poiTypeCodeMap[typeCode] || 'unknown',
  }
}

/**
 * Parse a Planetiler/OpenMapTiles MVT feature ID into an OSM ID and type.
 * Planetiler encodes as: feature.id = osm_id * 10 + type_code
 * where type_code: 1=node, 2=way, 3=relation
 */
export function parsePlanetilerOsmId(featureId: string | number): {
  osmId: string
  poiType: 'node' | 'way' | 'relation' | 'unknown'
} {
  const id = typeof featureId === 'string' ? parseInt(featureId, 10) : featureId
  if (isNaN(id) || id <= 0) return { osmId: '0', poiType: 'unknown' }

  const typeCode = id % 10
  const osmId = Math.floor(id / 10)

  const poiTypeCodeMap: Record<number, 'node' | 'way' | 'relation'> = {
    1: 'node',
    2: 'way',
    3: 'relation',
  }

  return {
    osmId: String(osmId),
    poiType: poiTypeCodeMap[typeCode] || 'unknown',
  }
}

type OpeningStatus = {
  isOpen: boolean
  nextChange: string | null
}

type DayRange = {
  days: string[]
  hours: string[]
}

export function parseOpeningHours(hoursStr: string, timezone?: string): OpeningStatus | null {
  try {
    // Handle special cases first
    if (hoursStr === '24/7') {
      return {
        isOpen: true,
        nextChange: null, // Always open
      }
    }

    if (hoursStr.toLowerCase() === 'sunrise-sunset') {
      return {
        isOpen: true,
        nextChange: 'at sunset',
      }
    }

    let now: dayjs.Dayjs
    let currentDay: string
    let currentTime: string
    let currentDayNum: number

    if (timezone) {
      const date = new Date()
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        weekday: 'short',
      }).formatToParts(date)
      const weekdayStr = parts.find(p => p.type === 'weekday')?.value ?? ''
      const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
      currentDayNum = dayMap[weekdayStr] ?? date.getDay()
      currentDay = dayjs().day(currentDayNum).format('dd').slice(0, 2)
      const hour = parts.find(p => p.type === 'hour')?.value ?? '00'
      const minute = parts.find(p => p.type === 'minute')?.value ?? '00'
      currentTime = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
    } else {
      now = dayjs()
      currentDay = now.format('dd').slice(0, 2)
      currentTime = now.format('HH:mm')
      currentDayNum = now.day()
    }

    // Split into day ranges
    const ranges = hoursStr.split(';').map(range => {
      // Handle case where there's no day specified (just hours)
      if (!range.includes(' ')) {
        return {
          days: ['Mo-Su'],
          hours: range.trim().split('-'),
        }
      }

      const [days, hours] = range.trim().split(' ')
      // If there's only one range and no day specified, assume it's every day
      const parsedDays =
        days.includes('-') || days.includes(',') ? days.split(',') : ['Mo-Su']
      return {
        days: parsedDays,
        hours: hours === 'off' ? null : hours.split('-'),
      }
    })

    // Find current day's hours
    const todayRange = ranges.find(range =>
      range.days.some(day => {
        // Handle the Mo-Su case
        if (day === 'Mo-Su') return true
        return day.includes(currentDay)
      }),
    )

    // Helper to format time
    const formatTime = (time: string) => {
      const [hours, minutes] = time.split(':')
      return dayjs()
        .hour(parseInt(hours))
        .minute(parseInt(minutes))
        .format('h:mm A')
    }

    // Helper to find next open day and its hours
    const findNextOpenDay = (
      startDay: number,
    ): { day: number; hours: string[] } | null => {
      for (let i = 1; i <= 7; i++) {
        const nextDay = (startDay + i) % 7
        const nextDayCode = dayjs().day(nextDay).format('dd').slice(0, 2)
        const nextDayRange = ranges.find(range =>
          range.days.some(day => day.includes(nextDayCode)),
        )
        if (nextDayRange?.hours) {
          return { day: nextDay, hours: nextDayRange.hours }
        }
      }
      return null
    }

    if (!todayRange || !todayRange.hours) {
      // Place is closed today, find next opening
      const nextOpen = findNextOpenDay(currentDayNum)
      if (nextOpen) {
        const nextOpenDate = dayjs()
          .day(nextOpen.day)
          .hour(parseInt(nextOpen.hours[0].split(':')[0]))
          .minute(parseInt(nextOpen.hours[0].split(':')[1]))
        return {
          isOpen: false,
          nextChange: nextOpenDate.format('dddd [at] h:mm A'),
        }
      }
      return {
        isOpen: false,
        nextChange: null,
      }
    }

    const [openTime, closeTime] = todayRange.hours
    const isOpen = currentTime >= openTime && currentTime <= closeTime

    if (isOpen) {
      return {
        isOpen: true,
        nextChange: formatTime(closeTime),
      }
    } else if (currentTime < openTime) {
      return {
        isOpen: false,
        nextChange: formatTime(openTime),
      }
    } else {
      // Find next day's opening time
      const nextOpen = findNextOpenDay(currentDayNum)
      if (nextOpen) {
        const nextOpenDate = dayjs()
          .day(nextOpen.day)
          .hour(parseInt(nextOpen.hours[0].split(':')[0]))
          .minute(parseInt(nextOpen.hours[0].split(':')[1]))
        return {
          isOpen: false,
          nextChange: nextOpenDate.format('dddd [at] h:mm A'),
        }
      }
      return {
        isOpen: false,
        nextChange: null,
      }
    }
  } catch (error) {
    console.error('Failed to parse opening hours:', error)
    return null
  }
}
