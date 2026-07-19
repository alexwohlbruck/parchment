import type { OpeningTime } from '../types/place.types'
import type { Language } from './i18n'
import {
  getPlaceType as getOSMPlaceType,
  type GeometryType,
} from './osm-presets'
import { logError } from './logger'

export function getPlaceType(
  tags: Record<string, string>,
  language: Language = 'en-US',
  geometry: GeometryType = 'point',
): string {
  return getOSMPlaceType(tags, language, geometry)
}

export function parseOpeningHoursForUnifiedFormat(
  hoursString: string,
): OpeningTime[] | null {
  try {
    if (!hoursString) return null

    const days = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
    const result: OpeningTime[] = []

    // Split by semicolons for different day patterns
    const patterns = hoursString.split(';').map((p) => p.trim())

    for (const pattern of patterns) {
      const [dayPart, timePart] = pattern.split(' ', 2)

      if (!dayPart || !timePart) continue

      // Process day ranges like Mo-Fr or Mo,We
      let daysToApply: number[] = []

      if (dayPart === 'Mo-Su' || dayPart === '24/7') {
        // Represents all days
        daysToApply = [0, 1, 2, 3, 4, 5, 6]
      } else {
        const dayPatterns = dayPart.split(',')

        for (const dp of dayPatterns) {
          if (dp.includes('-')) {
            // Handle day ranges like Mo-Fr
            const [start, end] = dp.split('-')
            const startIdx = days.indexOf(start)
            const endIdx = days.indexOf(end)

            if (startIdx !== -1 && endIdx !== -1) {
              for (let i = startIdx; i <= endIdx; i++) {
                daysToApply.push(i)
              }
            }
          } else {
            // Handle individual days like Mo
            const dayIdx = days.indexOf(dp)
            if (dayIdx !== -1) {
              daysToApply.push(dayIdx)
            }
          }
        }
      }

      if (daysToApply.length === 0) continue

      // Process time ranges like 08:00-17:00
      if (timePart === 'off' || timePart === 'closed') {
        // Skip closed days
        continue
      }

      const timeRanges = timePart.split(',')

      for (const timeRange of timeRanges) {
        const [start, end] = timeRange.split('-')

        if (!start || !end) continue

        // Apply to all days in the range
        for (const day of daysToApply) {
          result.push({
            day,
            open: start.trim(),
            close: end.trim(),
          })
        }
      }
    }

    return result.length > 0 ? result : null
  } catch (error) {
    logError('Error parsing opening hours', error)
    return null
  }
}

export function isPlaceOpen(openingTimes: OpeningTime[], timezone?: string): {
  isOpen: boolean
  nextChange?: string
} {
  if (!openingTimes || openingTimes.length === 0) {
    return { isOpen: false }
  }

  const now = new Date()
  let currentDay: number
  let currentTime: string

  if (timezone) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short',
    }).formatToParts(now)
    const weekdayStr = parts.find(p => p.type === 'weekday')?.value ?? ''
    const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    currentDay = dayMap[weekdayStr] ?? now.getDay()
    const hour = parts.find(p => p.type === 'hour')?.value ?? '00'
    const minute = parts.find(p => p.type === 'minute')?.value ?? '00'
    currentTime = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
  } else {
    currentDay = now.getDay()
    const currentHour = now.getHours()
    const currentMinute = now.getMinutes()
    currentTime = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`
  }

  // Find if the place is currently open
  for (const time of openingTimes) {
    if (time.day === currentDay) {
      if (time.open <= currentTime && time.close > currentTime) {
        // Calculate time until closing using string times
        const [closeH, closeM] = time.close.split(':').map(Number)
        const [curH, curM] = currentTime.split(':').map(Number)
        const minutesUntilClose = (closeH * 60 + closeM) - (curH * 60 + curM)

        if (minutesUntilClose <= 60) {
          return { isOpen: true, nextChange: `in ${minutesUntilClose} min` }
        } else {
          const hoursUntilClose = Math.floor(minutesUntilClose / 60)
          return { isOpen: true, nextChange: `in ${hoursUntilClose} hours` }
        }
      }
    }
  }

  // If we get here, the place is currently closed
  // Find the next opening time
  let nextOpeningTime: OpeningTime | null = null
  let daysUntilOpen = Infinity

  for (const time of openingTimes) {
    let dayDiff = time.day - currentDay
    if (dayDiff < 0) dayDiff += 7 // Wrap around for next week

    // Same day but later
    if (dayDiff === 0 && time.open > currentTime) {
      if (!nextOpeningTime || daysUntilOpen > 0) {
        nextOpeningTime = time
        daysUntilOpen = 0
      }
    }
    // Future day
    else if (dayDiff > 0) {
      if (!nextOpeningTime || dayDiff < daysUntilOpen) {
        nextOpeningTime = time
        daysUntilOpen = dayDiff
      }
    }
  }

  if (nextOpeningTime) {
    if (daysUntilOpen === 0) {
      return { isOpen: false, nextChange: `today at ${nextOpeningTime.open}` }
    } else if (daysUntilOpen === 1) {
      return {
        isOpen: false,
        nextChange: `tomorrow at ${nextOpeningTime.open}`,
      }
    } else {
      const days = [
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
      ]
      return {
        isOpen: false,
        nextChange: `on ${days[nextOpeningTime.day]} at ${
          nextOpeningTime.open
        }`,
      }
    }
  }

  return { isOpen: false }
}

export function getWheelchairAccess(
  tags: Record<string, string | undefined>,
): string {
  const wheelchair = tags?.wheelchair || 'unknown'
  switch (wheelchair) {
    case 'yes':
      return 'Wheelchair accessible'
    case 'no':
      return 'Not wheelchair accessible'
    case 'limited':
      return 'Limited wheelchair accessibility'
    case 'designated':
      return 'Designated wheelchair access'
    default:
      return 'Unknown wheelchair accessibility'
  }
}

export function getSmokingStatus(
  tags: Record<string, string | undefined>,
): string {
  const smoking = tags?.smoking || 'unknown'
  switch (smoking) {
    case 'yes':
      return 'Smoking allowed'
    case 'no':
      return 'No smoking'
    case 'separated':
      return 'Separate smoking area'
    case 'isolated':
      return 'Isolated smoking area'
    case 'outside':
      return 'Smoking allowed outside'
    case 'dedicated':
      return 'Dedicated smoking area'
    default:
      return 'Unknown smoking policy'
  }
}

export function getRestroomAccess(
  tags: Record<string, string | undefined>,
): string {
  const toilets = tags?.toilets || 'unknown'
  switch (toilets) {
    case 'yes':
      return 'Restrooms available'
    case 'no':
      return 'No restrooms'
    case 'customers':
      return 'Restrooms for customers only'
    default:
      return 'Unknown restroom availability'
  }
}

export function formatAddress(
  tags: Record<string, string | undefined>,
): string {
  if (!tags) return ''

  const parts = [
    `${tags['addr:housenumber'] || ''} ${tags['addr:street'] || ''}`.trim(),
    `${tags['addr:city'] || ''}${
      tags['addr:city'] && tags['addr:state'] ? ',' : ''
    } ${tags['addr:state'] || ''} ${tags['addr:postcode'] || ''}`.trim(),
    tags['addr:country'],
  ].filter(Boolean)

  return parts.join('\n')
}

export function parseCuisines(cuisine: string | undefined): string[] | null {
  if (!cuisine) return null
  return cuisine
    .split(';')
    .map((c) => c.trim().replace(/_/g, ' '))
    .map((c) => c.charAt(0).toUpperCase() + c.slice(1))
}

export function getWifiStatus(tags: Record<string, string | undefined>) {
  const access = tags.internet_access
  const ssid = tags['internet_access:ssid']
  const fee = tags['internet_access:fee']
  const password = tags['internet_access:password']

  if (!access || access === 'no') return null

  let label = 'WiFi available'
  if (access === 'free' || fee === 'no') {
    label = 'Free WiFi available'
  } else if (access === 'customers') {
    label = 'WiFi for customers'
  } else if (fee === 'yes') {
    label = 'Paid WiFi available'
  }

  return { label, ssid, password }
}

export function hasOutdoorSeating(
  tags: Record<string, string | undefined>,
): boolean {
  return tags.outdoor_seating === 'yes'
}
