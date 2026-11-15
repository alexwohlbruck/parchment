import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { createTestApp, req } from '../test/app'
import { authMockModule, resetAuth, setAuthUser } from '../test/auth-mock'

let enabled = true
const createPortalLogin = mock(
  async (_identity: unknown, _postUrl?: string) => ({
    url: 'https://feedback.example.com/auth/widget-handoff?ott=once',
  }),
)
mock.module('../middleware/auth.middleware', () => authMockModule())
mock.module('../middleware/rate-limit.middleware', () => ({
  makeUserRateLimit: () => (app: unknown) => app,
}))
const submitFeedback = mock(async (_input: unknown, _files?: File[]) => ({
  id: 'post_5',
  url: null,
  imagesCopied: true,
}))
const readFeedbackImage = mock(async (_id: string): Promise<Buffer | null> =>
  null,
)
class InvalidFeedbackImageError extends Error {}
mock.module('../services/feedback.service', () => ({
  isFeedbackConfigured: () => true,
  listBoards: async () => [],
  submitFeedback,
  readFeedbackImage,
  InvalidFeedbackImageError,
  MAX_FEEDBACK_IMAGES: 2,
  MAX_FEEDBACK_IMAGE_BYTES: 8,
  isFeedbackPortalLoginEnabled: () => enabled,
  createFeedbackPortalLogin: createPortalLogin,
  feedbackErrorMessage: () => null,
}))
const app = createTestApp((await import('./feedback.controller')).default)

beforeEach(() => {
  resetAuth()
  submitFeedback.mockClear()
  enabled = true
  createPortalLogin.mockClear()
  createPortalLogin.mockResolvedValue({
    url: 'https://feedback.example.com/auth/widget-handoff?ott=once',
  })
})

describe('POST /feedback/portal-login', () => {
  test('rejects unauthenticated requests without minting a login', async () => {
    setAuthUser(null)
    const response = await req(app).post('/feedback/portal-login', { body: {} })
    expect(response.status).toBe(401)
    expect(createPortalLogin).not.toHaveBeenCalled()
  })

  test('uses the session identity, ignoring identity claims from the browser', async () => {
    setAuthUser({
      id: 'actual-user',
      email: 'actual@example.com',
      alias: 'actual',
      firstName: 'Ada',
      lastName: 'Lovelace',
    })
    const response = await req(app).post('/feedback/portal-login', {
      body: {
        id: 'victim',
        email: 'victim@example.com',
        postUrl: 'https://feedback.example.com/b/ideas/posts/post_5',
      },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(createPortalLogin).toHaveBeenCalledWith(
      {
        id: 'actual-user',
        email: 'actual@example.com',
        name: 'Ada Lovelace',
      },
      'https://feedback.example.com/b/ideas/posts/post_5',
    )
  })

  test('returns unavailable when login has not been configured', async () => {
    enabled = false
    const response = await req(app).post('/feedback/portal-login', { body: {} })
    expect(response.status).toBe(503)
    expect(createPortalLogin).not.toHaveBeenCalled()
  })

  test('returns a safe error when Quackback refuses login', async () => {
    createPortalLogin.mockRejectedValueOnce(
      new Error('private signing details'),
    )
    const response = await req(app).post('/feedback/portal-login', { body: {} })
    expect(response.status).toBe(502)
    expect(JSON.stringify(response.body)).not.toContain(
      'private signing details',
    )
  })

  test('rejects malformed destination URLs', async () => {
    const response = await req(app).post('/feedback/portal-login', {
      body: { postUrl: 'not a URL' },
    })
    expect(response.status).toBe(422)
    expect(createPortalLogin).not.toHaveBeenCalled()
  })
})

describe('POST /feedback with images', () => {
  const user = { id: 'u1', email: 'ada@example.com', alias: 'ada' }
  function form(...images: File[]) {
    const body = new FormData()
    body.append('boardId', 'board_1')
    body.append('title', 'Broken')
    for (const image of images) body.append('images', image)
    return body
  }
  const png = (bytes = 4) =>
    new File([new Uint8Array(bytes)], 'shot.png', { type: 'image/png' })
  const post = (body: FormData) =>
    app.handle(
      new Request('http://localhost/feedback', { method: 'POST', body }),
    )

  test('hands the files to the service, without internal fields', async () => {
    setAuthUser(user)
    const response = await post(form(png()))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: 'post_5', url: null })
    expect(submitFeedback.mock.calls[0]![1]).toHaveLength(1)
  })

  test('refuses more images than the limit', async () => {
    setAuthUser(user)
    expect((await post(form(png(), png(), png()))).status).toBe(400)
    expect(submitFeedback).not.toHaveBeenCalled()
  })

  test('refuses an oversized image', async () => {
    setAuthUser(user)
    expect((await post(form(png(64)))).status).toBe(400)
    expect(submitFeedback).not.toHaveBeenCalled()
  })

  test('refuses a file that does not claim to be an image', async () => {
    setAuthUser(user)
    const text = new File(['hi'], 'notes.txt', { type: 'text/plain' })
    expect((await post(form(text))).status).toBe(400)
    expect(submitFeedback).not.toHaveBeenCalled()
  })

  test('reports an image the service could not decode', async () => {
    setAuthUser(user)
    submitFeedback.mockImplementationOnce(async () => {
      throw new InvalidFeedbackImageError()
    })
    expect((await post(form(png()))).status).toBe(400)
  })
})

describe('GET /feedback/images/:id', () => {
  test('serves a staged image without a session', async () => {
    setAuthUser(null)
    readFeedbackImage.mockResolvedValueOnce(Buffer.from('webp'))
    const response = await app.handle(
      new Request('http://localhost/feedback/images/abc'),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/webp')
  })

  test('404s an unknown image', async () => {
    setAuthUser(null)
    const response = await app.handle(
      new Request('http://localhost/feedback/images/abc'),
    )
    expect(response.status).toBe(404)
  })
})
