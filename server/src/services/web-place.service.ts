import axios from 'axios'
import { createHash } from 'node:crypto'
import { distance } from '@turf/turf'
import { SOURCE } from '../lib/constants'
import { MemoCache } from '../lib/memo-cache'
import { logError } from '../lib/logger'
import { assertPublicUrl, outboundRequestConfig } from '../lib/outbound-fetch'
import { matchTags } from '../lib/osm-presets'
import { readSiteBusinesses, type SiteBusiness } from '../lib/web-place/schema-org'
import { addressLine, businessTags, CATEGORY_TAGS, hasCategory } from '../lib/web-place/osm-tags'
import {
  contactLinks,
  hostOf,
  isListingSite,
  pageText,
  pageTitle,
  sameName,
} from '../lib/web-place/site-page'
import { OverpassAdapter } from './integrations/adapters/overpass-adapter'
import { forwardGeocode, reverseGeocode } from './geocoding.service'
import { lookupPlacesByNameAndLocation } from './place.service'
import type { Language } from '../lib/i18n/i18n.types'
import type { LanguageModelCapability } from '../types/language-model.types'
import type { Place, WebPlaceLookup } from '../types/place.types'
import type { LatLng } from '../types/ask.types'

/** How far from where the user is looking a namesake still counts as the place they mean. */
const MAX_DISTANCE_KM = 60
/** A mapped place this close with the same name is the one the site describes. */
const SAME_PLACE_M = 300
const FETCH_TIMEOUT_MS = 8000
const MAX_REDIRECTS = 4
const MAX_CONTACT_PAGES = 2
/** Reasoning models spend most of these thinking before they answer. */
const SITE_TOKENS = 1000
const READ_TOKENS = 1500

export class WebPlaceError extends Error {}

const webPlaces = new MemoCache<Place | null>({
  max: 500,
  ttlMs: 24 * 60 * 60_000,
  keep: (place) => place !== null,
})

/** A place found on the web earlier, while it is still remembered. */
export function getWebPlace(id: string): Promise<Place | null> {
  return webPlaces.get(id, async () => null)
}

interface Options {
  near: LatLng
  /** The business's own site, when the caller already knows it. */
  website?: string
  model?: LanguageModelCapability
  language?: Language
  signal?: AbortSignal
}

/**
 * Find a business the map doesn't have from its own website: the web only
 * points at the site, and everything shown or offered to OSM comes from it.
 */
export async function findPlaceOnWeb(query: string, options: Options): Promise<WebPlaceLookup> {
  const located = options.website
    ? { website: options.website, corroboratedBy: [] }
    : await findOfficialSite(query, options)
  if (!located) return { status: 'not-found', reason: 'No website of its own turned up.' }
  const { website, corroboratedBy } = located
  if (isListingSite(website)) {
    return { status: 'not-found', reason: 'Only listing sites mention it, not a site of its own.' }
  }

  // "Frenchette, New York" names the business before the comma.
  const name = query.split(',')[0].trim()
  const site = await readSite(website, name, options)
  if (!site) return { status: 'not-found', reason: `${hostOf(website)} doesn't give an address.` }
  const { business, url } = site
  if (isListingSite(url)) {
    return { status: 'not-found', reason: 'Only listing sites mention it, not a site of its own.' }
  }
  if (business.closed) return { status: 'not-found', reason: 'Its site says it has closed.' }
  if (!sameName(business.name, name) && !sameName(site.title ?? '', name)) {
    return { status: 'not-found', reason: `${hostOf(url)} looks like a different business (${business.name}).` }
  }

  const center = business.geo ?? (await geocodeAddress(business))
  if (!center) return { status: 'not-found', reason: "Couldn't place its address on the map." }
  const km = distance([options.near.lng, options.near.lat], [center.lng, center.lat], { units: 'kilometers' })
  if (km > MAX_DISTANCE_KM) {
    return { status: 'not-found', reason: `The ${business.name} on ${hostOf(url)} is ${Math.round(km)} km away.` }
  }

  const mapped = await mappedNamesake(business.name, center, options)
  if (mapped) return { status: 'mapped', place: mapped }

  const place = webPlace(business, siteRoot(url), center, options.language)
  await webPlaces.get(place.externalIds[SOURCE.WEB], async () => place)
  return { status: 'found', place, corroboratedBy }
}

const SITE_BRIEF =
  "Find the business's own official website. Reply with only its URL, or NONE if it has no site of its own or you can't confirm the business exists. Never a directory, map, review, booking, delivery or social media page."

async function findOfficialSite(query: string, { model, near, signal }: Options) {
  if (!model) throw new WebPlaceError('Web search is not available here. Pass the business website instead.')
  const area = query.includes(',') ? undefined : await areaName(near)
  const { message, citations = [] } = await model.complete({
    messages: [
      { role: 'system', content: SITE_BRIEF },
      { role: 'user', content: area ? `${query}, ${area}` : query },
    ],
    webSearch: { maxResults: 5 },
    maxTokens: SITE_TOKENS,
    signal,
  })
  const website = message.content?.match(/https?:\/\/[^\s"'<>)\]]+/)?.[0]?.replace(/[.,;]+$/, '')
  if (!website) return null
  const host = hostOf(website)
  const corroboratedBy = [...new Set(citations.map(({ url }) => hostOf(url)))].filter(
    (other): other is string => !!other && other !== host,
  )
  return { website, corroboratedBy }
}

/** "Brooklyn, NY" for a point, so a bare business name finds the local one. */
async function areaName({ lat, lng }: LatLng): Promise<string | undefined> {
  try {
    const address = (await reverseGeocode(lat, lng)).results[0]?.address?.value
    const parts = [address?.locality, address?.region].filter(Boolean)
    return parts.length ? parts.join(', ') : undefined
  } catch {
    return undefined
  }
}

interface Page {
  url: string
  html: string
}

/** The site's own description of the business: its JSON-LD, else what the model reads off its pages. */
async function readSite(website: string, name: string, options: Options) {
  const home = await fetchPage(website, options.signal)
  if (!home) return null
  const title = pageTitle(home.html)
  const pages = [home]
  let business = pickBusiness(readSiteBusinesses(home.html), name, options.near)
  for (const link of contactLinks(home.html, home.url).slice(0, MAX_CONTACT_PAGES)) {
    if (business?.address) break
    const page = await fetchPage(link, options.signal)
    if (!page) continue
    pages.push(page)
    business = pickBusiness(readSiteBusinesses(page.html), name, options.near) ?? business
  }
  if (!business || !hasCategory(business)) {
    const read = await readWithModel(pages, options)
    business = business && read ? { ...business, types: [...read.types, ...business.types] } : (business ?? read ?? undefined)
  }
  return business ? { business, url: home.url, title } : null
}

function pickBusiness(found: SiteBusiness[], name: string, near: LatLng): SiteBusiness | undefined {
  const named = found.filter((business) => sameName(business.name, name))
  const pool = named.length ? named : found
  const km = (business: SiteBusiness) =>
    business.geo
      ? distance([near.lng, near.lat], [business.geo.lng, business.geo.lat], { units: 'kilometers' })
      : Infinity
  return [...pool].sort((a, b) => km(a) - km(b))[0]
}

async function fetchPage(start: string, signal?: AbortSignal): Promise<Page | null> {
  let url = start.startsWith('http') ? start : `https://${start}`
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!/^https?:$/.test(new URL(url).protocol)) return null
      await assertPublicUrl(url)
      const response = await axios.get<string>(url, {
        ...outboundRequestConfig,
        timeout: FETCH_TIMEOUT_MS,
        responseType: 'text',
        validateStatus: (code) => code < 400,
        headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (compatible; Parchment)' },
        signal,
      })
      const location = response.headers.location
      if (response.status >= 300 && location) {
        url = new URL(location, url).href
        continue
      }
      const type = String(response.headers['content-type'] ?? '')
      if (!type.includes('html')) return null
      return { url, html: String(response.data) }
    }
  } catch (error) {
    if (!axios.isCancel(error)) logError('Failed to read a business website', error, { url })
  }
  return null
}

const READ_BRIEF = `Read this business's own web pages and reply with one JSON object only:
{"name","category","street","city","region","postcode","country","phone","email","opening_hours","closed"}
- category: one of ${Object.keys(CATEGORY_TAGS).join(', ')}, or null
- street: house number and street, e.g. "123 Main Street"
- country: ISO 3166 two-letter code
- opening_hours: OpenStreetMap syntax, e.g. "Mo-Fr 09:00-17:00; Sa 10:00-14:00"
- closed: true only if the pages say it has closed for good
Only what the pages state; null for anything they don't.`

async function readWithModel(pages: Page[], { model, signal }: Options): Promise<SiteBusiness | null> {
  if (!model) return null
  const content = pages.map((page) => `${page.url}\n${pageText(page.html)}`).join('\n\n---\n\n')
  const { message } = await model.complete({
    messages: [
      { role: 'system', content: READ_BRIEF },
      { role: 'user', content },
    ],
    maxTokens: READ_TOKENS,
    signal,
  })
  return parseModelBusiness(message.content ?? '')
}

export function parseModelBusiness(reply: string): SiteBusiness | null {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1))
  } catch {
    return null
  }
  const text = (key: string) =>
    typeof data[key] === 'string' && (data[key] as string).trim() ? (data[key] as string).trim() : undefined
  const name = text('name')
  const street = text('street')
  if (!name || !street) return null
  const category = text('category')
  const hours = text('opening_hours')
  return {
    name,
    types: category && CATEGORY_TAGS[category] ? [category] : [],
    address: {
      street,
      locality: text('city'),
      region: text('region'),
      postalCode: text('postcode'),
      country: text('country'),
    },
    phone: text('phone'),
    email: text('email'),
    openingHours: hours && /^[A-Za-z0-9 ,:;\-+/]+$/.test(hours) ? hours : undefined,
    closed: data.closed === true,
  }
}

async function geocodeAddress(business: SiteBusiness): Promise<LatLng | undefined> {
  const line = addressLine(business.address)
  if (!line) return undefined
  try {
    const { results } = await forwardGeocode(line)
    return results[0]?.geometry.value.center
  } catch {
    return undefined
  }
}

/** A mapped place nearby with the same name, so the site describes something OSM already has. */
async function mappedNamesake(name: string, center: LatLng, options: Options): Promise<Place | undefined> {
  const results = await lookupPlacesByNameAndLocation(name, center, {
    radius: SAME_PLACE_M,
    language: options.language,
    signal: options.signal,
  })
  return results.find((place) => {
    const at = place.geometry?.value?.center
    return (
      place.externalIds?.[SOURCE.OSM] &&
      place.name.value &&
      sameName(place.name.value, name) &&
      at &&
      distance([center.lng, center.lat], [at.lng, at.lat], { units: 'meters' }) <= SAME_PLACE_M
    )
  })
}

function siteRoot(url: string): string {
  const { origin } = new URL(url)
  return `${origin}/`
}

const adapter = new OverpassAdapter()

/** The place as its site describes it, built from the tags a mapper would add. */
export function webPlace(
  business: SiteBusiness,
  website: string,
  center: LatLng,
  language?: Language,
): Place {
  const tags = businessTags(business, website)
  const id = createHash('sha256').update(`${website}|${business.name}`).digest('hex').slice(0, 16)
  const place = attributeTo(
    adapter.placeInfo.adaptPlaceDetails(
      { type: 'node', id: 0, lat: center.lat, lon: center.lng, tags },
      `${SOURCE.WEB}/${id}`,
      language,
    ),
    SOURCE.WEB,
  )
  return {
    ...place,
    externalIds: { [SOURCE.WEB]: id },
    tags,
    sources: [{ id: SOURCE.WEB, name: hostOf(website) ?? website, url: website }],
    unmapped: { tags, presetId: hasCategory(business) ? (matchTags(tags, 'point')?.preset.id ?? null) : null },
  }
}

/** Credits every field the OSM adapter filled to another source. */
function attributeTo<T>(value: T, sourceId: string): T {
  if (Array.isArray(value)) return value.map((item) => attributeTo(item, sourceId)) as T
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [
      key,
      key === 'sourceId' && inner === SOURCE.OSM ? sourceId : attributeTo(inner, sourceId),
    ]),
  ) as T
}
