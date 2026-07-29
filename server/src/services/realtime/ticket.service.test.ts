/**
 * Unit tests for WebSocket upgrade tickets.
 *
 * One-time-use is the whole security property: a ticket rides in a query
 * string (browsers can't set headers on a WS handshake), so it can leak into
 * logs, proxies and referrers. Redeeming must therefore consume it, and the
 * 30-second TTL must be enforced on read rather than only by the sweeper.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  mintTicket,
  redeemTicket,
  _resetForTests,
} from './ticket.service'

beforeEach(() => {
  _resetForTests()
})

afterEach(() => {
  _resetForTests()
})

describe('mintTicket', () => {
  test('returns a ticket bound to the user with an expiry', () => {
    const { ticket, expiresAt } = mintTicket('user-1')

    expect(typeof ticket).toBe('string')
    expect(expiresAt).toBeGreaterThan(Date.now())
  })

  test('expires 30 seconds out', () => {
    const { expiresAt } = mintTicket('user-1')

    const ttl = expiresAt - Date.now()
    expect(ttl).toBeGreaterThan(25_000)
    expect(ttl).toBeLessThanOrEqual(30_000)
  })

  test('issues a distinct ticket every time', () => {
    const seen = new Set(
      Array.from({ length: 50 }, () => mintTicket('user-1').ticket),
    )

    expect(seen.size).toBe(50)
  })

  test('produces a URL-safe token — it travels as a query param', () => {
    const { ticket } = mintTicket('user-1')

    expect(ticket).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(encodeURIComponent(ticket)).toBe(ticket)
  })

  test('carries enough entropy to be unguessable (32 bytes base64url)', () => {
    const { ticket } = mintTicket('user-1')

    // 32 bytes → 43 base64url characters, unpadded.
    expect(ticket).toHaveLength(43)
  })
})

describe('redeemTicket', () => {
  test('resolves a fresh ticket to its user', () => {
    const { ticket } = mintTicket('user-1')

    expect(redeemTicket(ticket)).toBe('user-1')
  })

  test('is single-use — a second redemption fails', () => {
    const { ticket } = mintTicket('user-1')

    expect(redeemTicket(ticket)).toBe('user-1')
    expect(redeemTicket(ticket)).toBeNull()
  })

  test('returns null for a ticket that was never issued', () => {
    expect(redeemTicket('made-up-ticket')).toBeNull()
  })

  test('returns null for an empty token', () => {
    expect(redeemTicket('')).toBeNull()
  })

  test('keeps tickets separate per user', () => {
    const a = mintTicket('user-a')
    const b = mintTicket('user-b')

    expect(redeemTicket(b.ticket)).toBe('user-b')
    expect(redeemTicket(a.ticket)).toBe('user-a')
  })

  test('redeeming one ticket does not invalidate another', () => {
    const first = mintTicket('user-1')
    const second = mintTicket('user-1')

    redeemTicket(first.ticket)

    expect(redeemTicket(second.ticket)).toBe('user-1')
  })
})

describe('expiry', () => {
  test('an expired ticket does not resolve', () => {
    const realNow = Date.now
    const { ticket } = mintTicket('user-1')

    try {
      Date.now = () => realNow() + 31_000
      expect(redeemTicket(ticket)).toBeNull()
    } finally {
      Date.now = realNow
    }
  })

  test('a ticket still inside the window resolves', () => {
    const realNow = Date.now
    const { ticket } = mintTicket('user-1')

    try {
      Date.now = () => realNow() + 29_000
      expect(redeemTicket(ticket)).toBe('user-1')
    } finally {
      Date.now = realNow
    }
  })

  test('minting sweeps expired entries so the map stays bounded', () => {
    const realNow = Date.now
    const stale = mintTicket('user-old')

    try {
      Date.now = () => realNow() + 31_000
      // The sweep runs on mint; the stale entry should be gone afterwards.
      mintTicket('user-new')
      Date.now = realNow
      expect(redeemTicket(stale.ticket)).toBeNull()
    } finally {
      Date.now = realNow
    }
  })

  test('an expired ticket is consumed even though it resolves to null', () => {
    const realNow = Date.now
    const { ticket } = mintTicket('user-1')

    try {
      Date.now = () => realNow() + 31_000
      expect(redeemTicket(ticket)).toBeNull()
      Date.now = realNow
      // Time travelling back must not resurrect it.
      expect(redeemTicket(ticket)).toBeNull()
    } finally {
      Date.now = realNow
    }
  })
})
