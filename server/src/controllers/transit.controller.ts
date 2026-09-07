/**
 * Transit endpoints.
 *
 * Live vehicle positions, route topology, stop departures and station detail,
 * all served by Barrelman. Every route requires auth: without it, anyone could
 * enumerate live vehicle positions and the full route graph anonymously.
 */

import { Elysia } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import { requestBarrelman } from '../services/barrelman.service'

const app = new Elysia({ prefix: '/transit' }).use(requireAuth)

app.get('/vehicles', ({ query }) =>
  requestBarrelman('/transit/vehicles', query, { cacheControl: 'no-cache' }),
  { detail: { tags: ['Transit'], summary: 'GTFS-RT vehicle positions' } },
)

app.get('/shapes', ({ query }) =>
  requestBarrelman('/transit/shapes', query, { cacheControl: 'public, max-age=86400' }),
  { detail: { tags: ['Transit'], summary: 'Route shape geometry' } },
)

app.get('/route-vehicles', ({ query }) =>
  requestBarrelman('/transit/route-vehicles', query, { cacheControl: 'no-cache' }),
  { detail: { tags: ['Transit'], summary: 'Route-specific vehicle positions' } },
)

app.get('/trip-stops', ({ query }) =>
  requestBarrelman('/transit/trip-stops', query, { cacheControl: 'no-cache' }),
  { detail: { tags: ['Transit'], summary: 'Trip stop times' } },
)

/**
 * Which lines are actually running at each of a set of stops.
 *
 * The route panel needs this for every stop of a line at once, and
 * barrelman answers one stop per call. Asked from the browser that is one
 * request per stop — forty of them, six at a time, each landing at its own
 * moment, so a rider watched the bullets fade in one by one down the list.
 * Fanning out here costs the same upstream calls over a fast nearby link
 * and hands the panel ONE answer: the whole list settles together.
 *
 * Only route ids come back. The boards are large and the caller is asking a
 * yes/no question about each line.
 */
app.get('/service-at-stops', async ({ query, set }) => {
  const feedId = String(query.feedId ?? '')
  const stopIds = String(query.stopIds ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!feedId || !stopIds.length) {
    set.status = 400
    return { error: 'feedId and stopIds are required' }
  }
  // Bounded, so one request cannot fan out without limit.
  const wanted = [...new Set(stopIds)].slice(0, 120)

  const running: Record<string, string[]> = {}
  let feedOnestopId: string | undefined
  let next = 0
  const worker = async () => {
    while (next < wanted.length) {
      const stopId = wanted[next++]
      try {
        const res = await requestBarrelman('/transit/departures', { feedId, stopId })
        if (!res.ok) continue
        const groups = (await res.json()) as Array<{
          stop?: { feedOnestopId?: string }
          departures?: Array<{ route?: { id?: string } }>
        }>
        const ids = new Set<string>()
        for (const g of Array.isArray(groups) ? groups : []) {
          if (g.stop?.feedOnestopId && !feedOnestopId) feedOnestopId = g.stop.feedOnestopId
          for (const d of g.departures ?? []) if (d.route?.id) ids.add(d.route.id)
        }
        // An empty board is missing evidence, not a closed line, and the
        // caller has to tell those apart — so it is omitted rather than
        // reported as "nothing runs here".
        if (ids.size) running[stopId] = [...ids]
      } catch {
        // one unreachable board must not fail the rest
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, wanted.length) }, worker))

  set.headers['Cache-Control'] = 'no-cache'
  return { running, feedOnestopId }
}, {
  detail: {
    tags: ['Transit'],
    summary: 'Route ids with a departure at each of several stops',
  },
})

app.get('/route-detail', ({ query }) =>
  requestBarrelman('/transit/route-detail', query, { cacheControl: 'public, max-age=3600' }),
  { detail: { tags: ['Transit'], summary: 'Route detail with stops and shape' } },
)

// A route id off a map tile belongs to a feed the tile never names, and
// every other transit endpoint is keyed by the pair — so the map resolves
// it here before it can open anything.
app.get('/resolve-route', ({ query }) =>
  requestBarrelman('/transit/resolve-route', query, { cacheControl: 'public, max-age=3600' }),
  { detail: { tags: ['Transit'], summary: 'Resolve a bare GTFS route id at a location' } },
)

app.get('/departures', ({ query }) =>
  requestBarrelman('/transit/departures', query, { cacheControl: 'public, max-age=30' }),
  { detail: { tags: ['Transit'], summary: 'Upcoming departures at a stop' } },
)

app.get('/alerts', ({ query }) =>
  requestBarrelman('/transit/alerts', query, { cacheControl: 'public, max-age=60' }),
  { detail: { tags: ['Transit'], summary: 'GTFS-RT service alerts for routes, stops and trips' } },
)

app.get('/bikes-allowed', ({ query }) =>
  requestBarrelman('/transit/bikes-allowed', query, { cacheControl: 'public, max-age=3600' }),
  { detail: { tags: ['Transit'], summary: 'Batch check bikes_allowed for routes' } },
)

app.get('/station/:feedId/:stopId', ({ params }) =>
  requestBarrelman(
    `/transit/station/${encodeURIComponent(params.feedId)}/${encodeURIComponent(params.stopId)}`,
    {},
    { cacheControl: 'public, max-age=3600' },
  ),
  { detail: { tags: ['Transit'], summary: 'Station detail with entrances and buildings' } },
)

app.get('/nearest-entrance', ({ query }) =>
  requestBarrelman('/transit/nearest-entrance', query, { cacheControl: 'public, max-age=3600' }),
  { detail: { tags: ['Transit'], summary: 'Nearest station entrance lookup' } },
)

export default app
