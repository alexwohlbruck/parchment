/**
 * Signs in once and saves the browser state for every other spec to reuse.
 *
 * Each spec used to run the full OTP flow in `beforeEach` — load /signin,
 * request a code, fill eight PIN boxes, wait for the redirect. That is ~10-15s
 * of the 30s test budget spent before the test does anything, which is what
 * made most of the suite time out on the first attempt and pass on retry.
 *
 * Session identity lives in a cookie plus a few localStorage entries (the
 * identity seed and device id), all of which `storageState` captures, so
 * replaying it is equivalent to having signed in. Specs that exercise
 * authentication itself opt out — see the top of auth.spec.ts.
 */

import { test as setup, expect } from '@playwright/test'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { TEST_USER, fillOtp } from './helpers/auth'
import { requireBackend } from './helpers/database'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const STORAGE_STATE = path.join(__dirname, '.auth/user.json')

setup('authenticate', async ({ page }) => {
  await requireBackend()

  await page.addInitScript(() => {
    ;(window as any).__playwright = true
  })

  await page.goto('/signin')

  const emailInput = page.locator('input[type="email"]')
  await expect(emailInput).toBeVisible()
  await emailInput.fill(TEST_USER.email)

  await page.locator('button[type="submit"]').first().click()

  await page.waitForSelector('#pin-input', { timeout: 15000 })
  await fillOtp(page, TEST_USER.otp)

  // The router sends an authenticated user to the app; anything off /signin
  // means the session cookie has been issued.
  await page.waitForURL((url) => !url.pathname.includes('/signin'), {
    timeout: 30000,
  })

  await page.context().storageState({ path: STORAGE_STATE })
})
