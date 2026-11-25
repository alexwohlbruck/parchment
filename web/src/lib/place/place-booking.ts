export type ReservationPolicy = 'yes' | 'recommended' | 'required'

export type BookingProvider = 'venue' | 'opentable' | 'resy' | 'search'

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
}

const POLICIES: ReservationPolicy[] = ['yes', 'recommended', 'required']

const VENUE_URL_KEYS = [
  'reservation:website',
  'website:reservation',
  'website:reservations',
  'website:booking',
]

const DINING_AMENITIES = new Set(['restaurant', 'cafe', 'bar', 'pub', 'biergarten', 'food_court'])

const US_STATES = new Set(
  ('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM ' +
    'NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY').split(' '),
)

const PROVIDER_HOSTS: Record<'opentable' | 'resy', RegExp> = {
  opentable: /(^|\.)opentable\.[a-z.]+$/,
  resy: /(^|\.)resy\.com$/,
}

export function reservationPolicy(
  tags: Record<string, string | undefined> | null | undefined,
): ReservationPolicy | null {
  const value = (tags?.reservation ?? tags?.reservations)?.trim().toLowerCase()
  return POLICIES.find(p => p === value) ?? null
}

export function isDiningPlace(tags: Record<string, string | undefined>): boolean {
  return DINING_AMENITIES.has(tags.amenity ?? '') || tags.cuisine !== undefined
}

function venueBookingUrl(tags: BookingTarget['tags']): URL | null {
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

function providerOf(url: URL): BookingProvider {
  const host = url.hostname.toLowerCase()
  if (PROVIDER_HOSTS.opentable.test(host)) return 'opentable'
  if (PROVIDER_HOSTS.resy.test(host)) return 'resy'
  return 'venue'
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
  return url.toString()
}

export function webSearchUrl(target: BookingTarget): string {
  const terms = [target.name, target.locality, 'reservations'].filter(Boolean).join(' ')
  const url = new URL('https://www.google.com/search')
  url.searchParams.set('q', terms)
  return url.toString()
}

/** Ways to book a place that takes reservations, best first. Empty when it doesn't. */
export function bookingLinks(target: BookingTarget): BookingLink[] {
  if (!reservationPolicy(target.tags) || !target.name.trim()) return []

  const links: BookingLink[] = []
  const venue = venueBookingUrl(target.tags)
  if (venue) links.push({ provider: providerOf(venue), url: venue.toString() })

  const has = (provider: BookingProvider) => links.some(l => l.provider === provider)

  if (isDiningPlace(target.tags)) {
    if (!has('opentable')) links.push({ provider: 'opentable', url: openTableSearchUrl(target) })
    const resy = has('resy') ? null : resySearchUrl(target)
    if (resy) links.push({ provider: 'resy', url: resy })
  }

  links.push({ provider: 'search', url: webSearchUrl(target) })
  return links
}
