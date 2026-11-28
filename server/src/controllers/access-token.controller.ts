import Elysia, { t } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import { makeUserRateLimit } from '../middleware/rate-limit.middleware'
import { i18nPlugin } from '../lib/i18n/plugin'
import {
  createPersonalToken,
  listAccessTokens,
  revokeAccessToken,
} from '../services/access-token.service'
import {
  ACCESS_TOKEN_KINDS,
  PERSONAL_TOKEN_DAYS,
  TOKEN_SCOPES,
} from '../types/access-token.types'

const scopeSchema = t.UnionEnum(TOKEN_SCOPES)

const summaryFields = {
  id: t.String(),
  kind: t.UnionEnum(ACCESS_TOKEN_KINDS),
  name: t.String(),
  scopes: t.Array(scopeSchema),
  hint: t.String(),
  createdAt: t.Date(),
  lastUsedAt: t.Nullable(t.Date()),
  expiresAt: t.Nullable(t.Date()),
}

const createLimit = makeUserRateLimit({ name: 'access-token-create', limit: 20 })

const app = new Elysia({ prefix: '/auth/tokens' })
  .use(i18nPlugin)
  .use(requireAuth)

  .get('/', ({ user }) => listAccessTokens(user.id), {
    response: t.Array(t.Object(summaryFields)),
    detail: {
      tags: ['Auth'],
      summary: 'List access tokens',
      description:
        "The caller's personal access tokens and the apps connected through OAuth. Secrets are never returned; `hint` is the first characters of one, and for an OAuth grant `expiresAt` is when it stops refreshing.",
    },
  })

  .use(createLimit)
  .post(
    '/',
    async ({ user, body, set }) => {
      set.status = 201
      return createPersonalToken(user.id, body.name.trim(), body.scopes, body.expiresInDays)
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 60 }),
        scopes: t.Array(scopeSchema, { minItems: 1, uniqueItems: true }),
        expiresInDays: t.Nullable(t.UnionEnum(PERSONAL_TOKEN_DAYS)),
      }),
      response: { 201: t.Object({ ...summaryFields, secret: t.String() }) },
      detail: {
        tags: ['Auth'],
        summary: 'Create a personal access token',
        description:
          'Returns the secret once; only its hash is stored. Send it as `Authorization: Bearer <secret>` to reach the routes and MCP tools its scopes allow. Scoped tokens can never manage tokens, sessions or the account.',
      },
    },
  )

  .delete(
    '/:id',
    async ({ user, params, set, status, t }) => {
      if (!(await revokeAccessToken(user.id, params.id))) {
        return status(404, { message: t('errors.notFound.resource') })
      }
      set.status = 204
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Auth'],
        summary: 'Revoke an access token',
        description: 'Works for personal tokens and OAuth grants alike; the token stops working at once.',
      },
    },
  )

export default app
