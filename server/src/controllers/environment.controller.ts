import { Elysia, t } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import { integrationManager } from '../services/integrations'
import { IntegrationId } from '../types/integration.types'
import { getStationsGeoJson } from '../services/air-quality.service'
import { parseBbox, parseFirmsCsv, EMPTY_FC, type Bbox } from '../lib/wildfire'

/** NASA FIRMS MAP_KEY from the user-configured integration (undefined if unset). */
function firmsKey(): string | undefined {
  const rec = integrationManager
    .getConfiguredIntegrations()
    .find((i) => i.integrationId === IntegrationId.FIRMS)
  return (rec?.config as { apiKey?: string } | undefined)?.apiKey?.trim() || undefined
}

// ---------------------------------------------------------------------------
// Raster tile proxy (XYZ → WMS). Overlays that ARE continuous/dense — the AQI
// heatmap (CAMS) and fire hotspots (FIRMS) — are served as raster tiles so the
// map caches per-tile and never refetches-on-pan (which was hitting FIRMS'
// rate limit). We accept standard {z}/{x}/{y}, convert to the tile's EPSG:3857
// bounds, and proxy a WMS GetMap. Keys stay server-side.
// ---------------------------------------------------------------------------

const ORIGIN_SHIFT = Math.PI * 6378137 // 20037508.342789244

/** EPSG:3857 bounds (meters) of an XYZ tile: "minX,minY,maxX,maxY". */
function tileBounds3857(z: number, x: number, y: number): string {
  const size = (2 * ORIGIN_SHIFT) / 2 ** z
  const minX = -ORIGIN_SHIFT + x * size
  const maxX = -ORIGIN_SHIFT + (x + 1) * size
  const maxY = ORIGIN_SHIFT - y * size
  const minY = ORIGIN_SHIFT - (y + 1) * size
  return `${minX},${minY},${maxX},${maxY}`
}

// 1×1 transparent PNG — returned when a source is unconfigured or errors, so
// raster tiles degrade silently instead of throwing.
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

function transparentTile(): Response {
  return new Response(TRANSPARENT_PNG, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=60' },
  })
}

/** Fetch a WMS GetMap PNG (follows CAMS' 302 → streaming render) and forward it. */
async function proxyWmsTile(url: string, maxAge: number): Promise<Response> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok || !res.headers.get('content-type')?.includes('image')) {
      return transparentTile()
    }
    return new Response(await res.arrayBuffer(), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': `public, max-age=${maxAge}`,
      },
    })
  } catch {
    return transparentTile()
  }
}

/**
 * Environment overlays — air quality (OpenAQ) + wildfires (NASA FIRMS hotspots,
 * NIFC perimeters, NOAA HMS smoke). All endpoints return GeoJSON keyed off the
 * current map viewport (bbox = "west,south,east,north") and degrade to an empty
 * FeatureCollection when a source is unconfigured or fails, so the map layers
 * never break.
 */

const NIFC_PERIMETERS =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query'
const NOAA_HMS_SMOKE =
  'https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/NOAA_Satellite_Smoke_Detection_(v1)/FeatureServer/0/query'

/** Query an ArcGIS FeatureServer for GeoJSON intersecting a bbox. */
async function arcgisGeoJson(
  queryUrl: string,
  bbox: Bbox,
  outFields: string,
  recordCount = 500,
): Promise<unknown> {
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
    if (!res.ok) return EMPTY_FC
    const data = await res.json()
    return data?.type === 'FeatureCollection' ? data : EMPTY_FC
  } catch {
    return EMPTY_FC
  }
}

const bboxQuery = t.Object({ bbox: t.String() })
const tileParams = t.Object({ z: t.Numeric(), x: t.Numeric(), y: t.Numeric() })

// Public raster-tile sub-app. MapLibre raster sources don't carry our auth
// header, and these are public map tiles (provider keys stay server-side), so
// no requireAuth here.
const tileApp = new Elysia({ prefix: '/environment' })

// AQI heatmap raster tiles — CAMS (Copernicus) global PM2.5 surface. Public
// token, commercial-licensed. Colored by CAMS' concentration ramp.
tileApp.get(
  '/tiles/aqi/:z/:x/:y',
  async ({ params }) => {
    const bbox = tileBounds3857(params.z, params.x, params.y)
    const url =
      'https://eccharts.ecmwf.int/wms/?token=public&service=WMS&request=GetMap' +
      '&version=1.3.0&layers=composition_pm2p5&crs=EPSG:3857' +
      `&bbox=${bbox}&width=256&height=256&format=image/png&transparent=true` +
      '&styles=sh_all_pm2p5_defra_daqi'
    return proxyWmsTile(url, 1800) // CAMS updates ~2×/day
  },
  { params: tileParams },
)

// Authenticated data routes (GeoJSON overlays).
const app = new Elysia({ prefix: '/environment' }).use(requireAuth)

// Air quality — OpenAQ ground stations (needs the OpenAQ integration configured)
app.get(
  '/air-quality',
  async ({ query, set }) => {
    set.headers['cache-control'] = 'public, max-age=300'
    const bbox = parseBbox(query.bbox)
    if (!bbox) return EMPTY_FC
    return await getStationsGeoJson(bbox)
  },
  { query: bboxQuery },
)

// Wildfire hotspots — NASA FIRMS VIIRS active fire (needs the FIRMS integration configured)
app.get(
  '/wildfire/hotspots',
  async ({ query, set }) => {
    set.headers['cache-control'] = 'public, max-age=600'
    const bbox = parseBbox(query.bbox)
    if (!bbox) return EMPTY_FC
    const key = firmsKey()
    if (!key) return EMPTY_FC
    const days = Math.min(Math.max(Number(query.days) || 1, 1), 10)
    const area = `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`
    // The single-satellite CSV feeds are thin; merge all VIIRS + MODIS to match
    // the combined WMS coverage.
    const sources = [
      'VIIRS_NOAA20_NRT',
      'VIIRS_NOAA21_NRT',
      'VIIRS_SNPP_NRT',
      'MODIS_NRT',
    ]
    const results = await Promise.all(
      sources.map(async (src) => {
        try {
          const res = await fetch(
            `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${src}/${area}/${days}`,
            { signal: AbortSignal.timeout(15_000) },
          )
          if (!res.ok) return []
          return parseFirmsCsv(await res.text()).features
        } catch {
          return []
        }
      }),
    )

    // VIIRS/MODIS flag huge numbers of low-intensity thermal anomalies (crop
    // burns, gas flares). Drop low confidence, then keep the most intense so the
    // vector layer stays crisp/meaningful and renders fast even continent-wide.
    let features = results.flat().filter((f) => {
      const c = f.properties.confidence as string | null
      if (c === 'l') return false // VIIRS low
      const n = Number(c)
      return Number.isNaN(n) || n >= 50 // MODIS: drop < 50
    })
    const MAX_FIRES = 5000
    if (features.length > MAX_FIRES) {
      features.sort(
        (a, b) => (Number(b.properties.frp) || 0) - (Number(a.properties.frp) || 0),
      )
      features = features.slice(0, MAX_FIRES)
    }
    return { type: 'FeatureCollection' as const, features }
  },
  { query: t.Object({ bbox: t.String(), days: t.Optional(t.String()) }) },
)

// Wildfire perimeters — NIFC WFIGS current interagency perimeters (keyless)
app.get(
  '/wildfire/perimeters',
  async ({ query, set }) => {
    set.headers['cache-control'] = 'public, max-age=1800'
    const bbox = parseBbox(query.bbox)
    if (!bbox) return EMPTY_FC
    return await arcgisGeoJson(
      NIFC_PERIMETERS,
      bbox,
      'poly_IncidentName,attr_IncidentName,attr_FireDiscoveryDateTime',
    )
  },
  { query: bboxQuery },
)

// Smoke plumes — NOAA HMS satellite smoke detection (keyless)
app.get(
  '/wildfire/smoke',
  async ({ query, set }) => {
    set.headers['cache-control'] = 'public, max-age=1800'
    const bbox = parseBbox(query.bbox)
    if (!bbox) return EMPTY_FC
    return await arcgisGeoJson(
      NOAA_HMS_SMOKE,
      bbox,
      'Density,Satellite,Start,End_',
    )
  },
  { query: bboxQuery },
)

export default new Elysia().use(tileApp).use(app)
