import { api } from '@/lib/api'
import type { StayOffers } from '@server/types/integration.types'
import type { BookingVenues } from '@server/types/place-listing.types'

const OSM = 'osm'

export interface StayOffersQuery {
  id: string
  checkin: string
  checkout: string
  adults: number
  currency: string
  nationality: string
}

export async function fetchBookingVenues(id: string, signal: AbortSignal): Promise<BookingVenues> {
  const { data } = await api.get<BookingVenues>('/places/booking-venues', { params: { source: OSM, id }, signal })
  return data
}

export async function fetchStayOffers({ id, ...stay }: StayOffersQuery, signal: AbortSignal): Promise<StayOffers | null> {
  const { data } = await api.get<{ offers: StayOffers | null }>('/places/stay-offers', {
    params: { source: OSM, id, ...stay },
    signal,
    timeout: 30_000,
  })
  return data.offers
}
