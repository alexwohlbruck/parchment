/**
 * Transit endpoints.
 *
 * Live vehicle positions, route topology, stop departures and station detail,
 * all served by Barrelman. Every route requires auth: without it, anyone could
 * enumerate live vehicle positions and the full route graph anonymously.
 */

import { Elysia, t } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import { requestBarrelman } from '../services/barrelman.service'
import { findBoardingCandidates } from '../services/boarding-candidates.service'
import {
  routesRunningAt,
  SERVICE_BOARD_EVENTS,
  type ServiceBoard,
} from '../lib/service-window'

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
 *
 * Each board covers the whole station complex, so the answer can be
 * compared against the complex-wide list of lines the panel draws. A stop
 * present with an empty list has no departures at all; a stop absent
 * altogether could not be answered — either the call failed, or the board
 * came back too short to mean anything (see `service-window`).
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
        // The whole complex, not one platform. The bullets being judged are
        // every line a rider reaches from this stop — the station's own
        // (`via: 'station'`, which spans the complex) and the ones
        // transfers.txt joins to it — so a board for a single platform
        // marked the rest "not running": at Atlantic Av the BMT platform
        // knows nothing of the IRT 2/4 one level down. `complex` adds the
        // same-named siblings and `transfers` the joined ones, which is the
        // same expansion route-detail used to list the bullets.
        const res = await requestBarrelman('/transit/departures', {
          feedId,
          stopId,
          complex: 'true',
          transfers: 'true',
          // Deliberately untrimmed: asking barrelman for a window would hide
          // how far the page actually reached, and that reach is what says
          // whether an absent line is missing or merely off the end.
          n: String(SERVICE_BOARD_EVENTS),
        })
        if (!res.ok) continue
        const groups = (await res.json()) as Array<ServiceBoard & {
          stop?: { feedOnestopId?: string }
        }>
        const boards = Array.isArray(groups) ? groups : []
        for (const g of boards) {
          if (g.stop?.feedOnestopId && !feedOnestopId) feedOnestopId = g.stop.feedOnestopId
        }
        // A board that came back EMPTY is not the same as one that never came
        // back. Upstream answered and named nothing departing here, which is
        // exactly what a stop looks like when the line has stopped calling at
        // it — the 5's Dyre Av branch at three in the morning. Reported as an
        // empty list; a stop is omitted when the call failed or when the board
        // was too short to judge, and only those are missing evidence.
        const ids = routesRunningAt(boards, Date.now())
        if (ids) running[stopId] = ids
      } catch {
        // one unreachable board must not fail the rest, and must not be
        // mistaken for one that answered
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

const list = (value?: string) => (value ?? '').split(',').map((s) => s.trim()).filter(Boolean)

app.get('/boarding-candidates', async ({ query, set }) => {
  set.headers['Cache-Control'] = 'no-cache'
  return findBoardingCandidates({
    stopId: query.stopId,
    stops: list(query.stops),
    departure: query.departure,
    arrival: query.arrival,
    routes: list(query.routes),
    directionId: query.directionId || undefined,
  })
}, {
  query: t.Object({
    stopId: t.String({ minLength: 3, description: 'Timetable stop id (`{feed}_{stop}`) where the leg boards' }),
    stops: t.String({ minLength: 3, description: "Comma-separated stop ids after boarding, in ride order, the alighting stop last" }),
    departure: t.String({ format: 'date-time', description: 'Planned departure from the boarding stop' }),
    arrival: t.String({ format: 'date-time', description: 'Planned arrival at the alighting stop' }),
    routes: t.Optional(t.String({ description: "Comma-separated short names of the leg's interchangeable routes, its own included" })),
    directionId: t.Optional(t.String()),
  }),
  detail: {
    tags: ['Transit'],
    summary: 'Runs a rider may have boarded in place of the planned one',
    description:
      'Runs leaving the boarding stop from 10 minutes before to 20 minutes after `departure`: any run of `routes` '
      + 'in the leg\'s direction, and runs of other routes that also call at the alighting stop. Each lists the '
      + 'given later stops it calls at (`calls`, at most ten sampled, the alighting stop always kept), so an express '
      + 'can be told from a local, and carries its live `position` when the feed publishes vehicle positions. '
      + '`stops` names the later stops whose boards could be read: a run missing from one of those does not call there.',
  },
})

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
