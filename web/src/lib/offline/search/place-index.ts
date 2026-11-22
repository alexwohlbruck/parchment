import { everyTokenPrefixes, tokenize } from '@/lib/search/tokenize'
import { approxMeters } from '@/lib/offline/streets/street-graph'
import type { PackagePlace } from '@/types/offline-package.types'

interface Entry {
  place: PackagePlace
  name: string
  words: string[]
  /** Words of the kind of place and its street, matched after the name. */
  extra: string[]
}

export interface PlaceIndex {
  entries: Entry[]
  byId: Map<string, PackagePlace>
}

/** Streets come one row per stretch, so keep one per name per this many metres. */
const STREET_DEDUPE_METRES = 1500

export function buildPlaceIndex(places: Iterable<PackagePlace>): PlaceIndex {
  const entries: Entry[] = []
  const byId = new Map<string, PackagePlace>()
  const streets = new Map<string, PackagePlace[]>()
  for (const place of places) {
    if (byId.has(place.id)) continue
    if (place.category?.startsWith('highway/')) {
      const seen = streets.get(place.name) ?? []
      if (seen.some(s => approxMeters(s.lng, s.lat, place.lng, place.lat) < STREET_DEDUPE_METRES)) continue
      seen.push(place)
      streets.set(place.name, seen)
    }
    byId.set(place.id, place)
    const words = tokenize(place.name)
    entries.push({
      place,
      name: words.join(' '),
      words,
      extra: tokenize([place.placeType, place.address?.street].filter(Boolean).join(' ')),
    })
  }
  return { entries, byId }
}

export interface PlaceMatch {
  place: PackagePlace
  score: number
}

/** Halves a match's pull every this many metres from `near`. */
const DISTANCE_HALF_METRES = 3000

export function searchPlaceIndex(
  index: PlaceIndex,
  query: string,
  { near, limit = 20 }: { near?: { lat: number; lng: number }; limit?: number } = {},
): PlaceMatch[] {
  const tokens = tokenize(query)
  if (!tokens.length) return []
  const phrase = tokens.join(' ')
  const matches: PlaceMatch[] = []
  for (const entry of index.entries) {
    let score = 0
    if (entry.name === phrase) score = 4
    else if (entry.name.startsWith(phrase)) score = 3
    else if (everyTokenPrefixes(tokens, entry.words)) score = 2
    else if (everyTokenPrefixes(tokens, [...entry.words, ...entry.extra])) score = 1
    if (!score) continue
    if (near) {
      const metres = approxMeters(near.lng, near.lat, entry.place.lng, entry.place.lat)
      score += 0.9 * 0.5 ** (metres / DISTANCE_HALF_METRES)
    }
    if (entry.place.transit) score += 0.2
    matches.push({ place: entry.place, score })
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, limit)
}
