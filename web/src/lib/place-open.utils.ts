import type { OpeningHours } from '@/types/place.types'

/**
 * Check if a place is currently open based on its opening hours.
 * Returns true (open), false (closed), or null (indeterminate / no data).
 * null means filters should pass this place through rather than hiding it.
 */
export function isPlaceOpenNow(hours: OpeningHours | null | undefined): boolean | null {
  if (!hours) return null

  if (hours.isPermanentlyClosed || hours.isTemporarilyClosed) return false
  if (hours.isOpen24_7) return true

  if (!hours.regularHours?.length) return null

  const now = new Date()
  const currentDay = now.getDay()
  const currentTime =
    `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`

  const todaySlots = hours.regularHours.filter(h => h.day === currentDay)
  if (!todaySlots.length) return false

  return todaySlots.some(slot => currentTime >= slot.open && currentTime <= slot.close)
}
