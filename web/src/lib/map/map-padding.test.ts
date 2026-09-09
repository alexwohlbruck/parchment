import { describe, it, expect } from 'vitest'
import { calculateFitPadding, toContainerRect } from './map-padding'

/**
 * The desktop sidebar is a flex sibling of the map canvas, so the canvas
 * origin is already inset by its width — and that width is now whatever the
 * user dragged the rail to.
 */
describe('toContainerRect', () => {
  it('is a no-op when the container fills the viewport', () => {
    const visible = { x: 0, y: 240, width: 390, height: 600 }
    expect(toContainerRect(visible, { left: 0, top: 0 })).toEqual(visible)
  })

  it('drops the container offset out of the visible rect', () => {
    // 1280px viewport, 320px sidebar, a 400px drawer over the canvas.
    const visible = { x: 720, y: 0, width: 560, height: 800 }
    expect(toContainerRect(visible, { left: 320, top: 0 })).toEqual({
      x: 400,
      y: 0,
      width: 560,
      height: 800,
    })
  })
})

describe('calculateFitPadding', () => {
  it('measures the gutters from the container, not the viewport', () => {
    const viewportSpace = { x: 720, y: 0, width: 560, height: 800 }
    const containerSpace = toContainerRect(viewportSpace, { left: 320, top: 0 })

    // 960 x 800 canvas: 5% of 960 = 48 side margin, 8% of 800 = 64 top/bottom.
    const padding = calculateFitPadding(containerSpace, 960, 800)
    expect(padding.left).toBe(400 + 48)
    expect(padding.right).toBe(48)
    expect(padding.top).toBe(64)
    expect(padding.bottom).toBe(64)

    // Uncorrected, the drawer gutter would carry the sidebar's width too.
    expect(calculateFitPadding(viewportSpace, 960, 800).left).toBe(720 + 48)
  })

  it('never returns a negative gutter', () => {
    const padding = calculateFitPadding(
      { x: -20, y: -10, width: 1000, height: 900 },
      960,
      800,
    )
    expect(padding.left).toBe(48)
    expect(padding.top).toBe(64)
  })
})
