/**
 * Offline region packages: places to search, a transit timetable and a street
 * graph for one bounding box, built by Barrelman. The app saves them with a
 * region so search and directions work with no connection.
 */

import { Elysia, t } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import { makeUserRateLimit } from '../middleware/rate-limit.middleware'
import { i18nPlugin } from '../lib/i18n/plugin'
import { requestBarrelman } from '../services/barrelman.service'
import { labelPlaces } from '../services/offline/places-package.service'
import type { Language } from '../lib/i18n/i18n.types'
import type { PlacesPackage } from '../types/offline-package.types'

/** Large regions take Barrelman a while to assemble, mostly the timetable. */
const PACKAGE_TIMEOUT_MS = 180_000

const UPSTREAM_PATHS = {
  places: '/search/region',
  timetable: '/transit/timetable',
  streets: '/route/graph',
} as const

const bboxQuery = t.Object({
  bbox: t.String({
    pattern: '^-?\\d+(\\.\\d+)?(,-?\\d+(\\.\\d+)?){3}$',
    description: 'west,south,east,north in WGS 84',
    examples: ['-74.000,40.715,-73.965,40.745'],
  }),
  days: t.Optional(t.Numeric({ minimum: 1, maximum: 21 })),
})

async function packageResponse(
  kind: keyof typeof UPSTREAM_PATHS,
  query: Record<string, unknown>,
  request: Request,
  transform?: (body: string) => string,
): Promise<Response> {
  const upstream = await requestBarrelman(UPSTREAM_PATHS[kind], query, {
    timeoutMs: PACKAGE_TIMEOUT_MS,
    forwardErrorBody: true,
  })
  if (!upstream.ok) return upstream
  let body = await upstream.text()
  if (transform) body = transform(body)
  const gzip = request.headers.get('accept-encoding')?.includes('gzip')
  return new Response(gzip ? new Uint8Array(Bun.gzipSync(body)) : body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      ...(gzip && { 'Content-Encoding': 'gzip' }),
    },
  })
}

const labelled = (language: Language) => (body: string) =>
  JSON.stringify(labelPlaces(JSON.parse(body) as PlacesPackage, language))

const app = new Elysia({ prefix: '/offline' })
  .use(i18nPlugin)
  .use(requireAuth)
  .use(makeUserRateLimit({ name: 'offline-packages', limit: 30 }))

const detail = (summary: string, description: string) => ({ tags: ['Offline'], summary, description })

app.get('/places', ({ query, request, language }) =>
  packageResponse('places', query, request, labelled(language as Language)), {
  query: bboxQuery,
  detail: detail(
    'Places package',
    'Named places, streets and transit stops inside the box, for searching and opening place pages offline.',
  ),
})

app.get('/timetable', ({ query, request }) => packageResponse('timetable', query, request), {
  query: bboxQuery,
  detail: detail(
    'Timetable package',
    'Scheduled transit inside the box: stops, routes, trips and walking transfers for the next `days` days (14 by default).',
  ),
})

app.get('/streets', ({ query, request }) => packageResponse('streets', query, request), {
  query: bboxQuery,
  detail: detail('Street graph package', 'A walking and cycling street graph covering the box.'),
})

export default app
