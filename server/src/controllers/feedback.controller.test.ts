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
mock.module('../services/feedback.service', () => ({
  isFeedbackConfigured: () => true,
  listBoards: async () => [],
  submitFeedback: async () => ({}),
  isFeedbackPortalLoginEnabled: () => enabled,
  createFeedbackPortalLogin: createPortalLogin,
  feedbackErrorMessage: () => null,
}))
const app = createTestApp((await import('./feedback.controller')).default)

beforeEach(() => {
  resetAuth()
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
