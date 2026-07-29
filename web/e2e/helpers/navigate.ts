/**
 * Navigation helpers.
 *
 * The suite used to pair every `page.goto()` with
 * `waitForLoadState('networkidle')`. That wait is a poor fit for this app and
 * a major source of flake: the client holds a realtime WebSocket open and
 * streams map tiles, so "500ms with no network activity" may not happen until
 * the test times out. Playwright discourages it for exactly this reason.
 *
 * Instead we wait on the thing we actually care about — the SPA has mounted
 * and the router has settled on a URL — and let Playwright's auto-waiting
 * assertions handle the rest.
 */

import { Page, expect } from '@playwright/test'

/** Navigate and wait for the Vue app to mount. */
export async function gotoApp(page: Page, path: string) {
  await page.goto(path)
  await expect(page.locator('#app')).toBeVisible()
}

/**
 * Navigate and wait for the router to settle on a URL containing `expected`.
 *
 * Use when a test asserts on `page.url()`: the app redirects client-side
 * (auth guard, tab redirects like /library → /library/collections), so the URL
 * right after `goto` is not necessarily the final one.
 */
export async function gotoAndExpectUrl(
  page: Page,
  path: string,
  expected: string,
) {
  await page.goto(path)
  await page.waitForURL((url) => url.href.includes(expected), {
    timeout: 15000,
  })
  await expect(page.locator('#app')).toBeVisible()
}

/**
 * Settle after an in-app interaction (tab switch, dialog open) without a
 * fixed sleep. Waits for the app to be idle enough to assert against.
 */
export async function settle(page: Page) {
  await expect(page.locator('#app')).toBeVisible()
}
