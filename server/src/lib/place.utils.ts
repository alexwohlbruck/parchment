import { getLanguageCode, type Language } from './i18n'
import {
  getPlaceType as getOSMPlaceType,
  type GeometryType,
} from './osm-presets'

export function getPlaceType(
  tags: Record<string, string>,
  language: Language = 'en-US',
  geometry: GeometryType = 'point',
): string {
  return getOSMPlaceType(tags, language, geometry)
}

/**
 * The place's name in `language`, from OSM's `name:<code>` tags.
 *
 * English is deliberately left alone: `name` is the on-the-ground name, which
 * is the convention mappers actually maintain, while `name:en` is often absent
 * or a worse transliteration. For other languages `name:<code>` is the only
 * translation available, so it wins when present — "Hudson River" becomes
 * "Río Hudson", but a place with no Spanish tag keeps its local name.
 */
export function getLocalizedName(
  tags: Record<string, string> | null | undefined,
  language: Language = 'en-US',
  fallback?: string | null,
): string | undefined {
  const code = getLanguageCode(language)
  const localized = code !== 'en' ? tags?.[`name:${code}`]?.trim() : undefined
  return localized || fallback?.trim() || tags?.name?.trim() || undefined
}

export function getWheelchairAccess(
  tags: Record<string, string | undefined>,
): string {
  const wheelchair = tags?.wheelchair || 'unknown'
  switch (wheelchair) {
    case 'yes':
      return 'Wheelchair accessible'
    case 'no':
      return 'Not wheelchair accessible'
    case 'limited':
      return 'Limited wheelchair accessibility'
    case 'designated':
      return 'Designated wheelchair access'
    default:
      return 'Unknown wheelchair accessibility'
  }
}

export function getSmokingStatus(
  tags: Record<string, string | undefined>,
): string {
  const smoking = tags?.smoking || 'unknown'
  switch (smoking) {
    case 'yes':
      return 'Smoking allowed'
    case 'no':
      return 'No smoking'
    case 'separated':
      return 'Separate smoking area'
    case 'isolated':
      return 'Isolated smoking area'
    case 'outside':
      return 'Smoking allowed outside'
    case 'dedicated':
      return 'Dedicated smoking area'
    default:
      return 'Unknown smoking policy'
  }
}

export function getRestroomAccess(
  tags: Record<string, string | undefined>,
): string {
  const toilets = tags?.toilets || 'unknown'
  switch (toilets) {
    case 'yes':
      return 'Restrooms available'
    case 'no':
      return 'No restrooms'
    case 'customers':
      return 'Restrooms for customers only'
    default:
      return 'Unknown restroom availability'
  }
}

export function formatAddress(
  tags: Record<string, string | undefined>,
): string {
  if (!tags) return ''

  const parts = [
    `${tags['addr:housenumber'] || ''} ${tags['addr:street'] || ''}`.trim(),
    `${tags['addr:city'] || ''}${
      tags['addr:city'] && tags['addr:state'] ? ',' : ''
    } ${tags['addr:state'] || ''} ${tags['addr:postcode'] || ''}`.trim(),
    tags['addr:country'],
  ].filter(Boolean)

  return parts.join('\n')
}

export function parseCuisines(cuisine: string | undefined): string[] | null {
  if (!cuisine) return null
  return cuisine
    .split(';')
    .map((c) => c.trim().replace(/_/g, ' '))
    .map((c) => c.charAt(0).toUpperCase() + c.slice(1))
}

export function getWifiStatus(tags: Record<string, string | undefined>) {
  const access = tags.internet_access
  const ssid = tags['internet_access:ssid']
  const fee = tags['internet_access:fee']
  const password = tags['internet_access:password']

  if (!access || access === 'no') return null

  let label = 'WiFi available'
  if (access === 'free' || fee === 'no') {
    label = 'Free WiFi available'
  } else if (access === 'customers') {
    label = 'WiFi for customers'
  } else if (fee === 'yes') {
    label = 'Paid WiFi available'
  }

  return { label, ssid, password }
}

export function hasOutdoorSeating(
  tags: Record<string, string | undefined>,
): boolean {
  return tags.outdoor_seating === 'yes'
}
