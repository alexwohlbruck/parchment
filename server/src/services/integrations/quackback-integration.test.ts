import { describe, test, expect, beforeEach, mock } from 'bun:test'

const mockGet = mock((_url: string, _config?: any): Promise<any> =>
  Promise.resolve({ data: { data: [] } }),
)
const mockPost = mock(
  (_url: string, _body?: any): Promise<any> => Promise.resolve({ data: { data: {} } }),
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
  integration.initialize({ url: 'https://feedback.example.com/', apiKey: '  qb_test  ' })
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
      expect(integration.validateConfig({ url: 'https://x.test', apiKey: 'k' })).toBe(true)
      expect(integration.validateConfig({ url: 'https://x.test', apiKey: ' ' })).toBe(false)
      expect(integration.validateConfig({ url: '', apiKey: 'k' })).toBe(false)
    })

    test('refuses to initialize half-configured', () => {
      expect(() =>
        new QuackbackIntegration().initialize({ url: 'https://x.test', apiKey: '' }),
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
        { id: 'board_1', name: 'Bugs', slug: 'bugs', description: 'Report bugs' },
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
      integration.initialize({ url: 'https://other.example.com', apiKey: 'qb_other' })
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
