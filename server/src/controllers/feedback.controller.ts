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

const app = new Elysia({ prefix: '/feedback' }).use(i18nPlugin)

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

      const name = [user.firstName, user.lastName].filter(Boolean).join(' ')

      try {
        return await submitFeedback({
          boardId: body.boardId,
          title: body.title,
          content: body.content ?? '',
          author: { email: user.email, ...(name ? { name } : {}) },
        })
      } catch (error) {
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
        content: t.Optional(t.String({ maxLength: 10000 })),
      }),
      detail: {
        tags: ['Feedback'],
        summary: 'Submit feedback',
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
