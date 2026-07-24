import { Page } from '@playwright/test'

/**
 * Console-error text that is expected in the backend-light e2e environment and
 * is not a signal of an app defect: missing map tiles / unconfigured Mapbox
 * token, integrations that aren't set up, federation endpoints that 404, the
 * headless WebGL limits, and transient network failures against services the
 * test stack doesn't run.
 *
 * Genuine app exceptions (e.g. "x is not a function", "Cannot read properties
 * of undefined", "Uncaught") do NOT match anything here, so the smoke-level
 * "loads without console errors" checks still catch real regressions.
 */
const EXPECTED_NOISE = [
  'tile',
  '404',
  'Failed to load resource',
  'Failed to fetch',
  'NetworkError',
  'net::ERR',
  'ERR_NETWORK',
  'AbortError',
  'Passkey',
  'NotSupportedError',
  'WebGL',
  'mapbox',
  'Mapbox',
  'ResizeObserver',
  'CORS',
  'favicon',
]

export function isExpectedNoise(text: string): boolean {
  return EXPECTED_NOISE.some(n => text.includes(n))
}

/**
 * Register a console listener and return the growing array of console.error
 * texts. Filter with {@link criticalErrors} before asserting.
 */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

/** Drop expected-noise entries, leaving only errors that should fail a test. */
export function criticalErrors(errors: string[]): string[] {
  return errors.filter(e => !isExpectedNoise(e))
}
