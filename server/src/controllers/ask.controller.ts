import { Elysia, t } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import { i18nPlugin } from '../lib/i18n/plugin'
import { logError } from '../lib/logger'
import { resolveAskAccess } from '../services/ask/ask-model.service'
import { runAsk } from '../services/ask/ask-agent.service'
import type { AskAccess, AskEvent } from '../types/ask.types'
import type { Place } from '../types/place.types'

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
      const result: AskAccess = access.allowed
        ? { allowed: true, keySource: access.keySource }
        : { allowed: false, reason: access.reason }
      return result
    },
    {
      detail: {
        tags: ['Ask'],
        summary: 'Whether the user can use Ask',
        description:
          'Ask runs on the user\'s own OpenRouter key when they have one, otherwise on the system key, which needs the `premium:ask` permission. `reason` is `not-configured` when no key exists at all, `not-permitted` when only the system key exists and the user lacks the permission.',
      },
    },
  )

  .post(
    '/ask',
    async ({ body, user, language, request, status, t }) => {
      const access = await resolveAskAccess(user.id)
      if (!access.allowed) {
        return access.reason === 'not-permitted'
          ? status(403, { message: t('errors.ask.notPermitted'), reason: access.reason })
          : status(501, { message: t('errors.ask.notConfigured'), reason: access.reason })
      }

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
              access.model,
              { question: body.question, history: body.history, origin },
              {
                userId: user.id,
                language,
                origin,
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
        lat: t.Optional(t.Number({ minimum: -90, maximum: 90 })),
        lng: t.Optional(t.Number({ minimum: -180, maximum: 180 })),
      }),
      detail: {
        tags: ['Ask'],
        summary: 'Answer a question about places',
        description:
          'Streams Server-Sent Events while a language model searches Parchment\'s place data. `step` events report each search as it runs (`running`, then `done` or `failed`); `reach` carries a travel-time polygon when the question implies one; `answer` carries a short text and the cited places, every one of which came from a search; `error` and then `done` close the stream. `history` holds earlier turns of the same conversation, oldest first.',
      },
    },
  )

export default app
