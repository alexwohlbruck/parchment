import type { Stay, StayOffer, StayRates } from '../../types/integration.types'

const DAY_MS = 24 * 60 * 60 * 1000

export function stayNights(stay: Pick<Stay, 'checkin' | 'checkout'>): number {
  return Math.max(1, Math.round((Date.parse(stay.checkout) - Date.parse(stay.checkin)) / DAY_MS))
}

/** Our booking partner's cheapest room as one seller's offer, on its page for these dates. */
export function cheapestRoomOffer(rates: StayRates, stay: Stay): StayOffer | null {
  const room = rates.rooms[0]
  if (!room) return null
  return {
    seller: rates.provider,
    logo: null,
    official: false,
    featured: true,
    bookHere: true,
    nightly: { amount: Math.round((room.total.amount / stayNights(stay)) * 100) / 100, currency: room.total.currency },
    total: room.total,
    freeCancellation: rates.rooms.some((r) => r.freeCancellationUntil !== null),
    url: rates.bookingUrl ?? room.bookingUrl,
  }
}

const byNightly = (a: StayOffer, b: StayOffer) =>
  (a.nightly?.amount ?? Infinity) - (b.nightly?.amount ?? Infinity)

/** Our partner first, then Google's featured sellers in its order, then everyone else cheapest first. */
export function mergeOffers(partner: StayOffer[], google: StayOffer[]): StayOffer[] {
  return [
    ...partner,
    ...google.filter((o) => o.featured),
    ...google.filter((o) => !o.featured).sort(byNightly),
  ]
}
