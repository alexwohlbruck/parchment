import Elysia, { t } from 'elysia'
import { requireAuth, getUser } from '../middleware/auth.middleware'
import { makeUserRateLimit } from '../middleware/rate-limit.middleware'
import { i18nPlugin } from '../lib/i18n/plugin'
import {
  isFeedbackConfigured,
  listBoards,
  submitFeedback,
  feedbackErrorMessage,
  isFeedbackPortalLoginEnabled,
  createFeedbackPortalLogin,
} from '../services/feedback.service'
import { sniffImageType, type RasterImageType } from '../lib/image-type'
import { UnreadableImageError } from '../lib/webp'

const app = new Elysia({ prefix: '/feedback' }).use(i18nPlugin)

const MAX_SCREENSHOTS = 4
const MAX_SCREENSHOT_SIZE = 10 * 1024 * 1024
const SCREENSHOT_TYPES: RasterImageType[] = ['image/jpeg', 'image/png', 'image/webp']

/** Screenshot bytes, or null when any one isn't an image we accept. */
async function readScreenshots(files: File[]) {
  if (files.some((file) => file.size > MAX_SCREENSHOT_SIZE)) return null
  const images = await Promise.all(files.map(async (file) => new Uint8Array(await file.arrayBuffer())))
  return images.every(isScreenshotType) ? images : null
}

function isScreenshotType(bytes: Uint8Array) {
  const type = sniffImageType(bytes)
  return type !== null && SCREENSHOT_TYPES.includes(type)
}

/** Posting is cheap to abuse and creates real records upstream. */
const submitRateLimit = makeUserRateLimit({
  name: 'feedback-submit',
  limit: 5,
  windowMs: 60_000,
})

/**
 * List the boards feedback can be filed against
 */
app.use(requireAuth).get(
  '/boards',
  async ({ status, t }) => {
    if (!isFeedbackConfigured()) {
      return status(503, { message: t('errors.feedback.unavailable') })
    }

    try {
      return {
        boards: await listBoards(),
        portalLoginEnabled: isFeedbackPortalLoginEnabled(),
      }
    } catch (error) {
      return status(502, {
        message:
          feedbackErrorMessage(error) ?? t('errors.feedback.fetchFailed'),
      })
    }
  },
  {
    detail: {
      tags: ['Feedback'],
      summary: 'List feedback boards',
      description:
        'Lists available feedback boards and whether automatic portal login is configured.',
    },
  },
)

/**
 * Submit a feedback post on behalf of the signed-in user
 */
app
  .use(getUser)
  .use(submitRateLimit)
  .post(
    '/',
    async ({ body, user, status, t }) => {
      if (!isFeedbackConfigured()) {
        return status(503, { message: t('errors.feedback.unavailable') })
      }

      const files = body.screenshots ?? []
      if (files.length > MAX_SCREENSHOTS) {
        return status(400, { message: t('errors.feedback.tooManyScreenshots') })
      }
      const screenshots = await readScreenshots(files)
      if (!screenshots) {
        return status(400, { message: t('errors.feedback.invalidScreenshot') })
      }

      const name = [user.firstName, user.lastName].filter(Boolean).join(' ')

      try {
        return await submitFeedback({
          boardId: body.boardId,
          title: body.title,
          content: body.content ?? '',
          author: { email: user.email, ...(name ? { name } : {}) },
          screenshots,
        })
      } catch (error) {
        if (error instanceof UnreadableImageError) {
          return status(400, { message: t('errors.feedback.invalidScreenshot') })
        }
        return status(502, {
          message:
            feedbackErrorMessage(error) ?? t('errors.feedback.submitFailed'),
        })
      }
    },
    {
      body: t.Object({
        boardId: t.String({ minLength: 1 }),
        title: t.String({ minLength: 1, maxLength: 200 }),
        content: t.Optional(t.String({ maxLength: 9000 })),
        screenshots: t.Optional(t.Files()),
      }),
      detail: {
        tags: ['Feedback'],
        summary: 'Submit feedback',
        description:
          'Accepts JSON, or multipart form data to attach up to 4 screenshots (JPEG, PNG or WebP, 10MB each, judged by their contents). Screenshots are stored as public WebP files and embedded in the post.',
      },
    },
  )

app.use(getUser).post(
  '/portal-login',
  async ({ body, user, status, t, set }) => {
    set.headers['Cache-Control'] = 'no-store'
    if (!isFeedbackPortalLoginEnabled()) {
      return status(503, { message: t('errors.feedback.unavailable') })
    }
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ')
    try {
      return await createFeedbackPortalLogin(
        {
          id: user.id,
          email: user.email,
          ...(name ? { name } : {}),
        },
        body.postUrl,
      )
    } catch (error) {
      return status(502, {
        message:
          feedbackErrorMessage(error) ?? t('errors.feedback.fetchFailed'),
      })
    }
  },
  {
    body: t.Object({
      postUrl: t.Optional(t.String({ format: 'uri', maxLength: 2048 })),
    }),
    response: {
      200: t.Object({ url: t.String({ format: 'uri' }) }),
      401: t.Object({ message: t.String() }),
      503: t.Object({ message: t.String() }),
      502: t.Object({ message: t.String() }),
    },
    detail: {
      tags: ['Feedback'],
      summary: 'Sign in to the feedback portal',
      description:
        'Exchanges the authenticated Parchment identity for a one-time feedback portal login URL. Staff accounts receive the ordinary portal URL. No passwords or reusable provider session tokens are returned.',
    },
  },
)

export default app
