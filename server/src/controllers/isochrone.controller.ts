/**
 * Isochrone endpoints.
 *
 * Reachability polygons ("how far can I get in N minutes?") computed by
 * Barrelman — GraphHopper for street modes, MOTIS plus walking egress for
 * transit.
 */

import { Elysia } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import { requestBarrelman } from '../services/barrelman.service'
import {
  ISOCHRONE_MODES,
  MAX_CONTOURS,
  maxDurationForMode,
  type IsochroneMode,
} from '../types/isochrone.types'

/**
 * Isochrones are far slower than the rest of Barrelman: a transit contour
 * fans out to hundreds of per-stop GraphHopper searches, and GraphHopper's
 * own per-search timeout is 60s. The shared 10s budget would abort a
 * perfectly healthy request, so this endpoint gets its own.
 */
const ISOCHRONE_TIMEOUT_MS = 60_000

/**
 * Reject isochrone parameters we can rule out without an upstream round
 * trip. Barrelman validates too, and `forwardErrorBody` surfaces its
 * messages verbatim — this exists to stop the requests that are expensive
 * to discover upstream (a 40-contour transit fan-out) or plainly malformed.
 *
 * Deliberately stricter than Barrelman on one point: only the canonical mode
 * names are accepted, not its aliases ('foot', 'cycling', …). Returns an
 * error message, or null when the query is acceptable.
 */
export function validateIsochroneQuery(
  query: Record<string, unknown>,
): string | null {
  const lat = Number(query.lat)
  const lng = Number(query.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return 'lat and lng are required and must be numbers'
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return 'lat must be [-90,90], lng must be [-180,180]'
  }

  const mode = query.mode ? String(query.mode) : 'walk'
  if (!(ISOCHRONE_MODES as readonly string[]).includes(mode)) {
    return `Unsupported mode "${mode}". Supported: ${ISOCHRONE_MODES.join(', ')}`
  }

  if (query.durations) {
    const durations = String(query.durations).split(',').filter(Boolean)
    if (durations.length > MAX_CONTOURS) {
      return `At most ${MAX_CONTOURS} durations per request`
    }
    const limit = maxDurationForMode(mode as IsochroneMode)
    for (const raw of durations) {
      const seconds = Number(raw)
      if (!Number.isFinite(seconds) || seconds <= 0) {
        return `Invalid duration "${raw}" — expected a positive number of seconds`
      }
      if (seconds > limit) {
        return `Duration ${seconds}s exceeds the ${limit}s limit for mode "${mode}"`
      }
    }
  }

  return null
}

function badRequest(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  })
}

const app = new Elysia({ prefix: '/isochrone' }).use(requireAuth)

app.get('/', ({ query }) => {
  const invalid = validateIsochroneQuery(query)
  if (invalid) return badRequest(invalid)

  return requestBarrelman('/isochrone', query, {
    // Transit contours are a function of the departure time, so a cached
    // answer goes stale in a way the client has no way to notice.
    cacheControl: 'no-cache',
    timeoutMs: ISOCHRONE_TIMEOUT_MS,
    forwardErrorBody: true,
  })
}, {
  detail: {
    tags: ['Isochrone'],
    summary: 'Reachability polygons for a point',
    description:
      'Returns a GeoJSON FeatureCollection with one polygon per requested ' +
      'contour, ordered smallest first. `durations` is a comma-separated ' +
      'list of budgets in seconds; `mode` is one of walk, bike, car, transit.',
  },
})

app.get('/modes', () =>
  requestBarrelman('/isochrone/modes', {}, { cacheControl: 'public, max-age=3600' }),
  { detail: { tags: ['Isochrone'], summary: 'Supported isochrone modes and limits' } },
)

export default app
