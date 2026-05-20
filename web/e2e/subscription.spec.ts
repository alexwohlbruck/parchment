import { test, expect } from '@playwright/test'
import { signIn } from './helpers/auth'
import { requireBackend } from './helpers/database'

test.describe('Subscription settings', () => {
  test.beforeAll(async () => {
    await requireBackend()
  })

  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('subscription settings page is accessible', async ({ page }) => {
    await page.goto('/settings/billing')
    await page.waitForLoadState('networkidle')

    expect(page.url()).toContain('/settings/billing')

    const app = page.locator('#app')
    await expect(app).toBeVisible()
  })

  test('subscription page loads without console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })

    await page.goto('/settings/billing')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)

    const criticalErrors = errors.filter(
      (err) =>
        !err.includes('tile') &&
        !err.includes('404') &&
        !err.includes('Failed to load resource') &&
        !err.includes('Passkey') &&
        !err.includes('NotSupportedError') &&
        !err.includes('WebGL') &&
        !err.includes('mapbox.com') &&
        !err.includes('ResizeObserver') &&
        !err.includes('CORS') &&
        !err.includes('favicon'),
    )
    expect(criticalErrors).toHaveLength(0)
  })

  test('shows plan section', async ({ page }) => {
    await page.goto('/settings/billing')
    await page.waitForLoadState('networkidle')

    // The page should show the plan section with either Free or Premium status
    const planText = await page.textContent('body')
    const hasPlanInfo =
      planText?.includes('Free') || planText?.includes('Premium')
    expect(hasPlanInfo).toBe(true)
  })
})
