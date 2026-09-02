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

/**
 * Mapbox Standard's font names → the stacks we actually serve.
 *
 * Every name on the right has to be a directory under `public/fonts`, because
 * MapLibre asks our own glyph endpoint for it and a miss is silent: the request
 * falls through to the SPA's index.html and the labels just do not draw.
 * `Noto Sans Regular` used to sit here and was never one of them — Noto is
 * composited *inside* each stack as the non-Latin fallback, not served alone.
 */
const MAPBOX_TO_MAPLIBRE_FONTS: Record<string, string> = {
  'DIN Pro Medium':         'Geist Medium',
  'DIN Pro':                'Geist Regular',
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
    if (Array.isArray(maplibreConfig.layout['text-font'])) {
      maplibreConfig.layout['text-font'] = maplibreConfig.layout['text-font']
        .filter((entry: unknown) => typeof entry === 'string')
        .map((font: string) => MAPBOX_TO_MAPLIBRE_FONTS[font] ?? 'Geist Regular')
      // Ensure at least one font remains
      if (maplibreConfig.layout['text-font'].length === 0) {
        maplibreConfig.layout['text-font'] = ['Geist Regular']
      }
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
