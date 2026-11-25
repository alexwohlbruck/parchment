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

export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return turf.distance([a.lng, a.lat], [b.lng, b.lat], { units: 'meters' })
}

/** The listing for a place among nearby hotels: a close name within 250 m, the closest name winning. */
export function pickHotelMatch(
  candidates: HotelCandidate[],
  place: { name: string; lat: number; lng: number },
): HotelCandidate | null {
  return (
    candidates
      .map((hotel) => ({ hotel, similarity: hotelNameSimilarity(hotel.name, place.name), metres: metresBetween(place, hotel) }))
      .filter((c) => c.similarity >= MIN_NAME_SIMILARITY && c.metres <= MAX_MATCH_M)
      .sort((a, b) => b.similarity - a.similarity || a.metres - b.metres)[0]?.hotel ?? null
  )
}
