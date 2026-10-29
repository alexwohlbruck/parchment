import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { captureMapSnapshot } from './map-snapshot'

function setup() {
  const listeners = new Set<() => void>()
  const canvas = {
    width: 780, height: 1688,
    getBoundingClientRect: () => ({ left: 0, top: 12, width: 390, height: 844 }),
    toDataURL: vi.fn(() => 'data:image/webp;base64,bWFw'),
  }
  const map = {
    getCanvas: () => canvas as unknown as HTMLCanvasElement,
    loaded: vi.fn(() => true),
    on: vi.fn((_event: 'render', listener: () => void) => listeners.add(listener)),
    off: vi.fn((_event: 'render', listener: () => void) => listeners.delete(listener)),
    triggerRepaint: vi.fn(),
  }
  const render = () => [...listeners].forEach(listener => listener())
  const controller = new AbortController()
  return { map, canvas, render, controller, listeners }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('reads the real canvas only inside a loaded render callback', async () => {
  const { map, canvas, render, controller, listeners } = setup()
  const result = captureMapSnapshot(map, controller.signal)
  expect(canvas.toDataURL).not.toHaveBeenCalled()
  expect(map.triggerRepaint).toHaveBeenCalledOnce()
  map.loaded.mockReturnValue(false)
  render()
  expect(canvas.toDataURL).not.toHaveBeenCalled()
  map.loaded.mockReturnValue(true)
  render()
  expect(await result).toEqual({ image: 'data:image/webp;base64,bWFw', left: 0, top: 12, width: 390, height: 844 })
  expect(listeners.size).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
})

test('cleans up render and abort listeners when capture is cancelled', async () => {
  const { map, controller, listeners, canvas, render } = setup()
  const result = captureMapSnapshot(map, controller.signal)
  controller.abort()
  expect(await result).toBeNull()
  render()
  expect(canvas.toDataURL).not.toHaveBeenCalled()
  expect(listeners.size).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
})

test('times out without a rendered frame', async () => {
  const { map, controller, listeners } = setup()
  const result = captureMapSnapshot(map, controller.signal)
  await vi.advanceTimersByTimeAsync(2500)
  expect(await result).toBeNull()
  expect(listeners.size).toBe(0)
})

test('falls back safely when canvas export is unavailable', async () => {
  const { map, canvas, render, controller, listeners } = setup()
  canvas.toDataURL.mockImplementation(() => { throw new Error('Context lost') })
  const result = captureMapSnapshot(map, controller.signal)
  render()
  expect(await result).toBeNull()
  expect(listeners.size).toBe(0)
})

test('ignores an already aborted capture', async () => {
  const { map, controller } = setup()
  controller.abort()
  expect(await captureMapSnapshot(map, controller.signal)).toBeNull()
  expect(map.on).not.toHaveBeenCalled()
})
