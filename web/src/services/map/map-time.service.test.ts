import { afterEach, describe, expect, it, vi } from 'vitest'
import { isMapTimeLive, mapTime, onMapTimeChange, setMapTime } from './map-time.service'

afterEach(() => {
  setMapTime(null)
  vi.useRealTimers()
})

describe('map time source', () => {
  it('follows the clock until a time is chosen', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-25T12:00:00Z'))
    expect(isMapTimeLive()).toBe(true)
    expect(mapTime().toISOString()).toBe('2026-11-25T12:00:00.000Z')
  })

  it('holds a chosen time and hands out copies of it', () => {
    setMapTime(new Date('2026-06-21T03:00:00Z'))
    const time = mapTime()
    time.setFullYear(2000)
    expect(isMapTimeLive()).toBe(false)
    expect(mapTime().toISOString()).toBe('2026-06-21T03:00:00.000Z')
  })

  it('notifies listeners once per change and stops after unsubscribing', () => {
    const listener = vi.fn()
    const off = onMapTimeChange(listener)
    setMapTime(new Date('2026-06-21T03:00:00Z'))
    setMapTime(new Date('2026-06-21T03:00:00Z'))
    setMapTime(null)
    off()
    setMapTime(new Date('2026-06-22T03:00:00Z'))
    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenLastCalledWith(null)
  })

  it('treats an invalid date as live', () => {
    setMapTime(new Date('nope'))
    expect(isMapTimeLive()).toBe(true)
  })
})
