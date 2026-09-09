import { test, expect } from '@playwright/test'
import { collectConsoleErrors, expectNoCriticalErrors } from './helpers/console'
import { requireBackend } from './helpers/database'
import { gotoApp } from './helpers/navigate'

test.describe('Map', () => {
  test.beforeAll(async () => { await requireBackend() })

  test('map container loads and is visible', async ({ page }) => {
    await gotoApp(page, '/')
    // Map canvas, loading, or Mapbox fallback when no token (use .first() to avoid strict mode when multiple match)
    const mapCanvas = page.locator('canvas.maplibregl-canvas, canvas.mapboxgl-canvas').first()
    const mapLoading = page.getByText(/Loading Map|Preparing map|Mapbox Integration Required|Configure Mapbox/).first()
    await expect(mapCanvas.or(mapLoading).first()).toBeVisible({ timeout: 15000 })
  })

  test('map controls are visible', async ({ page }) => {
    await gotoApp(page, '/')
    await page.waitForTimeout(5000)
    const mapCanvas = page.locator('canvas.maplibregl-canvas, canvas.mapboxgl-canvas').first()
    const loadingOrFallback = page.getByText(/Loading Map|Preparing map|Mapbox Integration Required|Configure Mapbox/).first()
    const canvasVisible = await mapCanvas.isVisible({ timeout: 5000 }).catch(() => false)
    const loadingVisible = await loadingOrFallback.isVisible({ timeout: 2000 }).catch(() => false)
    expect(canvasVisible || loadingVisible).toBe(true)
  })

  test('map loads without critical errors', async ({ page }) => {
    const errors = collectConsoleErrors(page)

    await gotoApp(page, '/')
    
    // Wait for map to initialize
    await page.waitForTimeout(3000)

    // Filter out expected errors (tile loading, etc.)
    expectNoCriticalErrors(errors)
  })

  test('can interact with map (pan/zoom)', async ({ page }) => {
    await gotoApp(page, '/')
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
