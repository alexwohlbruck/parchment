import type { Address } from '@/types/place.types'

/** The `addr:*` tags a geocoder result implies, ready to merge into a feature. */
export function addressToTags(
  address: Address | null | undefined,
): Record<string, string> {
  if (!address) return {}

  const tags: Record<string, string> = {}
  const { housenumber, street } = splitStreetLine(address.street1)
  if (housenumber) tags['addr:housenumber'] = housenumber
  if (street) tags['addr:street'] = street
  if (address.locality) tags['addr:city'] = address.locality
  if (address.region) tags['addr:state'] = address.region
  if (address.postalCode) tags['addr:postcode'] = address.postalCode
  if (address.countryCode) tags['addr:country'] = address.countryCode.toUpperCase()
  return tags
}

/**
 * A one-line label for an address suggestion. Our geocoder leaves `formatted`
 * empty for some providers, which would render the suggestion list blank.
 */
export function formatAddressLine(address: Address | null | undefined): string {
  if (!address) return ''
  if (address.formatted) return address.formatted
  return [
    address.street1,
    address.locality,
    [address.region, address.postalCode].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ')
}

/**
 * Split "155 New Bern St" into its house number and street, which OSM tags
 * separately but most geocoders return as one line. A line that doesn't start
 * with a number is all street — "Unter den Linden" keeps its name.
 */
export function splitStreetLine(line: string | undefined): {
  housenumber?: string
  street?: string
} {
  const trimmed = line?.trim()
  if (!trimmed) return {}

  const match = trimmed.match(/^(\d+[a-zA-Z]?(?:[-/]\d+[a-zA-Z]?)?)\s+(.+)$/)
  if (match) return { housenumber: match[1], street: match[2] }
  return { street: trimmed }
}
