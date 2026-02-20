import { test, expect } from '@playwright/test'
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
    const errors: string[] = []
    
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })
    
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    
    // Filter out known harmless errors (e.g., map tile 404s, passkey not supported in test env)
    const criticalErrors = errors.filter(err => 
      !err.includes('tile') && 
      !err.includes('404') &&
      !err.includes('Failed to load resource') &&
      !err.includes('Passkey') &&
      !err.includes('NotSupportedError') &&
      !err.includes('WebGL') && // WebGL may not be available in headless mode
      !err.includes('mapbox.com') // Mapbox API may block headless browsers
    )
    
    expect(criticalErrors).toHaveLength(0)
  })
})
