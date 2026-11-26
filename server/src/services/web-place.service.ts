import axios from 'axios'
import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { distance } from '@turf/turf'
import { SOURCE } from '../lib/constants'
import { MemoCache } from '../lib/memo-cache'
import { logError, logger } from '../lib/logger'
import { assertPublicUrl, outboundRequestConfig } from '../lib/outbound-fetch'
import { getPresetById, matchTags } from '../lib/osm-presets'
import { readSiteBusinesses, type SiteBusiness } from '../lib/web-place/schema-org'
import { addressLine, businessTags, categoryTags, hasCategory, notYetOpenTags, splitStreet } from '../lib/web-place/osm-tags'
import { unbundlePage, type BundledAsset } from '../lib/web-place/bundled-page'
import { addressImages } from '../lib/web-place/site-images'
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
  typedName,
} from '../lib/web-place/site-page'
import { OverpassAdapter } from './integrations/adapters/overpass-adapter'
import { isVacantAddress, replacementTags, sameAddress } from '../lib/web-place/address-match'
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
/** How far from the geocoded point an element with the same address can be. */
const SAME_ADDRESS_M = 60
const SITE_GEO_SLACK_KM = 2
const FETCH_TIMEOUT_MS = 8000
const MAX_REDIRECTS = 4
const MAX_CONTACT_PAGES = 2
/** Reasoning models spend most of these thinking before they answer. */
const SITE_TOKENS = 1000
const READ_TOKENS = 3000
const FIELD_TOKENS = 4000
const IMAGE_TOKENS = 1000
const MAX_IMAGE_BYTES = 5_000_000
const IMAGE_SIDE_PX = 1000

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

/** A stage of a lookup, as it starts or learns more, so a caller can show the work. */
export type WebPlaceStage = 'site' | 'read' | 'classify' | 'images' | 'fields' | 'locate' | 'map'

interface Options {
  near: LatLng
  progress?: (stage: WebPlaceStage, detail?: string) => void
  /** The business's own site, when the caller already knows it. */
  website?: string
  /** A street address the user gave, which stands in for one the site doesn't state. */
  address?: string
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
  const site = await readSite(website, query, options)
  if (!site) return { status: 'not-found', reason: `${hostOf(website)} doesn't give an address.` }
  const { url } = site
  let { business } = site
  if (isListingSite(url)) {
    return { status: 'not-found', reason: 'Only listing sites mention it, not a site of its own.' }
  }
  if (business.closed) return { status: 'not-found', reason: 'Its site says it has closed.' }
  if (!typedName(name, business.name) && !site.names.some((candidate) => typedName(name, candidate))) {
    return { status: 'not-found', reason: `${hostOf(url)} looks like a different business (${business.name}).` }
  }
  business = { ...business, name: siteName(site.names, business.name, name) }
  if (options.address) business = { ...business, address: userAddress(options.address), addressFrom: 'you' }
  if (!business.address?.street) {
    return { status: 'not-found', reason: `${hostOf(url)} doesn't give a street address, in its text or its images.` }
  }

  const from = business.addressFrom && ADDRESS_FROM[business.addressFrom]
  options.progress?.('locate', [addressLine(business.address), from].filter(Boolean).join(' · '))
  const geocoded = await geocodeAddress(business)
  if (geocoded?.match) business = { ...business, address: geocodedAddress(business.address, geocoded.match) }
  const center = geocoded?.center ?? business.geo
  if (!center) return { status: 'not-found', reason: "Couldn't place its address on the map." }
  const km = distance([options.near.lng, options.near.lat], [center.lng, center.lat], { units: 'kilometers' })
  if (km > MAX_DISTANCE_KM) {
    return { status: 'not-found', reason: `The ${business.name} on ${hostOf(url)} is ${Math.round(km)} km away.` }
  }

  options.progress?.('map', business.name)
  const mapped = await mappedNamesake(business.name, center, options)
  if (mapped) return { status: 'mapped', place: mapped }

  const vacant = await vacantAddress(business, center)
  const place = webPlace(business, siteRoot(url), center, options.language, vacant)
  await webPlaces.get(place.externalIds[SOURCE.WEB], async () => place)
  return { status: 'found', place, corroboratedBy }
}

const SITE_BRIEF =
  "Find the business's own official website. Reply with only its URL, or NONE if it has no site of its own or you can't confirm the business exists. Never a directory, map, review, booking, delivery or social media page."

async function findOfficialSite(query: string, { model, near, signal, progress }: Options) {
  if (!model) throw new WebPlaceError('Web search is not available here. Pass the business website instead.')
  const area = query.includes(',') ? undefined : await areaName(near)
  progress?.('site', area ? `${query}, ${area}` : query)
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
  /** Images a bundled page carries inline, by the ids its markup uses. */
  assets?: Map<string, BundledAsset>
}

const ADDRESS_FROM = { image: 'read off its images', you: 'as you gave it' } as const

/** "215 Union St, Brooklyn, NY 11231" as the site's address shape. */
export function userAddress(line: string): NonNullable<SiteBusiness['address']> {
  const [street, ...rest] = line.split(',').map((part) => part.trim()).filter(Boolean)
  const postcode = rest.find((part) => /^\d{5}(?:-\d{4})?$/.test(part))
  const region = rest.find((part) => /^[A-Z]{2}(?:\s+\d{5})?$/.test(part))
  return {
    street,
    locality: rest.find((part) => part !== postcode && part !== region),
    region: region?.slice(0, 2),
    postalCode: postcode ?? region?.match(/\d{5}/)?.[0],
  }
}

/** The site's fullest spelling of its name, over the spelling a search was typed with. */
export function siteName(names: string[], read: string, typed: string): string {
  const named = names.find((candidate) => sameName(candidate, read) || typedName(typed, candidate))
  if (!named) return read
  return names
    .filter((candidate) => sameName(candidate, named))
    .reduce((longest, candidate) => (candidate.length > longest.length ? candidate : longest))
}

/** The site's own description of the business: its JSON-LD, else what the model reads off its pages. */
async function readSite(website: string, query: string, options: Options) {
  const name = query.split(',')[0].trim()
  options.progress?.('read', hostOf(website) ?? website)
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
    options.progress?.('classify', business ? 'Its structured data doesn’t say what kind of place it is' : 'It has no structured data')
    const read = await readWithModel(text, query, options)
    business = business && read ? { ...business, preset: read.preset } : (business ?? read ?? undefined)
  }
  if (business && !business.address?.street && !options.address) {
    const address = await readImageAddress(pages, options)
    if (address) business = { ...business, address, addressFrom: 'image' }
  }
  if (business) business = await readFields(business, text, options)
  return business ? { business, url: home.url, names: siteNames(home.html) } : null
}

function pickBusiness(found: SiteBusiness[], name: string, near: LatLng): SiteBusiness | undefined {
  const named = found.filter((business) => typedName(name, business.name))
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
      const html = String(response.data)
      const bundled = unbundlePage(html)
      return bundled ? { url, ...bundled } : { url, html }
    }
  } catch (error) {
    if (!axios.isCancel(error)) logError('Failed to read a business website', error, { url })
  }
  return null
}

const READ_BRIEF = `Read this business's own web pages and reply with one JSON object only:
{"name","branch","preset","street","city","region","postcode","country","phone","email","opening_hours","hours_quote","closed","opens_soon"}
- When the pages list several locations, describe only the one being looked for: the one its neighbourhood or city names, else the nearest to where it was searched. Its street, hours and phone must all be that location's.
- name: the business's name without the location, e.g. "La Cabra"
- branch: that location's own name when the pages list several, e.g. "Chelsea"; null when there is only one
- preset: the OpenStreetMap preset that fits it best, copied exactly from the list below, or null if none fits
- street: house number and street as the page writes them, e.g. "123 Main Street"
- country: ISO 3166 two-letter code
- opening_hours: OpenStreetMap opening_hours syntax, e.g. "Mo-Fr 09:00-17:00; Sa 10:00-14:00"
- hours_quote: the exact words on the page the hours come from
- closed: true only if the pages say it has closed for good
- opens_soon: true only if the pages say it hasn't opened yet, e.g. "coming soon" or "opening this fall"
Copy only what the pages state; null for anything they don't. Never fill a value in from what is typical for this kind of place.
Presets: `

async function readWithModel(text: string, query: string, { model, near, signal }: Options): Promise<SiteBusiness | null> {
  if (!model) return null
  const wanted = `Looking for: ${query}, searched near ${near.lat.toFixed(4)}, ${near.lng.toFixed(4)}`
  const { message } = await model.complete({
    messages: [
      { role: 'system', content: READ_BRIEF + businessPresetIds().join(' ') },
      { role: 'user', content: `${wanted}\n\n${text}` },
    ],
    maxTokens: READ_TOKENS,
    signal,
  })
  return parseModelBusiness(message.content ?? '', text)
}

const IMAGE_BRIEF = `These images are from a business's own website. If one shows the business's street address, reply with one JSON object only, copying exactly what the image shows:
{"street","city","region","postcode"}, e.g. {"street":"215 Union St","city":"Brooklyn","region":null,"postcode":null}
If none shows a street address, reply {"street":null}. Never guess one.`

/** An address the site shows only in its logo or other images, read by a model that can see them. */
async function readImageAddress(pages: Page[], options: Options): Promise<SiteBusiness['address'] | undefined> {
  if (!options.model) return undefined
  const sources = pages.flatMap((page) => addressImages(page.html).map((src) => ({ src, page }))).slice(0, 2)
  if (!sources.length) return undefined
  options.progress?.('images', sources.length === 1 ? '1 image' : `${sources.length} images`)
  const images = (await Promise.all(sources.map(({ src, page }) => imageDataUrl(src, page, options.signal)))).filter(
    (url): url is string => !!url,
  )
  if (!images.length) return undefined
  try {
    const { message } = await options.model.complete({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: IMAGE_BRIEF },
            ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
          ],
        },
      ],
      maxTokens: IMAGE_TOKENS,
      signal: options.signal,
    })
    const data = parseJson(message.content ?? '')
    const text = (key: string) => (typeof data?.[key] === 'string' && data[key].trim() ? data[key].trim() : undefined)
    const street = text('street')
    if (!street || !splitStreet(street)['addr:housenumber']) return undefined
    return { street, locality: text('city'), region: text('region'), postalCode: text('postcode') }
  } catch (error) {
    // Models that can't read images refuse the request; the lookup carries on without them.
    if (!axios.isCancel(error)) logger.debug(`Reading a site's images failed: ${String(error)}`)
    return undefined
  }
}

async function imageDataUrl(src: string, page: Page, signal?: AbortSignal): Promise<string | null> {
  try {
    const bytes = page.assets?.get(src)?.bytes ?? (await fetchImage(new URL(src, page.url).href, signal))
    if (!bytes) return null
    const png = await sharp(bytes)
      .resize({ width: IMAGE_SIDE_PX, height: IMAGE_SIDE_PX, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer()
    return `data:image/png;base64,${png.toString('base64')}`
  } catch {
    return null
  }
}

async function fetchImage(url: string, signal?: AbortSignal): Promise<Buffer | null> {
  if (!/^https?:$/.test(new URL(url).protocol)) return null
  await assertPublicUrl(url)
  const response = await axios.get<ArrayBuffer>(url, {
    ...outboundRequestConfig,
    timeout: FETCH_TIMEOUT_MS,
    responseType: 'arraybuffer',
    maxContentLength: MAX_IMAGE_BYTES,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Parchment)' },
    signal,
  })
  return String(response.headers['content-type'] ?? '').startsWith('image/') ? Buffer.from(response.data) : null
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
  if (!name) return null
  const read = value('street')
  const street = read && streetOnPage(read, text) ? read : undefined
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
    ...(data.opens_soon === true && { opensSoon: true }),
    ...(stated('branch') && { branch: stated('branch') }),
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

function fieldsSummary(preset: string, tags: Record<string, string>, rejected: { key: string; reason: string }[]): string {
  const kept = Object.entries(tags).map(([key, value]) => `${key}=${value}`)
  const dropped = rejected.map(({ key, reason }) => `${key} (${reason})`)
  return [
    preset,
    kept.length ? `kept ${kept.join(', ')}` : 'nothing stated on the site',
    dropped.length && `dropped ${dropped.join(', ')}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Fills the preset's other fields from the pages, keeping only what the schema allows and the pages quote. */
async function readFields(business: SiteBusiness, text: string, { model, signal, progress }: Options): Promise<SiteBusiness> {
  const category = categoryTags(business)
  const preset = business.preset ?? (category && matchTags(category, 'point')?.preset.id)
  const specs = preset ? presetFieldSpecs(preset) : []
  if (!model || !preset || !specs.length) return business
  const presetName = getPresetById(preset)?.name ?? preset
  progress?.('fields', `${presetName}: ${specs.length} fields`)
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
    if (tags.operator && sameName(tags.operator, business.name)) {
      delete tags.operator
      rejected.push({ key: 'operator', reason: 'just its own name' })
    }
    if (rejected.length) logger.debug({ preset, rejected }, '[web-place] dropped fields the schema or pages do not bear out')
    progress?.('fields', fieldsSummary(presetName, tags, rejected))
    return { ...business, tags }
  } catch (error) {
    if (!signal?.aborted) logError('Failed to read a business’s fields', error)
    return business
  }
}

async function geocodeAddress(business: SiteBusiness): Promise<{ center: LatLng; match?: Place } | undefined> {
  const line = addressLine(business.address)
  if (!line) return undefined
  try {
    const { lat, lng } = business.geo ?? {}
    const { results } = await forwardGeocode(line, lat, lng)
    const match = addressMatch(results, business)
    if (match) return { center: match.geometry.value.center, match }
    const loose = business.geo || business.addressFrom
    const top = results[0]?.geometry.value.center
    return !loose && top ? { center: top } : undefined
  } catch {
    return undefined
  }
}

/** The geocoded result for the business's own house number, which site-authored coordinates often miss. */
export function addressMatch(results: Place[], business: SiteBusiness): Place | undefined {
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
  return match
}

/** The address as the geocoder spells the matched house, e.g. "215 UNION ST" off a logo as "215 Union Street". */
export function geocodedAddress(address: SiteBusiness['address'], match: Place): SiteBusiness['address'] {
  const found = match.address?.value
  const street = found?.street1 ?? match.name?.value
  if (!street || !splitStreet(street)['addr:housenumber']) return address
  const unit = address?.street?.split(',').slice(1).map((part) => part.trim()).filter(Boolean) ?? []
  return {
    ...address,
    street: [street, ...unit].join(', '),
    // The site's own city: New York's geocoder says "New York" where OSM writes "Brooklyn".
    locality: address?.locality ? titleCase(address.locality) : found?.locality,
    region: found?.region ?? address?.region,
    postalCode: found?.postalCode ?? address?.postalCode,
  }
}

/** "BROOKLYN" as "Brooklyn"; anything already in mixed case stays as written. */
function titleCase(text: string): string {
  return text === text.toUpperCase() ? text.toLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()) : text
}

/** A node or way at the business's address with no business on it now, nodes first, then nearest. */
async function vacantAddress(business: SiteBusiness, center: LatLng): Promise<VacantElement | undefined> {
  const street = business.address?.street
  if (!street) return undefined
  try {
    const { results } = await reverseGeocode(center.lat, center.lng)
    const metres = (place: Place) =>
      distance([center.lng, center.lat], [place.geometry.value.center.lng, place.geometry.value.center.lat], { units: 'meters' })
    return results
      .flatMap((place): (VacantElement & { metres: number })[] => {
        const [type, id] = (place.externalIds?.[SOURCE.OSM] ?? '').split('/')
        const tags = place.tags ?? {}
        if ((type !== 'node' && type !== 'way') || !Number(id) || !place.geometry?.value?.center) return []
        if (!sameAddress(tags, street) || !isVacantAddress(tags) || metres(place) > SAME_ADDRESS_M) return []
        return [{ type, id: Number(id), tags, metres: metres(place) }]
      })
      .sort((a, b) => Number(a.type !== 'node') - Number(b.type !== 'node') || a.metres - b.metres)[0]
  } catch {
    return undefined
  }
}

interface VacantElement {
  type: 'node' | 'way'
  id: number
  tags: Record<string, string>
}

function formerName(tags: Record<string, string>): string | undefined {
  return tags.old_name ?? tags['disused:name'] ?? tags['was:name']
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
  vacant?: VacantElement,
): Place {
  const tags = businessTags(business, website)
  const osmTags = business.opensSoon ? notYetOpenTags(tags) : tags
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
      tags: vacant ? replacementTags(vacant.tags, osmTags) : osmTags,
      ...(business.opensSoon && { opensSoon: true }),
      ...(vacant && { replaces: { type: vacant.type, id: vacant.id, formerName: formerName(vacant.tags) } }),
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
