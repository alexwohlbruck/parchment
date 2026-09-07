import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createAnimationHold } from './animation-hold'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createAnimationHold', () => {
  it('runs the work immediately when nothing is holding', () => {
    const run = vi.fn()
    const hold = createAnimationHold(run)
    expect(hold.active).toBe(false)
  })

  // The bug this exists for: a drawer slide republishes its bounds every
  // frame, and each frame applied padding — a jumpTo — killing the in-flight
  // fit. The frames must collapse into one application, after the ease.
  it('collapses every update during a hold into one, after it ends', () => {
    const run = vi.fn()
    const hold = createAnimationHold(run)

    hold.begin(800)
    for (let frame = 0; frame < 20; frame++) {
      expect(hold.active).toBe(true)
      hold.defer()
    }
    expect(run).not.toHaveBeenCalled()

    hold.end()
    expect(run).toHaveBeenCalledTimes(1)
    expect(hold.active).toBe(false)
  })

  it('ends itself when the duration lapses without a moveend', () => {
    const run = vi.fn()
    const hold = createAnimationHold(run)

    hold.begin(800)
    hold.defer()
    vi.advanceTimersByTime(799)
    expect(run).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(1)
    expect(hold.active).toBe(false)
  })

  // Every ordinary moveend ends the hold too, so an untouched one must not
  // fire work nobody asked for.
  it('ends silently when nothing was deferred', () => {
    const run = vi.fn()
    const hold = createAnimationHold(run)

    hold.begin(800)
    hold.end()
    expect(run).not.toHaveBeenCalled()
  })

  it('restarts the window when a re-fit begins mid-hold', () => {
    const run = vi.fn()
    const hold = createAnimationHold(run)

    hold.begin(800)
    hold.defer()
    vi.advanceTimersByTime(600)
    hold.begin(800) // the settled re-fit
    vi.advanceTimersByTime(600)
    expect(run).not.toHaveBeenCalled()

    vi.advanceTimersByTime(200)
    expect(run).toHaveBeenCalledTimes(1)
  })

  // Starting an ease over a running one makes the engine stop the old one and
  // fire `moveend` synchronously. Acting on that event would apply padding
  // into the animation that just started — the original bug, one layer down.
  it('ignores the moveend that starting a new animation provokes', () => {
    const run = vi.fn()
    const hold = createAnimationHold(run)

    hold.begin(800)
    hold.defer()

    // The engine stops the previous ease from inside the new fit call.
    hold.begin(800, () => hold.end())

    expect(run).not.toHaveBeenCalled()
    expect(hold.active).toBe(true)

    vi.advanceTimersByTime(800)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('still starts the animation when there is no duration to hold', () => {
    const run = vi.fn()
    const hold = createAnimationHold(run)
    const start = vi.fn()

    hold.begin(0, start)
    expect(start).toHaveBeenCalledTimes(1)
    expect(hold.active).toBe(false)
  })

  it('treats a zero duration as no animation to protect', () => {
    const run = vi.fn()
    const hold = createAnimationHold(run)

    hold.begin(0)
    expect(hold.active).toBe(false)
  })
})
