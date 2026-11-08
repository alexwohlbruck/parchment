/**
 * Search over what is already on the device: coordinates, plus codes and
 * what3words addresses typed into the box, saved places and recently viewed
 * places. It answers when the server can't,
 * so search still finds something offline.
 */
import { parseCoordinateQuery, parsePlusCode, type LatLng } from '@server/lib/coordinate-query'
import { loadWhatFreeWords, parseWhat3words } from '@server/lib/whatfreewords'
import { haversineMeters } from '@/lib/geo/geo-line'
import { getBookmarkPlaceId } from '@/lib/place/place-route'
import type { AutocompleteResult } from '@/types/search.types'
import type { Place } from '@/types/place.types'
import type { RecentPlaceEntry } from '@/lib/recents'

/** The fields search reads from a bookmark or a decrypted e2ee point. */
export interface LocalSavedPlace {
  externalIds: Record<string, string>
  name: string
  address?: string | null
  lat: number
  lng: number
  icon?: string
  iconPack?: 'lucide' | 'maki'
  iconColor?: string
}

export interface LocalSearchSources {
  savedPlaces: LocalSavedPlace[]
  recentPlaces: RecentPlaceEntry[]
}

export interface LocalSearchOptions {
  /** Breaks ties between equally good matches by distance. */
  center?: { lat: number; lng: number }
  limit?: number
}

/** The place id a coordinate result routes on, matching the server's. */
export function coordinatePlaceId(lat: number, lng: number): string {
  return `coords/${lat}/${lng}`
}

/**
 * The point a query names, labelled like the server's result. `reference`
 * recovers a short plus code; one naming a town ("P2C7+V2 New York") needs
 * the server to geocode the town.
 */
export function coordinateResult(query: string, reference?: LatLng): AutocompleteResult | null {
  const coords = parseCoordinateQuery(query, reference)
  if (!coords) return null
  const plusCode = parsePlusCode(query)
  return {
    id: coordinatePlaceId(coords.lat, coords.lng),
    type: 'place',
    title: plusCode ? plusCode.code : `${coords.lat}, ${coords.lng}`,
    description: plusCode ? 'Plus code' : 'Coordinates',
    icon: 'MapPin',
    iconPack: 'lucide',
    lat: coords.lat,
    lng: coords.lng,
  }
}

/** A what3words address, worked out on the device from the word data. */
export async function what3wordsResult(query: string): Promise<AutocompleteResult | null> {
  const words = parseWhat3words(query)
  if (!words) return null
  const point = await loadWhatFreeWords()
    .then(w3w => w3w.wordsToLatLng(words))
    .catch(() => null)
  if (!point) return null
  return {
    id: coordinatePlaceId(point.lat, point.lng),
    type: 'place',
    title: `///${words}`,
    description: 'what3words',
    icon: 'MapPin',
    iconPack: 'lucide',
    ...point,
  }
}

export function localAutocomplete(
  query: string,
  sources: LocalSearchSources,
  { center, limit = 20 }: LocalSearchOptions = {},
): AutocompleteResult[] {
  const coords = coordinateResult(query, center)
  if (coords) return [coords]

  const tokens = tokenize(query)
  if (!tokens.length) return []

  const scored: Array<{ result: AutocompleteResult; score: number }> = []
  const seen = new Set<string>()

  // Saved places first: someone who saved a place is likelier to want it
  // than one they merely looked at, so a saved match outranks a recent one.
  for (const p of sources.savedPlaces) {
    const id = getBookmarkPlaceId(p)
    if (!id || seen.has(id)) continue
    const score = matchScore(tokens, p.name, p.address ?? undefined)
    if (!score) continue
    seen.add(id)
    scored.push({
      score: score + 0.5,
      result: {
        id,
        type: 'bookmark',
        title: p.name,
        description: p.address || undefined,
        icon: p.icon || 'MapPin',
        iconPack: p.iconPack || 'lucide',
        color: p.iconColor,
        lat: p.lat,
        lng: p.lng,
      },
    })
  }

  for (const r of sources.recentPlaces) {
    if (seen.has(r.id)) continue
    const score = matchScore(tokens, r.title, r.subtitle)
    if (!score) continue
    seen.add(r.id)
    scored.push({
      score,
      result: {
        id: r.id,
        type: 'place',
        title: r.title,
        description: r.subtitle,
        icon: r.icon || 'MapPin',
        iconPack: (r.iconPack || 'lucide') as 'lucide' | 'maki',
        iconCategory: r.category,
        lat: r.lat,
        lng: r.lng,
      },
    })
  }

  const distance = (r: AutocompleteResult) =>
    center && r.lat != null && r.lng != null
      ? haversineMeters(center.lat, center.lng, r.lat, r.lng)
      : Infinity

  return scored
    .sort((a, b) => b.score - a.score || distance(a.result) - distance(b.result))
    .slice(0, limit)
    .map(s => s.result)
}

/**
 * How well every query token matches the name, falling back to the address.
 * 0 means no match. The name starting with the query beats a word in it
 * starting with each token, which beats a match in the address alone.
 */
function matchScore(tokens: string[], name: string, address?: string): number {
  const nameWords = tokenize(name)
  if (nameWords.join(' ').startsWith(tokens.join(' '))) return 3
  if (everyTokenPrefixes(tokens, nameWords)) return 2
  if (address && everyTokenPrefixes(tokens, [...nameWords, ...tokenize(address)])) return 1
  return 0
}

function everyTokenPrefixes(tokens: string[], words: string[]): boolean {
  return tokens.every(t => words.some(w => w.startsWith(t)))
}

function tokenize(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

/**
 * A place built from local data alone, for showing a search result or
 * opening a place page without the server. Detail fields are left empty.
 */
export function localPlace(input: {
  id: string
  name: string
  lat: number
  lng: number
  address?: string | null
  placeType?: string
  icon?: string
  iconPack?: 'lucide' | 'maki'
  externalIds?: Record<string, string>
}): Place {
  const timestamp = new Date().toISOString()
  const field = <T>(value: T) => ({ value, sourceId: 'local', timestamp })
  return {
    id: input.id,
    externalIds: input.externalIds ?? {},
    name: field(input.name),
    description: null,
    placeType: field(input.placeType ?? 'Place'),
    icon: { icon: input.icon || 'MapPin', iconPack: input.iconPack || 'lucide' },
    geometry: field({ type: 'point', center: { lat: input.lat, lng: input.lng } }),
    photos: [],
    address: input.address ? field({ formatted: input.address }) : null,
    contactInfo: { phone: null, email: null, website: null, websites: null, socials: {} },
    openingHours: null,
    amenities: {},
    tags: {},
    summary: null,
    sources: [],
    lastUpdated: timestamp,
    createdAt: timestamp,
  } as unknown as Place
}

/** The page-ready place for a local autocomplete result. */
export function localResultAsPlace(result: AutocompleteResult): Place | null {
  if (result.lat == null || result.lng == null) return null
  return localPlace({
    id: result.id,
    name: result.title,
    lat: result.lat,
    lng: result.lng,
    // A recent's subtitle may be a category, not an address.
    address: result.type === 'bookmark' ? result.description : null,
    placeType: result.id.startsWith('coords/') ? result.description : undefined,
    icon: result.icon,
    iconPack: result.iconPack,
    externalIds: placeIdExternalIds(result.id),
  })
}

/** "osm/node/1" → { osm: "node/1" }, so a local place still matches its bookmark. */
export function placeIdExternalIds(placeId: string): Record<string, string> {
  const slash = placeId.indexOf('/')
  return slash > 0 ? { [placeId.slice(0, slash)]: placeId.slice(slash + 1) } : {}
}
