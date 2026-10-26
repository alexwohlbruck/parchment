import { Elysia, t } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import { makeUserRateLimit } from '../middleware/rate-limit.middleware'
import { getSpeechCatalog, synthesizeSpeech } from '../services/speech.service'

const speech = new Elysia({ prefix: '/speech' })
  .use(requireAuth)
  .use(makeUserRateLimit({ name: 'speech', limit: 60, windowMs: 60_000 }))
  .get('/', async ({ request, status }) => {
    try {
      return await getSpeechCatalog(AbortSignal.any([request.signal, AbortSignal.timeout(3000)]))
    } catch {
      return status(503, { message: 'Speech synthesis unavailable' })
    }
  }, { detail: { tags: ['Speech'], summary: 'List speech voices, languages and supported controls' } })
  .post('/', async ({ body, request, status }) => {
    try {
      const audio = await synthesizeSpeech(body, AbortSignal.any([request.signal, AbortSignal.timeout(4000)]))
      return new Response(new Uint8Array(audio).buffer, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, no-store' } })
    } catch {
      return status(503, { message: 'Speech synthesis unavailable' })
    }
  }, {
    body: t.Object({
      text: t.String({ minLength: 1, maxLength: 500 }),
      language: t.String({ minLength: 2, maxLength: 35 }),
      voice: t.Optional(t.String({ maxLength: 100 })),
      rate: t.Optional(t.Number({ minimum: 0.75, maximum: 1.5 })),
    }),
    detail: {
      tags: ['Speech'], summary: 'Synthesize a short instruction',
      description: 'Returns MP3 audio from a configured TTS integration. Rate 1 is normal; larger values speak faster. Returns 503 when unavailable or the voice/language is unsupported; clients should use browser speech fallback.',
      responses: { 200: { description: 'Synthesized MP3', content: { 'audio/mpeg': { schema: { type: 'string', format: 'binary' } } } } },
    },
  })

export default speech
