import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { createTestApp, req } from '../test/app'
import { authMockModule, resetAuth, setAuthUser } from '../test/auth-mock'

let enabled = true
const createPortalLogin = mock(
  async (_identity: unknown, _postUrl?: string) => ({
    url: 'https://feedback.example.com/auth/widget-handoff?ott=once',
  }),
)
const submitFeedback = mock(async (_input: any) => ({ id: 'post_1', url: null }))
mock.module('../middleware/auth.middleware', () => authMockModule())
mock.module('../middleware/rate-limit.middleware', () => ({
  makeUserRateLimit: () => (app: unknown) => app,
}))
mock.module('../services/feedback.service', () => ({
  isFeedbackConfigured: () => true,
  listBoards: async () => [],
  submitFeedback,
  isFeedbackPortalLoginEnabled: () => enabled,
  createFeedbackPortalLogin: createPortalLogin,
  feedbackErrorMessage: () => null,
}))
const app = createTestApp((await import('./feedback.controller')).default)

beforeEach(() => {
  resetAuth()
  enabled = true
  createPortalLogin.mockClear()
  submitFeedback.mockClear()
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

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])

/** The harness JSON-encodes bodies, so multipart goes through app.handle directly. */
async function postFeedback(screenshots: File[]) {
  const form = new FormData()
  form.set('boardId', 'board_1')
  form.set('title', 'Broken map')
  for (const file of screenshots) form.append('screenshots', file)
  const response = await app.handle(
    new Request('http://localhost/feedback', { method: 'POST', body: form }),
  )
  return { status: response.status, body: await response.json() }
}

describe('POST /feedback screenshots', () => {
  test('passes screenshot bytes through, judged by contents not name', async () => {
    const response = await postFeedback([
      new File([PNG], 'shot.txt', { type: 'text/plain' }),
    ])
    expect(response.status).toBe(200)
    expect(submitFeedback.mock.calls[0][0].screenshots).toEqual([PNG])
  })

  test('rejects a file that is not an image', async () => {
    const response = await postFeedback([
      new File(['<svg/>'], 'shot.png', { type: 'image/png' }),
    ])
    expect(response.status).toBe(400)
    expect(submitFeedback).not.toHaveBeenCalled()
  })

  test('rejects more than 4 screenshots', async () => {
    const shot = () => new File([PNG], 'shot.png', { type: 'image/png' })
    const response = await postFeedback([shot(), shot(), shot(), shot(), shot()])
    expect(response.status).toBe(400)
    expect(submitFeedback).not.toHaveBeenCalled()
  })

  test('still accepts a JSON post with no screenshots', async () => {
    const response = await req(app).post('/feedback', {
      body: { boardId: 'board_1', title: 'Idea' },
    })
    expect(response.status).toBe(200)
    expect(submitFeedback.mock.calls[0][0].screenshots).toEqual([])
  })
})
