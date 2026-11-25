import {
  bookingKind,
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

export {
  bookingKind,
  isDiningPlace,
  isLodgingPlace,
  reservationPolicy,
  type BookingKind,
  type ReservationPolicy,
} from '@server/lib/place/booking-kind'

export type BookingProvider = VenueProvider | 'venue' | 'googleHotels' | 'search'

export interface BookingLink {
  provider: BookingProvider
  url: string
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

/** A booking page: on a known site it's that site's venue page, prefilled; anywhere else it's the venue's own. */
function directLink(raw: string, target: BookingTarget): BookingLink {
  const provider = venueProviderOf(raw)
  const id = provider && parseVenueUrl(provider, raw)
  const url = provider && id ? venuePageUrl(provider, id, target.plan) : null
  return { provider: provider ?? 'venue', url: url ?? raw }
}

/**
 * Ways to book a place, best first: its own pages on booking sites, then
 * searches on the sites where none is known. A web search is only offered
 * when nothing direct is. Empty when it can't be booked.
 */
export function bookingLinks(target: BookingTarget): BookingLink[] {
  const kind = bookingKind(target.tags)
  if (!kind || !target.name.trim()) return []

  const links: BookingLink[] = []
  const add = (link: BookingLink | null) => {
    if (link && !links.some(l => l.provider === link.provider)) links.push(link)
  }

  for (const provider of VENUE_PROVIDERS[kind]) {
    const id = target.venues?.[provider]
    const url = id ? venuePageUrl(provider, id, target.plan) : null
    if (url) add({ provider, url })
  }
  const reservations = (target.actions ?? []).filter(a => a.kind === 'reservation').map(a => a.url)
  const tagged = venueBookingUrl(target.tags)?.toString()
  for (const raw of tagged ? [...reservations, tagged] : reservations) add(directLink(raw, target))

  const direct = links.length > 0
  for (const [provider, search] of SEARCHES[kind]) {
    if (provider === 'search' && direct) continue
    if (target.unlisted?.includes(provider as VenueProvider) || links.some(l => l.provider === provider)) continue
    const url = search(target)
    if (url) add({ provider, url })
  }
  return links
}

const DELIVERY_NAMES: [RegExp, string][] = [
  [/(^|\.)ubereats\.com$/, 'Uber Eats'],
  [/(^|\.)doordash\.com$/, 'DoorDash'],
  [/(^|\.)grubhub\.com$/, 'Grubhub'],
  [/(^|\.)seamless\.com$/, 'Seamless'],
  [/(^|\.)postmates\.com$/, 'Postmates'],
  [/(^|\.)deliveroo\.[a-z.]+$/, 'Deliveroo'],
  [/(^|\.)just-eat\.[a-z.]+$/, 'Just Eat'],
]

export interface DeliveryLink {
  name: string
  url: string
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
    const name = DELIVERY_NAMES.find(([pattern]) => pattern.test(host))?.[1] ?? host.replace(/^www\./, '')
    if (!links.some(l => l.name === name)) links.push({ name, url: action.url })
  }
  return links
}
