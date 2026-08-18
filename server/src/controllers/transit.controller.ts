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

app.get('/route-detail', ({ query }) =>
  requestBarrelman('/transit/route-detail', query, { cacheControl: 'public, max-age=3600' }),
  { detail: { tags: ['Transit'], summary: 'Route detail with stops and shape' } },
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
