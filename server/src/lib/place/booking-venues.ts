import type { BookingKind } from './booking-kind'

/** Booking sites a place's own venue page can be stored for, by match-store provider key. */
export type VenueProvider = 'opentable' | 'resy' | 'booking' | 'expedia'

export const VENUE_PROVIDERS: Readonly<Record<BookingKind, readonly VenueProvider[]>> = {
  table: ['opentable', 'resy'],
  stay: ['booking', 'expedia'],
  ahead: [],
}

export interface VenuePlan {
  party: number
  /** YYYY-MM-DD */
  day: string
  /** YYYY-MM-DD, for stays. */
  checkout: string
  /** YYYY-MM-DDTHH:mm, for tables. */
  tableTime: string
}

const SLUG = '[a-z0-9][a-z0-9-]*'

/** Ids are host-free paths, so a stored id can only ever build a link back to that provider. */
const ID_PATTERNS: Record<VenueProvider, RegExp> = {
  opentable: new RegExp(`^(r/${SLUG}|rid/[1-9]\\d*)$`),
  resy: new RegExp(`^${SLUG}/${SLUG}$`),
  booking: new RegExp(`^[a-z]{2}/${SLUG}$`),
  expedia: /^[1-9]\d*$/,
}

const HOSTS: Record<VenueProvider, RegExp> = {
  opentable: /(^|\.)opentable\.[a-z.]+$/,
  resy: /(^|\.)resy\.com$/,
  booking: /(^|\.)booking\.com$/,
  expedia: /(^|\.)expedia\.[a-z.]+$/,
}

export function isVenueProvider(provider: string): provider is VenueProvider {
  return provider in ID_PATTERNS
}

export function isVenueId(provider: VenueProvider, id: string): boolean {
  return ID_PATTERNS[provider].test(id)
}

function toUrl(raw: string): URL | null {
  try {
    const url = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
  } catch {
    return null
  }
}

/** Which booking site a URL is on. */
export function venueProviderOf(raw: string): VenueProvider | null {
  const host = toUrl(raw)?.hostname.toLowerCase()
  if (!host) return null
  return (Object.keys(HOSTS) as VenueProvider[]).find((p) => HOSTS[p].test(host)) ?? null
}

function idFrom(provider: VenueProvider, url: URL): string | null {
  const path = url.pathname.toLowerCase().replace(/\/+$/, '')
  switch (provider) {
    case 'opentable': {
      const rid = url.searchParams.get('rid') ?? /\/restaurant\/profile\/(\d+)/.exec(path)?.[1]
      if (rid) return `rid/${rid}`
      const slug = /^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/r\/([^/]+)$/.exec(path)?.[1]
      return slug ? `r/${slug}` : null
    }
    case 'resy': {
      const match = /^\/cities\/([^/]+)\/(?:venues\/)?([^/]+)$/.exec(path)
      return match && match[2] !== 'search' ? `${match[1]}/${match[2]}` : null
    }
    case 'booking': {
      const match = /^\/hotel\/([a-z]{2})\/([^/.]+)(?:\.[a-z-]+)?\.html$/.exec(path)
      return match ? `${match[1]}/${match[2]}` : null
    }
    case 'expedia':
      return /\.h(\d+)\.hotel-information$/.exec(path)?.[1] ?? url.searchParams.get('hotelId')
  }
}

/** The venue id in a page URL from that booking site, or null when it isn't a venue page there. */
export function parseVenueUrl(provider: VenueProvider, raw: string): string | null {
  const url = toUrl(raw)
  if (!url || venueProviderOf(raw) !== provider) return null
  const id = idFrom(provider, url)
  return id && isVenueId(provider, id) ? id : null
}

/** The venue's own page, with the party and dates filled in when given. */
export function venuePageUrl(provider: VenueProvider, id: string, plan?: VenuePlan): string | null {
  if (!isVenueId(provider, id)) return null
  let url: URL
  switch (provider) {
    case 'opentable': {
      const [kind, value] = id.split('/')
      url = kind === 'rid'
        ? new URL(`https://www.opentable.com/restref/client/?rid=${value}`)
        : new URL(`https://www.opentable.com/r/${value}`)
      if (plan) {
        url.searchParams.set('covers', String(plan.party))
        url.searchParams.set('dateTime', plan.tableTime)
      }
      break
    }
    case 'resy': {
      const [city, venue] = id.split('/')
      url = new URL(`https://resy.com/cities/${city}/venues/${venue}`)
      if (plan) {
        url.searchParams.set('date', plan.day)
        url.searchParams.set('seats', String(plan.party))
      }
      break
    }
    case 'booking':
      url = new URL(`https://www.booking.com/hotel/${id}.html`)
      if (plan) {
        url.searchParams.set('checkin', plan.day)
        url.searchParams.set('checkout', plan.checkout)
        url.searchParams.set('group_adults', String(plan.party))
        url.searchParams.set('no_rooms', '1')
      }
      break
    case 'expedia':
      url = new URL(`https://www.expedia.com/h${id}.Hotel-Information`)
      if (plan) {
        url.searchParams.set('chkin', plan.day)
        url.searchParams.set('chkout', plan.checkout)
        url.searchParams.set('rm1', `a${plan.party}`)
      }
      break
  }
  return url.toString()
}
