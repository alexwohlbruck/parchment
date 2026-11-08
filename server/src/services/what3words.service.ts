/**
 * what3words: a three-word address for every 3 m square. The grid is
 * proprietary, so both directions go through their API with the key from the
 * What3words integration, and nothing works without one.
 *
 * API v3: https://developer.what3words.com/public-api/docs
 */
import { logWarn } from '../lib/logger'
import { IntegrationId } from '../types/integration.types'
import { integrationManager } from './integrations'
import type { LatLng } from '../lib/coordinate-query'

const API = 'https://api.what3words.com/v3'

// "///filled.count.soap", "filled.count.soap", or a w3w.co / what3words.com
// link. Words are letters in any script; the separator may be the
// full-width or ideographic dot some languages use.
const WORDS = String.raw`\p{L}+[.｡。･・︒។։။۔።।]\p{L}+[.｡。･・︒។։။۔።।]\p{L}+`
const QUERY = new RegExp(
  String.raw`^(?:\/{3}|https?:\/\/(?:www\.)?(?:w3w\.co|what3words\.com)\/)?(${WORDS})\/?$`,
  'u',
)

/** The three-word address a query names, normalised to dots, or null. */
export function parseWhat3words(query: string): string | null {
  const m = query.trim().match(QUERY)
  if (!m) return null
  // A bare "maps.google.com" matches too; the API answers it with 400, which
  // is cached, so it costs one request and returns nothing.
  const words = m[1].replace(/[｡。･・︒។։။۔።।]/gu, '.')
  return words.toLowerCase()
}

export function isWhat3wordsAvailable(): boolean {
  return apiKey() !== undefined
}

export interface What3wordsLocation extends LatLng {
  words: string
  /** e.g. "Bayswater, London" */
  nearestPlace?: string
}

// Both directions are fixed mappings, so a lookup never goes stale.
const cache = new Map<string, What3wordsLocation | null>()
const CACHE_LIMIT = 2000

function remember(key: string, value: What3wordsLocation | null) {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!)
  cache.set(key, value)
}

export async function what3wordsToCoordinates(
  words: string,
  signal?: AbortSignal,
): Promise<What3wordsLocation | null> {
  const key = `w:${words}`
  if (cache.has(key)) return cache.get(key)!
  const data = await request('convert-to-coordinates', { words }, signal)
  const result = data?.coordinates
    ? {
        lat: data.coordinates.lat,
        lng: data.coordinates.lng,
        words: data.words,
        nearestPlace: data.nearestPlace || undefined,
      }
    : null
  if (data !== undefined) remember(key, result)
  return result
}

export async function coordinatesToWhat3words(
  lat: number,
  lng: number,
  language = 'en',
  signal?: AbortSignal,
): Promise<What3wordsLocation | null> {
  // 3 m squares: five decimals (~1 m) keep the cache key on the same square.
  const key = `c:${lat.toFixed(5)},${lng.toFixed(5)},${language}`
  if (cache.has(key)) return cache.get(key)!
  const data = await request(
    'convert-to-3wa',
    { coordinates: `${lat},${lng}`, language },
    signal,
  )
  const result = data?.words
    ? {
        lat: data.coordinates?.lat ?? lat,
        lng: data.coordinates?.lng ?? lng,
        words: data.words,
        nearestPlace: data.nearestPlace || undefined,
      }
    : null
  if (data !== undefined) remember(key, result)
  return result
}

function apiKey(): string | undefined {
  const rec = integrationManager
    .getConfiguredIntegrations()
    .find((i) => i.integrationId === IntegrationId.WHAT3WORDS)
  return (rec?.config as { apiKey?: string } | undefined)?.apiKey?.trim() || undefined
}

/**
 * The parsed body, null for an answer of "no such address" (cached), or
 * undefined when the lookup couldn't be made at all (not cached).
 */
async function request(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<any | null | undefined> {
  const key = apiKey()
  if (!key) return undefined
  const url = `${API}/${path}?${new URLSearchParams({ ...params, key })}`
  try {
    const res = await fetch(url, {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5_000)]) : AbortSignal.timeout(5_000),
    })
    // 400 is how the API answers a well-formed but unknown address.
    if (res.status === 400) return null
    if (!res.ok) {
      logWarn(`what3words ${path} failed: ${res.status}`)
      return undefined
    }
    return await res.json()
  } catch (err) {
    if (!signal?.aborted) logWarn(`what3words ${path} failed`, err)
    return undefined
  }
}
