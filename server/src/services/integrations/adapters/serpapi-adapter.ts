import type { HotelCandidate, StayMoney, StayOffer } from '../../../types/integration.types'

interface SerpRate {
  extracted_lowest?: number
  extracted_before_taxes_fees?: number
  extracted_after_taxes_fees?: number
}

export interface SerpPrice {
  source?: string
  link?: string
  logo?: string | null
  official?: boolean
  rate_per_night?: SerpRate
  total_rate?: SerpRate
  free_cancellation?: boolean
}

export interface SerpProperty {
  type?: string
  name?: string
  property_token?: string
  address?: string
  gps_coordinates?: { latitude?: number; longitude?: number }
  featured_prices?: SerpPrice[]
  prices?: SerpPrice[]
}

export interface SerpHotelsResponse extends SerpProperty {
  error?: string
  properties?: SerpProperty[]
}

function money(amount: number | undefined, currency: string): StayMoney | null {
  return amount != null && Number.isFinite(amount) && amount > 0 ? { amount, currency } : null
}

function httpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

/** The seller's own page from a Google Hotels click link, which carries it in `pcurl`. */
export function sellerUrl(link: string | undefined): string | null {
  const url = httpUrl(link)
  if (!url) return null
  const pcurl = new URL(url).searchParams.get('pcurl')
  return pcurl ? httpUrl(pcurl) : url
}

function offer(price: SerpPrice, currency: string, featured: boolean, url: string): StayOffer {
  return {
    seller: price.source!.trim(),
    logo: httpUrl(price.logo),
    official: !!price.official,
    featured,
    bookHere: false,
    nightly: money(price.rate_per_night?.extracted_before_taxes_fees ?? price.rate_per_night?.extracted_lowest, currency),
    total: money(price.total_rate?.extracted_after_taxes_fees ?? price.total_rate?.extracted_lowest, currency),
    freeCancellation: !!price.free_cancellation,
    url,
  }
}

/**
 * One offer per seller, featured sellers first. A featured seller links to
 * its own page when it also appears among the plain prices, and to Google's
 * ad link otherwise.
 */
export function adaptSerpOffers(property: SerpProperty, currency: string): StayOffer[] {
  const plain = new Map<string, SerpPrice>()
  for (const price of property.prices ?? []) {
    const key = price.source?.trim().toLowerCase()
    if (key && !plain.has(key)) plain.set(key, price)
  }

  const offers = new Map<string, StayOffer>()
  for (const price of property.featured_prices ?? []) {
    const key = price.source?.trim().toLowerCase()
    if (!key || offers.has(key)) continue
    const twin = plain.get(key)
    const url = sellerUrl(twin?.link) ?? httpUrl(price.link)
    if (!url) continue
    const featured = offer(price, currency, true, url)
    featured.freeCancellation ||= !!twin?.free_cancellation
    offers.set(key, featured)
  }
  for (const [key, price] of plain) {
    if (offers.has(key)) continue
    const url = sellerUrl(price.link)
    if (url) offers.set(key, offer(price, currency, false, url))
  }
  return [...offers.values()]
}

export function adaptSerpCandidate(property: SerpProperty): HotelCandidate | null {
  const { property_token: id, name, gps_coordinates: gps } = property
  if (!id || !name || gps?.latitude == null || gps?.longitude == null) return null
  return { id, name, lat: gps.latitude, lng: gps.longitude, address: property.address ?? null }
}
