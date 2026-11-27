export type ReservationPolicy = 'yes' | 'recommended' | 'required'

export type BookingKind = 'table' | 'stay' | 'ahead'

const POLICIES: ReservationPolicy[] = ['yes', 'recommended', 'required']

const VENUE_URL_KEYS = [
  'reservation:website',
  'website:reservation',
  'website:reservations',
  'website:booking',
]

const DINING_AMENITIES = new Set(['restaurant', 'cafe', 'bar', 'pub', 'biergarten', 'food_court'])

const LODGING_TOURISM = new Set(['hotel', 'motel', 'hostel', 'guest_house', 'apartment', 'chalet'])

export function reservationPolicy(
  tags: Record<string, string | undefined> | null | undefined,
): ReservationPolicy | null {
  const value = (tags?.reservation ?? tags?.reservations)?.trim().toLowerCase()
  return POLICIES.find(p => p === value) ?? null
}

export function isDiningPlace(tags: Record<string, string | undefined>): boolean {
  return DINING_AMENITIES.has(tags.amenity ?? '') || tags.cuisine !== undefined
}

export function isLodgingPlace(tags: Record<string, string | undefined>): boolean {
  return LODGING_TOURISM.has(tags.tourism ?? '')
}

function refusesReservations(tags: Record<string, string | undefined>): boolean {
  return (tags.reservation ?? tags.reservations)?.trim().toLowerCase() === 'no'
}

/** What booking a place means, or null when it can't be booked. Lodging is bookable unless tagged otherwise. */
export function bookingKind(
  tags: Record<string, string | undefined> | null | undefined,
): BookingKind | null {
  if (!tags) return null
  if (isLodgingPlace(tags)) return refusesReservations(tags) ? null : 'stay'
  if (!reservationPolicy(tags)) return null
  return isDiningPlace(tags) ? 'table' : 'ahead'
}

/** The place's own booking page from its tags, when it has a usable http(s) one. */
export function venueBookingUrl(tags: Record<string, string | undefined>): URL | null {
  for (const key of VENUE_URL_KEYS) {
    const raw = tags[key]?.trim()
    if (!raw) continue
    try {
      const url = new URL(raw)
      if (url.protocol === 'https:' || url.protocol === 'http:') return url
    } catch {
      continue
    }
  }
  return null
}
