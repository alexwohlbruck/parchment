import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { frameTask } from './frame-task'

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16))
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now += 5)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('spreads work over frames and coalesces changes into one trailing pass', () => {
  const steps: number[] = []
  const create = vi.fn(function* () { for (let i = 0; i < 3; i++) { steps.push(i); yield } })
  const task = frameTask(create)
  task.request()
  vi.advanceTimersByTime(16)
  expect(steps).toEqual([0])
  task.request()
  task.request()
  vi.advanceTimersByTime(16)
  expect(steps).toEqual([0, 1])
  vi.advanceTimersByTime(160)
  expect(create).toHaveBeenCalledTimes(2)
  expect(steps).toEqual([0, 1, 2, 0, 1, 2])
  expect(vi.getTimerCount()).toBe(0)
})

it('cancels unfinished work and can start a fresh pass', () => {
  const closed = vi.fn()
  const task = frameTask(function* () { try { yield; yield } finally { closed() } })
  task.request()
  vi.advanceTimersByTime(16)
  task.cancel()
  expect(closed).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
  task.request()
  vi.advanceTimersByTime(100)
  expect(closed).toHaveBeenCalledTimes(2)
})

it('keeps one pending frame when work requests another pass synchronously', () => {
  let requests = 0
  const task = frameTask(function* () { if (++requests === 1) task.request(); yield })
  task.request()
  vi.advanceTimersByTime(16)
  expect(vi.getTimerCount()).toBe(1)
  vi.advanceTimersByTime(100)
  expect(requests).toBe(2)
  expect(vi.getTimerCount()).toBe(0)
})
