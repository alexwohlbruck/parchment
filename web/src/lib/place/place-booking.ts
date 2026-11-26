import {
  bookingKind,
  isDiningPlace,
  isLodgingPlace,
  venueBookingUrl,
  type BookingKind,
} from '@server/lib/place/booking-kind'
import {
  VENUE_PROVIDERS,
  parseVenueUrl,
  venuePageUrl,
  venueProviderOf,
  type VenueIds,
  type VenueProvider,
} from '@server/lib/place/booking-venues'
import type { PlaceAction } from '@server/types/place.types'
import { BOOKING_BRANDS, bookingBrandOf, siteName, type BookingBrandKey } from './booking-brands'

export {
  bookingKind,
  isDiningPlace,
  isLodgingPlace,
  reservationPolicy,
  type BookingKind,
  type ReservationPolicy,
} from '@server/lib/place/booking-kind'

export type BookingProvider = VenueProvider | 'venue' | 'other' | 'googleHotels' | 'search'

export interface BookingLink {
  provider: BookingProvider
  url: string
  /** The site's name, for a provider we have no name for. */
  name?: string
  /** A search on the site rather than the place's own page there. */
  search?: boolean
}

export interface BookingTarget {
  name: string
  tags: Record<string, string | undefined>
  center?: { lat: number; lng: number } | null
  locality?: string
  region?: string
  countryCode?: string
  /** Prefills party size and dates on providers that take them. */
  plan?: { party: number; day: string; checkout: string; tableTime: string }
  /** The place's own pages on booking sites, from the match store. */
  venues?: VenueIds
  /** Booking sites a person said don't list the place. */
  unlisted?: VenueProvider[]
  /** Reservation and delivery pages from the place's data. */
  actions?: PlaceAction[]
  /** Overrides the kind read from tags, for a place known to be bookable some other way. */
  kind?: BookingKind | null
}

const US_STATES = new Set(
  ('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM ' +
    'NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY').split(' '),
)

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function openTableSearchUrl(target: BookingTarget): string {
  const url = new URL('https://www.opentable.com/s')
  url.searchParams.set('term', target.name)
  if (target.center) {
    url.searchParams.set('latitude', target.center.lat.toFixed(5))
    url.searchParams.set('longitude', target.center.lng.toFixed(5))
  }
  if (target.plan) {
    url.searchParams.set('covers', String(target.plan.party))
    url.searchParams.set('dateTime', target.plan.tableTime)
  }
  return url.toString()
}

function isInUS(target: BookingTarget): boolean {
  const country = target.countryCode ?? target.tags['addr:country']
  if (country) return country.trim().toUpperCase() === 'US'
  return (target.center?.lng ?? 0) < -50
}

/** Resy addresses its markets as `<city>-<state>`, so a search needs a US city and state code. */
export function resySearchUrl(target: BookingTarget): string | null {
  const state = (target.region ?? target.tags['addr:state'])?.trim().toUpperCase() ?? ''
  const city = slugify(target.locality ?? target.tags['addr:city'] ?? '')
  if (!US_STATES.has(state) || !city || !isInUS(target)) return null
  const url = new URL(`https://resy.com/cities/${city}-${state.toLowerCase()}/search`)
  url.searchParams.set('query', target.name)
  if (target.plan) {
    url.searchParams.set('date', target.plan.day)
    url.searchParams.set('seats', String(target.plan.party))
  }
  return url.toString()
}

function stayQuery(target: BookingTarget): string {
  return [target.name, target.locality].filter(Boolean).join(', ')
}

export function bookingComSearchUrl(target: BookingTarget): string {
  const url = new URL('https://www.booking.com/searchresults.html')
  url.searchParams.set('ss', stayQuery(target))
  if (target.plan) {
    url.searchParams.set('checkin', target.plan.day)
    url.searchParams.set('checkout', target.plan.checkout)
    url.searchParams.set('group_adults', String(target.plan.party))
    url.searchParams.set('no_rooms', '1')
  }
  return url.toString()
}

export function expediaSearchUrl(target: BookingTarget): string {
  const url = new URL('https://www.expedia.com/Hotel-Search')
  url.searchParams.set('destination', stayQuery(target))
  if (target.plan) {
    url.searchParams.set('startDate', target.plan.day)
    url.searchParams.set('endDate', target.plan.checkout)
    url.searchParams.set('adults', String(target.plan.party))
  }
  return url.toString()
}

export function googleHotelsSearchUrl(target: BookingTarget): string {
  const url = new URL('https://www.google.com/travel/search')
  url.searchParams.set('q', stayQuery(target))
  return url.toString()
}

export function webSearchUrl(target: BookingTarget): string {
  const terms = [target.name, target.locality, 'reservations'].filter(Boolean).join(' ')
  const url = new URL('https://www.google.com/search')
  url.searchParams.set('q', terms)
  return url.toString()
}

const SEARCHES: Record<BookingKind, [BookingProvider, (target: BookingTarget) => string | null][]> = {
  table: [
    ['opentable', openTableSearchUrl],
    ['resy', resySearchUrl],
    ['search', webSearchUrl],
  ],
  stay: [
    ['bookingcom', bookingComSearchUrl],
    ['expedia', expediaSearchUrl],
    ['googleHotels', googleHotelsSearchUrl],
  ],
  ahead: [['search', webSearchUrl]],
}

/**
 * A booking page: on a known site it's that site's venue page, prefilled. On
 * any other site, the place's own tagged page is "their website", and a link
 * from elsewhere is named after its site.
 */
function directLink(raw: string, target: BookingTarget, own: boolean): BookingLink {
  const provider = venueProviderOf(raw)
  const id = provider && parseVenueUrl(provider, raw)
  const url = provider && id ? venuePageUrl(provider, id, target.plan) : null
  if (provider) return { provider, url: url ?? raw }
  if (own) return { provider: 'venue', url: raw }
  const brand = bookingBrandOf(raw)
  return { provider: 'other', url: raw, name: brand ? BOOKING_BRANDS[brand].name : siteName(raw) }
}

/**
 * Ways to book a place, best first. Its own pages on booking sites when any
 * is known; otherwise searches, so a search never sits beside a real page and
 * passes for one. Empty when it can't be booked.
 */
export function bookingLinks(target: BookingTarget): BookingLink[] {
  const kind = target.kind ?? bookingKind(target.tags)
  if (!kind || !target.name.trim()) return []

  const links: BookingLink[] = []
  const add = (link: BookingLink | null) => {
    if (link && !links.some(l => l.provider === link.provider && l.name === link.name)) links.push(link)
  }

  for (const provider of VENUE_PROVIDERS[kind]) {
    const id = target.venues?.[provider]
    const url = id ? venuePageUrl(provider, id, target.plan) : null
    if (url) add({ provider, url })
  }
  const tagged = venueBookingUrl(target.tags)?.toString()
  if (tagged) add(directLink(tagged, target, true))
  for (const action of target.actions ?? []) {
    if (action.kind === 'reservation') add(directLink(action.url, target, false))
  }

  if (links.length) return links

  for (const [provider, search] of SEARCHES[kind]) {
    if (target.unlisted?.includes(provider as VenueProvider)) continue
    const url = search(target)
    if (url) add({ provider, url, search: true })
  }
  return links
}

export interface DeliveryLink {
  name: string
  url: string
  brand?: BookingBrandKey
}

/** Where to order delivery from the place, one link per service. */
export function deliveryLinks(actions: PlaceAction[] | undefined): DeliveryLink[] {
  const links: DeliveryLink[] = []
  for (const action of actions ?? []) {
    if (action.kind !== 'delivery') continue
    let host: string
    try {
      host = new URL(action.url).hostname.toLowerCase()
    } catch {
      continue
    }
    const brand = bookingBrandOf(action.url)
    const name = brand ? BOOKING_BRANDS[brand].name : host.replace(/^www\./, '')
    if (!links.some(l => l.name === name)) links.push({ name, url: action.url, ...(brand && { brand }) })
  }
  return links
}

/**
 * What booking a place means: from its tags, or, for a restaurant or lodging
 * whose tags don't say, from a booking page known for it elsewhere.
 */
export function effectiveBookingKind(
  tags: Record<string, string | undefined>,
  knownElsewhere: boolean,
): BookingKind | null {
  const kind = bookingKind(tags)
  if (kind || !knownElsewhere || tags.reservation === 'no') return kind
  if (isLodgingPlace(tags)) return 'stay'
  return isDiningPlace(tags) ? 'table' : null
}
