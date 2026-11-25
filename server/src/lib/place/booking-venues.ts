import type { BookingKind } from './booking-kind'
import type { ProviderMatches } from './provider-matches'
import type { PlaceAction } from '../../types/place.types'

/** Booking sites a place's own venue page can be stored for, by match-store provider key. */
export type VenueProvider = 'opentable' | 'resy' | 'tock' | 'sevenrooms' | 'bookingcom' | 'expedia' | 'hotelscom'

export const VENUE_PROVIDERS: Readonly<Record<BookingKind, readonly VenueProvider[]>> = {
  table: ['opentable', 'resy', 'tock', 'sevenrooms'],
  stay: ['bookingcom', 'expedia', 'hotelscom'],
  ahead: [],
}

/** The sites offered for correction on every place of a kind; the rest show once a venue is known there. */
export const LISTED_VENUE_PROVIDERS: Readonly<Record<BookingKind, readonly VenueProvider[]>> = {
  table: ['opentable', 'resy'],
  stay: ['bookingcom', 'expedia'],
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
  tock: new RegExp(`^${SLUG}$`),
  sevenrooms: new RegExp(`^${SLUG}$`),
  bookingcom: new RegExp(`^[a-z]{2}/${SLUG}$`),
  expedia: /^[1-9]\d*$/,
  hotelscom: /^[1-9]\d*$/,
}

const HOSTS: Record<VenueProvider, RegExp> = {
  opentable: /(^|\.)opentable\.[a-z.]+$/,
  resy: /(^|\.)resy\.com$/,
  tock: /(^|\.)exploretock\.com$/,
  sevenrooms: /(^|\.)sevenrooms\.com$/,
  bookingcom: /(^|\.)booking\.com$/,
  expedia: /(^|\.)expedia\.[a-z.]+$/,
  hotelscom: /(^|\.)hotels\.com$/,
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
    case 'tock':
      return /^\/([^/]+)/.exec(path)?.[1] ?? null
    case 'sevenrooms':
      return /^\/(?:reservations|explore)\/([^/]+)/.exec(path)?.[1] ?? null
    case 'bookingcom': {
      const match = /^\/hotel\/([a-z]{2})\/([^/.]+)(?:\.[a-z-]+)?\.html$/.exec(path)
      return match ? `${match[1]}/${match[2]}` : null
    }
    case 'expedia':
      return /(?:^|[/.])h(\d+)\.hotel-information$/.exec(path)?.[1] ?? url.searchParams.get('hotelId')
    case 'hotelscom':
      return /^\/ho(\d+)(?:\/|$)/.exec(path)?.[1] ?? null
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
    case 'tock':
      url = new URL(`https://www.exploretock.com/${id}`)
      if (plan) {
        url.pathname += '/search'
        url.searchParams.set('date', plan.day)
        url.searchParams.set('size', String(plan.party))
        url.searchParams.set('time', plan.tableTime.slice(11))
      }
      break
    case 'sevenrooms':
      url = new URL(`https://www.sevenrooms.com/reservations/${id}`)
      if (plan) {
        url.searchParams.set('date', plan.day)
        url.searchParams.set('party_size', String(plan.party))
      }
      break
    case 'bookingcom':
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
    case 'hotelscom':
      url = new URL(`https://www.hotels.com/ho${id}/`)
      if (plan) {
        url.searchParams.set('chkin', plan.day)
        url.searchParams.set('chkout', plan.checkout)
        url.searchParams.set('rm1', `a${plan.party}`)
      }
      break
  }
  return url.toString()
}

export type VenueIds = Partial<Record<VenueProvider, string>>

/** Venues on known booking sites among a place's reservation links, the first per site. */
export function venuesFromActions(actions: PlaceAction[] | undefined): VenueIds {
  const venues: VenueIds = {}
  for (const action of actions ?? []) {
    if (action.kind !== 'reservation') continue
    const provider = venueProviderOf(action.url)
    if (!provider || venues[provider]) continue
    const id = parseVenueUrl(provider, action.url)
    if (id) venues[provider] = id
  }
  return venues
}

/**
 * Venues worth storing, never over a person's confirmed choice. A source that
 * outranks what is stored replaces it; a lower one only fills sites with nothing stored.
 */
export function venueUpserts(stored: ProviderMatches, found: VenueIds, { replace = true } = {}): VenueIds {
  const upserts: VenueIds = {}
  for (const [provider, id] of Object.entries(found) as [VenueProvider, string][]) {
    const current = stored[provider]
    if (current?.confirmed || current?.providerPlaceId === id || (current && !replace)) continue
    upserts[provider] = id
  }
  return upserts
}

/** Wikidata properties holding a hotel's id on booking sites, and how each becomes our venue id. */
const WIKIDATA_VENUE_PROPERTIES: [string, VenueProvider, (value: string) => string | null][] = [
  ['P3607', 'bookingcom', (v) => v.replace(/^\/+|\.html$/g, '').toLowerCase()],
  ['P5651', 'expedia', (v) => /^h?(\d+)$/i.exec(v)?.[1] ?? null],
  ['P3898', 'hotelscom', (v) => /^(?:ho)?(\d+)$/i.exec(v)?.[1] ?? null],
]

export const WIKIDATA_VENUE_PROPERTY_IDS = WIKIDATA_VENUE_PROPERTIES.map(([property]) => property)

type WikidataClaims = Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[] | undefined>

/** Booking-site venues from a Wikidata item's claims. Legacy numeric Booking.com ids can't be linked, so they're skipped. */
export function venuesFromWikidata(claims: WikidataClaims | null | undefined): VenueIds {
  const venues: VenueIds = {}
  for (const [property, provider, toId] of WIKIDATA_VENUE_PROPERTIES) {
    for (const claim of claims?.[property] ?? []) {
      const value = claim.mainsnak?.datavalue?.value
      const id = typeof value === 'string' ? toId(value.trim()) : null
      if (id && isVenueId(provider, id)) {
        venues[provider] = id
        break
      }
    }
  }
  return venues
}
