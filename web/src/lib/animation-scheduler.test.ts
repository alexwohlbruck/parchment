import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { _resetForTests, register, requestTick } from './animation-scheduler'

/**
 * Drive the loop deterministically: jsdom doesn't ship a real
 * `requestAnimationFrame`, but vitest does — wrap it so we can step
 * frames by advancing fake timers.
 */
function flushFrames(count: number) {
  for (let i = 0; i < count; i++) {
    vi.advanceTimersByTime(16)
  }
}

beforeEach(() => {
  // jsdom shim: rAF backed by setTimeout; we advance timers below.
  // Stub globals BEFORE the reset, since reset may call cancelAnimationFrame.
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 16) as unknown as number,
  )
  vi.stubGlobal('cancelAnimationFrame', (id: number) =>
    clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
  )
  _resetForTests()
})

afterEach(() => {
  // Reset BEFORE unstubbing globals so cancelAnimationFrame still
  // matches the requestAnimationFrame that was used to schedule.
  _resetForTests()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('animation-scheduler', () => {
  test('register starts the loop and ticks fire each frame', () => {
    const tick = vi.fn(() => 'active' as const)
    register(tick)
    flushFrames(3)
    // Each register() schedules at least one frame; subsequent
    // 'active' returns keep the loop alive.
    expect(tick.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  test('loop pauses after a sustained idle window', () => {
    const tick = vi.fn(() => 'idle' as const)
    register(tick)
    // Sleep threshold is 30 idle frames — push well past it.
    flushFrames(60)
    const callsAfterSleep = tick.mock.calls.length

    // Advance more time without a wake — no further calls expected.
    flushFrames(30)
    expect(tick.mock.calls.length).toBe(callsAfterSleep)
  })

  test('requestTick resumes a paused loop', () => {
    const tick = vi.fn(() => 'idle' as const)
    register(tick)
    flushFrames(60) // run to sleep
    const callsBefore = tick.mock.calls.length

    requestTick()
    flushFrames(2)
    expect(tick.mock.calls.length).toBeGreaterThan(callsBefore)
  })

  test('a tick returning active resets the idle counter', () => {
    let activeFrames = 0
    const tick = vi.fn(() => {
      activeFrames++
      return activeFrames < 5 ? ('active' as const) : ('idle' as const)
    })
    register(tick)
    // 5 active frames + 30 idle frames = ~35 calls before sleep. Verify
    // the loop did NOT pause during the active stretch.
    flushFrames(40)
    expect(tick.mock.calls.length).toBeGreaterThan(30)
  })

  test('multiple ticks share one loop', () => {
    const a = vi.fn(() => 'active' as const)
    const b = vi.fn(() => 'active' as const)
    register(a)
    register(b)
    flushFrames(3)
    // Both run on the same frame; counts match.
    expect(a.mock.calls.length).toBe(b.mock.calls.length)
    expect(a.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  test('throwing tick does not abort the loop', () => {
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bad = vi.fn(() => {
      throw new Error('boom')
    })
    const good = vi.fn(() => 'active' as const)
    register(bad)
    register(good)
    flushFrames(3)
    expect(good.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(consoleErr).toHaveBeenCalled()
    consoleErr.mockRestore()
  })

  test('unregister returned by register stops calls', () => {
    const tick = vi.fn(() => 'active' as const)
    const off = register(tick)
    flushFrames(2)
    const before = tick.mock.calls.length
    off()
    flushFrames(5)
    expect(tick.mock.calls.length).toBe(before)
  })
})
