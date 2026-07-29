/**
 * Harness for controller (endpoint) tests.
 *
 * Mounts a controller into a bare Elysia app composed the same way `index.ts`
 * composes the real one — notably the i18next plugin, which `requireAuth` and
 * most error paths call `t()` on. Requests are driven through `app.handle()`,
 * so there is no listening socket and no port to collide on.
 *
 *   import { createTestApp, req } from '../test/app'
 *   import vehicles from './vehicle.controller'
 *
 *   const app = createTestApp(vehicles)
 *   const res = await req(app).get('/vehicles')
 *   expect(res.status).toBe(401)
 *
 * See `auth-mock.ts` for driving the authenticated paths.
 */

import { Elysia } from 'elysia'
import { i18next } from 'elysia-i18next'
import { getI18nInitOptions, detectLanguage } from '../lib/i18n'

/** Anything Elysia accepts in `.use()` — a controller module's default export. */
type Plugin = Parameters<Elysia['use']>[0]

/**
 * Build an app with `controllers` mounted. Pass several when a route under test
 * depends on another controller being present.
 */
export function createTestApp(...controllers: Plugin[]): Elysia {
  const app = new Elysia().use(
    i18next({
      initOptions: getI18nInitOptions(),
      detectLanguage: ({ request }) => {
        const url = new URL(request.url)
        const queryLang = url.searchParams.get('lang') ?? undefined
        const acceptLanguage = request.headers.get('accept-language') ?? undefined
        return detectLanguage(queryLang, acceptLanguage)
      },
    }),
  )
  for (const controller of controllers) app.use(controller)
  return app
}

export interface TestResponse<T = any> {
  status: number
  /** Parsed JSON when the response is JSON, otherwise the raw text. */
  body: T
  headers: Headers
}

export interface RequestOptions {
  /** Serialized as a JSON body with the matching content-type. */
  body?: unknown
  /** Sent as `Authorization: Bearer <token>`. */
  token?: string
  headers?: Record<string, string>
  /** Appended as a query string; nullish values are dropped. */
  query?: Record<string, string | number | boolean | undefined | null>
}

const BASE = 'http://localhost'

async function send(
  app: Elysia,
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<TestResponse> {
  const url = new URL(path, BASE)
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
  }

  const headers: Record<string, string> = { ...options.headers }
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  if (options.body !== undefined) headers['content-type'] ??= 'application/json'

  const response = await app.handle(
    new Request(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
  )

  const text = await response.text()
  let body: unknown = text
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      // Non-JSON response (redirect HTML, plain text) — keep the raw text.
    }
  }

  return { status: response.status, body, headers: response.headers }
}

/**
 * Verb helpers bound to an app:  `await req(app).post('/vehicles', { body })`
 */
export function req(app: Elysia) {
  return {
    get: (path: string, options?: RequestOptions) => send(app, 'GET', path, options),
    post: (path: string, options?: RequestOptions) => send(app, 'POST', path, options),
    put: (path: string, options?: RequestOptions) => send(app, 'PUT', path, options),
    patch: (path: string, options?: RequestOptions) => send(app, 'PATCH', path, options),
    delete: (path: string, options?: RequestOptions) => send(app, 'DELETE', path, options),
  }
}
