import {
  bookingKind,
  venueBookingUrl,
  type BookingKind,
} from '@server/lib/place/booking-kind'

export {
  bookingKind,
  isDiningPlace,
  isLodgingPlace,
  reservationPolicy,
  type BookingKind,
  type ReservationPolicy,
} from '@server/lib/place/booking-kind'

export type BookingProvider =
  | 'venue'
  | 'opentable'
  | 'resy'
  | 'bookingCom'
  | 'expedia'
  | 'googleHotels'
  | 'search'

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
}

const US_STATES = new Set(
  ('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM ' +
    'NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY').split(' '),
)

const PROVIDER_HOSTS: [BookingProvider, RegExp][] = [
  ['opentable', /(^|\.)opentable\.[a-z.]+$/],
  ['resy', /(^|\.)resy\.com$/],
  ['bookingCom', /(^|\.)booking\.com$/],
  ['expedia', /(^|\.)expedia\.[a-z.]+$/],
]

function providerOf(url: URL): BookingProvider {
  const host = url.hostname.toLowerCase()
  return PROVIDER_HOSTS.find(([, pattern]) => pattern.test(host))?.[0] ?? 'venue'
}

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
    ['bookingCom', bookingComSearchUrl],
    ['expedia', expediaSearchUrl],
    ['googleHotels', googleHotelsSearchUrl],
  ],
  ahead: [['search', webSearchUrl]],
}

/** Ways to book a place, best first. Empty when it can't be booked. */
export function bookingLinks(target: BookingTarget): BookingLink[] {
  const kind = bookingKind(target.tags)
  if (!kind || !target.name.trim()) return []

  const links: BookingLink[] = []
  const venue = venueBookingUrl(target.tags)
  if (venue) links.push({ provider: providerOf(venue), url: venue.toString() })

  for (const [provider, search] of SEARCHES[kind]) {
    if (links.some(l => l.provider === provider)) continue
    const url = search(target)
    if (url) links.push({ provider, url })
  }
  return links
}
