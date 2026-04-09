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

// TODO: Fix any types
export function mapboxLayerToMaplibreLayer(layer: Layer): MaplibreLayerType {
  const { configuration } = { ...layer }
  const maplibreConfig: any = {
    ...configuration,
    type: configuration.type,
  }

  // Remove Mapbox-specific paint properties, then strip unsupported expressions
  if (maplibreConfig.paint) {
    MAPBOX_PAINT_PROPERTIES.forEach(prop => {
      if (prop in maplibreConfig.paint) {
        delete maplibreConfig.paint[prop]
      }
    })
    maplibreConfig.paint = stripMapboxExpressionsFromObject(maplibreConfig.paint)
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

// TODO: Opening hours need proper timezone handling:
// 1. Use the place's lat/lon to determine its timezone
// 2. Use a timezone library (like moment-timezone) to convert local times
// 3. Consider using opening_hours.js which handles:
//    - Timezone conversion based on lat/lon
//    - Daylight saving time
//    - Complex rules like "sunrise-sunset"
//    - Holiday schedules
//    See: https://github.com/opening-hours/opening_hours.js
export function parseOpeningHours(hoursStr: string): OpeningStatus | null {
  // Current implementation assumes local browser timezone
  // This can be wrong if the place is in a different timezone
  try {
    // Handle special cases first
    if (hoursStr === '24/7') {
      return {
        isOpen: true,
        nextChange: null, // Always open
      }
    }

    if (hoursStr.toLowerCase() === 'sunrise-sunset') {
      // This is a rough approximation - ideally we'd calculate actual sunrise/sunset
      return {
        isOpen: true, // Assuming daytime for now
        nextChange: 'at sunset',
      }
    }

    const now = dayjs()
    const currentDay = now.format('dd').slice(0, 2)
    const currentTime = now.format('HH:mm')

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
      const nextOpen = findNextOpenDay(now.day())
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
      const nextOpen = findNextOpenDay(now.day())
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
