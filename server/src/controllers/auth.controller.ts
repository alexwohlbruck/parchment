import Elysia, { t } from 'elysia'
import { and, eq, desc } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../schema/users.schema'
import {
  getSession,
  requireAuth,
  getSessionId,
} from '../middleware/auth.middleware'
import { appName, origins } from '../config'
import { Passkey, passkeys } from '../schema/passkeys.schema'
import { sessions } from '../schema/sessions.schema'
import {
  createSession,
  destroySession,
  destroyAllSessions,
  destroyOtherSessions,
  generateWebauthnOptions,
  generatePrfAssertionOptions,
  generatePrfEnrollOptionsForCredential,
  rpID,
  sendEmailVerificationCode,
  getPermissions,
} from '../services/auth.service'
import { fetchUser, fetchUserByEmail } from '../services/user.service'
import {
  createServerToken,
  validateServerToken,
} from '../services/token.service'
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from '@simplewebauthn/server/script/deps'
import { generateId } from '../util'
import { detectLanguage, getI18nInitOptions } from '../lib/i18n'
import { makeUserRateLimit } from '../middleware/rate-limit.middleware'
import { passkeyNameFromAAGUID } from '../lib/passkey-aaguid'

// Rate limits on the PRF-options endpoints. These hand out WebAuthn
// challenges that an attacker with a valid session cookie could
// otherwise burn in a loop (either to waste authenticator state or as
// part of a side-channel probe). Keep both well under the expected
// per-user ceiling of "one tap every few seconds."
const prfAssertRateLimit = makeUserRateLimit({
  name: 'prf-assert-options',
  limit: 30,
  windowMs: 60_000,
})
const prfEnrollRateLimit = makeUserRateLimit({
  name: 'prf-enroll-options',
  limit: 30,
  windowMs: 60_000,
})

const app = new Elysia({ prefix: '/auth' })

app.post(
  '/verify',
  async ({ body: { email }, set, status, t }) => {
    let user = await fetchUserByEmail(email)

    if (!user) {
      // Invite-only today. Open-signup flow (auto-create user + seed default
      // layers) will replace this branch when we're ready to accept new
      // signups without an explicit invite.
      return status(404, { message: t('errors.notFound.user') })
    }

    const isAppTester = user.email === process.env.APP_TESTER_EMAIL

    const verificationCode = await createServerToken(
      'otp',
      user.id,
      isAppTester ? '00000000' : undefined,
    )
    const emailSuccess = isAppTester
      ? true
      : await sendEmailVerificationCode(user.email, verificationCode)

    if (emailSuccess) {
      set.status = 201
    } else {
      set.status = 500
    }
  },
  {
    detail: {
      tags: ['Auth'],
      description: 'Verify an email address by requesting a one-time password.',
    },
    body: t.Object({
      email: t.String({
        format: 'email',
      }),
    }),
  },
)

app.group('/passkeys', (app) => {
  app.group('/register', (app) => {
    app.use(requireAuth).post(
      '/options',
      async ({ user, cookie: { challenge }, set }) => {
        const { email } = await fetchUser(user.id)

        try {
          const options = await generateWebauthnOptions(
            'register',
            user.id,
            email,
          )
          challenge.value = options.challenge
          return options
        } catch (err) {
          set.status = 500
        }
      },
      {
        detail: {
          tags: ['Auth'],
          summary: 'Get passkey registration options',
        },
      },
    )

    app.use(requireAuth).post(
      '/verify',
      async ({ body, set, user, cookie: { challenge }, status, t, request }) => {
        if (!user) return (set.status = 401)
        if (!challenge.value) return (set.status = 400) // TODO: Check this is how to break out with error in Elysia, make better error

        const payload = body as RegistrationResponseJSON & { name?: string }

        const verification = await verifyRegistrationResponse({
          response: payload,
          expectedChallenge: (challenge.value as string) ?? '',
          expectedOrigin: (origins.clientOrigin as string) ?? '',
          expectedRPID: rpID,
          requireUserVerification: true,
        })

        if (!verification.verified) {
          return status(401, {
            message: t('errors.auth.passkeyVerificationFailed'),
          })
        }

        const { registrationInfo } = verification

        if (!registrationInfo) {
          return status(401, {
            message: t('errors.auth.passkeyVerificationFailed'),
          })
        }

        const {
          credentialID,
          credentialPublicKey,
          counter,
          credentialDeviceType,
          credentialBackedUp,
          aaguid,
        } = registrationInfo

        // Auto-name the passkey from its AAGUID (identifies the
        // authenticator make — "iCloud Keychain", "1Password", etc.) so
        // the user never has to think up a name. Falls back to
        // "{OS} · {Browser}" if the AAGUID is unknown. The client can
        // still override by passing `name`, but the UI stopped prompting
        // as of the "auto-name passkeys" change.
        const derivedName = passkeyNameFromAAGUID(
          aaguid,
          request.headers.get('user-agent') ?? undefined,
        )
        const finalName = payload.name?.trim() || derivedName

        const passkey: Partial<Passkey> = (
          await db
            .insert(passkeys)
            .values({
              id: credentialID,
              name: finalName,
              publicKey: Buffer.from(credentialPublicKey).toString('base64'),
              userId: user.id,
              counter,
              deviceType: credentialDeviceType,
              backedUp: credentialBackedUp,
              transports: body.response.transports,
            })
            .returning()
        )[0]

        // TODO: Find way to automatically hide sensitive fields
        delete passkey.publicKey
        challenge.remove()

        return passkey
      },
      {
        detail: {
          tags: ['Auth'],
          description: 'Verify webauthn passkey registration.',
        },
        body: t.Object({
          name: t.Optional(t.String()),
          id: t.String(),
          rawId: t.String(),
          response: t.Object({
            clientDataJSON: t.String(),
            attestationObject: t.String(),
            authenticatorData: t.Optional(t.String()),
            transports: t.Optional(t.Any()),
            publicKeyAlgorithm: t.Optional(t.Any()),
            publicKey: t.Optional(t.String()),
          }),
          authenticatorAttachment: t.Any(),
          clientExtensionResults: t.Optional(t.Any()),
          type: t.String(),
        }),
      },
    )

    return app
  })

  app.group('/authenticate', (app) => {
    app.post(
      'options',
      async ({ set, cookie: { challenge } }) => {
        try {
          const options = await generateWebauthnOptions('authenticate')
          challenge.value = options.challenge
          return options
        } catch (err) {
          set.status = 500
        }
      },
      {
        detail: {
          tags: ['Auth'],
          summary: 'Get passkey authentication options',
        },
      },
    )

    app.post(
      '/verify',
      async ({
        body,
        cookie: { challenge },
        set,
        headers,
        status,
        request,
        t,
      }) => {
        if (!challenge.value) {
          return status(401, {
            message: t('errors.auth.challengeNotFound'),
          })
        }

        const passkey = (
          await db.select().from(passkeys).where(eq(passkeys.id, body.id))
        )[0]

        if (!passkey) {
          return status(401, {
            message: t('errors.auth.passkeyNotFound'),
          })
        }

        const verification = await verifyAuthenticationResponse({
          response: body as AuthenticationResponseJSON,
          expectedChallenge: (challenge.value as string) ?? '',
          expectedOrigin: origins.clientOrigin ?? '',
          expectedRPID: rpID,
          authenticator: {
            credentialID: passkey.id,
            credentialPublicKey: Buffer.from(passkey.publicKey, 'base64'),
            counter: passkey.counter,
            transports: passkey.transports.split(
              ',',
            ) as AuthenticatorTransportFuture[],
          },
        })

        if (verification.verified) {
          const user = await fetchUser(passkey.userId)
          const session = await createSession(user.id, {
            set,
            headers,
          })
          set.status = 201
          return {
            token: session.id,
            user,
          }
        }

        challenge.remove()
        return status(401, {
          message: t('errors.auth.passkeyVerificationFailed'),
        })
      },
      {
        body: t.Object({
          id: t.String(),
          rawId: t.String(),
          response: t.Object({
            authenticatorData: t.String(),
            clientDataJSON: t.String(),
            signature: t.String(),
            userHandle: t.String(),
          }),
          type: t.String(),
          clientExtensionResults: t.Any(),
          authenticatorAttachment: t.String(),
        }),
        detail: {
          tags: ['Auth'],
          summary: 'Verify passkey authentication',
        },
      },
    )

    return app
  })

  app.use(requireAuth).get(
    '/',
    async ({ user, set }) => {
      return db.select().from(passkeys).where(eq(passkeys.userId, user.id))
    },
    {
      detail: {
        tags: ['Auth'],
        summary: 'List all passkeys for current user',
      },
    },
  )

  app
    .use(requireAuth)
    .use(prfAssertRateLimit)
    .post(
      '/prf-assert/options',
      async ({ user }) => {
        return await generatePrfAssertionOptions(user.id)
      },
      {
        detail: {
          tags: ['Auth', 'Crypto'],
          summary:
            'Return WebAuthn authentication options with the PRF extension ' +
            "eval'd against the current user's salt, restricted to " +
            "credentials that have a wrapped-master-key slot. Used to " +
            'unwrap K_m on a new device after sign-in.',
        },
      },
    )

  app
    .use(requireAuth)
    .use(prfEnrollRateLimit)
    .post(
      '/:credentialId/prf-enroll/options',
      async ({ user, params, status }) => {
        const options = await generatePrfEnrollOptionsForCredential(
          user.id,
          params.credentialId,
        )
        if (!options) {
          return status(404, { message: 'Passkey not found' })
        }
        return options
      },
      {
        params: t.Object({ credentialId: t.String() }),
        detail: {
          tags: ['Auth', 'Crypto'],
          summary:
            'Return WebAuthn authentication options to enable recovery on ' +
            'an already-registered passkey. Scoped to one credential; if ' +
            "the authenticator emits a PRF output, the client POSTs a new " +
            'wrapped-K_m slot for it.',
        },
      },
    )

  app.use(requireAuth).delete(
    '/:passkeyId',
    async ({ user, set, params: { passkeyId } }) => {
      await db
        .delete(passkeys)
        .where(and(eq(passkeys.id, passkeyId), eq(passkeys.userId, user.id)))
      set.status = 204
    },
    {
      detail: {
        tags: ['Auth'],
        summary: 'Delete a passkey',
      },
    },
  )

  return app
})

app.group('/sessions', (app) => {
  app.post(
    '/',
    async (context) => {
      const {
        body: { email, token },
        status,
        t,
      } = context
      const user = await fetchUserByEmail(email)

      if (!user) {
        return status(404, { message: t('errors.notFound.user') })
      }

      const isValid = await validateServerToken(token, 'otp', user.id)

      if (!isValid)
        return status(401, { message: t('errors.auth.invalidSession') })

      const session = await createSession(user.id, context)

      return {
        token: session.id,
        user,
      }
    },
    {
      detail: {
        tags: ['Auth'],
        description:
          'Sign in a user. Exchanges a passkey or one-time password for an authentication token.',
      },
      body: t.Union([
        t.Object({
          method: t.Union([t.Literal('passkey'), t.Literal('otp')]),
          email: t.String({
            format: 'email',
          }),
          // TODO: Accept 8 digit otp or server token
          token: t.String(),
        }),
      ]),
    },
  )

  app.delete(
    '/',
    async ({ cookie, set }) => {
      destroySession(cookie)
      set.status = 204
    },
    {
      detail: {
        tags: ['Auth'],
        description: 'Sign out a user.',
      },
    },
  )

  app.use(requireAuth).delete(
    '/all',
    async ({ user, cookie, set }) => {
      await destroyAllSessions(user.id)
      // Drop the current cookie too so the caller doesn't keep a stale
      // session id locally after the DB rows are gone.
      const sessionCookie = cookie['auth_session']
      if (sessionCookie) {
        sessionCookie.path = '/'
        sessionCookie.remove()
      }
      set.status = 204
    },
    {
      detail: {
        tags: ['Auth'],
        description:
          'Sign out of every device. Destroys all session rows and rotates ' +
          'every per-device wrap secret so any cached seed envelope on any ' +
          'device is immediately unusable.',
      },
    },
  )

  app.use(requireAuth).delete(
    '/others',
    async ({ user, session, body, set }) => {
      await destroyOtherSessions(user.id, session.id, body.deviceId)
      set.status = 204
    },
    {
      body: t.Object({
        deviceId: t.String({
          minLength: 8,
          maxLength: 64,
          pattern: '^[a-zA-Z0-9-]+$',
        }),
      }),
      detail: {
        tags: ['Auth'],
        description:
          "Sign out of every OTHER device. Keeps the caller's session " +
          "and wrap secret intact; rotates every other device's wrap " +
          'secret and deletes every other session row.',
      },
    },
  )

  app.use(getSession).get(
    'current',
    async ({ user, set, request }) => {
      if (!user) {
        set.status = 204
        return null
      }

      const sessionId = getSessionId(request)
      const me = (await db.select().from(users).where(eq(users.id, user.id)))[0]

      return {
        user: me,
        token: sessionId,
      }
    },
    {
      detail: {
        tags: ['Auth', 'Users'],
      },
    },
  )

  app.use(requireAuth).get(
    'current/permissions',
    async ({ user }) => {
      const permissions = await getPermissions(user.id)
      return { permissions }
    },
    {
      detail: {
        tags: ['Auth'],
        summary: 'Get current session permissions',
      },
    },
  )

  app.use(requireAuth).get(
    '/',
    async ({ set, user }) => {
      return await db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, user.id))
        .orderBy(desc(sessions.createdAt))
    },
    {
      detail: {
        tags: ['Auth'],
        summary: 'Get all sessions for current user',
      },
    },
  )

  app.use(requireAuth).delete(
    '/:sessionId',
    async ({ set, user, params: { sessionId } }) => {
      if (!user) return (set.status = 401)
      await db
        .delete(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.userId, user.id)))
      return (set.status = 204)
    },
    {
      detail: {
        tags: ['Auth'],
        summary: 'Delete a session',
      },
    },
  )

  return app
})

export default app
