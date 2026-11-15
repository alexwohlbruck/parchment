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
  readFeedbackImage,
  InvalidFeedbackImageError,
  MAX_FEEDBACK_IMAGES,
  MAX_FEEDBACK_IMAGE_BYTES,
} from '../services/feedback.service'

// Its own instance: routes sharing one with the authenticated ones below would
// pick up their auth guard.
const publicApi = new Elysia({ prefix: '/feedback' })

/**
 * Serve an image attached to a feedback post. Public, because the feedback
 * provider fetches it without a Parchment session; the id is a random UUID.
 */
publicApi.get(
  '/images/:id',
  async ({ params: { id }, status }) => {
    const image = await readFeedbackImage(id)
    if (!image) return status(404)
    return new Response(new Uint8Array(image), {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  },
  {
    params: t.Object({ id: t.String() }),
    detail: {
      tags: ['Feedback'],
      summary: 'Get a feedback image',
      description:
        'Serves an image attached to a feedback post until the feedback provider has stored its own copy.',
    },
  },
)

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

      const images = body.images ?? []
      if (images.length > MAX_FEEDBACK_IMAGES) {
        return status(400, { message: t('errors.feedback.tooManyImages') })
      }
      if (images.some((image) => image.size > MAX_FEEDBACK_IMAGE_BYTES)) {
        return status(400, { message: t('errors.feedback.imageTooLarge') })
      }
      if (images.some((image) => !image.type.startsWith('image/'))) {
        return status(400, { message: t('errors.feedback.invalidImage') })
      }

      const name = [user.firstName, user.lastName].filter(Boolean).join(' ')

      try {
        const { id, url } = await submitFeedback(
          {
            boardId: body.boardId,
            title: body.title,
            content: body.content ?? '',
            author: { email: user.email, ...(name ? { name } : {}) },
          },
          images,
        )
        return { id, url }
      } catch (error) {
        if (error instanceof InvalidFeedbackImageError) {
          return status(400, { message: t('errors.feedback.invalidImage') })
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
        // Leaves room under the provider's 10,000 for the image embeds.
        content: t.Optional(t.String({ maxLength: 9500 })),
        images: t.Optional(t.Files()),
      }),
      detail: {
        tags: ['Feedback'],
        summary: 'Submit feedback',
        description: `Accepts JSON, or multipart form data with up to ${MAX_FEEDBACK_IMAGES} \`images\`. Images are re-encoded and stripped of metadata before they reach the feedback provider.`,
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

export default new Elysia().use(publicApi).use(app)
