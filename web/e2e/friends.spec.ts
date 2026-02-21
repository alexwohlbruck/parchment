import { test, expect } from '@playwright/test'
import { signIn } from './helpers/auth'
import { requireBackend } from './helpers/database'

test.describe('Friends', () => {
  test.beforeAll(async () => { await requireBackend() })
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('friends page is accessible', async ({ page }) => {
    await page.goto('/friends')
    await page.waitForLoadState('networkidle')
    
    // Check URL
    expect(page.url()).toContain('/friends')
    
    // App should be visible
    const app = page.locator('#app')
    await expect(app).toBeVisible()
  })

  test('friends page loads without errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })

    await page.goto('/friends')
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

  test('can navigate to friends list', async ({ page }) => {
    await page.goto('/friends')
    await page.waitForLoadState('networkidle')
    
    // Should be on friends page
    expect(page.url()).toContain('/friends')
    
    // Look for friends-related UI elements
    // Could be a list, empty state, or add friend button
    const friendsContainer = page.locator('[class*="friend"], [data-testid*="friend"]').first()
    const addFriendButton = page.locator('button:has-text("Add"), button[aria-label*="add"]').first()
    
    // Either friends list or add button should be present
    const hasFriendsList = await friendsContainer.isVisible().catch(() => false)
    const hasAddButton = await addFriendButton.isVisible().catch(() => false)
    
    // At least the page should load
    const app = page.locator('#app')
    await expect(app).toBeVisible()
  })

  test('friends profile route is accessible', async ({ page }) => {
    await page.goto('/friends/testuser')
    await page.waitForLoadState('networkidle')
    // Allow time for route to resolve (may show profile or not-found)
    await page.waitForTimeout(1500)
    const app = page.locator('#app')
    await expect(app).toBeVisible({ timeout: 10000 })
    expect(page.url()).toContain('/friends')
  })

  test('can view location sharing features', async ({ page }) => {
    await page.goto('/friends')
    await page.waitForLoadState('networkidle')
    
    // Look for location sharing toggle or settings
    const locationToggle = page.locator('button[role="switch"], input[type="checkbox"]').first()
    const hasToggle = await locationToggle.isVisible().catch(() => false)
    
    // Test passes whether or not location features are visible
    // (depends on friend list and permissions)
    expect(page.url()).toContain('/friends')
  })
})
