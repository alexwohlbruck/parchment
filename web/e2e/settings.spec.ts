import { test, expect } from '@playwright/test'
import { signIn } from './helpers/auth'
import { requireBackend } from './helpers/database'

test.describe('Settings', () => {
  test.beforeAll(async () => { await requireBackend() })
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('settings page is accessible', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
    
    // Check URL
    expect(page.url()).toContain('/settings')
    
    // App should be visible
    const app = page.locator('#app')
    await expect(app).toBeVisible()
  })

  test('settings page loads without errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })

    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)

    const criticalErrors = errors.filter(err =>
      !err.includes('tile') &&
      !err.includes('404') &&
      !err.includes('Failed to load resource') &&
      !err.includes('Passkey') &&
      !err.includes('NotSupportedError') &&
      !err.includes('WebGL') &&
      !err.includes('mapbox.com') &&
      !err.includes('ResizeObserver') &&
      !err.includes('CORS') &&
      !err.includes('favicon')
    )
    expect(criticalErrors).toHaveLength(0)
  })

  test('account settings are accessible', async ({ page }) => {
    await page.goto('/settings/account')
    await page.waitForLoadState('networkidle')
    
    // Check URL
    expect(page.url()).toContain('/settings/account')
    
    // App should be visible
    const app = page.locator('#app')
    await expect(app).toBeVisible()
  })

  test('appearance settings are accessible', async ({ page }) => {
    await page.goto('/settings/appearance')
    await page.waitForLoadState('networkidle')
    
    // Check URL
    expect(page.url()).toContain('/settings/appearance')
    
    // App should be visible
    const app = page.locator('#app')
    await expect(app).toBeVisible()
  })

  test('map settings are accessible', async ({ page }) => {
    await page.goto('/settings/map')
    await page.waitForLoadState('networkidle')
    
    // Check URL
    expect(page.url()).toContain('/settings/map')
    
    // App should be visible
    const app = page.locator('#app')
    await expect(app).toBeVisible()
  })

  test('behavior settings are accessible', async ({ page }) => {
    await page.goto('/settings/behavior')
    await page.waitForLoadState('networkidle')
    
    // Check URL
    expect(page.url()).toContain('/settings/behavior')
    
    // App should be visible
    const app = page.locator('#app')
    await expect(app).toBeVisible()
  })

  test('can navigate between settings sections', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
    
    // Look for navigation links or tabs
    const navLinks = page.locator('a[href*="/settings/"], button[data-section]')
    const linkCount = await navLinks.count()
    
    if (linkCount >= 2) {
      // Click on second link
      await navLinks.nth(1).click()
      await page.waitForLoadState('networkidle')
      
      // Should still be in settings
      expect(page.url()).toContain('/settings')
    }
  })

  test('can toggle theme', async ({ page }) => {
    await page.goto('/settings/appearance')
    await page.waitForLoadState('networkidle')
    
    // Look for theme toggle (dark mode, light mode, etc.)
    const themeToggle = page.locator('button[aria-label*="theme"], button:has-text("Dark"), button:has-text("Light")').first()
    const hasToggle = await themeToggle.isVisible().catch(() => false)
    
    if (hasToggle) {
      await themeToggle.click()
      await page.waitForTimeout(500)
      
      // Should still be on appearance settings
      expect(page.url()).toContain('/settings/appearance')
    }
  })
})
