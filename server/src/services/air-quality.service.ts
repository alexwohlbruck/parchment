/**
 * OpenAQ air-quality service.
 *
 * OpenAQ aggregates real ground-monitoring stations worldwide (open data,
 * non-profit). We use it as the sensor-accurate source for both the map
 * overlay (stations in a bbox) and the weather widget (nearest station),
 * feeding raw pollutant concentrations into the regional AQI engine
 * (`lib/aqi.ts`). The API key comes from the user-configured OpenAQ
 * integration; falls back gracefully (returns empty/null) when it's
 * unconfigured or a request fails, so callers never break.
 *
 * OpenAQ v3 API: https://docs.openaq.org/ — auth via `X-API-Key` header.
 */

import { computeAirQuality, type AqiComponents } from '../lib/aqi'
import { logWarn } from '../lib/logger'
import { IntegrationId, type AirQuality } from '../types/integration.types'
import { integrationManager } from './integrations'

const OPENAQ_BASE = 'https://api.openaq.org/v3'

// Molecular weights for ppb→µg/m³ (µg/m³ = ppb × MW / 24.45 at 25 °C, 1 atm).
const MW: Record<string, number> = {
  o3: 48.0,
  no2: 46.0055,
  so2: 64.066,
  co: 28.01,
}

// OpenAQ parameter name → our component key.
const PARAM_MAP: Record<string, keyof AqiComponents> = {
  pm25: 'pm2_5',
  'pm2.5': 'pm2_5',
  pm10: 'pm10',
  o3: 'o3',
  no2: 'no2',
  so2: 'so2',
  co: 'co',
}

export interface OpenAqSensor {
  id: number
  parameter?: { name?: string; units?: string }
}
export interface OpenAqLocation {
  id: number
  name?: string
  country?: { code?: string } | string | null
  coordinates?: { latitude?: number; longitude?: number }
  sensors?: OpenAqSensor[]
}
export interface OpenAqLatest {
  sensorsId?: number
  value?: number
  datetime?: { utc?: string } | string
}

export interface AirQualityStation {
  id: number
  name: string
  lat: number
  lng: number
  components: AqiComponents
  airQuality: AirQuality | null
  updatedAt?: string
}

// ---------------------------------------------------------------------------
// Pure transforms (unit-tested; no network)
// ---------------------------------------------------------------------------

/** Normalize an OpenAQ measurement to µg/m³ (gases may arrive in ppm/ppb). */
export function toMicrogramsPerM3(
  key: keyof AqiComponents,
  value: number,
  units?: string,
): number {
  const u = (units || '').toLowerCase().replace(/\s/g, '')
  const mw = MW[key]
  // Particulates and already-µg/m³ values pass through unchanged.
  if (!mw || u === '' || u === 'µg/m³' || u === 'ug/m3' || u === 'µg/m3')
    return value
  if (u === 'ppm') return (value * 1000 * mw) / 24.45
  if (u === 'ppb') return (value * mw) / 24.45
  return value
}

function countryCode(loc: OpenAqLocation): string | undefined {
  if (!loc.country) return undefined
  return typeof loc.country === 'string' ? loc.country : loc.country.code
}

/** Assemble one station's components + regional AQI from OpenAQ data. */
export function assembleStation(
  loc: OpenAqLocation,
  latest: OpenAqLatest[],
): AirQualityStation | null {
  const lat = loc.coordinates?.latitude
  const lng = loc.coordinates?.longitude
  if (lat == null || lng == null) return null

  const byId = new Map<number, OpenAqLatest>()
  for (const l of latest) if (l.sensorsId != null) byId.set(l.sensorsId, l)

  const components: AqiComponents = {}
  let updatedAt: string | undefined
  for (const sensor of loc.sensors ?? []) {
    const key = PARAM_MAP[(sensor.parameter?.name || '').toLowerCase()]
    if (!key) continue
    const m = byId.get(sensor.id)
    if (!m || m.value == null) continue
    components[key] = toMicrogramsPerM3(key, m.value, sensor.parameter?.units)
    const dt = typeof m.datetime === 'string' ? m.datetime : m.datetime?.utc
    if (dt && (!updatedAt || dt > updatedAt)) updatedAt = dt
  }

  if (Object.keys(components).length === 0) return null

  return {
    id: loc.id,
    name: loc.name || 'Station',
    lat,
    lng,
    components,
    airQuality: computeAirQuality(components, countryCode(loc)),
    updatedAt,
  }
}

function haversineKm(
  lat1: number,
  lng1: number,
  lat2?: number,
  lng2?: number,
): number | null {
  if (lat2 == null || lng2 == null) return null
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ---------------------------------------------------------------------------
// Network (defensive; degrades to null/[] without a key)
// ---------------------------------------------------------------------------

function apiKey(): string | undefined {
  const rec = integrationManager
    .getConfiguredIntegrations()
    .find((i) => i.integrationId === IntegrationId.OPENAQ)
  return (rec?.config as { apiKey?: string } | undefined)?.apiKey?.trim() || undefined
}

// ---------------------------------------------------------------------------
// Rate limiting + circuit breaker — stay within OpenAQ's usage terms.
// Free tier: 60 req/min, 2,000 req/hr, and they suspend keys that burst or
// over-consume. Every request funnels through openaqGet, which (a) meters via a
// token bucket so we never spike and stay well under both ceilings, and (b)
// trips a circuit breaker when OpenAQ blocks us, so we stop probing instead of
// hammering a limited or suspended key.
// ---------------------------------------------------------------------------

// Token bucket: sustained ~24 req/min (≈1,440/hr) with bursts capped at 6 — a
// comfortable margin under the 60/min and 2,000/hr limits, and never a spike.
const BUCKET = { capacity: 6, tokens: 6, refillPerSec: 0.4, last: Date.now() }

async function takeToken(): Promise<void> {
  for (;;) {
    const now = Date.now()
    BUCKET.tokens = Math.min(
      BUCKET.capacity,
      BUCKET.tokens + ((now - BUCKET.last) / 1000) * BUCKET.refillPerSec,
    )
    BUCKET.last = now
    if (BUCKET.tokens >= 1) {
      BUCKET.tokens -= 1
      return
    }
    const waitMs = Math.ceil(((1 - BUCKET.tokens) / BUCKET.refillPerSec) * 1000)
    await new Promise((r) => setTimeout(r, waitMs))
  }
}

// Circuit breaker: once OpenAQ blocks us (429 rate-limit, or 401/403
// suspension/unauthorized) we stop sending until the cooldown passes.
let circuitOpenUntil = 0
function openCircuit(ms: number, reason: string) {
  circuitOpenUntil = Math.max(circuitOpenUntil, Date.now() + ms)
  logWarn(`[openaq] pausing requests ${Math.round(ms / 1000)}s (${reason})`)
}

function headerNum(res: Response, name: string): number {
  return Number(res.headers.get(name))
}

async function openaqGet(path: string): Promise<any | null> {
  const key = apiKey()
  if (!key) return null
  if (Date.now() < circuitOpenUntil) return null // blocked — skip entirely

  await takeToken()
  if (Date.now() < circuitOpenUntil) return null // may have tripped while queued

  try {
    const res = await fetch(`${OPENAQ_BASE}${path}`, {
      headers: { 'X-API-Key': key },
      signal: AbortSignal.timeout(8000),
    })

    // Suspended / unauthorized — back off for hours; do not keep probing.
    if (res.status === 401 || res.status === 403) {
      openCircuit(6 * 60 * 60 * 1000, `HTTP ${res.status}`)
      return null
    }
    // Rate limited — honour the reset window.
    if (res.status === 429) {
      const reset = headerNum(res, 'x-ratelimit-reset') || 60
      openCircuit(Math.min(Math.max(reset, 60), 3600) * 1000, 'rate limited')
      return null
    }
    if (!res.ok) return null

    // Proactively pause if we've drained the current window. Only act when the
    // header is actually present — a missing header must not read as 0.
    const remainingRaw = res.headers.get('x-ratelimit-remaining')
    if (remainingRaw != null && Number(remainingRaw) <= 1) {
      const reset = headerNum(res, 'x-ratelimit-reset') || 60
      openCircuit(Math.min(reset, 120) * 1000, 'window exhausted')
    }
    return await res.json()
  } catch {
    return null
  }
}

// In-memory cache. OpenAQ data refreshes ~hourly, so a long TTL both keeps the
// widget snappy and keeps request volume low. Misses (no nearby station) are
// cached for a while too so we don't re-probe station-less areas repeatedly.
const cache = new Map<string, { at: number; data: unknown }>()
const CACHE_TTL = 30 * 60 * 1000
const MISS_CACHE_TTL = 10 * 60 * 1000

function readCache<T>(k: string): T | undefined {
  const c = cache.get(k)
  if (!c) return undefined
  const ttl = c.data == null ? MISS_CACHE_TTL : CACHE_TTL
  if (Date.now() - c.at < ttl) return c.data as T
  return undefined
}

export function isOpenAqConfigured(): boolean {
  return apiKey() !== undefined
}

/** Stations (with AQI) inside a bbox, for the map overlay. */
export async function getStationsInBbox(
  bbox: { west: number; south: number; east: number; north: number },
  opts: { limit?: number } = {},
): Promise<AirQualityStation[]> {
  if (!apiKey()) return []
  // Each location needs its own /latest call, so keep this modest — the token
  // bucket in openaqGet meters it regardless, but a smaller set is cheaper.
  const limit = Math.min(opts.limit ?? 20, 30)
  const key = `bbox:${bbox.west.toFixed(2)},${bbox.south.toFixed(2)},${bbox.east.toFixed(2)},${bbox.north.toFixed(2)}:${limit}`
  const hit = readCache<AirQualityStation[]>(key)
  if (hit) return hit

  // OpenAQ bbox order is minLon,minLat,maxLon,maxLat.
  const bboxParam = `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`
  const locData = await openaqGet(`/locations?bbox=${bboxParam}&limit=${limit}`)
  const locations: OpenAqLocation[] = locData?.results ?? []
  if (locations.length === 0) {
    cache.set(key, { at: Date.now(), data: [] })
    return []
  }

  const stations = (
    await Promise.all(
      locations.map(async (loc) => {
        const latest = await openaqGet(`/locations/${loc.id}/latest`)
        return assembleStation(loc, latest?.results ?? [])
      }),
    )
  ).filter((s): s is AirQualityStation => s !== null)

  cache.set(key, { at: Date.now(), data: stations })
  return stations
}

// Probe at most this many nearest stations. A single station usually measures
// just one or two pollutants (a school might report only pm2.5), so an area AQI
// blends a few monitors to catch the dominant pollutant — like AirNow. Kept
// small (and fetched serially with early-exit below) to stay within OpenAQ's
// rate terms.
const AGGREGATE_STATIONS = 4
// Pollutants that drive the index; once collected we stop probing more stations.
const WANTED_POLLUTANTS: (keyof AqiComponents)[] = [
  'pm2_5', 'o3', 'pm10', 'no2', 'so2', 'co',
]

/**
 * Area air quality for the weather widget: the nearest available reading for
 * each pollutant across the nearby stations, combined into one AQI whose value
 * is the max sub-index (the dominant pollutant), à la AirNow. Reporting the
 * single nearest station instead under-reports whenever the dominant pollutant
 * (often ozone in summer) is only measured at a neighbouring station.
 *
 * `stationName`/`distanceKm` describe the station that supplied the *dominant*
 * pollutant, so the widget's "OpenAQ · <station>" label points at what's
 * actually driving the number.
 */
export async function getNearestStationAirQuality(
  lat: number,
  lng: number,
): Promise<{
  components: AqiComponents
  airQuality: AirQuality
  stationName: string
  distanceKm: number
} | null> {
  if (!apiKey()) return null
  // ~1km cache grid: nearby lookups share one entry, cutting request volume.
  const key = `near:${lat.toFixed(2)},${lng.toFixed(2)}`
  const hit =
    readCache<Awaited<ReturnType<typeof getNearestStationAirQuality>>>(key)
  if (hit !== undefined) return hit

  const data = await openaqGet(
    `/locations?coordinates=${lat},${lng}&radius=25000&limit=12`,
  )
  const locations: OpenAqLocation[] = data?.results ?? []
  const ranked = locations
    .map((loc) => ({
      loc,
      d: haversineKm(lat, lng, loc.coordinates?.latitude, loc.coordinates?.longitude),
    }))
    .filter((x): x is { loc: OpenAqLocation; d: number } => x.d != null)
    .sort((a, b) => a.d - b.d)
    .slice(0, AGGREGATE_STATIONS)

  // Fetch nearest stations' latest readings SERIALLY (never a burst), merging in
  // distance order so the nearest reading wins per pollutant. Stop early once
  // pm2.5 + ozone (the usual index drivers) are in hand, so a typical lookup is
  // just 1–2 /latest calls rather than one per station.
  const merged: AqiComponents = {}
  const provenance = new Map<string, { name: string; d: number }>()
  for (const { loc, d } of ranked) {
    if (WANTED_POLLUTANTS.every((p) => merged[p] != null)) break
    const latest = await openaqGet(`/locations/${loc.id}/latest`)
    const station = assembleStation(loc, latest?.results ?? [])
    if (station) {
      for (const [k, v] of Object.entries(station.components)) {
        if (merged[k as keyof AqiComponents] == null && v != null) {
          merged[k as keyof AqiComponents] = v
          provenance.set(k, { name: station.name, d })
        }
      }
    }
    if (merged.pm2_5 != null && merged.o3 != null) break
  }

  if (Object.keys(merged).length === 0) {
    cache.set(key, { at: Date.now(), data: null })
    return null
  }

  // Country of the nearest station (they're all within 25km → same country).
  const country = countryCode(ranked[0].loc)
  const airQuality = computeAirQuality(merged, country)
  if (!airQuality) {
    cache.set(key, { at: Date.now(), data: null })
    return null
  }
  // Attribute to the station that supplied the dominant pollutant.
  const src = (airQuality.dominant && provenance.get(airQuality.dominant)) ||
    provenance.values().next().value
  const result = {
    components: merged,
    airQuality: {
      ...airQuality,
      source: 'openaq' as const,
      stationName: src?.name,
    },
    stationName: src?.name ?? 'Station',
    distanceKm: src?.d ?? 0,
  }
  cache.set(key, { at: Date.now(), data: result })
  return result
}

/** GeoJSON FeatureCollection of stations for the map overlay. */
export async function getStationsGeoJson(bbox: {
  west: number
  south: number
  east: number
  north: number
}) {
  const stations = await getStationsInBbox(bbox)
  return {
    type: 'FeatureCollection' as const,
    features: stations
      .filter((s) => s.airQuality)
      .map((s) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] },
        properties: {
          name: s.name,
          index: s.airQuality!.index,
          severity: s.airQuality!.severity,
          standard: s.airQuality!.standard,
          dominant: s.airQuality!.dominant,
          updatedAt: s.updatedAt,
        },
      })),
  }
}
