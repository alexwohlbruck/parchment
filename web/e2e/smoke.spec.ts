import { test, expect } from '@playwright/test'
import { collectConsoleErrors, criticalErrors as filterCritical } from './helpers/console'
import { requireBackend } from './helpers/database'

test.describe('Smoke tests', () => {
  test.beforeAll(async () => { await requireBackend() })

  test('app loads and shows main container', async ({ page }) => {
    await page.goto('/')
    
    // Wait for the app to load
    await page.waitForLoadState('networkidle')
    
    // Check that we're either on signin or the main app
    const body = page.locator('body')
    await expect(body).toBeVisible()
    
    // App should have loaded Vue
    const app = page.locator('#app')
    await expect(app).toBeVisible()
  })

  test('app has correct title', async ({ page }) => {
    await page.goto('/')
    
    // Check page title
    await expect(page).toHaveTitle(/Parchment/)
  })

  test('app loads without console errors', async ({ page }) => {
    const errors = collectConsoleErrors(page)
    
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    
    // Filter out known harmless errors (e.g., map tile 404s, passkey not supported in test env)
    const criticalErrors = filterCritical(errors)
    
    expect(criticalErrors).toHaveLength(0)
  })
})
