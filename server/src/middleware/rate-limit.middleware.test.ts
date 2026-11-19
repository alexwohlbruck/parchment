import { describe, test, expect } from 'bun:test'
import { RateLimiter, clientIp } from './rate-limit.middleware'

describe('RateLimiter', () => {
  test('allows up to the limit, then reports seconds until the window resets', () => {
    const limiter = new RateLimiter(2, 60_000)
    expect(limiter.hit('a', 0)).toBe(0)
    expect(limiter.hit('a', 1_000)).toBe(0)
    expect(limiter.hit('a', 30_000)).toBe(30)
  })

  test('opens a fresh window once the old one ends', () => {
    const limiter = new RateLimiter(1, 60_000)
    limiter.hit('a', 0)
    expect(limiter.hit('a', 59_999)).toBe(1)
    expect(limiter.hit('a', 60_000)).toBe(0)
  })

  test('keys have independent budgets', () => {
    const limiter = new RateLimiter(1, 60_000)
    limiter.hit('a', 0)
    expect(limiter.hit('b', 0)).toBe(0)
  })

  test('drops expired buckets so one-off keys do not accumulate', () => {
    const limiter = new RateLimiter(1, 60_000)
    for (let i = 0; i < 100; i++) limiter.hit(`ip-${i}`, 0)
    limiter.hit('later', 120_000)
    expect(limiter.size).toBe(1)
  })
})

describe('clientIp', () => {
  const withForwarded = (value: string) =>
    new Request('http://x/', { headers: { 'x-forwarded-for': value } })

  test('takes the address the trusted proxy appended, not one the client sent', () => {
    expect(clientIp(withForwarded('6.6.6.6, 1.2.3.4'), '10.0.0.1', 1)).toBe('1.2.3.4')
  })

  test('counts back one entry per trusted proxy', () => {
    expect(clientIp(withForwarded('6.6.6.6, 1.2.3.4, 10.0.0.2'), '10.0.0.1', 2)).toBe(
      '1.2.3.4',
    )
  })

  test('ignores the header entirely with no trusted proxy', () => {
    expect(clientIp(withForwarded('6.6.6.6'), '1.2.3.4', 0)).toBe('1.2.3.4')
  })

  test('falls back to the socket address without the header', () => {
    expect(clientIp(new Request('http://x/'), '1.2.3.4', 1)).toBe('1.2.3.4')
  })
})
