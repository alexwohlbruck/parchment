import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { authMockModule, resetAuth, setAuthUser } from '../test/auth-mock'
import { createTestApp, req } from '../test/app'

mock.module('../middleware/auth.middleware', () => authMockModule())
const catalog = { model: 'kokoro:v1.0', voices: [{ id: 'af_heart', name: 'heart', language: 'en-US' }], rate: { min: 0.75, max: 1.5, default: 1, native: true }, inflection: false }
const getSpeechCatalog = mock(async (_signal?: AbortSignal) => catalog)
const synthesizeSpeech = mock(async (_request: unknown, _signal?: AbortSignal) => new Uint8Array([1, 2, 3]))
mock.module('../services/speech.service', () => ({ getSpeechCatalog, synthesizeSpeech }))
const { default: speech } = await import('./speech.controller')
const app = createTestApp(speech)

beforeEach(() => { resetAuth(); getSpeechCatalog.mockReset(); getSpeechCatalog.mockResolvedValue(catalog); synthesizeSpeech.mockReset(); synthesizeSpeech.mockResolvedValue(new Uint8Array([1, 2, 3])) })

describe('speech API', () => {
  test('requires authentication for discovery and synthesis', async () => {
    setAuthUser(null)
    expect((await req(app).get('/speech')).status).toBe(401)
    expect((await req(app).post('/speech', { body: { text: 'Turn', language: 'en' } })).status).toBe(401)
    expect(synthesizeSpeech).not.toHaveBeenCalled()
  })
  test('returns voice capabilities and MP3 bytes', async () => {
    expect((await req(app).get('/speech')).body).toEqual(catalog)
    const response = await req(app).post('/speech', { body: { text: 'Turn', language: 'en', rate: 1.25 } })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('audio/mpeg')
    expect(synthesizeSpeech).toHaveBeenCalledWith({ text: 'Turn', language: 'en', rate: 1.25 }, expect.any(AbortSignal))
  })
  test('rejects invalid rates and oversized text before inference', async () => {
    for (const body of [{ text: 'Turn', language: 'en', rate: 4 }, { text: 'x'.repeat(501), language: 'en' }]) {
      expect((await req(app).post('/speech', { body })).status).toBe(422)
    }
    expect(synthesizeSpeech).not.toHaveBeenCalled()
  })
  test('returns unavailable so clients can fall back without exposing upstream errors', async () => {
    synthesizeSpeech.mockRejectedValue(new Error('http://private-tts:8880/internal'))
    const response = await req(app).post('/speech', { body: { text: 'Turn', language: 'en' } })
    expect(response.status).toBe(503)
    expect(response.body).toEqual({ message: 'Speech synthesis unavailable' })
  })
})
