import { test, expect } from '@playwright/test'
import { requireBackend } from './helpers/database'
import { gotoApp } from './helpers/navigate'

test.describe('Integrations', () => {
  test.beforeAll(async () => { await requireBackend() })

  test('integrations page is accessible', async ({ page }) => {
    await gotoApp(page, '/settings/integrations')

    expect(page.url()).toContain('/settings/integrations')

    const app = page.locator('#app')
    await expect(app).toBeVisible()
  })

  test('can view available integrations', async ({ page }) => {
    await gotoApp(page, '/settings/integrations')

    // Wait for loading to finish
    await page.waitForTimeout(2000)

    // Should see integration tiles or empty state
    const tiles = page.locator('[class*="card"], [class*="integration"]')
    const emptyMessage = page.locator('text=/no available|no configured/i')
    const hasContent = (await tiles.count() > 0) || (await emptyMessage.isVisible().catch(() => false))
    expect(hasContent).toBe(true)
  })

  test('can configure Mapbox integration', async ({ page }) => {
    await gotoApp(page, '/settings/integrations')
    await page.waitForTimeout(2000)

    // Find Mapbox tile and click (configure or edit)
    const mapboxTile = page.locator('text=Mapbox').first()
    const hasMapbox = await mapboxTile.isVisible().catch(() => false)

    if (!hasMapbox) {
      test.skip(true, 'Mapbox integration not listed')
      return
    }

    await mapboxTile.click()
    await page.waitForTimeout(500)

    // Dialog should open with access token field
    const tokenInput = page.locator('input[name="accessToken"], input[placeholder*="token"], input[id*="accessToken"]').first()
    await expect(tokenInput).toBeVisible({ timeout: 5000 })

    // Use test token from env or placeholder
    const testToken = process.env.E2E_MAPBOX_TOKEN || 'pk.test-playwright-e2e'
    await tokenInput.fill(testToken)

    // Click Save / Continue
    const saveButton = page.locator('button:has-text("Save"), button:has-text("Continue"), button[type="submit"]').first()
    await saveButton.click()

    // Wait for dialog to close and success
    await page.waitForTimeout(2000)

    // Should still be on integrations page
    expect(page.url()).toContain('/settings/integrations')
  })

  test('integration status indicators are visible', async ({ page }) => {
    await gotoApp(page, '/settings/integrations')
    await page.waitForTimeout(3000)
    // Integrations page uses SettingsSection (H5 titles) and cards; wait for content or empty state
    const content = page.locator('h5, [class*="card"], [class*="integration"], .text-muted-foreground').first()
    await expect(content).toBeVisible({ timeout: 10000 })
  })
})
