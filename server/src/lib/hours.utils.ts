import type { OpeningHours, OpeningTime } from '../types/unified-place.types'

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
 * @returns OpeningHours object
 */
export function parseOsmHours(tags: Record<string, string>): OpeningHours {
  const openingHours: OpeningHours = {
    regularHours: [],
    isOpen24_7: false,
    isPermanentlyClosed: false,
    isTemporarilyClosed: false,
  }

  // Check for 24/7
  if (tags.opening_hours === '24/7') {
    openingHours.isOpen24_7 = true
    return openingHours
  }

  // Check for closed statuses
  if (
    tags.opening_hours === 'closed' ||
    tags.disused === 'yes' ||
    tags.abandoned === 'yes'
  ) {
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

  // Parse regular opening hours if available
  if (tags.opening_hours) {
    openingHours.rawText = tags.opening_hours

    // Try to parse basic OSM opening hours format
    // Example: "Mo-Fr 09:00-17:00; Sa 10:00-14:00"
    const dayRangeRegex =
      /(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/g
    const dayMap: Record<string, number> = {
      Su: 0,
      Mo: 1,
      Tu: 2,
      We: 3,
      Th: 4,
      Fr: 5,
      Sa: 6,
    }

    let match
    while ((match = dayRangeRegex.exec(tags.opening_hours)) !== null) {
      const [_, startDay, endDay, openTime, closeTime] = match
      const start = dayMap[startDay]
      const end = endDay ? dayMap[endDay] : start

      // Handle day ranges (e.g., Mo-Fr)
      for (let day = start; day <= (end >= start ? end : 6); day++) {
        openingHours.regularHours.push({
          day,
          open: parseTimeString(openTime),
          close: parseTimeString(closeTime),
        })
      }
      // If range wraps around to Sunday (e.g., Fr-Tu)
      if (endDay && end < start) {
        for (let day = 0; day <= end; day++) {
          openingHours.regularHours.push({
            day,
            open: parseTimeString(openTime),
            close: parseTimeString(closeTime),
          })
        }
      }
    }

    // Sort hours by day
    openingHours.regularHours.sort((a, b) => a.day - b.day)
  }

  return openingHours
}

/**
 * Check if a place is currently open
 * @param hours Array of OpeningTime objects
 * @returns Object containing open status and next change time
 */
export function isPlaceOpen(hours: OpeningTime[]): {
  isOpen: boolean
  nextChange?: string // Time string in format "HH:mm"
} {
  if (!hours.length) return { isOpen: false }

  const now = new Date()
  const currentDay = now.getDay()
  const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now
    .getMinutes()
    .toString()
    .padStart(2, '0')}`

  // Find today's hours
  const todayHours = hours.find((h) => h.day === currentDay)
  if (!todayHours) return { isOpen: false }

  const isOpen =
    currentTime >= todayHours.open && currentTime <= todayHours.close

  // Calculate next change time
  let nextChange: string | undefined
  if (isOpen) {
    nextChange = todayHours.close
  } else if (currentTime < todayHours.open) {
    nextChange = todayHours.open
  } else {
    // Find next day's opening time
    let nextDay = (currentDay + 1) % 7
    while (nextDay !== currentDay) {
      const nextDayHours = hours.find((h) => h.day === nextDay)
      if (nextDayHours) {
        nextChange = nextDayHours.open
        break
      }
      nextDay = (nextDay + 1) % 7
    }
  }

  return { isOpen, nextChange }
}
