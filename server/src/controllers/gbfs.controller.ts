/**
 * GBFS shared mobility endpoints.
 *
 * Dock and vehicle availability for bikeshare / scooter systems, served by
 * Barrelman. Authenticated for the same reason as transit: live availability
 * shouldn't be enumerable anonymously.
 */

import { Elysia, t } from 'elysia'
import { permissions, requireAuth } from '../middleware/auth.middleware'
import { requestBarrelman } from '../services/barrelman.service'
import { rankAlternatives, type NearbyStation } from '../lib/dock-alternatives'
import { PermissionId } from '../types/auth.types'

const ALTERNATIVES_RADIUS_METERS = 700

const app = new Elysia({ prefix: '/gbfs' }).use(requireAuth)

app.get('/nearby-stations', ({ query }) =>
  requestBarrelman('/gbfs/nearby-stations', query, { cacheControl: 'no-cache' }),
  { detail: { tags: ['GBFS'], summary: 'Nearby stations with availability' } },
)

app.get('/systems', ({ query }) =>
  requestBarrelman('/gbfs/systems', query, { cacheControl: 'public, max-age=3600' }),
  { detail: { tags: ['GBFS'], summary: 'GBFS system catalog' } },
)

app.get('/station', ({ query }) =>
  requestBarrelman('/gbfs/station', query, { cacheControl: 'no-cache' }),
  {
    detail: {
      tags: ['GBFS'],
      summary: 'One station with live availability',
      description: 'By `systemId` + `stationId`, or the station nearest `lat`/`lng` within `radius` metres.',
    },
  },
)

app.use(permissions(PermissionId.PREMIUM_NAVIGATION)).get(
  '/station/alternatives',
  async ({ query, status }) => {
    const original = { lat: query.lat, lng: query.lng }
    const res = await requestBarrelman(
      '/gbfs/nearby-stations',
      { lat: query.lat, lng: query.lng, radius: ALTERNATIVES_RADIUS_METERS, limit: 15 },
      { cacheControl: 'no-cache' },
    )
    if (!res.ok) return status(502, { message: 'Station availability unavailable' })
    const { stations = [] } = (await res.json()) as { stations?: NearbyStation[] }
    const target = query.toLat != null && query.toLng != null ? { lat: query.toLat, lng: query.toLng } : null
    return { alternatives: rankAlternatives(stations, original, query.need, query.min ?? 3, target).slice(0, 5) }
  },
  {
    query: t.Object({
      lat: t.Number(),
      lng: t.Number(),
      need: t.Union([t.Literal('dock'), t.Literal('bike')]),
      min: t.Optional(t.Number({ minimum: 1 })),
      toLat: t.Optional(t.Number()),
      toLng: t.Optional(t.Number()),
    }),
    detail: {
      tags: ['GBFS'],
      summary: 'Stations to switch to when one fills up or runs dry',
      description:
        'Nearby stations within 700 m of `lat`/`lng` holding at least `min` (default 3) free docks '
        + '(`need=dock`) or bikes (`need=bike`), excluding the original. Ranked by distance to '
        + '`toLat`/`toLng` (where the traveller goes next) when given, else to the original. '
        + 'Requires the premium navigation permission.',
    },
  },
)

export default app
