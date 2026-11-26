import axios from 'axios'
import { createHash } from 'node:crypto'
import { distance } from '@turf/turf'
import { SOURCE } from '../lib/constants'
import { MemoCache } from '../lib/memo-cache'
import { logError, logger } from '../lib/logger'
import { assertPublicUrl, outboundRequestConfig } from '../lib/outbound-fetch'
import { getPresetById, matchTags } from '../lib/osm-presets'
import { readSiteBusinesses, type SiteBusiness } from '../lib/web-place/schema-org'
import { addressLine, businessTags, categoryTags, hasCategory, splitStreet } from '../lib/web-place/osm-tags'
import {
  businessPresetIds,
  checkClaims,
  isBusinessPreset,
  isOsmHours,
  onPage,
  presetFieldSpecs,
  type Claim,
  type FieldSpec,
} from '../lib/web-place/preset-schema'
import {
  contactLinks,
  hostOf,
  isListingSite,
  pageText,
  siteNames,
  sameName,
} from '../lib/web-place/site-page'
import { OverpassAdapter } from './integrations/adapters/overpass-adapter'
import { forwardGeocode, reverseGeocode } from './geocoding.service'
import { lookupPlacesByNameAndLocation } from './place.service'
import type { Language } from '../lib/i18n/i18n.types'
import type { ChatMessage, LanguageModelCapability } from '../types/language-model.types'
import type { Place, WebPlaceLookup } from '../types/place.types'
import type { LatLng } from '../types/ask.types'

/** How far from where the user is looking a namesake still counts as the place they mean. */
const MAX_DISTANCE_KM = 60
/** A mapped place this close with the same name is the one the site describes. */
const SAME_PLACE_M = 300
const SITE_GEO_SLACK_KM = 2
const FETCH_TIMEOUT_MS = 8000
const MAX_REDIRECTS = 4
const MAX_CONTACT_PAGES = 2
/** Reasoning models spend most of these thinking before they answer. */
const SITE_TOKENS = 1000
const READ_TOKENS = 1500
const FIELD_TOKENS = 4000

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
  const { url } = site
  let { business } = site
  if (isListingSite(url)) {
    return { status: 'not-found', reason: 'Only listing sites mention it, not a site of its own.' }
  }
  if (business.closed) return { status: 'not-found', reason: 'Its site says it has closed.' }
  if (!sameName(business.name, name) && !site.names.some((candidate) => sameName(candidate, name))) {
    return { status: 'not-found', reason: `${hostOf(url)} looks like a different business (${business.name}).` }
  }
  business = { ...business, name: siteName(site.names, business.name, name) }

  const center = (await geocodeAddress(business)) ?? business.geo
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

/** "Brooklyn, NY", or a postcode where nearby addresses name no town, so a bare business name finds the local one. */
async function areaName({ lat, lng }: LatLng): Promise<string | undefined> {
  try {
    const addresses = (await reverseGeocode(lat, lng)).results.map((place) => place.address?.value)
    const town = addresses.find((address) => address?.locality)
    if (town) return [town.locality, town.region].filter(Boolean).join(', ')
    return addresses.find((address) => address?.postalCode)?.postalCode
  } catch {
    return undefined
  }
}

interface Page {
  url: string
  html: string
}

/** The name as the site presents it, over the spelling a search was typed with. */
export function siteName(names: string[], read: string, typed: string): string {
  return names.find((candidate) => sameName(candidate, read) || sameName(candidate, typed)) ?? read
}

/** The site's own description of the business: its JSON-LD, else what the model reads off its pages. */
async function readSite(website: string, name: string, options: Options) {
  const home = await fetchPage(website, options.signal)
  if (!home) return null
  const pages = [home]
  let business = pickBusiness(readSiteBusinesses(home.html), name, options.near)
  for (const link of contactLinks(home.html, home.url).slice(0, MAX_CONTACT_PAGES)) {
    if (business?.address) break
    const page = await fetchPage(link, options.signal)
    if (!page) continue
    pages.push(page)
    business = pickBusiness(readSiteBusinesses(page.html), name, options.near) ?? business
  }
  const text = pagesText(pages)
  if (!business || !hasCategory(business)) {
    const read = await readWithModel(text, options)
    business = business && read ? { ...business, preset: read.preset } : (business ?? read ?? undefined)
  }
  if (business) business = await readFields(business, text, options)
  return business ? { business, url: home.url, names: siteNames(home.html) } : null
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
{"name","preset","street","city","region","postcode","country","phone","email","opening_hours","hours_quote","closed"}
- preset: the OpenStreetMap preset that fits it best, copied exactly from the list below, or null if none fits
- street: house number and street as the page writes them, e.g. "123 Main Street"
- country: ISO 3166 two-letter code
- opening_hours: OpenStreetMap opening_hours syntax, e.g. "Mo-Fr 09:00-17:00; Sa 10:00-14:00"
- hours_quote: the exact words on the page the hours come from
- closed: true only if the pages say it has closed for good
Copy only what the pages state; null for anything they don't. Never fill a value in from what is typical for this kind of place.
Presets: `

async function readWithModel(text: string, { model, signal }: Options): Promise<SiteBusiness | null> {
  if (!model) return null
  const { message } = await model.complete({
    messages: [
      { role: 'system', content: READ_BRIEF + businessPresetIds().join(' ') },
      { role: 'user', content: text },
    ],
    maxTokens: READ_TOKENS,
    signal,
  })
  return parseModelBusiness(message.content ?? '', text)
}

function pagesText(pages: Page[]): string {
  return pages.map((page) => `${page.url}\n${pageText(page.html)}`).join('\n\n---\n\n')
}

function parseJson(reply: string): Record<string, unknown> | null {
  try {
    const data = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1))
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null
  } catch {
    return null
  }
}

/** The business the model read, keeping only what the page text bears out. */
export function parseModelBusiness(reply: string, text: string): SiteBusiness | null {
  const data = parseJson(reply)
  if (!data) return null
  const value = (key: string) =>
    typeof data[key] === 'string' && (data[key] as string).trim() ? (data[key] as string).trim() : undefined
  const stated = (key: string) => {
    const found = value(key)
    return found && onPage(found, text) ? found : undefined
  }
  const name = stated('name')
  const street = value('street')
  if (!name || !street || !streetOnPage(street, text)) return null
  const preset = value('preset')
  const hours = value('opening_hours')
  const hoursQuote = value('hours_quote')
  const phone = value('phone')
  const country = value('country')
  return {
    name,
    types: [],
    preset: preset && isBusinessPreset(preset) ? preset : undefined,
    address: {
      street,
      locality: stated('city'),
      region: stated('region'),
      postalCode: stated('postcode'),
      country: country && /^[A-Z]{2}$/i.test(country) ? country.toUpperCase() : undefined,
    },
    phone: phone && digitsOnPage(phone, text) ? phone : undefined,
    email: stated('email'),
    openingHours: hours && hoursQuote && onPage(hoursQuote, text) && isOsmHours(hours) ? hours : undefined,
    closed: data.closed === true,
  }
}

/** The house number and street name both appear, however the page abbreviates "Street". */
function streetOnPage(street: string, text: string): boolean {
  if (onPage(street, text)) return true
  const { 'addr:housenumber': number, 'addr:street': name } = splitStreet(street.split(',')[0].trim())
  const word = name?.split(' ')[0]
  return !!number && !!word && onPage(`${number} ${word}`, text)
}

function digitsOnPage(phone: string, text: string): boolean {
  const digits = phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  return digits.length >= 7 && text.replace(/\D/g, '').includes(digits)
}

const FIELD_HINTS: Record<string, string> = {
  multiCombo: 'each value becomes <key><value>=yes, several separated by ;',
  semiCombo: 'several separated by ;',
  number: 'a number',
  text: 'words exactly as the page writes them',
}

function fieldsBrief(preset: string, specs: FieldSpec[]): string {
  const lines = specs.map(({ key, type, label, options }) => {
    const how = FIELD_HINTS[type]?.replace('<key>', key) ?? 'one value'
    return `${key} (${label}; ${how})${options ? `: ${options.join(', ')}` : ''}`
  })
  return `You are tagging a ${getPresetById(preset)?.name ?? preset} (${preset}) for OpenStreetMap from the business's own web pages.
Answer every field below, in one JSON object keyed by field key. Each answer is null, or {"value": ..., "quote": ...}:
- value: one of the listed options where options are given; snake_case otherwise
- quote: the exact words copied from the pages that state it
Null unless the pages say it outright. Never answer from what is typical for this kind of place.
${lines.join('\n')}`
}

/** Fills the preset's other fields from the pages, keeping only what the schema allows and the pages quote. */
async function readFields(business: SiteBusiness, text: string, { model, signal }: Options): Promise<SiteBusiness> {
  const category = categoryTags(business)
  const preset = business.preset ?? (category && matchTags(category, 'point')?.preset.id)
  const specs = preset ? presetFieldSpecs(preset) : []
  if (!model || !preset || !specs.length) return business
  try {
    const messages: ChatMessage[] = [
      { role: 'system', content: fieldsBrief(preset, specs) },
      { role: 'user', content: text },
    ]
    const ask = async () => {
      const { message } = await model.complete({ messages, maxTokens: FIELD_TOKENS, signal })
      messages.push({ role: 'assistant', content: message.content })
      return parseJson(message.content ?? '') ?? {}
    }
    const claims = await ask()
    const skipped = specs.filter(({ key }) => !(key in claims)).map(({ key }) => key)
    if (skipped.length) {
      messages.push({ role: 'user', content: `You skipped ${skipped.join(', ')}. Answer each of them the same way.` })
      Object.assign(claims, await ask())
    }
    const { tags, rejected } = checkClaims(claims as Record<string, Claim | null>, specs, text)
    if (rejected.length) logger.debug({ preset, rejected }, '[web-place] dropped fields the schema or pages do not bear out')
    return { ...business, tags }
  } catch (error) {
    if (!signal?.aborted) logError('Failed to read a business’s fields', error)
    return business
  }
}

async function geocodeAddress(business: SiteBusiness): Promise<LatLng | undefined> {
  const line = addressLine(business.address)
  if (!line) return undefined
  try {
    const { lat, lng } = business.geo ?? {}
    const { results } = await forwardGeocode(line, lat, lng)
    return addressPoint(results, business) ?? (business.geo ? undefined : results[0]?.geometry.value.center)
  } catch {
    return undefined
  }
}

/** The geocoded point for the business's own house number, which site-authored coordinates often miss. */
export function addressPoint(results: Place[], business: SiteBusiness): LatLng | undefined {
  const number = business.address?.street && splitStreet(business.address.street.split(',')[0].trim())['addr:housenumber']
  if (!number) return undefined
  const startsWithNumber = new RegExp(`^${number.replace(/[-–]/g, '[-–]')}\\b`, 'i')
  const match = results.find((place) =>
    [place.name?.value, place.address?.value?.street1].some((text) => text && startsWithNumber.test(text.trim())),
  )
  const center = match?.geometry?.value?.center
  if (!center) return undefined
  const { geo } = business
  if (geo && distance([geo.lng, geo.lat], [center.lng, center.lat], { units: 'kilometers' }) > SITE_GEO_SLACK_KM) {
    return undefined
  }
  return center
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
    unmapped: {
      tags,
      presetId: business.preset ?? (hasCategory(business) ? (matchTags(tags, 'point')?.preset.id ?? null) : null),
    },
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
