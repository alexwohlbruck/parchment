import type { Source } from '../../lib/constants'
import { bookingKind, venueBookingUrl } from '../../lib/place/booking-kind'
import {
  VENUE_PROVIDERS,
  WIKIDATA_VENUE_PROPERTY_IDS,
  parseVenueUrl,
  venueProviderOf,
  venuesFromWikidata,
  venueUpserts,
  type VenueIds,
  type VenueProvider,
} from '../../lib/place/booking-venues'
import { fetchWikidataClaims } from '../wikidata.service'
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

const WIKIDATA_TTL_MS = 24 * 60 * 60 * 1000
const wikidataVenues = new Map<string, { venues: VenueIds; at: number }>()

/** Booking-site ids on the place's Wikidata item, for lodging. Kept for a day; a failed fetch isn't. */
async function venuesFromWikidataItem(place: Place | null): Promise<VenueIds> {
  const qid = place?.tags?.wikidata?.trim()
  if (!qid || bookingKind(place?.tags) !== 'stay') return {}
  const cached = wikidataVenues.get(qid)
  if (cached && Date.now() - cached.at < WIKIDATA_TTL_MS) return cached.venues
  const claims = await fetchWikidataClaims(qid, WIKIDATA_VENUE_PROPERTY_IDS)
  if (!claims) return {}
  const venues = venuesFromWikidata(claims)
  wikidataVenues.set(qid, { venues, at: Date.now() })
  return venues
}

/**
 * The place's venue on each booking site it can be booked on. Open data
 * seeds the store, unconfirmed so a person can still correct it: a booking
 * page tagged on the place outranks Wikidata, and both outrank what
 * Foursquare's links stored. A person's confirmed choice is never replaced.
 */
export async function getBookingVenues(source: Source, placeId: string): Promise<BookingVenues> {
  const [place, stored] = await Promise.all([
    lookupPlaceById(source, placeId),
    getProviderMatches(source, placeId),
  ])
  const providers = venueProvidersFor(place)
  const tagged = taggedVenue(place)
  const found: VenueIds = { ...(await venuesFromWikidataItem(place)), ...(tagged && { [tagged.provider]: tagged.id }) }
  const upserts = venueUpserts(
    stored,
    Object.fromEntries(Object.entries(found).filter(([provider]) => providers.includes(provider as VenueProvider))),
  )
  await Promise.all(
    Object.entries(upserts).map(([provider, providerPlaceId]) => {
      stored[provider] = { providerPlaceId, confirmed: false }
      return setProviderMatch(source, placeId, provider, stored[provider]).catch((error) =>
        logWarn('Could not save booking venue', error),
      )
    }),
  )
  return bookingVenues(providers, stored)
}

export function resetBookingVenuesForTests(): void {
  wikidataVenues.clear()
}
