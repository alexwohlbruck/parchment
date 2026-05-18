import type { OpeningHours } from '@/types/place.types'

export function getLocalDayAndTime(timezone?: string): { day: number; time: string } {
  const now = new Date()
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
    const day = dayMap[weekdayStr] ?? now.getDay()

    const hour = parts.find(p => p.type === 'hour')?.value ?? '00'
    const minute = parts.find(p => p.type === 'minute')?.value ?? '00'
    const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`

    return { day, time }
  }

  return {
    day: now.getDay(),
    time: `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`,
  }
}

/**
 * Check if a place is currently open based on its opening hours.
 * Returns true (open), false (closed), or null (indeterminate / no data).
 * null means filters should pass this place through rather than hiding it.
 *
 * When timezone is provided, compares against the place's local time
 * instead of the browser's local time.
 */
export function isPlaceOpenNow(
  hours: OpeningHours | null | undefined,
  timezone?: string,
): boolean | null {
  if (!hours) return null

  if (hours.isPermanentlyClosed || hours.isTemporarilyClosed) return false
  if (hours.isOpen24_7) return true

  if (!hours.regularHours?.length) return null

  const { day: currentDay, time: currentTime } = getLocalDayAndTime(timezone)

  const todaySlots = hours.regularHours.filter(h => h.day === currentDay)
  if (!todaySlots.length) return false

  return todaySlots.some(slot => currentTime >= slot.open && currentTime <= slot.close)
}
