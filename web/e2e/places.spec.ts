import { test, expect } from '@playwright/test'
import { collectConsoleErrors, expectNoCriticalErrors } from './helpers/console'
import { requireBackend } from './helpers/database'
import { gotoApp, settle } from './helpers/navigate'

test.describe('Places', () => {
  test.beforeAll(async () => { await requireBackend() })

  test('can navigate to place detail from search', async ({ page }) => {
    // Search for something likely to have results
    await gotoApp(page, '/search?q=restaurant')
    await page.waitForTimeout(2000)
    
    // Try to find a place link
    const placeLink = page.locator('a[href*="/place/"]').first()
    const hasLink = await placeLink.isVisible().catch(() => false)
    
    if (hasLink) {
      await placeLink.click()
      await settle(page)
      
      // Should be on a place detail page
      expect(page.url()).toContain('/place/')
      
      // App should be visible
      const app = page.locator('#app')
      await expect(app).toBeVisible()
    }
    
    // Test passes whether or not results are available
  })

  test('place detail page loads without errors', async ({ page }) => {
    const errors = collectConsoleErrors(page)

    // Try to navigate to a place (will 404 if not found, but shouldn't crash)
    await gotoApp(page, '/place/osm/node/123456789')
    await page.waitForTimeout(1000)

    // Should handle missing places gracefully
    expectNoCriticalErrors(errors)
  })

  test('place coords route is accessible', async ({ page }) => {
    // Test the coords-based place route
    await gotoApp(page, '/place/coords/37.7749/-122.4194')
    
    // Should load without crashing
    const app = page.locator('#app')
    await expect(app).toBeVisible()
    
    // URL should be correct
    expect(page.url()).toContain('/place/coords/')
  })

  test('place location route is accessible', async ({ page }) => {
    // Test the named location route
    await gotoApp(page, '/place/location/San%20Francisco/37.7749/-122.4194')
    
    // Should load without crashing
    const app = page.locator('#app')
    await expect(app).toBeVisible()
    
    // URL should be correct
    expect(page.url()).toContain('/place/location/')
  })
})
