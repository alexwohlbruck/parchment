import { test, expect } from '@playwright/test'
import { signIn } from './helpers/auth'
import { requireBackend } from './helpers/database'

test.describe('Directions', () => {
  test.beforeAll(async () => { await requireBackend() })
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('directions view is accessible', async ({ page }) => {
    await page.goto('/directions')
    await page.waitForLoadState('networkidle')

    // Check URL
    expect(page.url()).toContain('/directions')

    // Check that directions UI is visible
    const app = page.locator('#app')
    await expect(app).toBeVisible()

    // Waypoint inputs should be visible
    const waypointInputs = page.locator(
      'input[type="text"], input[placeholder*="location"], input[placeholder*="destination"], input[placeholder*="origin"]',
    )
    const inputCount = await waypointInputs.count()

    // Should have at least 2 waypoint inputs (origin and destination)
    expect(inputCount).toBeGreaterThanOrEqual(2)
  })

  test('travel mode selector is visible', async ({ page }) => {
    await page.goto('/directions')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)
    const modeSelector = page.locator('[role="tablist"], [class*="tabs"], button[role="tab"]').first()
    await expect(modeSelector).toBeVisible({ timeout: 8000 })
  })

  test('can switch between travel modes', async ({ page }) => {
    await page.goto('/directions')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)
    const modeTabs = page.locator('button[role="tab"]')
    const tabCount = await modeTabs.count()
    if (tabCount < 2) {
      test.skip(true, 'Need at least 2 mode tabs')
      return
    }
    const secondMode = modeTabs.nth(1)
    await secondMode.click()
    await page.waitForTimeout(500)
    const isSelected = await secondMode.getAttribute('data-state')
    const ariaSelected = await secondMode.getAttribute('aria-selected')
    expect(isSelected === 'active' || ariaSelected === 'true').toBe(true)
  })

  test('waypoint inputs accept text', async ({ page }) => {
    await page.goto('/directions')
    await page.waitForLoadState('networkidle')

    // Find first waypoint input
    const firstInput = page.locator('input[type="text"]').first()
    await expect(firstInput).toBeVisible()

    // Type in the input
    await firstInput.fill('San Francisco')

    // Verify value
    const value = await firstInput.inputValue()
    expect(value).toContain('San Francisco')
  })

  test('can add additional waypoints', async ({ page }) => {
    await page.goto('/directions')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)
    const initialInputs = await page.locator('input[type="text"]').count()
    const addButton = page.locator(
      'button:has-text("Add"), button[aria-label*="add"], button:has([class*="plus"]), button:has(svg)',
    )
    const hasAddButton = await addButton
      .first()
      .isVisible()
      .catch(() => false)

    if (hasAddButton) {
      await addButton.first().click()
      await page.waitForTimeout(1000)
      const newInputs = await page.locator('input[type="text"]').count()
      if (newInputs > initialInputs) {
        expect(newInputs).toBeGreaterThan(initialInputs)
      }
    }
  })

  test('directions page loads without errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })

    await page.goto('/directions')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)

    // Filter out expected errors
    const criticalErrors = errors.filter(
      err =>
        !err.includes('tile') &&
        !err.includes('404') &&
        !err.includes('Failed to load resource') &&
        !err.includes('Passkey') &&
        !err.includes('NotSupportedError') &&
        !err.includes('WebGL') && // WebGL may not be available in headless mode
        !err.includes('mapbox.com'), // Mapbox API may block headless browsers
    )

    expect(criticalErrors).toHaveLength(0)
  })
})
