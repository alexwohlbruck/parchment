/** A business as a website describes itself in schema.org JSON-LD. */
export interface SiteBusiness {
  name: string
  types: string[]
  address?: {
    street?: string
    locality?: string
    region?: string
    postalCode?: string
    country?: string
  }
  geo?: { lat: number; lng: number }
  phone?: string
  email?: string
  /** OSM opening_hours syntax. */
  openingHours?: string
  cuisine?: string[]
  closed?: boolean
  /** The iD preset a model picked for it, when its JSON-LD names no type. */
  preset?: string
  /** Further tags read off its pages that the preset's schema allows. */
  tags?: Record<string, string>
  /** Where the address came from when its pages' text doesn't give one. */
  addressFrom?: 'image' | 'you'
  /** One location's own name, when the site lists several. */
  branch?: string
  /** Its pages say it hasn't opened yet. */
  opensSoon?: boolean
}

type Json = Record<string, any>

const NOT_A_BUSINESS = new Set([
  'WebSite',
  'WebPage',
  'BreadcrumbList',
  'ImageObject',
  'SiteNavigationElement',
  'Person',
  'Article',
  'BlogPosting',
  'Product',
  'Offer',
  'Event',
  'FAQPage',
  'SearchAction',
])

const SCRIPT =
  /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi

/** Every business with a name and an address or position that the page's JSON-LD describes. */
export function readSiteBusinesses(html: string): SiteBusiness[] {
  const found: SiteBusiness[] = []
  for (const [, body] of html.matchAll(SCRIPT)) {
    for (const node of flatten(parseJson(body))) {
      const business = toBusiness(node)
      if (business) found.push(business)
    }
  }
  return found
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text.trim())
  } catch {
    return null
  }
}

/** Top-level arrays, @graph members, and the branches a chain lists under its organisation. */
function flatten(value: unknown, depth = 0): Json[] {
  if (depth > 3 || !value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap((item) => flatten(item, depth))
  const node = value as Json
  const nested = ['@graph', 'location', 'subOrganization', 'department'].flatMap((key) =>
    flatten(node[key], depth + 1),
  )
  return [node, ...nested]
}

function typesOf(node: Json): string[] {
  const raw = node['@type']
  const list = Array.isArray(raw) ? raw : [raw]
  return list.filter((type): type is string => typeof type === 'string')
}

function toBusiness(node: Json): SiteBusiness | null {
  const types = typesOf(node)
  if (!types.length || types.every((type) => NOT_A_BUSINESS.has(type))) return null
  const name = text(node.name)
  const address = readAddress(node.address)
  const geo = readGeo(node.geo)
  if (!name || (!address && !geo)) return null
  const cuisine = list(node.servesCuisine)
  return {
    name,
    types,
    ...(address && { address }),
    ...(geo && { geo }),
    ...optional('phone', text(node.telephone)),
    ...optional('email', text(node.email)?.replace(/^mailto:/i, '')),
    ...optional('openingHours', readHours(node)),
    ...(cuisine.length && { cuisine }),
    ...(isClosed(node) && { closed: true }),
  }
}

function optional<K extends string, V>(key: K, value: V | undefined) {
  return (value === undefined ? {} : { [key]: value }) as Partial<Record<K, V>>
}

function text(value: unknown): string | undefined {
  if (typeof value === 'number') return String(value)
  if (typeof value !== 'string') return undefined
  return value.replace(/\s+/g, ' ').trim() || undefined
}

function list(value: unknown): string[] {
  const items = Array.isArray(value) ? value : [value]
  return items.map(text).filter((item): item is string => !!item)
}

function readAddress(value: unknown): SiteBusiness['address'] | undefined {
  const node = (Array.isArray(value) ? value[0] : value) as Json | string | undefined
  if (!node || typeof node !== 'object') return undefined
  const country = node.addressCountry
  const address = {
    ...optional('street', text(node.streetAddress)),
    ...optional('locality', text(node.addressLocality)),
    ...optional('region', text(node.addressRegion)),
    ...optional('postalCode', text(node.postalCode)),
    ...optional('country', text(typeof country === 'object' ? country?.name : country)),
  }
  return address.street ? address : undefined
}

function readGeo(value: unknown): SiteBusiness['geo'] | undefined {
  const node = value as Json | undefined
  const lat = Number(node?.latitude)
  const lng = Number(node?.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return undefined
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined
  return { lat, lng }
}

function isClosed(node: Json): boolean {
  return /PermanentlyClosed|Closed$/i.test(text(node.businessStatus) ?? '')
}

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const
const DAY_NAMES: Record<string, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
}

function readHours(node: Json): string | undefined {
  const spec = node.openingHoursSpecification
  if (spec) return specificationToOsm(Array.isArray(spec) ? spec : [spec])
  const lines = list(node.openingHours).filter((line) => /^[A-Za-z0-9 ,:;\-+/]+$/.test(line))
  return lines.length ? lines.join('; ') : undefined
}

/** schema.org OpeningHoursSpecification entries as an OSM opening_hours value. */
export function specificationToOsm(entries: Json[]): string | undefined {
  const byDay: string[][] = DAYS.map(() => [])
  for (const entry of entries) {
    if (entry?.validFrom || entry?.validThrough) continue
    const opens = clock(entry?.opens)
    const closes = clock(entry?.closes, true)
    if (!opens || !closes || opens === closes) continue
    for (const day of list(entry.dayOfWeek)) {
      const index = DAY_NAMES[day.split('/').pop()!.toLowerCase()]
      if (index !== undefined) byDay[index].push(`${opens}-${closes}`)
    }
  }
  const spans = byDay.map((ranges) => [...new Set(ranges)].sort().join(','))
  if (spans.every((span) => span === '00:00-24:00')) return '24/7'
  const rules: string[] = []
  for (let start = 0; start < DAYS.length; ) {
    let end = start
    while (end + 1 < DAYS.length && spans[end + 1] === spans[start]) end++
    if (spans[start]) {
      const days = start === end ? DAYS[start] : `${DAYS[start]}-${DAYS[end]}`
      rules.push(`${days} ${spans[start]}`)
    }
    start = end + 1
  }
  return rules.length ? rules.join('; ') : undefined
}

function clock(value: unknown, closing = false): string | undefined {
  const match = text(value)?.match(/^(\d{1,2}):(\d{2})/)
  if (!match) return undefined
  const time = `${match[1].padStart(2, '0')}:${match[2]}`
  return closing && (time === '23:59' || time === '00:00') ? '24:00' : time
}
