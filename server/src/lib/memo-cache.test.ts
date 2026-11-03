import { describe, test, expect, setSystemTime, afterEach } from 'bun:test'
import { MemoCache } from './memo-cache'

describe('MemoCache', () => {
  afterEach(() => setSystemTime())

  test('shares one load between concurrent and repeat lookups', async () => {
    const cache = new MemoCache<number>({ max: 10 })
    let loads = 0
    const load = async () => ++loads
    const [a, b] = await Promise.all([cache.get('k', load), cache.get('k', load)])
    expect([a, b, await cache.get('k', load)]).toEqual([1, 1, 1])
    expect(loads).toBe(1)
  })

  test('evicts the oldest entry past its size', async () => {
    const cache = new MemoCache<string>({ max: 2 })
    let loads = 0
    const load = (v: string) => async () => { loads++; return v }
    await cache.get('a', load('a'))
    await cache.get('b', load('b'))
    await cache.get('c', load('c'))
    await cache.get('b', load('b'))
    expect(loads).toBe(3)
    await cache.get('a', load('a'))
    expect(loads).toBe(4)
  })

  test('reloads an entry once it outlives the TTL', async () => {
    const cache = new MemoCache<number>({ max: 10, ttlMs: 1000 })
    let loads = 0
    const load = async () => ++loads
    setSystemTime(new Date('2026-01-01T00:00:00Z'))
    await cache.get('k', load)
    setSystemTime(new Date('2026-01-01T00:00:00.999Z'))
    expect(await cache.get('k', load)).toBe(1)
    setSystemTime(new Date('2026-01-01T00:00:01Z'))
    expect(await cache.get('k', load)).toBe(2)
  })

  test('forgets values it was told not to keep', async () => {
    const cache = new MemoCache<number | null>({ max: 10, keep: (v) => v != null })
    let loads = 0
    const load = async () => (++loads === 1 ? null : loads)
    expect(await cache.get('k', load)).toBeNull()
    expect(await cache.get('k', load)).toBe(2)
    expect(await cache.get('k', load)).toBe(2)
  })

  test('forgets a rejected load and passes the rejection on', async () => {
    const cache = new MemoCache<number>({ max: 10 })
    let loads = 0
    const load = async () => {
      if (++loads === 1) throw new Error('down')
      return loads
    }
    await expect(cache.get('k', load)).rejects.toThrow('down')
    expect(await cache.get('k', load)).toBe(2)
  })

  test('turns a load that throws synchronously into a rejection', async () => {
    const cache = new MemoCache<number>({ max: 10 })
    const load = (): Promise<number> => { throw new Error('sync') }
    await expect(cache.get('k', load)).rejects.toThrow('sync')
  })
})
