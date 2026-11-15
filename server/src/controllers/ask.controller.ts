import { Elysia, t } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import { i18nPlugin } from '../lib/i18n/plugin'
import { logError } from '../lib/logger'
import { resolveAskAccess } from '../services/ask/ask-model.service'
import { runAsk } from '../services/ask/ask-agent.service'
import { recordAskQuestion } from '../services/ask/ask-usage.service'
import { meterModel } from '../lib/ask/ask-usage'
import { knownPlaces } from '../lib/ask/known-places'
import { VehicleSchema } from '../types/directions-api.types'
import type { AskAccess, AskEvent } from '../types/ask.types'
import type { Place } from '../types/place.types'
import type { Vehicle } from '../types/trip.types'

const encoder = new TextEncoder()

function sseFrame(event: AskEvent): Uint8Array {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
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
          'Ask runs on the user\'s own OpenRouter key when they have one, otherwise on the system key, which needs the `premium:ask` permission and allows a number of questions per UTC month (`ASK_MONTHLY_QUESTIONS`, default 200, 0 for no limit). On the system key, `quota` carries `used`, `limit`, `remaining` and `resetsAt`, or is null without a limit. `reason` is `not-configured` when no key exists at all, `not-permitted` when only the system key exists and the user lacks the permission, and `quota-exceeded` (with `limit` and `resetsAt`) when this month\'s questions are used up.',
      },
    },
  )

  .post(
    '/ask',
    async ({ body, user, language, request, status, t }) => {
      const access = await resolveAskAccess(user.id)
      if (!access.allowed) {
        switch (access.reason) {
          case 'quota-exceeded':
            return status(429, {
              message: t('errors.ask.quotaExceeded'),
              reason: access.reason,
              limit: access.limit,
              resetsAt: access.resetsAt,
            })
          case 'not-permitted':
            return status(403, { message: t('errors.ask.notPermitted'), reason: access.reason })
          default:
            return status(501, { message: t('errors.ask.notConfigured'), reason: access.reason })
        }
      }

      const meter = meterModel(access.model)

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
              { question: body.question, history: body.history, origin, placeId: body.placeId },
              {
                userId: user.id,
                language,
                origin,
                places: knownPlaces(body.here, body.places),
                units: body.units ?? 'metric',
                vehicles: (body.vehicles ?? []) as Vehicle[],
                now: new Date(),
                signal: request.signal,
                seen: new Map<string, Place>(),
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
      }),
      detail: {
        tags: ['Ask'],
        summary: 'Answer a question about places',
        description:
          'Streams Server-Sent Events while a language model searches Parchment\'s place data. `step` events report each search as it runs (`running`, then `done` or `failed`); `reach` carries a travel-time polygon when the question implies one; `answer` carries a short text and the cited places, every one of which came from a search; `error` and then `done` close the stream. `history` holds earlier turns of the same conversation, oldest first. `here` and `places` give the model names (\"here\", \"home\") it can route between; their coordinates go to tools, never into the prompt. A `trip` event carries the trip the answer recommends, for opening in Directions. Every question counts toward the user\'s monthly usage; on the system key, a used-up allowance returns 429 with `reason: quota-exceeded` and `resetsAt`.',
      },
    },
  )

export default app
