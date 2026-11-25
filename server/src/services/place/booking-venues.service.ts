import type { Source } from '../../lib/constants'
import { bookingKind, venueBookingUrl } from '../../lib/place/booking-kind'
import {
  VENUE_PROVIDERS,
  parseVenueUrl,
  venueProviderOf,
  type VenueProvider,
} from '../../lib/place/booking-venues'
import type { ProviderMatches } from '../../lib/place/provider-matches'
import { logWarn } from '../../lib/logger'
import type { Place } from '../../types/place.types'
import { lookupPlaceById } from '../place.service'
import { getProviderMatches, setProviderMatch } from './provider-matches.service'

export interface BookingVenues {
  /** The place's own page on each booking site, by provider. */
  venues: Partial<Record<VenueProvider, string>>
  /** Booking sites a person said don't list this place, so they aren't searched. */
  unlisted: VenueProvider[]
}

/** The booking sites that apply to a place, for its kind. */
export function venueProvidersFor(place: Place | null): VenueProvider[] {
  const kind = bookingKind(place?.tags)
  return kind ? [...VENUE_PROVIDERS[kind]] : []
}

/** A venue id from the place's own tagged booking page, when that page is on one of its booking sites. */
export function taggedVenue(place: Place | null): { provider: VenueProvider; id: string } | null {
  const url = place?.tags && venueBookingUrl(place.tags)
  if (!url) return null
  const provider = venueProviderOf(url.toString())
  if (!provider || !venueProvidersFor(place).includes(provider)) return null
  const id = parseVenueUrl(provider, url.toString())
  return id ? { provider, id } : null
}

export function bookingVenues(providers: VenueProvider[], stored: ProviderMatches): BookingVenues {
  const result: BookingVenues = { venues: {}, unlisted: [] }
  for (const provider of providers) {
    const match = stored[provider]
    if (match?.providerPlaceId) result.venues[provider] = match.providerPlaceId
    else if (match?.confirmed) result.unlisted.push(provider)
  }
  return result
}

/**
 * The place's venue on each booking site it can be booked on. A booking page
 * tagged on the place fills its site in once, unconfirmed, so a person can still correct it.
 */
export async function getBookingVenues(source: Source, placeId: string): Promise<BookingVenues> {
  const [place, stored] = await Promise.all([
    lookupPlaceById(source, placeId),
    getProviderMatches(source, placeId),
  ])
  const tagged = taggedVenue(place)
  if (tagged && !stored[tagged.provider]) {
    stored[tagged.provider] = { providerPlaceId: tagged.id, confirmed: false }
    await setProviderMatch(source, placeId, tagged.provider, stored[tagged.provider]).catch((error) =>
      logWarn('Could not save tagged booking venue', error),
    )
  }
  return bookingVenues(venueProvidersFor(place), stored)
}
