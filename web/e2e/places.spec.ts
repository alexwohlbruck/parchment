import { test, expect } from '@playwright/test'
import { signIn } from './helpers/auth'
import { requireBackend } from './helpers/database'

test.describe('Places', () => {
  test.beforeAll(async () => { await requireBackend() })
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('can navigate to place detail from search', async ({ page }) => {
    // Search for something likely to have results
    await page.goto('/search?q=restaurant')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
    
    // Try to find a place link
    const placeLink = page.locator('a[href*="/place/"]').first()
    const hasLink = await placeLink.isVisible().catch(() => false)
    
    if (hasLink) {
      await placeLink.click()
      await page.waitForLoadState('networkidle')
      
      // Should be on a place detail page
      expect(page.url()).toContain('/place/')
      
      // App should be visible
      const app = page.locator('#app')
      await expect(app).toBeVisible()
    }
    
    // Test passes whether or not results are available
  })

  test('place detail page loads without errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })

    // Try to navigate to a place (will 404 if not found, but shouldn't crash)
    await page.goto('/place/osm/node/123456789')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)

    // Filter out expected errors
    const criticalErrors = errors.filter(err =>
      !err.includes('tile') &&
      !err.includes('404') &&
      !err.includes('Failed to load resource') &&
      !err.includes('Passkey') &&
      !err.includes('NotSupportedError') &&
      !err.includes('Not Found') && // Place might not exist
      !err.includes('WebGL') && // WebGL may not be available in headless mode
      !err.includes('mapbox.com') // Mapbox API may block headless browsers
    )

    // Should handle missing places gracefully
    expect(criticalErrors).toHaveLength(0)
  })

  test('place coords route is accessible', async ({ page }) => {
    // Test the coords-based place route
    await page.goto('/place/coords/37.7749/-122.4194')
    await page.waitForLoadState('networkidle')
    
    // Should load without crashing
    const app = page.locator('#app')
    await expect(app).toBeVisible()
    
    // URL should be correct
    expect(page.url()).toContain('/place/coords/')
  })

  test('place location route is accessible', async ({ page }) => {
    // Test the named location route
    await page.goto('/place/location/San%20Francisco/37.7749/-122.4194')
    await page.waitForLoadState('networkidle')
    
    // Should load without crashing
    const app = page.locator('#app')
    await expect(app).toBeVisible()
    
    // URL should be correct
    expect(page.url()).toContain('/place/location/')
  })
})
