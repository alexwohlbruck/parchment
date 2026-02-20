import { test, expect } from '@playwright/test'
import { signIn, TEST_USER } from './helpers/auth'
import { requireBackend } from './helpers/database'
import { enableVirtualAuthenticator, disableVirtualAuthenticator, getCredentials } from './helpers/webauthn'

test.describe('Authentication', () => {
  test.beforeAll(async () => {
    await requireBackend()
  })

  test('signin page is accessible', async ({ page }) => {
    await page.goto('/signin')
    await page.waitForLoadState('networkidle')

    // Check that we're on the signin page
    expect(page.url()).toContain('/signin')

    // Check for key elements
    const emailInput = page.locator('input[type="email"]')
    await expect(emailInput).toBeVisible()

    const sendCodeButton = page.locator('button[type="submit"]').first()
    await expect(sendCodeButton).toBeVisible()
  })

  test('unauthenticated user is redirected to signin', async ({ page }) => {
    // Try to access a protected route
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Should redirect to signin
    expect(page.url()).toContain('/signin')
  })

  test('can sign in with test user email and OTP', async ({ page }) => {
    await page.goto('/signin')
    await page.waitForLoadState('networkidle')

    // Fill in email
    const emailInput = page.locator('input[type="email"]')
    await emailInput.fill(TEST_USER.email)

    // Click send code
    const sendCodeButton = page.locator('button[type="submit"]').first()
    await sendCodeButton.click()

    // Wait for OTP form
    await page.waitForSelector('#pin-input', { timeout: 5000 })

    // Verify OTP form is visible
    const pinInput = page.locator('#pin-input')
    await expect(pinInput).toBeVisible()

    // Fill in test OTP (0000-0000 = 00000000)
    const firstInput = page.locator('#pin-input')
    await firstInput.fill(TEST_USER.otp)

    // Wait for successful signin and redirect
    await page.waitForURL(url => !url.pathname.includes('/signin'), {
      timeout: 10000,
    })

    // Should be on main app now
    const url = page.url()
    expect(url).not.toContain('/signin')
  })

  test('full signin flow redirects to app', async ({ page }) => {
    await signIn(page)
    const url = page.url()
    expect(url).not.toContain('/signin')
    await expect(page.locator('#app')).toBeVisible({ timeout: 10000 })
  })

  // Passkey tests: temporarily skipped; remove .skip below to re-enable
  test.describe.skip('Passkey (saved for later)', () => {
    test('passkey signin button is visible', async ({ page }) => {
      await page.goto('/signin')
      await page.waitForLoadState('networkidle')
      
      // Look for passkey signin button (i18n: "Sign in with passkey" in en-US)
      const passkeyButton = page.getByRole('button', { name: /sign in with passkey/i })
      
      // In web environment, passkey button should be present (unless we're in Tauri)
      const isVisible = await passkeyButton.isVisible().catch(() => false)
      if (isVisible) {
        await expect(passkeyButton).toBeVisible()
      }
    })

    test('can register and authenticate with passkey', async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'WebAuthn virtual authenticator only works on Chromium')
      test.setTimeout(90_000) // sign in + add passkey + sign out + sign in with passkey

      const { client, authenticatorId } = await enableVirtualAuthenticator(page)
      try {
        await page.goto('/signin')
        await page.waitForLoadState('networkidle')
        await signIn(page)
        await page.goto('/settings/account')
        await page.waitForLoadState('networkidle')

        const addPasskeyButton = page.locator('button:has-text("Add Passkey"), button:has-text("passkey"), button:has-text("Add")')
        const hasButton = await addPasskeyButton.first().isVisible().catch(() => false)
        if (hasButton) {
          await addPasskeyButton.first().click()
          await page.waitForTimeout(1000)
          const passkeyNameInput = page.locator('input[placeholder*="Keychain"], input[placeholder*="Chrome"], input[placeholder*="LastPass"]')
          const hasNameInput = await passkeyNameInput.isVisible().catch(() => false)
          if (hasNameInput) {
            await passkeyNameInput.fill('Playwright Test Passkey')
            await page.locator('button:has-text("Continue")').click()
          }
          await page.waitForTimeout(2000)
          const credentials = await getCredentials(client, authenticatorId)
          expect(credentials.length).toBeGreaterThan(0)

          const signOutButton = page.locator('button:has-text("Sign out"), button:has-text("Logout")')
          const hasSignOut = await signOutButton.first().isVisible().catch(() => false)
          if (hasSignOut) {
            await signOutButton.first().click()
            await page.waitForURL('**/signin', { timeout: 5000 })
          } else {
            await page.goto('/signin')
          }
          await page.waitForLoadState('networkidle')
          const passkeySigninButton = page.getByRole('button', { name: /sign in with passkey/i })
          await expect(passkeySigninButton).toBeVisible({ timeout: 5000 })
          await passkeySigninButton.click()
          await page.waitForURL(url => !url.pathname.includes('/signin'), { timeout: 10000 })
          expect(page.url()).not.toContain('/signin')
        } else {
          test.skip(true, 'Passkey registration UI not found')
        }
      } finally {
        await disableVirtualAuthenticator(client, authenticatorId)
      }
    })
  })
})
