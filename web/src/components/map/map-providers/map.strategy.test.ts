import { describe, expect, it, vi } from 'vitest'
import { MapStrategy } from './map.strategy'

class TestMapStrategy extends MapStrategy {
  setup(map: unknown) {
    this.mapInstance = map
    this.setupPoiClickHandling()
  }

  teardown() {
    this.destroyPoiClickHandling()
  }
}

function setup() {
  const element = document.createElement('div')
  const listeners = new Map<string, (event: unknown) => void>()
  let enabled = true
  const doubleClickZoom = {
    disable: vi.fn(() => {
      enabled = false
    }),
    enable: vi.fn(() => {
      enabled = true
    }),
    isEnabled: vi.fn(() => enabled),
  }
  const map = {
    doubleClickZoom,
    getCanvasContainer: () => element,
    on: vi.fn((name: string, listener: (event: unknown) => void) => {
      listeners.set(name, listener)
    }),
    off: vi.fn((name: string, listener: (event: unknown) => void) => {
      if (listeners.get(name) === listener) listeners.delete(name)
    }),
  }
  const strategy = new TestMapStrategy(element, {} as never)
  strategy.setup(map)

  return { doubleClickZoom, listeners, map, strategy }
}

describe('MapStrategy touch zoom handling', () => {
  it('resets double-tap zoom when one-finger drag zoom starts', () => {
    const { doubleClickZoom, listeners, strategy } = setup()

    listeners.get('zoomstart')?.({
      originalEvent: { type: 'touchmove', touches: { length: 1 } },
    })

    expect(doubleClickZoom.disable).toHaveBeenCalledOnce()
    expect(doubleClickZoom.enable).toHaveBeenCalledOnce()
    strategy.teardown()
  })

  it('preserves ordinary double-tap and multi-touch zoom', () => {
    const { doubleClickZoom, listeners, strategy } = setup()
    const zoomStart = listeners.get('zoomstart')

    zoomStart?.({
      originalEvent: { type: 'touchend', touches: { length: 0 } },
    })
    zoomStart?.({
      originalEvent: { type: 'touchmove', touches: { length: 2 } },
    })

    expect(doubleClickZoom.disable).not.toHaveBeenCalled()
    expect(doubleClickZoom.enable).not.toHaveBeenCalled()
    strategy.teardown()
  })

  it('does not enable double-tap zoom when it was disabled', () => {
    const { doubleClickZoom, listeners, strategy } = setup()
    doubleClickZoom.disable()
    doubleClickZoom.disable.mockClear()

    listeners.get('zoomstart')?.({
      originalEvent: { type: 'touchmove', touches: { length: 1 } },
    })

    expect(doubleClickZoom.disable).not.toHaveBeenCalled()
    expect(doubleClickZoom.enable).not.toHaveBeenCalled()
    strategy.teardown()
  })

  it('detaches the zoom listener during teardown', () => {
    const { listeners, map, strategy } = setup()

    strategy.teardown()

    expect(map.off).toHaveBeenCalledWith('zoomstart', expect.any(Function))
    expect(listeners.has('zoomstart')).toBe(false)
  })
})
