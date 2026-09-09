import type { OpeningHours, OpeningTime } from '../types/place.types'
import { parseOpeningHours, type OpeningHoursContext } from './opening-hours'
import { isPermanentlyClosedByOsmTags } from './osm-lifecycle'

const DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

/**
 * Parse time string to 24h format
 * @param timeStr Time string in various formats (e.g. "5:30 PM", "17:30", "5:30")
 * @returns Time in 24h format "HH:mm"
 */
function parseTimeString(timeStr: string): string {
  // Remove any spaces
  timeStr = timeStr.trim()

  // If already in 24h format
  if (timeStr.match(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)) {
    return timeStr.padStart(5, '0')
  }

  // Parse "5:30 PM" format
  const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i)
  if (!match) return '00:00'

  let [_, hours, minutes, meridiem] = match
  let hoursNum = parseInt(hours)

  // Convert to 24h format
  if (meridiem?.toUpperCase() === 'PM' && hoursNum < 12) {
    hoursNum += 12
  } else if (meridiem?.toUpperCase() === 'AM' && hoursNum === 12) {
    hoursNum = 0
  }

  return `${hoursNum.toString().padStart(2, '0')}:${minutes}`
}

/**
 * Parse Google Places API opening hours text
 * @param rawText Opening hours text from Google Places API
 * @returns Array of OpeningTime objects
 */
export function parseGoogleHours(rawText: string): OpeningTime[] {
  if (!rawText) return []

  const hours: OpeningTime[] = []
  const dayRegex = new RegExp(DAYS.join('|'), 'g')

  rawText.split(';').forEach((dayHours) => {
    const day = dayHours.match(dayRegex)?.[0]
    if (!day) return

    const times = dayHours.match(
      /(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*[–-]\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i,
    )
    if (!times) return

    const [_, openTime, closeTime] = times
    hours.push({
      day: DAYS.indexOf(day),
      open: parseTimeString(openTime),
      close: parseTimeString(closeTime),
    })
  })

  return hours.sort((a, b) => a.day - b.day)
}

/**
 * Parse OSM opening hours text
 * @param tags OSM tags object
 * @param context Place location, used for solar times and holiday calendars
 * @returns OpeningHours object
 */
export function parseOsmHours(
  tags: Record<string, string>,
  context: OpeningHoursContext = {},
): OpeningHours {
  const openingHours: OpeningHours = {
    regularHours: [],
    isOpen24_7: false,
    isPermanentlyClosed: false,
    isTemporarilyClosed: false,
  }

  // Permanently closed wins over every other status: a retired place routinely
  // keeps the opening_hours it had when it was alive, including "24/7".
  if (isPermanentlyClosedByOsmTags(tags) || tags.opening_hours === 'closed') {
    openingHours.isPermanentlyClosed = true
    return openingHours
  }

  if (
    tags.opening_hours === 'temporary closed' ||
    tags.temporary === 'closed'
  ) {
    openingHours.isTemporarilyClosed = true
    return openingHours
  }

  return parseOpeningHours(tags.opening_hours, context) ?? openingHours
}
