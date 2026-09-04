import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useShakeGesture } from './useShakeGesture'

/** Fire a motion event with the given acceleration, at a controlled clock. */
function motion(x: number, y: number, z: number) {
  const event = new Event('devicemotion') as DeviceMotionEvent
  Object.defineProperty(event, 'accelerationIncludingGravity', {
    value: { x, y, z },
  })
  window.dispatchEvent(event)
}

/** Jolt hard enough to clear the threshold, alternating so each sample moves. */
function jolt(n: number, gap = 150) {
  for (let i = 0; i < n; i++) {
    vi.advanceTimersByTime(gap)
    motion(i % 2 === 0 ? 30 : -30, 0, 0)
  }
}

describe('useShakeGesture', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires once the jolts pass the threshold', () => {
    const onShake = vi.fn()
    const shake = useShakeGesture(onShake)
    shake.start()

    jolt(5)

    expect(onShake).toHaveBeenCalledTimes(1)
    shake.stop()
  })

  it('ignores a single knock', () => {
    const onShake = vi.fn()
    const shake = useShakeGesture(onShake)
    shake.start()

    vi.advanceTimersByTime(150)
    motion(0, 0, 0)
    vi.advanceTimersByTime(150)
    motion(30, 0, 0)

    expect(onShake).not.toHaveBeenCalled()
    shake.stop()
  })

  it('ignores gentle movement however long it goes on', () => {
    const onShake = vi.fn()
    const shake = useShakeGesture(onShake)
    shake.start()

    for (let i = 0; i < 40; i++) {
      vi.advanceTimersByTime(150)
      motion(i % 2 === 0 ? 2 : -2, 0, 0)
    }

    expect(onShake).not.toHaveBeenCalled()
    shake.stop()
  })

  it('does not fire twice for one long shake', () => {
    const onShake = vi.fn()
    const shake = useShakeGesture(onShake)
    shake.start()

    jolt(12)

    expect(onShake).toHaveBeenCalledTimes(1)
    shake.stop()
  })

  it('fires again after the cooldown passes', () => {
    const onShake = vi.fn()
    const shake = useShakeGesture(onShake)
    shake.start()

    jolt(5)
    vi.advanceTimersByTime(3000)
    jolt(5)

    expect(onShake).toHaveBeenCalledTimes(2)
    shake.stop()
  })

  it('stops listening once stopped', () => {
    const onShake = vi.fn()
    const shake = useShakeGesture(onShake)
    shake.start()
    shake.stop()

    jolt(6)

    expect(onShake).not.toHaveBeenCalled()
  })
})
