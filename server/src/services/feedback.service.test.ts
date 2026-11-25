import { describe, test, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdtemp, readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import sharp from 'sharp'

const root = await mkdtemp(join(tmpdir(), 'feedback-'))
mock.module('../config/storage.config', () => ({
  storage: { driver: 'local', localDir: root, publicUrl: 'https://cdn.test', s3: {} },
}))
afterAll(() => rm(root, { recursive: true, force: true }))

const storedScreenshots = () => readdir(join(root, 'feedback')).catch(() => [])
const screenshot = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#3366ff' } })
    .png()
    .toBuffer()
    .then((buffer) => new Uint8Array(buffer))

/** Stand-in for whichever integration provides the feedback capability. */
const listBoards = mock((): Promise<any> => Promise.resolve([]))
const submitFeedback = mock((_input: any): Promise<any> => Promise.resolve({}))

let records: any[] = []
let instance: any = null

mock.module('./integrations', () => ({
  integrationManager: {
    getConfiguredIntegrationsByCapability: (capability: string) =>
      capability === 'feedback' ? records : [],
    getCachedIntegrationInstance: () => instance,
  },
}))

const {
  isFeedbackConfigured,
  listBoards: serviceListBoards,
  submitFeedback: serviceSubmitFeedback,
  feedbackErrorMessage,
  isFeedbackPortalLoginEnabled,
  createFeedbackPortalLogin,
} = await import('./feedback.service')

const PROVIDER = { capabilities: { feedback: { listBoards, submitFeedback } } }

describe('feedback.service', () => {
  beforeEach(() => {
    listBoards.mockClear()
    submitFeedback.mockClear()
    records = [{ integrationId: 'quackback' }]
    instance = PROVIDER
  })

  describe('provider resolution', () => {
    test('is configured when an integration offers the capability', () => {
      expect(isFeedbackConfigured()).toBe(true)
    })

    test('is unconfigured when nothing offers it', () => {
      records = []
      expect(isFeedbackConfigured()).toBe(false)
    })

    test('is unconfigured when the record has no live instance', () => {
      instance = null
      expect(isFeedbackConfigured()).toBe(false)
    })

    test('is unconfigured when the instance lacks the capability', () => {
      instance = { capabilities: {} }
      expect(isFeedbackConfigured()).toBe(false)
    })

    test('does not care which integration provides it', () => {
      records = [{ integrationId: 'some-other-provider' }]
      expect(isFeedbackConfigured()).toBe(true)
    })
  })

  describe('delegation', () => {
    test('lists boards through the provider', async () => {
      listBoards.mockImplementation(() =>
        Promise.resolve([
          { id: 'board_1', name: 'Bugs', slug: 'bugs', description: null },
        ]),
      )
      expect(await serviceListBoards()).toEqual([
        { id: 'board_1', name: 'Bugs', slug: 'bugs', description: null },
      ])
    })

    test('passes the submission through untouched', async () => {
      const input = {
        boardId: 'board_1',
        title: 'Title',
        content: 'Body',
        author: { email: 'ada@example.com', name: 'Ada' },
      }
      submitFeedback.mockImplementation(() =>
        Promise.resolve({
          id: 'post_5',
          url: 'https://x.test/b/bugs/posts/post_5',
        }),
      )

      expect(await serviceSubmitFeedback(input)).toEqual({
        id: 'post_5',
        url: 'https://x.test/b/bugs/posts/post_5',
      })
      expect(submitFeedback).toHaveBeenCalledWith(input)
    })

    test('reports the missing provider rather than calling through', async () => {
      records = []
      expect(serviceListBoards()).rejects.toThrow('Feedback is not configured')
      expect(listBoards).not.toHaveBeenCalled()
    })
  })

  describe('screenshots', () => {
    const input = {
      boardId: 'board_1',
      title: 'Title',
      content: 'Body',
      author: { email: 'ada@example.com' },
    }

    beforeEach(() => rm(join(root, 'feedback'), { recursive: true, force: true }))

    test('embeds each stored screenshot after the text', async () => {
      await serviceSubmitFeedback({
        ...input,
        screenshots: [await screenshot(40, 30), await screenshot(30, 40)],
      })

      const { content } = submitFeedback.mock.calls[0][0]
      const urls: string[] = [...content.matchAll(/!\[Screenshot \d\]\((.+?)\)/g)].map((m) => m[1])
      expect(content.startsWith('Body\n\n![Screenshot 1](https://cdn.test/feedback/')).toBe(true)
      expect(urls).toHaveLength(2)
      expect((await storedScreenshots()).sort()).toEqual(
        urls.map((url) => url.split('/').pop()!).sort(),
      )
    })

    test('shrinks large screenshots and re-encodes them as webp', async () => {
      await serviceSubmitFeedback({ ...input, screenshots: [await screenshot(4000, 1000)] })

      const [file] = await storedScreenshots()
      const meta = await sharp(join(root, 'feedback', file)).metadata()
      expect(meta).toMatchObject({ format: 'webp', width: 2048, height: 512 })
    })

    test('drops the screenshots when the post fails', async () => {
      submitFeedback.mockImplementationOnce(() => Promise.reject(new Error('down')))
      await expect(
        serviceSubmitFeedback({ ...input, screenshots: [await screenshot(10, 10)] }),
      ).rejects.toThrow('down')
      expect(await storedScreenshots()).toEqual([])
    })

    test('stores nothing when feedback is not configured', async () => {
      records = []
      await expect(
        serviceSubmitFeedback({ ...input, screenshots: [await screenshot(10, 10)] }),
      ).rejects.toThrow('Feedback is not configured')
      expect(await storedScreenshots()).toEqual([])
    })
  })

  describe('portal login', () => {
    test('stays disabled for a provider that only accepts submissions', async () => {
      expect(isFeedbackPortalLoginEnabled()).toBe(false)
      await expect(
        createFeedbackPortalLogin({ id: 'user_1', email: 'ada@example.com' }),
      ).rejects.toThrow('not configured')
    })

    test('delegates login with the authenticated identity and destination', async () => {
      const createPortalLogin = mock(async () => ({
        url: 'https://feedback.example.com/auth/widget-handoff?ott=once',
      }))
      instance = {
        capabilities: {
          feedback: {
            listBoards,
            submitFeedback,
            isPortalLoginEnabled: () => true,
            createPortalLogin,
          },
        },
      }
      const identity = { id: 'user_1', email: 'ada@example.com' }
      expect(isFeedbackPortalLoginEnabled()).toBe(true)
      await serviceListBoards()
      await createFeedbackPortalLogin(
        identity,
        'https://feedback.example.com/b/bugs/posts/post_1',
      )
      expect(createPortalLogin).toHaveBeenCalledWith(
        identity,
        'https://feedback.example.com/b/bugs/posts/post_1',
      )
    })
  })

  describe('feedbackErrorMessage', () => {
    test('surfaces the upstream message', () => {
      const error = {
        response: {
          data: { error: { code: 'VALIDATION', message: 'Title is required' } },
        },
      }
      expect(feedbackErrorMessage(error)).toBe('Title is required')
    })

    test('returns null when there is no upstream message to show', () => {
      expect(feedbackErrorMessage(new Error('socket hang up'))).toBeNull()
    })
  })
})
