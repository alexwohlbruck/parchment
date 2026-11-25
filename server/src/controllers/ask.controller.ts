import { Elysia, t } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import { i18nPlugin } from '../lib/i18n/plugin'
import { logError } from '../lib/logger'
import { resolveAskAccess } from '../services/ask/ask-model.service'
import { runAsk } from '../services/ask/ask-agent.service'
import { recordAskQuestion } from '../services/ask/ask-usage.service'
import { meterModel } from '../lib/ask/ask-usage'
import { knownPlaces } from '../lib/ask/known-places'
import { RoutingPreferencesSchema, TripModeTokenSchema, VehicleSchema } from '../types/directions-api.types'
import { getAskPreferences } from '../services/user-preferences.service'
import { findPlaceOnWeb, WebPlaceError } from '../services/web-place.service'
import type { AskAccess, AskEvent } from '../types/ask.types'
import type { TranslateFn } from '../lib/i18n/i18n.types'
import type { Place } from '../types/place.types'
import type { Vehicle } from '../types/trip.types'

const encoder = new TextEncoder()

function sseFrame(event: AskEvent): Uint8Array {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
}

type Denied = Extract<AskAccess, { allowed: false }>

/** Answers a user Ask can't serve right now. */
function accessDenied(access: Denied, t: TranslateFn, status: (code: 429 | 403 | 501, body: unknown) => unknown) {
  switch (access.reason) {
    case 'quota-exceeded':
      return status(429, { message: t('errors.ask.quotaExceeded'), reason: access.reason, limit: access.limit, resetsAt: access.resetsAt })
    case 'not-permitted':
      return status(403, { message: t('errors.ask.notPermitted'), reason: access.reason })
    case 'turned-off':
      return status(403, { message: t('errors.ask.turnedOff'), reason: access.reason })
    default:
      return status(501, { message: t('errors.ask.notConfigured'), reason: access.reason })
  }
}

const app = new Elysia()
  .use(i18nPlugin)
  .use(requireAuth)

  .get(
    '/ask/access',
    async ({ user }) => {
      const access = await resolveAskAccess(user.id)
      if (!access.allowed) return access
      const { model, ...granted } = access
      return granted as AskAccess
    },
    {
      detail: {
        tags: ['Ask'],
        summary: 'Whether the user can use Ask',
        description:
          'Ask runs on the user\'s own OpenRouter key when they have one, otherwise on the system key, which allows questions per UTC month by plan: `ask:trial` 5 (`ASK_QUESTIONS_TRIAL`), `ask:basic` 50 (`ASK_QUESTIONS_BASIC`) and `premium:ask` 1000 (`ASK_QUESTIONS_PREMIUM`), the best one held winning; 0 means no limit. On the system key, `quota` carries `used`, `limit`, `remaining` and `resetsAt`, or is null without a limit. `reason` is `not-configured` when no key exists at all, `not-permitted` when only the system key exists and the user holds none of those permissions, `quota-exceeded` (with `limit` and `resetsAt`) when this month\'s questions are used up, and `turned-off` when the user switched Ask off in their settings.',
      },
    },
  )

  .post(
    '/ask',
    async ({ body, user, language, request, status, t }) => {
      const access = await resolveAskAccess(user.id)
      if (!access.allowed) return accessDenied(access, t, status)

      const meter = meterModel(access.model)
      const preferences = await getAskPreferences(user.id)

      const origin =
        body.lat !== undefined && body.lng !== undefined
          ? { lat: body.lat, lng: body.lng }
          : undefined

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const emit = (event: AskEvent) => {
            if (!request.signal.aborted) controller.enqueue(sseFrame(event))
          }
          try {
            await runAsk(
              meter.model,
              { question: body.question, history: body.history, origin, placeId: body.placeId, point: body.point },
              {
                userId: user.id,
                language,
                origin,
                places: preferences.shareLocation ? knownPlaces(body.here, body.places) : new Map(),
                units: body.units ?? 'metric',
                vehicles: (body.vehicles ?? []) as Vehicle[],
                routingPreferences: body.routingPreferences,
                excludedModes: body.excludedModes,
                routes: new Map(),
                now: new Date(),
                signal: request.signal,
                seen: new Map<string, Place>(),
                reviews: new Map(),
                model: preferences.webSearch ? meter.model : undefined,
                sources: new Map(),
                emit,
              },
            )
          } catch (error) {
            if (!request.signal.aborted) {
              logError('Ask failed', error)
              emit({ type: 'error', message: t('errors.server.internal') })
            }
          }
          emit({ type: 'done' })
          controller.close()
          recordAskQuestion(user.id, access.keySource, meter.totals).catch((error) =>
            logError('Recording Ask usage failed', error),
          )
        },
      })

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'X-Accel-Buffering': 'no',
        },
      })
    },
    {
      body: t.Object({
        question: t.String({ minLength: 1, maxLength: 500 }),
        history: t.Optional(
          t.Array(
            t.Object({
              role: t.Union([t.Literal('user'), t.Literal('assistant')]),
              content: t.String({ maxLength: 4000 }),
            }),
            { maxItems: 12 },
          ),
        ),
        placeId: t.Optional(
          t.String({ description: 'A place the question is about, e.g. "osm/node/123". Its details and reviews are read first.' }),
        ),
        point: t.Optional(
          t.Object(
            {
              lat: t.Number({ minimum: -90, maximum: 90 }),
              lng: t.Number({ minimum: -180, maximum: 180 }),
              name: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
            },
            { description: 'A spot on the map the question is about, such as an address, when it has no placeId' },
          ),
        ),
        lat: t.Optional(t.Number({ minimum: -90, maximum: 90, description: "The map's centre" })),
        lng: t.Optional(t.Number({ minimum: -180, maximum: 180 })),
        here: t.Optional(
          t.Object(
            { lat: t.Number({ minimum: -90, maximum: 90 }), lng: t.Number({ minimum: -180, maximum: 180 }) },
            { description: "The device's own position, when the user has shared it" },
          ),
        ),
        places: t.Optional(
          t.Array(
            t.Object({
              name: t.String({ minLength: 1, maxLength: 60 }),
              lat: t.Number({ minimum: -90, maximum: 90 }),
              lng: t.Number({ minimum: -180, maximum: 180 }),
            }),
            { maxItems: 10, description: 'Saved places like Home and Work, which the model may name as trip ends without seeing their coordinates' },
          ),
        ),
        units: t.Optional(t.Union([t.Literal('metric'), t.Literal('imperial')])),
        vehicles: t.Optional(
          t.Array(VehicleSchema, { maxItems: 20, description: 'The user\'s vehicles, so Ask plans trips the way Directions does' }),
        ),
        routingPreferences: t.Optional(RoutingPreferencesSchema),
        excludedModes: t.Optional(
          t.Array(TripModeTokenSchema, { uniqueItems: true, description: 'Modes the user does not use, as Directions sends them' }),
        ),
      }),
      detail: {
        tags: ['Ask'],
        summary: 'Answer a question about places',
        description:
          'Streams Server-Sent Events while a language model searches Parchment\'s place data. `step` events report each search as it runs (`running`, then `done` or `failed`); `reach` carries a travel-time polygon when the question implies one; `answer` carries a short text and the cited places, every one of which came from a search; `error` and then `done` close the stream. `history` holds earlier turns of the same conversation, oldest first. `here` and `places` give the model names (\"here\", \"home\") it can route between; their coordinates go to tools, never into the prompt. A `trip` event carries the trip the answer recommends, for opening in Directions; `route` and `canvas` events name a route or canvas saved to the user\'s library. Every question counts toward the user\'s monthly usage; on the system key, a used-up allowance returns 429 with `reason: quota-exceeded` and `resetsAt`.',
      },
    },
  )

  .post(
    '/ask/web-place',
    async ({ body, user, language, request, status, t }) => {
      const access = await resolveAskAccess(user.id)
      if (!access.allowed) return accessDenied(access, t, status)
      const meter = meterModel(access.model)
      try {
        return await findPlaceOnWeb(body.query, {
          near: { lat: body.lat, lng: body.lng },
          model: meter.model,
          language,
          signal: request.signal,
        })
      } catch (error) {
        if (error instanceof WebPlaceError) return status(400, { message: error.message })
        throw error
      } finally {
        recordAskQuestion(user.id, access.keySource, meter.totals).catch((error) =>
          logError('Recording Ask usage failed', error),
        )
      }
    },
    {
      body: t.Object({
        query: t.String({ minLength: 1, maxLength: 200, description: 'The business name, e.g. "Pianoland, Brooklyn"' }),
        lat: t.Number({ minimum: -90, maximum: 90 }),
        lng: t.Number({ minimum: -180, maximum: 180 }),
      }),
      detail: {
        tags: ['Ask'],
        summary: 'Find a business on its own website',
        description:
          'For a business that place search doesn\'t find: a language model finds the business\'s own website, and the place is read from that site, never from directories or review sites. `status` is `found` with a `web/…` place that isn\'t on the map yet (its `unmapped` field holds the tags a new OSM node would carry), `mapped` with the OSM place it turned out to be, or `not-found` with a `reason`. Counts as one Ask question.',
      },
    },
  )

export default app
