/**
 * GBFS shared mobility endpoints.
 *
 * Dock and vehicle availability for bikeshare / scooter systems, served by
 * Barrelman. Authenticated for the same reason as transit: live availability
 * shouldn't be enumerable anonymously.
 */

import { Elysia } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import { requestBarrelman } from '../services/barrelman.service'

const app = new Elysia({ prefix: '/gbfs' }).use(requireAuth)

app.get('/nearby-stations', ({ query }) =>
  requestBarrelman('/gbfs/nearby-stations', query, { cacheControl: 'no-cache' }),
  { detail: { tags: ['GBFS'], summary: 'Nearby stations with availability' } },
)

app.get('/systems', ({ query }) =>
  requestBarrelman('/gbfs/systems', query, { cacheControl: 'public, max-age=3600' }),
  { detail: { tags: ['GBFS'], summary: 'GBFS system catalog' } },
)

export default app
