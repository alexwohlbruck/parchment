import * as turf from '@turf/turf'
import * as fuzz from 'fuzzball'

export interface HotelCandidate {
  id: string
  name: string
  lat: number
  lng: number
  address?: string | null
}

export const HOTEL_SEARCH_RADIUS_M = 1000
const MAX_MATCH_M = 250
const MIN_NAME_SIMILARITY = 0.8
/** Close enough that a shorter form of the name ("EVEN Hotel" for "EVEN Hotel Brooklyn by IHG") is the same hotel. */
const SHORT_NAME_MAX_M = 75

const GENERIC_WORDS = /\b(the|a|hotel|hotels|inn|suites?|resort|hostel|motel|by|and|at)\b/g

function words(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function coreName(name: string): string {
  return words(name).replace(GENERIC_WORDS, ' ').replace(/\s+/g, ' ').trim()
}

/** Compares whole names, so a shared neighbourhood ("Times Square") can't pair two different hotels. */
export function hotelNameSimilarity(a: string, b: string): number {
  const left = coreName(a)
  const right = coreName(b)
  if (!left || !right) return words(a) === words(b) ? 1 : 0
  return fuzz.token_sort_ratio(left, right) / 100
}

/** Whether every word of one name's core appears in the other's. */
export function hotelNameContains(a: string, b: string): boolean {
  const [shorter, longer] = [coreName(a), coreName(b)].sort((x, y) => x.length - y.length).map((n) => n.split(' ').filter(Boolean))
  if (!shorter.length) return false
  return shorter.every((word) => longer.includes(word))
}

/** How well a name answers a search typed by a person: lenient, for ranking choices. */
export function hotelQueryScore(name: string, query: string): number {
  return fuzz.token_set_ratio(words(name), words(query)) / 100
}

export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return turf.distance([a.lng, a.lat], [b.lng, b.lat], { units: 'meters' })
}

/**
 * The listing for a place among nearby hotels: a close name within 250 m, or
 * a shorter form of the name within 75 m. The closest name wins.
 */
export function pickHotelMatch(
  candidates: HotelCandidate[],
  place: { name: string; lat: number; lng: number },
): HotelCandidate | null {
  return (
    candidates
      .map((hotel) => ({ hotel, similarity: hotelNameSimilarity(hotel.name, place.name), metres: metresBetween(place, hotel) }))
      .filter(
        (c) =>
          (c.similarity >= MIN_NAME_SIMILARITY && c.metres <= MAX_MATCH_M) ||
          (c.metres <= SHORT_NAME_MAX_M && hotelNameContains(c.hotel.name, place.name)),
      )
      .sort((a, b) => b.similarity - a.similarity || a.metres - b.metres)[0]?.hotel ?? null
  )
}
