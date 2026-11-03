import { createHmac } from 'node:crypto'
import { describe, test, expect, beforeEach, mock } from 'bun:test'

const mockGet = mock(
  (_url: string, _config?: any): Promise<any> =>
    Promise.resolve({ data: { data: [] } }),
)
const mockPost = mock(
  (_url: string, _body?: any): Promise<any> =>
    Promise.resolve({ data: { data: {} } }),
)

mock.module('axios', () => ({
  default: { create: () => ({ get: mockGet, post: mockPost }), get: mockGet },
}))

import { QuackbackIntegration } from './quackback-integration'
import { IntegrationCapabilityId } from '../../types/integration.enums'

const BOARDS = {
  data: [
    { id: 'board_1', name: 'Bugs', slug: 'bugs', description: 'Report bugs' },
    { id: 'board_2', name: 'Ideas', slug: 'ideas', description: null },
  ],
}

function configured() {
  const integration = new QuackbackIntegration()
  // Trailing slash on purpose — it must be trimmed before building URLs.
  integration.initialize({
    url: 'https://feedback.example.com/',
    apiKey: '  qb_test  ',
  })
  return integration
}

describe('QuackbackIntegration', () => {
  beforeEach(() => {
    mockGet.mockClear()
    mockPost.mockClear()
    mockGet.mockImplementation(() => Promise.resolve({ data: BOARDS }))
  })

  describe('config', () => {
    test('declares the feedback capability', () => {
      expect(new QuackbackIntegration().capabilityIds).toEqual([
        IntegrationCapabilityId.FEEDBACK,
      ])
      expect(new QuackbackIntegration().capabilities.feedback).toBeDefined()
    })

    test('requires both a url and an api key', () => {
      const integration = new QuackbackIntegration()
      expect(
        integration.validateConfig({ url: 'https://x.test', apiKey: 'k' }),
      ).toBe(true)
      expect(
        integration.validateConfig({ url: 'https://x.test', apiKey: ' ' }),
      ).toBe(false)
      expect(integration.validateConfig({ url: '', apiKey: 'k' })).toBe(false)
    })

    test('refuses to initialize half-configured', () => {
      expect(() =>
        new QuackbackIntegration().initialize({
          url: 'https://x.test',
          apiKey: '',
        }),
      ).toThrow('Invalid configuration')
    })

    test('throws when used before initialize', () => {
      expect(new QuackbackIntegration().listBoards()).rejects.toThrow(
        'has not been initialized',
      )
    })
  })

  describe('listBoards', () => {
    test('maps the upstream envelope to boards', async () => {
      expect(await configured().listBoards()).toEqual([
        {
          id: 'board_1',
          name: 'Bugs',
          slug: 'bugs',
          description: 'Report bugs',
        },
        { id: 'board_2', name: 'Ideas', slug: 'ideas', description: null },
      ])
    })

    test('caches so repeat calls do not re-fetch', async () => {
      const integration = configured()
      await integration.listBoards()
      await integration.listBoards()
      expect(mockGet).toHaveBeenCalledTimes(1)
    })

    test('re-fetches once the cache is cleared', async () => {
      const integration = configured()
      await integration.listBoards()
      integration.clearBoardsCache()
      await integration.listBoards()
      expect(mockGet).toHaveBeenCalledTimes(2)
    })

    test('re-initializing drops a stale cache', async () => {
      const integration = configured()
      await integration.listBoards()
      integration.initialize({
        url: 'https://other.example.com',
        apiKey: 'qb_other',
      })
      await integration.listBoards()
      expect(mockGet).toHaveBeenCalledTimes(2)
    })
  })

  describe('submitFeedback', () => {
    beforeEach(() => {
      mockPost.mockImplementation((url: string) =>
        url === '/users/identify'
          ? Promise.resolve({ data: { data: { principalId: 'principal_9' } } })
          : Promise.resolve({ data: { data: { id: 'post_5' } } }),
      )
    })

    test('attributes the post to the identified author', async () => {
      await configured().submitFeedback({
        boardId: 'board_1',
        title: 'Crash on load',
        content: 'Steps to reproduce',
        author: { email: 'ada@example.com', name: 'Ada' },
      })

      expect(mockPost).toHaveBeenCalledWith('/users/identify', {
        email: 'ada@example.com',
        name: 'Ada',
      })
      expect(mockPost).toHaveBeenCalledWith('/posts', {
        boardId: 'board_1',
        title: 'Crash on load',
        content: 'Steps to reproduce',
        authorPrincipalId: 'principal_9',
      })
    })

    test('builds a portal url from the board slug, trimming the trailing slash', async () => {
      const result = await configured().submitFeedback({
        boardId: 'board_2',
        title: 'Dark mode',
        content: '',
        author: { email: 'ada@example.com' },
      })

      expect(result).toEqual({
        id: 'post_5',
        url: 'https://feedback.example.com/b/ideas/posts/post_5',
      })
    })

    test('omits the name when the user has none', async () => {
      await configured().submitFeedback({
        boardId: 'board_1',
        title: 'Title',
        content: '',
        author: { email: 'ada@example.com' },
      })

      expect(mockPost).toHaveBeenCalledWith('/users/identify', {
        email: 'ada@example.com',
      })
    })

    test('returns a null url when the board is unknown', async () => {
      const result = await configured().submitFeedback({
        boardId: 'board_gone',
        title: 'Title',
        content: '',
        author: { email: 'ada@example.com' },
      })

      expect(result.url).toBeNull()
    })
  })

  describe('portal login', () => {
    const identity = { id: 'user_123', email: 'ada@example.com', name: 'Ada' }
    function loginIntegration() {
      const integration = configured()
      integration.initialize({
        url: 'https://feedback.example.com/',
        apiKey: 'qb_admin',
        widgetSecret: 'test-signing-secret',
      })
      return integration
    }
    beforeEach(() => {
      mockPost.mockResolvedValue({ data: { sessionToken: 'private-session' } })
      mockGet.mockResolvedValue({ data: { token: 'one-time-token' } })
    })

    test('signs a five-minute identity and exchanges only its session for a one-time login', async () => {
      const result = await loginIntegration().createPortalLogin(identity)
      const [path, body] = mockPost.mock.calls[0]!
      expect(path).toBe('/api/widget/identify')
      const [header, claims, signature] = body.ssoToken.split('.')
      expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
        alg: 'HS256',
        typ: 'JWT',
      })
      const payload = JSON.parse(Buffer.from(claims, 'base64url').toString())
      expect(payload).toMatchObject({
        sub: 'user_123',
        email: identity.email,
        name: 'Ada',
      })
      expect(payload.exp - payload.iat).toBe(300)
      expect(payload.iat).toBeCloseTo(Date.now() / 1000, -1)
      expect(signature).toBe(
        createHmac('sha256', 'test-signing-secret')
          .update(`${header}.${claims}`)
          .digest('base64url'),
      )
      expect(mockGet).toHaveBeenCalledWith(
        '/api/auth/one-time-token/generate',
        {
          headers: { Authorization: 'Bearer private-session' },
        },
      )
      const url = new URL(result.url)
      expect(url.origin + url.pathname).toBe(
        'https://feedback.example.com/auth/widget-handoff',
      )
      expect(url.searchParams.get('ott')).toBe('one-time-token')
      expect(url.searchParams.get('returnTo')).toBe('/')
      expect(result.url).not.toContain('private-session')
      expect(result.url).not.toContain(body.ssoToken)
    })

    test('returns to a feedback post without forwarding its query or fragment', async () => {
      const { url } = await loginIntegration().createPortalLogin(
        identity,
        'https://feedback.example.com/b/ideas/posts/post_5?untrusted=true#fragment',
      )
      expect(new URL(url).searchParams.get('returnTo')).toBe(
        '/b/ideas/posts/post_5',
      )
    })

    test('rejects foreign origins and non-post destinations before identifying the user', async () => {
      for (const url of [
        'https://evil.test/b/ideas/posts/post_5',
        'https://feedback.example.com/auth/login',
        'https://feedback.example.com/b/ideas/posts/../../auth',
      ]) {
        await expect(
          loginIntegration().createPortalLogin(identity, url),
        ).rejects.toThrow('Invalid feedback post URL')
      }
      expect(mockPost).not.toHaveBeenCalled()
    })

    test('keeps login disabled without a signing secret', async () => {
      expect(configured().isPortalLoginEnabled()).toBe(false)
      await expect(configured().createPortalLogin(identity)).rejects.toThrow(
        'not configured',
      )
      expect(mockPost).not.toHaveBeenCalled()
    })

    test('does not continue when identity verification fails or omits the session', async () => {
      mockPost.mockRejectedValueOnce(new Error('Identity refused'))
      await expect(
        loginIntegration().createPortalLogin(identity),
      ).rejects.toThrow('Identity refused')
      mockPost.mockResolvedValueOnce({ data: {} })
      await expect(
        loginIntegration().createPortalLogin(identity),
      ).rejects.toThrow('no session')
      expect(mockGet).not.toHaveBeenCalled()
    })

    test('opens normal portal login for staff without minting an admin session', async () => {
      mockPost.mockRejectedValueOnce({
        response: {
          status: 403,
          data: { error: { code: 'IDENTITY_NOT_ALLOWED' } },
        },
      })
      expect(await loginIntegration().createPortalLogin(identity)).toEqual({
        url: 'https://feedback.example.com/',
      })
      expect(mockGet).not.toHaveBeenCalled()
    })

    test('does not fall back when a user is blocked', async () => {
      mockPost.mockRejectedValueOnce({
        response: { status: 403, data: { error: { code: 'BLOCKED' } } },
      })
      await expect(
        loginIntegration().createPortalLogin(identity),
      ).rejects.toMatchObject({ response: { status: 403 } })
      expect(mockGet).not.toHaveBeenCalled()
    })

    test('rejects a missing one-time token', async () => {
      mockGet.mockResolvedValueOnce({ data: {} })
      await expect(
        loginIntegration().createPortalLogin(identity),
      ).rejects.toThrow('no login token')
    })
  })

  describe('testConnection', () => {
    test('reports the board count on success', async () => {
      expect(
        await new QuackbackIntegration().testConnection({
          url: 'https://feedback.example.com',
          apiKey: 'qb_test',
        }),
      ).toEqual({ success: true, message: 'Connected — 2 boards available' })
    })

    test('fails when the instance has no boards to file against', async () => {
      mockGet.mockImplementation(() => Promise.resolve({ data: { data: [] } }))
      const result = await new QuackbackIntegration().testConnection({
        url: 'https://feedback.example.com',
        apiKey: 'qb_test',
      })
      expect(result.success).toBe(false)
      expect(result.message).toContain('no boards exist yet')
    })

    test('calls out a rejected key rather than a generic failure', async () => {
      mockGet.mockImplementation(() =>
        Promise.reject({ response: { status: 401 } }),
      )
      expect(
        await new QuackbackIntegration().testConnection({
          url: 'https://feedback.example.com',
          apiKey: 'qb_wrong',
        }),
      ).toEqual({ success: false, message: 'Invalid API key' })
    })

    test('rejects a half-filled config without a request', async () => {
      const result = await new QuackbackIntegration().testConnection({
        url: '',
        apiKey: '',
      })
      expect(result.success).toBe(false)
      expect(mockGet).not.toHaveBeenCalled()
    })
  })
})
