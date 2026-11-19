import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { createFrameCap } from './frame-cap'

class FakeMap {
  frames = 0
  triggerRepaint() {
    this.frames++
  }
}

describe('createFrameCap', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('passes every repaint through while uncapped', () => {
    const map = new FakeMap()
    createFrameCap(map as unknown as MaplibreMap)
    map.triggerRepaint()
    map.triggerRepaint()
    expect(map.frames).toBe(2)
  })

  it('folds repaints inside the interval into one deferred frame', () => {
    const map = new FakeMap()
    createFrameCap(map as unknown as MaplibreMap).set(33)
    map.triggerRepaint()
    map.triggerRepaint()
    map.triggerRepaint()
    expect(map.frames).toBe(1)
    vi.advanceTimersByTime(33)
    expect(map.frames).toBe(2)
  })

  it('spaces requests made mid-frame a full interval apart', () => {
    const map = new FakeMap()
    createFrameCap(map as unknown as MaplibreMap).set(33)
    map.triggerRepaint()
    vi.advanceTimersByTime(20)
    map.triggerRepaint()
    vi.advanceTimersByTime(12)
    expect(map.frames).toBe(1)
    vi.advanceTimersByTime(1)
    expect(map.frames).toBe(2)
  })

  it('hands the original repaint back on dispose', () => {
    const map = new FakeMap()
    const cap = createFrameCap(map as unknown as MaplibreMap)
    cap.set(33)
    cap.dispose()
    map.triggerRepaint()
    map.triggerRepaint()
    expect(map.frames).toBe(2)
  })
})
