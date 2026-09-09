/**
 * Simulator store — playback state machine. Pure JS, no Vue, no DOM.
 * The store is a singleton module so tests reset it between cases via
 * `unload()` (which returns it to the cleanest reachable state).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { GpxPoint } from './gpx-parser'
import { simulatorStore } from './simulator-store'

function makePoints(): GpxPoint[] {
  // Three evenly-spaced 1-second samples, ~1km east at the equator.
  return [
    { lat: 0, lng: 0, time: 1000, altitude: null, speed: 1, heading: 90 },
    { lat: 0, lng: 0.001, time: 2000, altitude: null, speed: 1, heading: 90 },
    { lat: 0, lng: 0.002, time: 3000, altitude: null, speed: 0, heading: null },
  ]
}

beforeEach(() => {
  // Stub rAF -> setTimeout(16ms) so the playback ticker advances under
  // fake timers. This file's tests don't actually need rAF to fire,
  // but the store calls requestAnimationFrame at module-load time the
  // first time `load()` is called, and it must not throw.
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 16) as unknown as number,
  )
  vi.stubGlobal('cancelAnimationFrame', (id: number) =>
    clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
  )
  simulatorStore.unload()
})

afterEach(() => {
  // Drop registrations + timers BEFORE restoring globals.
  simulatorStore.unload()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('simulatorStore — initial / unload state', () => {
  test('starts stopped with no points', () => {
    const s = simulatorStore.getState()
    expect(s.status).toBe('stopped')
    expect(s.points).toEqual([])
    expect(s.fileName).toBeNull()
    expect(s.totalDurationMs).toBe(0)
    expect(s.currentPoint).toBeNull()
  })

  test('preserves user prefs across unload', () => {
    simulatorStore.setRate(4)
    simulatorStore.setLoop(false)
    simulatorStore.unload()
    const s = simulatorStore.getState()
    expect(s.playbackRate).toBe(4)
    expect(s.loop).toBe(false)
  })
})

describe('simulatorStore — load', () => {
  test('moves to paused with the track loaded', () => {
    simulatorStore.load('test.gpx', makePoints())
    const s = simulatorStore.getState()
    expect(s.status).toBe('paused')
    expect(s.fileName).toBe('test.gpx')
    expect(s.points).toHaveLength(3)
    expect(s.totalDurationMs).toBe(2000) // 3000 - 1000
    expect(s.trackTimeMs).toBe(0)
    expect(s.currentPoint).toBe(s.points[0])
  })

  test('ignores empty point arrays', () => {
    simulatorStore.load('empty.gpx', [])
    const s = simulatorStore.getState()
    expect(s.status).toBe('stopped') // unchanged
    expect(s.fileName).toBeNull()
  })
})

describe('simulatorStore — play / pause / stop', () => {
  test('play moves status to playing', () => {
    simulatorStore.load('t.gpx', makePoints())
    simulatorStore.play()
    expect(simulatorStore.getState().status).toBe('playing')
  })

  test('play is a no-op when no track loaded', () => {
    simulatorStore.play()
    expect(simulatorStore.getState().status).toBe('stopped')
  })

  test('pause moves playing → paused', () => {
    simulatorStore.load('t.gpx', makePoints())
    simulatorStore.play()
    simulatorStore.pause()
    expect(simulatorStore.getState().status).toBe('paused')
  })

  test('pause is a no-op when not playing', () => {
    simulatorStore.load('t.gpx', makePoints())
    expect(simulatorStore.getState().status).toBe('paused')
    simulatorStore.pause()
    expect(simulatorStore.getState().status).toBe('paused')
  })

  test('stop returns to stopped + zero playhead while keeping track', () => {
    simulatorStore.load('t.gpx', makePoints())
    simulatorStore.seek(1500)
    simulatorStore.stop()
    const s = simulatorStore.getState()
    expect(s.status).toBe('stopped')
    expect(s.trackTimeMs).toBe(0)
    expect(s.points).toHaveLength(3) // track still loaded
  })

  test('play after reaching the end restarts from zero', () => {
    simulatorStore.load('t.gpx', makePoints())
    simulatorStore.seek(2000) // end
    simulatorStore.play()
    expect(simulatorStore.getState().trackTimeMs).toBe(0)
    expect(simulatorStore.getState().status).toBe('playing')
  })
})

describe('simulatorStore — seek', () => {
  beforeEach(() => {
    simulatorStore.load('t.gpx', makePoints())
  })

  test('seeks to the requested position and updates currentPoint', () => {
    simulatorStore.seek(1500)
    const s = simulatorStore.getState()
    expect(s.trackTimeMs).toBe(1500)
    expect(s.currentPoint).toBe(s.points[1]) // halfway between t=1000 and t=2000
  })

  test('clamps below zero', () => {
    simulatorStore.seek(-100)
    expect(simulatorStore.getState().trackTimeMs).toBe(0)
  })

  test('clamps to total duration', () => {
    simulatorStore.seek(99_999)
    expect(simulatorStore.getState().trackTimeMs).toBe(2000)
  })
})

describe('simulatorStore — rate + loop', () => {
  test('setRate clamps to [0.1, 64]', () => {
    simulatorStore.setRate(0.0001)
    expect(simulatorStore.getState().playbackRate).toBe(0.1)
    simulatorStore.setRate(1000)
    expect(simulatorStore.getState().playbackRate).toBe(64)
    simulatorStore.setRate(2.5)
    expect(simulatorStore.getState().playbackRate).toBe(2.5)
  })

  test('setLoop toggles', () => {
    simulatorStore.setLoop(false)
    expect(simulatorStore.getState().loop).toBe(false)
    simulatorStore.setLoop(true)
    expect(simulatorStore.getState().loop).toBe(true)
  })
})

describe('simulatorStore — subscribe', () => {
  test('fires once immediately on subscribe', () => {
    const fn = vi.fn()
    const off = simulatorStore.subscribe(fn)
    expect(fn).toHaveBeenCalledTimes(1)
    off()
  })

  test('fires on state changes', () => {
    const fn = vi.fn()
    const off = simulatorStore.subscribe(fn)
    fn.mockClear()
    simulatorStore.load('t.gpx', makePoints())
    simulatorStore.play()
    simulatorStore.pause()
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(3)
    off()
  })

  test('unsubscribe stops further calls', () => {
    const fn = vi.fn()
    const off = simulatorStore.subscribe(fn)
    fn.mockClear()
    off()
    simulatorStore.load('t.gpx', makePoints())
    expect(fn).not.toHaveBeenCalled()
  })

  test('subscriber failure does not break other subscribers', () => {
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bad = vi.fn(() => {
      throw new Error('boom')
    })
    const good = vi.fn()
    simulatorStore.subscribe(bad)
    simulatorStore.subscribe(good)
    bad.mockClear()
    good.mockClear()
    simulatorStore.load('t.gpx', makePoints())
    expect(good).toHaveBeenCalled()
    expect(consoleErr).toHaveBeenCalled()
    consoleErr.mockRestore()
  })
})
