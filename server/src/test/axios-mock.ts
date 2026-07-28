/**
 * Shared axios mock for integration tests.
 *
 * Integrations reach the network two ways: the bare `axios` default import and
 * pooled instances from `axios.create()` (see the Barrelman concurrency
 * limiter). A mock that only replaces the default export lets `create()` fall
 * through to real axios, so those tests hit the network and fail with
 * ECONNREFUSED. This factory covers both, and gives `create()` instances the
 * `interceptors` surface callers register against.
 *
 * Usage — the `mock.module` call must run before the integration is imported,
 * so keep it above that import in the test file:
 *
 *   import { createAxiosMock } from '../../test/axios-mock'
 *   const http = createAxiosMock()
 *   mock.module('axios', () => http.module)
 *   import { SomeIntegration } from './some-integration'
 *
 *   http.get.mockResolvedValueOnce({ data: { ok: true } })
 *   expect(http.get.mock.calls[0][0]).toBe('https://api.example.com/thing')
 *
 * Every verb shares one mock across the default export and all `create()`
 * instances, so assertions don't care which instance the code under test used.
 * Call `http.reset()` in `beforeEach` to clear recorded calls.
 */

import { mock } from 'bun:test'

const VERBS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'request'] as const

type Verb = (typeof VERBS)[number]

export type AxiosMock = {
  [K in Verb]: ReturnType<typeof mock>
} & {
  /** Pass to `mock.module('axios', () => http.module)`. */
  module: Record<string, unknown>
  /** Records every config object passed to `axios.create()`. */
  create: ReturnType<typeof mock>
  /**
   * Clears recorded calls AND any queued `mockResolvedValueOnce` /
   * `mockRejectedValueOnce` entries, then restores the default resolution.
   * Call in `beforeEach`: a queued one-off that the test under test never
   * consumed would otherwise fire in a later test and shift every subsequent
   * response by one.
   */
  reset(): void
}

/**
 * Build a fresh axios mock. Verbs resolve to `{ data: undefined }` by default;
 * queue real responses per test with `mockResolvedValueOnce`.
 */
export function createAxiosMock(): AxiosMock {
  const verbs = Object.fromEntries(
    VERBS.map((verb) => [verb, mock(() => Promise.resolve({ data: undefined }))]),
  ) as { [K in Verb]: ReturnType<typeof mock> }

  // Interceptor registration is a no-op: the mock never runs a real request
  // pipeline, so anything registered here would never fire. `use` still returns
  // a handle id because callers occasionally hold onto it to eject later.
  const interceptors = () => ({
    request: { use: mock(() => 0), eject: mock(() => undefined) },
    response: { use: mock(() => 0), eject: mock(() => undefined) },
  })

  const instance = () => ({ ...verbs, interceptors: interceptors(), defaults: {} })

  const create = mock(() => instance())

  const axiosDefault = {
    ...verbs,
    create,
    interceptors: interceptors(),
    defaults: {},
    isAxiosError: (error: unknown) =>
      typeof error === 'object' && error !== null && 'isAxiosError' in error,
  }

  return {
    ...verbs,
    create,
    // Integrations import axios as both `import axios from 'axios'` and
    // `import { AxiosError } from 'axios'`, so expose named exports too.
    module: {
      default: axiosDefault,
      ...axiosDefault,
    },
    reset() {
      for (const verb of VERBS) {
        // mockReset (not mockClear) is what drops the queued *Once entries;
        // it also drops the implementation, so put the default back.
        verbs[verb].mockReset()
        verbs[verb].mockImplementation(() => Promise.resolve({ data: undefined }))
      }
      create.mockReset()
      create.mockImplementation(() => instance())
    },
  }
}

/**
 * Build an axios-shaped rejection, for testing error branches.
 * Mirrors the fields integration code actually reads off a failure.
 */
export function axiosError(
  status: number,
  data: unknown = {},
  message = `Request failed with status code ${status}`,
) {
  return Object.assign(new Error(message), {
    isAxiosError: true,
    response: { status, data, headers: {} },
  })
}
