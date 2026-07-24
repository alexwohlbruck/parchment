import { Page, expect } from '@playwright/test'

/**
 * Test user credentials.
 * Must match seed user; APP_TESTER_EMAIL in .env.test and docker-compose.test.yml.
 * That user always gets OTP 00000000.
 */
export const TEST_USER = {
  email: process.env.APP_TESTER_EMAIL || 'test@parchment.local',
  otp: '00000000', // 8 digits: 0000-0000
}

/**
 * Enter the OTP into the PIN field.
 *
 * The reka-ui PinInput renders one <input> per digit, each exposed as a
 * textbox named "pin input N of 8". `#pin-input` is only the component root and
 * isn't a fillable <input>, so we target the per-digit boxes by role and fill
 * each one. The component auto-submits on @complete, but that event can be
 * missed when digits are set programmatically, so we also click Submit
 * explicitly (no-op if auto-submit already navigated away).
 */
export async function fillOtp(page: Page, otp: string) {
  const inputs = page.getByRole('textbox', { name: /pin input/i })
  await inputs.first().waitFor({ state: 'visible', timeout: 10000 })
  for (let i = 0; i < otp.length; i++) {
    await inputs.nth(i).fill(otp[i])
  }
  const submit = page.getByRole('button', { name: 'Submit' })
  if (await submit.isEnabled().catch(() => false)) {
    await submit.click({ timeout: 3000 }).catch(() => {})
  }
}

/**
 * Sign in to the app using the test user
 */
export async function signIn(page: Page) {
  // Inject flag to indicate we're in Playwright test environment
  await page.addInitScript(() => {
    (window as any).__playwright = true
  })
  
  // Go to signin page
  await page.goto('/signin')
  await page.waitForLoadState('networkidle')

  // Fill in email
  const emailInput = page.locator('input[type="email"]')
  await emailInput.fill(TEST_USER.email)

  // Click send code button
  const sendCodeButton = page.locator('button[type="submit"]').first()
  await sendCodeButton.click()

  // Wait for OTP form to appear
  await page.waitForSelector('#pin-input', { timeout: 10000 })

  // Fill in OTP (8 digits)
  await fillOtp(page, TEST_USER.otp)

  // Wait for redirect to main app (should go to / or wherever stashed path was)
  await page.waitForURL(url => !url.pathname.includes('/signin'), {
    timeout: 20000,
  })
}

/**
 * Check if user is authenticated (not on signin page)
 */
export async function isAuthenticated(page: Page): Promise<boolean> {
  return !page.url().includes('/signin')
}
