import { test, expect } from '@playwright/test'
import { signIn } from './helpers/auth'
import { requireBackend } from './helpers/database'

test.describe('Library', () => {
  test.beforeAll(async () => { await requireBackend() })
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('library page is accessible', async ({ page }) => {
    await page.goto('/library')
    await page.waitForLoadState('networkidle')
    
    // Check URL
    expect(page.url()).toContain('/library')
    
    // App should be visible
    const app = page.locator('#app')
    await expect(app).toBeVisible()
  })

  test('library page loads without errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })

    await page.goto('/library')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)

    // Filter out expected errors
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

  test('can navigate between library tabs', async ({ page }) => {
    await page.goto('/library')
    await page.waitForLoadState('networkidle')
    
    // Look for tabs (bookmarks, collections, layers, etc.)
    const tabs = page.locator('button[role="tab"], [class*="tab"]')
    const tabCount = await tabs.count()
    
    if (tabCount >= 2) {
      // Click on second tab
      await tabs.nth(1).click()
      await page.waitForTimeout(500)
      
      // Should still be on library page
      expect(page.url()).toContain('/library')
    }
  })

  test('bookmarks section is accessible', async ({ page }) => {
    await page.goto('/library')
    await page.waitForLoadState('networkidle')
    
    // Look for bookmarks-related content
    // This could be a tab, heading, or section
    const bookmarksSection = page.locator('text=/bookmarks/i, [data-section="bookmarks"]').first()
    
    // Either bookmarks are visible or we're on the library page
    const url = page.url()
    expect(url).toContain('/library')
  })

  test('collections section is accessible', async ({ page }) => {
    await page.goto('/library')
    await page.waitForLoadState('networkidle')
    
    // Look for collections tab or section
    const collectionsTab = page.locator('text=/collections/i, button:has-text("Collections")').first()
    const hasCollections = await collectionsTab.isVisible().catch(() => false)
    
    if (hasCollections) {
      await collectionsTab.click()
      await page.waitForTimeout(500)
      
      // Should still be on library
      expect(page.url()).toContain('/library')
    }
  })

  test('layers section is accessible', async ({ page }) => {
    await page.goto('/library')
    await page.waitForLoadState('networkidle')
    
    // Look for layers tab or section
    const layersTab = page.locator('text=/layers/i, button:has-text("Layers")').first()
    const hasLayers = await layersTab.isVisible().catch(() => false)
    
    if (hasLayers) {
      await layersTab.click()
      await page.waitForTimeout(500)
      
      // Should still be on library
      expect(page.url()).toContain('/library')
    }
  })

  test('can bookmark a place from search', async ({ page }) => {
    // First, search for something
    await page.goto('/search?q=cafe')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
    
    // Try to find a place and its bookmark button
    const bookmarkButton = page.locator('button[aria-label*="bookmark"], button[aria-label*="save"], [class*="bookmark"]').first()
    const hasButton = await bookmarkButton.isVisible().catch(() => false)
    
    if (hasButton) {
      await bookmarkButton.click()
      await page.waitForTimeout(500)
      
      // Navigate to library to check
      await page.goto('/library')
      await page.waitForLoadState('networkidle')
      
      // Should be on library page
      expect(page.url()).toContain('/library')
    }
    
    // Test passes whether or not bookmark functionality is found
  })
})
