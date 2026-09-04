import { describe, test, expect, beforeEach, mock } from 'bun:test'

// QUACKBACK_URL / QUACKBACK_API_KEY come from src/test/setup.ts.
const mockGet = mock((_url: string) => Promise.resolve({ data: { data: [] } }))
const mockPost = mock((_url: string, _body?: any) =>
  Promise.resolve({ data: { data: {} } }),
)

mock.module('axios', () => ({
  default: { create: () => ({ get: mockGet, post: mockPost }) },
}))

import {
  listBoards,
  submitFeedback,
  clearBoardsCache,
  feedbackErrorMessage,
} from './feedback.service'

const BOARDS = [
  { id: 'board_1', name: 'Bugs', slug: 'bugs', description: 'Report bugs' },
  { id: 'board_2', name: 'Ideas', slug: 'ideas', description: null },
]

describe('feedback.service', () => {
  beforeEach(() => {
    clearBoardsCache()
    mockGet.mockClear()
    mockPost.mockClear()
    mockGet.mockImplementation(() => Promise.resolve({ data: { data: BOARDS } }))
  })

  describe('listBoards', () => {
    test('maps the upstream envelope to boards', async () => {
      expect(await listBoards()).toEqual([
        { id: 'board_1', name: 'Bugs', slug: 'bugs', description: 'Report bugs' },
        { id: 'board_2', name: 'Ideas', slug: 'ideas', description: null },
      ])
    })

    test('caches so repeat calls do not re-fetch', async () => {
      await listBoards()
      await listBoards()
      expect(mockGet).toHaveBeenCalledTimes(1)
    })

    test('re-fetches once the cache is cleared', async () => {
      await listBoards()
      clearBoardsCache()
      await listBoards()
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
      await submitFeedback({
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
      const result = await submitFeedback({
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
      await submitFeedback({
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
      const result = await submitFeedback({
        boardId: 'board_gone',
        title: 'Title',
        content: '',
        author: { email: 'ada@example.com' },
      })

      expect(result.url).toBeNull()
    })
  })

  describe('feedbackErrorMessage', () => {
    test('surfaces the upstream message', () => {
      const error = {
        response: { data: { error: { code: 'VALIDATION', message: 'Title is required' } } },
      }
      expect(feedbackErrorMessage(error)).toBe('Title is required')
    })

    test('returns null when there is no upstream message to show', () => {
      expect(feedbackErrorMessage(new Error('socket hang up'))).toBeNull()
    })
  })
})
