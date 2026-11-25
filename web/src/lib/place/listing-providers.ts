import { capitalize } from '@/lib/string'

const PROVIDER_NAMES: Record<string, string> = {
  google: 'Google',
  foursquare: 'Foursquare',
  opentable: 'OpenTable',
  resy: 'Resy',
  yelp: 'Yelp',
  tripadvisor: 'Tripadvisor',
  booking: 'Booking.com',
  expedia: 'Expedia',
  liteapi: 'LiteAPI',
}

/** Brand name for a listing provider key; unknown providers read as their capitalised key. */
export function listingProviderName(provider: string): string {
  return PROVIDER_NAMES[provider] ?? capitalize(provider)
}

/** The OSM id the listing store keys a place by, or null when it can't hold listings for it. */
export function listingPlaceId(externalIds: Record<string, string> | undefined): string | null {
  const id = externalIds?.osm
  return id && /^(node|way|relation)\/[1-9]\d*$/.test(id) ? id : null
}
