import { Elysia, t } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import { getStationsGeoJson } from '../services/air-quality.service'
import { parseBbox, EMPTY_FC } from '../lib/wildfire'
import { getFireHotspots, getFirePerimeters, getSmokePlumes } from '../services/wildfire.service'

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
    return await getFireHotspots(bbox, Number(query.days) || 1)
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
    return await getFirePerimeters(bbox)
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
    return await getSmokePlumes(bbox)
  },
  { query: bboxQuery },
)

export default new Elysia().use(tileApp).use(app)
