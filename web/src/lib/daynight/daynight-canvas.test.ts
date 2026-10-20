import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderDayNightCanvas } from './daynight-canvas'

afterEach(() => vi.restoreAllMocks())

describe('day/night image', () => {
  it('maps twilight to Mercator latitudes, including the Arctic Circle', () => {
    const data = new Uint8ClampedArray(360 * 360 * 4)
    const putImageData = vi.fn()
    const canvas = { getContext: () => ({ createImageData: () => ({ data }), putImageData }) }
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement)
    renderDayNightCanvas(360, 360, new Date('2026-06-21T00:00:00Z'))
    const alphaAt = (x: number, y: number) => data[(y * 360 + x) * 4 + 3]
    expect(alphaAt(180, 90)).toBeLessThan(25)
    expect(alphaAt(180, 180)).toBeGreaterThan(100)
    expect(alphaAt(0, 180)).toBe(0)
    expect(putImageData).toHaveBeenCalledOnce()
  })
})
