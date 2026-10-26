import { afterEach, describe, expect, test, vi } from 'vitest'
import { trackHeldPointers, type HeldPointers } from './held-pointers'

const press = (target: Element, type: string, pointerId: number) =>
  target.dispatchEvent(new PointerEvent(type, { pointerId, bubbles: true }))

describe('trackHeldPointers', () => {
  let tracker: HeldPointers
  afterEach(() => tracker.dispose())

  test('counts presses inside the element until the last one lifts', () => {
    const map = document.body.appendChild(document.createElement('div'))
    const outside = document.body.appendChild(document.createElement('div'))
    const released = vi.fn()
    tracker = trackHeldPointers(() => map, released)

    press(outside, 'pointerdown', 1)
    expect(tracker.count).toBe(0)
    press(map, 'pointerdown', 2)
    press(map, 'pointerdown', 3)
    expect(tracker.count).toBe(2)
    press(map, 'pointerup', 2)
    expect(released).not.toHaveBeenCalled()
    press(outside, 'pointercancel', 3)
    expect(tracker.count).toBe(0)
    expect(released).toHaveBeenCalledOnce()
  })
})
