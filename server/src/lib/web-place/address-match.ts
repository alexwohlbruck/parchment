import { normalizeStreetName } from '../address-text'
import { BUSINESS_KEYS } from './preset-schema'
import { splitStreet } from './osm-tags'

const VACANT = new Set(['vacant', 'no'])
/** A former tenant's tags, which go once a new business takes the address. */
const FORMER_TENANT =
  /^(?:(?:disused|abandoned|was|removed|demolished|razed|closed):|old_|name(?::|$)|opening_hours|phone$|mobile$|fax$|email$|website$|url$|contact:|cuisine$|brand(?::|$)|operator(?::|$)|check_date|description$|payment:|diet:|takeaway$|delivery$|outdoor_seating$|drive_through$|internet_access)/

/** An address on the map with no business there now: a plain address point, or a closed business's. */
export function isVacantAddress(tags: Record<string, string>): boolean {
  if (tags.name || tags.building || tags.entrance || tags.door) return false
  return ![...BUSINESS_KEYS].some((key) => tags[key] && !VACANT.has(tags[key]))
}

/** True when the element carries the same house number and street as the site's street line. */
export function sameAddress(tags: Record<string, string>, street: string): boolean {
  const ours = splitStreet(street.split(',')[0].trim())
  const [number, name] = [ours['addr:housenumber'], ours['addr:street']]
  if (!number || !name || !tags['addr:housenumber'] || !tags['addr:street']) return false
  return (
    tags['addr:housenumber'].trim().toLowerCase() === number.trim().toLowerCase() &&
    normalizeStreetName(tags['addr:street']) === normalizeStreetName(name)
  )
}

/** The element's tags with the former tenant's gone and the business's in, keeping the address as mapped. */
export function replacementTags(existing: Record<string, string>, business: Record<string, string>): Record<string, string> {
  const kept = Object.entries(existing).filter(([key]) => !FORMER_TENANT.test(key) && !BUSINESS_KEYS.has(key))
  const address = kept.filter(([key]) => key.startsWith('addr:'))
  return { ...Object.fromEntries(kept), ...business, ...Object.fromEntries(address) }
}

/** True when the text names the address's house number and street, as a user who gave it would. */
export function mentionsAddress(text: string, address: string): boolean {
  const ours = splitStreet(address.split(',')[0].trim())
  const [number, street] = [ours['addr:housenumber'], ours['addr:street']]
  if (!number || !street) return false
  const said = ` ${normalizeStreetName(text)} `
  return said.includes(` ${number.toLowerCase()} `) && said.includes(` ${normalizeStreetName(street)} `)
}
