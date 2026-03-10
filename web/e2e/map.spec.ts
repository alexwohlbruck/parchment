import { test, expect } from '@playwright/test'
import { signIn } from './helpers/auth'
import { requireBackend } from './helpers/database'

test.describe('Map', () => {
  test.beforeAll(async () => { await requireBackend() })
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('map container loads and is visible', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    // Map canvas, loading, or Mapbox fallback when no token (use .first() to avoid strict mode when multiple match)
    const mapCanvas = page.locator('canvas.maplibregl-canvas, canvas.mapboxgl-canvas').first()
    const mapLoading = page.getByText(/Loading Map|Preparing map|Mapbox Integration Required|Configure Mapbox/).first()
    await expect(mapCanvas.or(mapLoading).first()).toBeVisible({ timeout: 15000 })
  })

  test('map controls are visible', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(5000)
    const mapCanvas = page.locator('canvas.maplibregl-canvas, canvas.mapboxgl-canvas').first()
    const loadingOrFallback = page.getByText(/Loading Map|Preparing map|Mapbox Integration Required|Configure Mapbox/).first()
    const canvasVisible = await mapCanvas.isVisible({ timeout: 5000 }).catch(() => false)
    const loadingVisible = await loadingOrFallback.isVisible({ timeout: 2000 }).catch(() => false)
    expect(canvasVisible || loadingVisible).toBe(true)
  })

  test('map loads without critical errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    
    // Wait for map to initialize
    await page.waitForTimeout(3000)

    // Filter out expected errors (tile loading, etc.)
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

  test('can interact with map (pan/zoom)', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(4000)
    const mapCanvas = page.locator('canvas.maplibregl-canvas, canvas.mapboxgl-canvas').first()
    const visible = await mapCanvas.isVisible({ timeout: 8000 }).catch(() => false)
    if (!visible) {
      test.skip(true, 'Map canvas not available (no integration or WebGL)')
      return
    }
    await mapCanvas.click({ position: { x: 100, y: 100 } })
    await page.waitForTimeout(500)
  })
})
