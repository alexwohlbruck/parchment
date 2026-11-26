import { distance, point } from '@turf/turf'
import type { SearchResult } from '../../types/search.types'

/** Lowercase, drop apostrophes, collapse everything else to single spaces. */
export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

export interface ScoredResult {
  result: SearchResult
  relevance: number
}

interface LatLng {
  lat: number
  lng: number
}

const MIN_QUERY_LENGTH = 3
/** A category this relevant means the query names a kind of place: "coffee", "library". */
const CATEGORY_TERM_RELEVANCE = 0.8
/** A house number followed by a word: "350 5th Ave", "12b Elm St". */
const ADDRESS_QUERY = /^\s*\d+[a-z]?\s+\S/i
const ADDRESS_TYPE = /address|intersection|road|street|highway|footway|path/i
const SETTLEMENT_TYPE = /^(city|town|village|hamlet|suburb|borough|quarter|neighbou?rhood)$/i
/** How far down the places an address may sit, under a city named in the query. */
const ADDRESS_DEPTH = 5
/** Two records this close are one place listed by two sources. */
const SAME_PLACE_KM = 0.2
/** A rival this close always competes, however near the top place is. */
const NEAR_KM = 25
/** Past this multiple of the top place's distance, a rival is somewhere else. */
const FAR_RATIO = 1.5

const ABBREVIATIONS: Record<string, string> = {
  st: 'street', av: 'avenue', ave: 'avenue', blvd: 'boulevard', rd: 'road',
  dr: 'drive', ln: 'lane', ct: 'court', pl: 'place', pkwy: 'parkway',
  hwy: 'highway', cir: 'circle', ter: 'terrace', sq: 'square',
  n: 'north', s: 'south', e: 'east', w: 'west',
  ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest',
}

function tokens(s: string): string[] {
  return normalizeName(s).split(' ').filter(Boolean).map(t => ABBREVIATIONS[t] ?? t)
}

function placeType(result: SearchResult): string {
  const type = result.metadata.place?.placeType?.value
  return typeof type === 'string' ? type : ''
}

function isAddress(result: SearchResult): boolean {
  return result.id.startsWith('pelias/') ||
    result.id.startsWith('osm/intersection/') ||
    ADDRESS_TYPE.test(placeType(result))
}

function isSettlement(result: SearchResult): boolean {
  return SETTLEMENT_TYPE.test(placeType(result))
}

function centerOf(result: SearchResult): LatLng | undefined {
  return result.metadata.place?.geometry?.value?.center
}

function km(a: LatLng, b: LatLng): number {
  return distance(point([a.lng, a.lat]), point([b.lng, b.lat]), { units: 'kilometers' })
}

/** Every typed word is a word of `name`; the last may still be half typed. */
function namesAll(typed: string[], name: string[]): boolean {
  return typed.every((word, i) =>
    i === typed.length - 1
      ? name.some(n => n.startsWith(word))
      : name.includes(word))
}

/** The nearest address with the typed number and street; a city may follow. */
function addressMatch(typed: string[], places: SearchResult[]): SearchResult | undefined {
  return places.slice(0, ADDRESS_DEPTH).find(place => {
    if (!isAddress(place)) return false
    const title = tokens(place.title)
    return title[0] === typed[0] &&
      namesAll(typed, [...title, ...tokens(place.description ?? '')])
  })
}

/**
 * Whether `other` is a second place the user could mean: not the top place
 * listed again by another source, and not much farther away than it. A town
 * only competes with other towns, not the shops and stations named after it.
 */
function competes(top: SearchResult, other: SearchResult, center?: LatLng): boolean {
  if (isAddress(other) || isSettlement(top) !== isSettlement(other)) return false
  const a = centerOf(top)
  const b = centerOf(other)
  if (!a || !b) return true
  if (km(a, b) < SAME_PLACE_KM) return false
  if (!center) return true
  return km(center, b) <= Math.max(NEAR_KM, FAR_RATIO * km(center, a))
}

/**
 * The top place, when no other place near enough to matter has as good a
 * name: one named exactly what was typed beats one that only contains it,
 * wherever it is.
 */
function nameMatch(
  query: string,
  typed: string[],
  places: SearchResult[],
  center?: LatLng,
): SearchResult | undefined {
  const top = places[0]
  if (!top || !namesAll(typed, tokens(top.title))) return undefined
  const exact = normalizeName(top.title) === normalizeName(query)
  if (!exact && places.some(p => normalizeName(p.title) === normalizeName(query))) return undefined
  const rivalName = (p: SearchResult) =>
    exact ? normalizeName(p.title) === normalizeName(query) : namesAll(typed, tokens(p.title))
  const rival = places.slice(1).some(p => rivalName(p) && competes(top, p, center))
  return rival ? undefined : top
}

const OPENABLE_TYPES = new Set<SearchResult['type']>(['place', 'transit_route', 'transit_stop'])

/**
 * The one result a full search means, when it means exactly one: a typed
 * coordinate, the kind of place or the brand the query names, the nearest
 * match for a street address, or a place or transit line whose name no other
 * place nearby shares.
 */
export function confidentMatch(
  query: string,
  scored: ScoredResult[],
  center?: LatLng,
): string | undefined {
  const results = scored.map(s => s.result)
  const top = results[0]
  if (top?.id.startsWith('coords/')) return top.id
  if (normalizeName(query).length < MIN_QUERY_LENGTH) return undefined

  const kind = scored.find(({ result, relevance }) =>
    result.type === 'category' && relevance >= CATEGORY_TERM_RELEVANCE)
  if (kind) return kind.result.id

  const brand = results.find(r =>
    r.type === 'brand' && normalizeName(r.title) === normalizeName(query))
  if (brand) return brand.id

  const typed = tokens(query)
  const places = results.filter(r => OPENABLE_TYPES.has(r.type))
  const match = ADDRESS_QUERY.test(query)
    ? addressMatch(typed, places)
    : nameMatch(query, typed, places, center)
  return match?.id
}
