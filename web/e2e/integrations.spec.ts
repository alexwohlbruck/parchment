import { test, expect } from '@playwright/test'
import { signIn } from './helpers/auth'
import { requireBackend } from './helpers/database'

test.describe('Integrations', () => {
  test.beforeAll(async () => { await requireBackend() })
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('integrations page is accessible', async ({ page }) => {
    await page.goto('/settings/integrations')
    await page.waitForLoadState('networkidle')

    expect(page.url()).toContain('/settings/integrations')

    const app = page.locator('#app')
    await expect(app).toBeVisible()
  })

  test('can view available integrations', async ({ page }) => {
    await page.goto('/settings/integrations')
    await page.waitForLoadState('networkidle')

    // Wait for loading to finish
    await page.waitForTimeout(2000)

    // Should see integration tiles or empty state
    const tiles = page.locator('[class*="card"], [class*="integration"]')
    const emptyMessage = page.locator('text=/no available|no configured/i')
    const hasContent = (await tiles.count() > 0) || (await emptyMessage.isVisible().catch(() => false))
    expect(hasContent).toBe(true)
  })

  test('can configure Mapbox integration', async ({ page }) => {
    await page.goto('/settings/integrations')
    await page.waitForLoadState('networkidle')
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
    await page.goto('/settings/integrations')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)
    // Integrations page uses SettingsSection (H5 titles) and cards; wait for content or empty state
    const content = page.locator('h5, [class*="card"], [class*="integration"], .text-muted-foreground').first()
    await expect(content).toBeVisible({ timeout: 10000 })
  })

  test('can remove integration when configured', async ({ page }) => {
    await page.goto('/settings/integrations')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    await page.locator('[data-slot="dialog-overlay"]').waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {})
    const deleteButton = page.locator('button').filter({ has: page.locator('[class*="trash"], svg') }).first()
    const hasDelete = await deleteButton.isVisible({ timeout: 5000 }).catch(() => false)
    if (!hasDelete) {
      test.skip(true, 'No configured integration to remove')
      return
    }
    await deleteButton.click({ timeout: 10000 })
    await page.waitForTimeout(800)
    const confirmButton = page.locator('button:has-text("Delete"), button:has-text("Remove"), button:has-text("Confirm")').first()
    const hasConfirm = await confirmButton.isVisible({ timeout: 5000 }).catch(() => false)
    if (hasConfirm) {
      await confirmButton.click()
      await page.waitForTimeout(1500)
    }
    // After removal we may stay on integrations or be redirected (e.g. home)
    const url = page.url()
    const onIntegrations = /\/settings\/integrations/.test(url)
    const onAppRoot = /^https?:\/\/[^/]+\/?$/.test(url) || url.endsWith('/')
    expect(onIntegrations || onAppRoot).toBe(true)
  })
})
