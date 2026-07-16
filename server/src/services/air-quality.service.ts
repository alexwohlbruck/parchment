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

async function openaqGet(path: string): Promise<any | null> {
  const key = apiKey()
  if (!key) return null
  try {
    const res = await fetch(`${OPENAQ_BASE}${path}`, {
      headers: { 'X-API-Key': key },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// Small in-memory cache (OpenAQ updates ~hourly; stations move rarely).
const cache = new Map<string, { at: number; data: unknown }>()
const CACHE_TTL = 5 * 60 * 1000
// A miss (no station / transient OpenAQ failure) is cached only briefly so the
// widget doesn't get stuck on the modeled fallback for minutes at a time.
const MISS_CACHE_TTL = 45 * 1000

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
  const limit = Math.min(opts.limit ?? 50, 100)
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

/** Nearest station with a usable AQI, for the weather widget. */
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
  const key = `near:${lat.toFixed(3)},${lng.toFixed(3)}`
  const hit =
    readCache<Awaited<ReturnType<typeof getNearestStationAirQuality>>>(key)
  if (hit !== undefined) return hit

  const data = await openaqGet(
    `/locations?coordinates=${lat},${lng}&radius=25000&limit=8`,
  )
  const locations: OpenAqLocation[] = data?.results ?? []
  const ranked = locations
    .map((loc) => ({
      loc,
      d: haversineKm(lat, lng, loc.coordinates?.latitude, loc.coordinates?.longitude),
    }))
    .filter((x): x is { loc: OpenAqLocation; d: number } => x.d != null)
    .sort((a, b) => a.d - b.d)

  for (const { loc, d } of ranked) {
    const latest = await openaqGet(`/locations/${loc.id}/latest`)
    const station = assembleStation(loc, latest?.results ?? [])
    if (station?.airQuality) {
      const result = {
        components: station.components,
        airQuality: {
          ...station.airQuality,
          source: 'openaq' as const,
          stationName: station.name,
        },
        stationName: station.name,
        distanceKm: d,
      }
      cache.set(key, { at: Date.now(), data: result })
      return result
    }
  }
  cache.set(key, { at: Date.now(), data: null })
  return null
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
