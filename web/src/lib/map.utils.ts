import { Layer, MaplibreLayer } from '@/types/map.types'
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
const MAPBOX_LAYOUT_PROPERTIES = [
  'symbol-placement',
  'text-field',
  'text-size',
  'text-offset',
  'text-font',
  'icon-image',
  'icon-size',
] as const

// TODO: Fix any types
export function mapboxLayerToMaplibreLayer(layer: Layer): MaplibreLayer {
  const { configuration } = { ...layer }
  const maplibreConfig: any = {
    ...configuration,
    type: configuration.type,
  }

  // Remove Mapbox-specific paint properties
  if (maplibreConfig.paint) {
    MAPBOX_PAINT_PROPERTIES.forEach(prop => {
      if (prop in maplibreConfig.paint) {
        delete maplibreConfig.paint[prop]
      }
    })
  }

  // Remove Mapbox-specific layout properties
  if (maplibreConfig.layout) {
    MAPBOX_LAYOUT_PROPERTIES.forEach(prop => {
      if (prop in maplibreConfig.layout) {
        delete maplibreConfig.layout[prop]
      }
    })
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
