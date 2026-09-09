/**
 * Tests for the federation canonical message builder.
 */

import { describe, test, expect } from 'bun:test'
import {
  buildClientSignableV2,
  buildServerSignableWrapper,
  hashBody,
  generateNonce,
  isTimestampFresh,
  buildLegacySignableV1,
} from './federation-canonical'

describe('buildClientSignableV2', () => {
  test('produces deterministic output regardless of payload key order', () => {
    const base = {
      protocol_version: 2,
      message_type: 'FRIEND_INVITE',
      message_version: 1,
      from: 'alice@a.com',
      to: 'bob@b.com',
      nonce: 'nonceA',
      timestamp: '2026-04-20T00:00:00Z',
    }
    const a = buildClientSignableV2({
      ...base,
      payload: { foo: 'x', bar: 'y' },
    })
    const b = buildClientSignableV2({
      ...base,
      payload: { bar: 'y', foo: 'x' },
    })
    expect(a).toBe(b)
  })

  test('differs when any covered field changes', () => {
    const base = {
      protocol_version: 2,
      message_type: 'FRIEND_INVITE',
      message_version: 1,
      from: 'alice@a.com',
      to: 'bob@b.com',
      nonce: 'n1',
      timestamp: '2026-04-20T00:00:00Z',
      payload: {},
    }
    const original = buildClientSignableV2(base)
    expect(buildClientSignableV2({ ...base, nonce: 'n2' })).not.toBe(original)
    expect(buildClientSignableV2({ ...base, timestamp: 'x' })).not.toBe(original)
    expect(buildClientSignableV2({ ...base, protocol_version: 3 })).not.toBe(
      original,
    )
    expect(buildClientSignableV2({ ...base, message_version: 2 })).not.toBe(
      original,
    )
  })
})

describe('buildServerSignableWrapper', () => {
  test('normalizes method to uppercase', () => {
    const a = buildServerSignableWrapper({
      method: 'post',
      path: '/federation/inbox',
      body_hash: 'hash',
      nonce: 'n',
      timestamp: 't',
      peer_server_id: 'peer',
      sender_server_id: 'sender',
      protocol_version: 2,
    })
    const b = buildServerSignableWrapper({
      method: 'POST',
      path: '/federation/inbox',
      body_hash: 'hash',
      nonce: 'n',
      timestamp: 't',
      peer_server_id: 'peer',
      sender_server_id: 'sender',
      protocol_version: 2,
    })
    expect(a).toBe(b)
  })
})

describe('hashBody', () => {
  test('returns base64 sha256 with deterministic output', () => {
    expect(hashBody('hello')).toBe(hashBody('hello'))
    expect(hashBody('hello')).not.toBe(hashBody('world'))
    expect(typeof hashBody('hello')).toBe('string')
  })
})

describe('generateNonce', () => {
  test('produces unique 16-byte nonces', () => {
    const a = generateNonce()
    const b = generateNonce()
    expect(a).not.toBe(b)
    // base64 of 16 bytes is 24 chars including padding
    expect(a.length).toBeGreaterThan(20)
  })
})

describe('isTimestampFresh', () => {
  test('accepts a timestamp within skew', () => {
    expect(isTimestampFresh(new Date().toISOString(), 300)).toBe(true)
  })

  test('rejects a timestamp far in the past', () => {
    const stale = new Date(Date.now() - 10 * 60_000).toISOString()
    expect(isTimestampFresh(stale, 300)).toBe(false)
  })

  test('rejects a timestamp far in the future', () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString()
    expect(isTimestampFresh(future, 300)).toBe(false)
  })

  test('rejects unparseable strings', () => {
    expect(isTimestampFresh('not-a-date', 300)).toBe(false)
  })
})

describe('buildLegacySignableV1', () => {
  test('still produces the same shape v1 clients expect', () => {
    const out = buildLegacySignableV1('FRIEND_INVITE', {
      from: 'a@b.com',
      to: 'c@d.com',
    })
    const parsed = JSON.parse(out)
    expect(parsed.type).toBe('FRIEND_INVITE')
    expect(parsed.from).toBe('a@b.com')
  })

  test('emits type first, then payload keys in sorted order', () => {
    // Byte-exact check: this is what the original client & server produced.
    // Any regression here silently breaks every v1 signature, so the string
    // comparison is intentional.
    const out = buildLegacySignableV1('FRIEND_INVITE', {
      to: 'c@d.com',
      from: 'a@b.com',
      timestamp: '2026-04-20T00:00:00Z',
    })
    expect(out).toBe(
      '{"type":"FRIEND_INVITE","from":"a@b.com","timestamp":"2026-04-20T00:00:00Z","to":"c@d.com"}',
    )
  })
})
