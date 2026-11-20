import { integrationManager } from './integrations'
import { IntegrationId } from '../types/integration.types'
import { parseFirmsCsv, EMPTY_FC, type Bbox, type GeoJsonFeatureCollection } from '../lib/wildfire'
import type { FeatureCollection } from 'geojson'

const NIFC_PERIMETERS =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query'
const NOAA_HMS_SMOKE =
  'https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/NOAA_Satellite_Smoke_Detection_(v1)/FeatureServer/0/query'

// The single-satellite feeds are thin; together they match the combined WMS coverage.
const FIRMS_SOURCES = ['VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT', 'VIIRS_SNPP_NRT', 'MODIS_NRT']
const MAX_FIRES = 5000
const EMPTY = EMPTY_FC as unknown as FeatureCollection

/** NASA FIRMS MAP_KEY from the user-configured integration (undefined if unset). */
function firmsKey(): string | undefined {
  const rec = integrationManager
    .getConfiguredIntegrations()
    .find((i) => i.integrationId === IntegrationId.FIRMS)
  return (rec?.config as { apiKey?: string } | undefined)?.apiKey?.trim() || undefined
}

export function isFirmsConfigured(): boolean {
  return !!firmsKey()
}

/** Query an ArcGIS FeatureServer for GeoJSON intersecting a bbox. */
async function arcgisGeoJson(
  queryUrl: string,
  bbox: Bbox,
  outFields: string,
  recordCount = 500,
): Promise<FeatureCollection> {
  const params = new URLSearchParams({
    where: '1=1',
    geometry: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields,
    outSR: '4326',
    resultRecordCount: String(recordCount),
    f: 'geojson',
  })
  try {
    const res = await fetch(`${queryUrl}?${params}`, {
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return EMPTY
    const data = await res.json()
    return data?.type === 'FeatureCollection' ? data : EMPTY
  } catch {
    return EMPTY
  }
}

/** NASA FIRMS active fire detections over the last `days`, the most intense first when capped. */
export async function getFireHotspots(bbox: Bbox, days = 1): Promise<GeoJsonFeatureCollection> {
  const key = firmsKey()
  if (!key) return EMPTY_FC
  const span = Math.min(Math.max(Math.round(days), 1), 10)
  const area = `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`
  const results = await Promise.all(
    FIRMS_SOURCES.map(async (src) => {
      try {
        const res = await fetch(
          `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${src}/${area}/${span}`,
          { signal: AbortSignal.timeout(15_000) },
        )
        if (!res.ok) return []
        return parseFirmsCsv(await res.text()).features
      } catch {
        return []
      }
    }),
  )

  // Low-confidence detections are mostly crop burns and gas flares.
  let features = results.flat().filter((f) => {
    const c = f.properties.confidence as string | null
    if (c === 'l') return false
    const n = Number(c)
    return Number.isNaN(n) || n >= 50
  })
  if (features.length > MAX_FIRES) {
    features.sort((a, b) => (Number(b.properties.frp) || 0) - (Number(a.properties.frp) || 0))
    features = features.slice(0, MAX_FIRES)
  }
  return { type: 'FeatureCollection', features }
}

/** NIFC current interagency fire perimeters (US only). */
export function getFirePerimeters(bbox: Bbox): Promise<FeatureCollection> {
  return arcgisGeoJson(
    NIFC_PERIMETERS,
    bbox,
    'poly_IncidentName,attr_IncidentName,attr_FireDiscoveryDateTime,poly_GISAcres,attr_PercentContained',
  )
}

/** NOAA HMS satellite smoke plumes (North America). */
export function getSmokePlumes(bbox: Bbox): Promise<FeatureCollection> {
  return arcgisGeoJson(NOAA_HMS_SMOKE, bbox, 'Density,Satellite,Start,End_')
}
