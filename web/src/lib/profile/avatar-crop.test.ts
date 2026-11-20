import { describe, expect, it } from 'vitest'
import { clampCrop, initialCrop, MAX_ZOOM, sourceRect, zoomAround } from './avatar-crop'

const landscape = { width: 800, height: 400 }
const VIEWPORT = 200

describe('initialCrop', () => {
  it('centers the image so its short side fills the viewport', () => {
    const crop = initialCrop(landscape, VIEWPORT)
    expect(crop).toEqual({ zoom: 1, x: -100, y: 0 })
    const rect = sourceRect(crop, landscape, VIEWPORT)
    expect([rect.x, rect.y, rect.size]).toEqual([200, expect.closeTo(0), 400])
  })
})

describe('clampCrop', () => {
  it('never lets the image uncover the viewport', () => {
    expect(clampCrop({ zoom: 1, x: 50, y: 30 }, landscape, VIEWPORT)).toEqual({ zoom: 1, x: 0, y: 0 })
    expect(clampCrop({ zoom: 1, x: -999, y: -999 }, landscape, VIEWPORT)).toEqual({
      zoom: 1,
      x: -200,
      y: 0,
    })
  })

  it('limits zoom', () => {
    expect(clampCrop({ zoom: 0.5, x: 0, y: 0 }, landscape, VIEWPORT).zoom).toBe(1)
    expect(clampCrop({ zoom: 99, x: 0, y: 0 }, landscape, VIEWPORT).zoom).toBe(MAX_ZOOM)
  })
})

describe('zoomAround', () => {
  it('keeps the point under the focus fixed', () => {
    const start = initialCrop(landscape, VIEWPORT)
    const focus = { x: 100, y: 100 }
    const before = sourceRect(start, landscape, VIEWPORT)
    const zoomed = zoomAround(start, 2, focus, landscape, VIEWPORT)
    const after = sourceRect(zoomed, landscape, VIEWPORT)

    expect(after.size).toBe(before.size / 2)
    expect(after.x + after.size / 2).toBeCloseTo(before.x + before.size / 2)
    expect(after.y + after.size / 2).toBeCloseTo(before.y + before.size / 2)
  })
})
