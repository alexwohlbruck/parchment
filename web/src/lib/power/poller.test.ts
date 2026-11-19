import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPoller } from './poller'

describe('createPoller', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('runs at once, then on each interval until stopped', () => {
    const task = vi.fn()
    const poller = createPoller(task, () => 1000)
    poller.start()
    expect(task).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(3000)
    expect(task).toHaveBeenCalledTimes(4)
    poller.stop()
    vi.advanceTimersByTime(3000)
    expect(task).toHaveBeenCalledTimes(4)
  })

  it('picks up a new interval on retime without an extra run', () => {
    const task = vi.fn()
    let ms = 1000
    const poller = createPoller(task, () => ms)
    poller.start()
    ms = 5000
    poller.retime()
    vi.advanceTimersByTime(4000)
    expect(task).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(task).toHaveBeenCalledTimes(2)
  })

  it('stays stopped on retime', () => {
    const task = vi.fn()
    const poller = createPoller(task, () => 1000)
    poller.retime()
    vi.advanceTimersByTime(3000)
    expect(task).not.toHaveBeenCalled()
  })
})
