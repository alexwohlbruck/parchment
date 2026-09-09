/**
 * Unit tests for server-to-server federation auth.
 *
 * Three properties are load-bearing:
 *
 *   1. TOFU pinning — a peer's identity key is pinned on first contact and a
 *      CHANGED key is rejected outright rather than silently rotated. Silent
 *      rotation would let anyone who can answer for the domain take over the
 *      peer relationship.
 *   2. Ordering — the signature is verified BEFORE the nonce is recorded.
 *      Recording first would let an unauthenticated attacker spoofing
 *      `sender_server_id` poison the per-sender nonce cache and lock out the
 *      real peer.
 *   3. Replay rejection — a nonce reused by a genuinely signed sender is
 *      refused via the unique constraint.
 */

import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'
import { createDbMock } from '../test/db-mock'
import { createAxiosMock } from '../test/axios-mock'

const http = createAxiosMock()
mock.module('axios', () => http.module)

const dbMock = createDbMock()
mock.module('../db', () => ({ db: dbMock.db }))

class MalformedSignatureInputError extends Error {}
let signatureValid = true
let signatureThrows: Error | null = null

const verifySignature = mock((_canonical: string, _sig: string, _key: string) => {
  if (signatureThrows) throw signatureThrows
  return signatureValid
})

mock.module('../lib/crypto', () => ({
  verifySignature,
  MalformedSignatureInputError,
}))

let timestampFresh = true
const buildServerSignableWrapper = mock((parts: any) => JSON.stringify(parts))
const hashBody = mock((body: string) => `hash(${body})`)
const isTimestampFresh = mock((_ts: string, _skew: number) => timestampFresh)

mock.module('../lib/federation-canonical', () => ({
  buildServerSignableWrapper,
  hashBody,
  isTimestampFresh,
}))

const signWithServerKey = mock(async (_canonical: string) => 'our-signature')
mock.module('../lib/server-identity', () => ({
  signWithServerKey,
  supportsProtocolVersion: (v: number) => v === 2,
  getProtocolVersion: () => 2,
}))

mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
}))

process.env.SERVER_ORIGIN = 'https://parchment.test'

const {
  resolvePeerServer,
  signOutboundRequest,
  getOurServerId,
  verifyInboundRequest,
} = await import('./federation-auth.service')

const manifest = (over: object = {}) => ({
  server_id: 'peer.test',
  public_key: 'peer-public-key',
  protocol_versions: [2],
  capabilities: ['location-live'],
  ...over,
})

/** Inbound headers for a well-formed signed request. */
function authHeaders(over: Record<string, string> = {}): Headers {
  return new Headers({
    'X-Parchment-Server-Id': 'peer.test',
    'X-Parchment-Protocol-Version': '2',
    'X-Parchment-Nonce': 'nonce-1',
    'X-Parchment-Timestamp': '2026-01-01T00:00:00.000Z',
    'X-Parchment-Server-Signature': 'peer-signature',
    ...over,
  })
}

const inbound = {
  method: 'POST',
  path: '/federation/inbox',
  bodyJson: '{"a":1}',
}

beforeEach(() => {
  http.reset()
  dbMock.reset()
  signatureValid = true
  signatureThrows = null
  timestampFresh = true
  verifySignature.mockClear()
  signWithServerKey.mockClear()
  buildServerSignableWrapper.mockClear()
})

describe('getOurServerId', () => {
  test('strips the scheme from SERVER_ORIGIN', () => {
    expect(getOurServerId()).toBe('parchment.test')
  })

  test('throws when SERVER_ORIGIN is unset', () => {
    const previous = process.env.SERVER_ORIGIN
    delete process.env.SERVER_ORIGIN

    try {
      expect(() => getOurServerId()).toThrow('SERVER_ORIGIN not set')
    } finally {
      process.env.SERVER_ORIGIN = previous
    }
  })
})

describe('resolvePeerServer — manifest', () => {
  test('fetches the well-known manifest over https', async () => {
    http.get.mockResolvedValueOnce({ data: manifest() })
    dbMock.queueSelect([])

    const peer = await resolvePeerServer('peer.test')

    expect(http.get.mock.calls[0][0]).toBe(
      'https://peer.test/.well-known/parchment-server',
    )
    expect(peer.serverId).toBe('peer.test')
  })

  test('rejects a malformed manifest', async () => {
    http.get.mockResolvedValueOnce({ data: { server_id: 'peer.test' } })

    await expect(resolvePeerServer('peer.test')).rejects.toThrow(
      'malformed server manifest',
    )
  })

  test('rejects an empty manifest body', async () => {
    http.get.mockResolvedValueOnce({ data: null })

    await expect(resolvePeerServer('peer.test')).rejects.toThrow(
      'malformed server manifest',
    )
  })

  test('rejects a peer with no mutually supported protocol version', async () => {
    http.get.mockResolvedValueOnce({
      data: manifest({ protocol_versions: [1, 3] }),
    })

    await expect(resolvePeerServer('peer.test')).rejects.toThrow(
      'No mutually supported protocol version',
    )
    // Nothing is pinned for a peer we can't talk to.
    expect(dbMock.insertCount).toBe(0)
  })

  test('derives the minimum protocol version when unspecified', async () => {
    http.get.mockResolvedValueOnce({
      data: manifest({ protocol_versions: [2, 4] }),
    })
    dbMock.queueSelect([])

    const peer = await resolvePeerServer('peer.test')

    expect(peer.minimumProtocolVersion).toBe(2)
  })

  test('honours an explicit minimum protocol version', async () => {
    http.get.mockResolvedValueOnce({
      data: manifest({ protocol_versions: [2], minimum_protocol_version: 2 }),
    })
    dbMock.queueSelect([])

    expect((await resolvePeerServer('peer.test')).minimumProtocolVersion).toBe(2)
  })

  test('defaults capabilities to an empty list', async () => {
    http.get.mockResolvedValueOnce({
      data: manifest({ capabilities: undefined }),
    })
    dbMock.queueSelect([])

    expect((await resolvePeerServer('peer.test')).capabilities).toEqual([])
  })

  test('refuses an http:// peer outside dev', async () => {
    await expect(resolvePeerServer('http://peer.test')).rejects.toThrow(
      'Federation requires HTTPS peers',
    )
    expect(http.get).not.toHaveBeenCalled()
  })
})

describe('resolvePeerServer — TOFU pinning', () => {
  test('pins the key on first contact', async () => {
    http.get.mockResolvedValueOnce({ data: manifest() })
    dbMock.queueSelect([])

    await resolvePeerServer('peer.test')

    expect(dbMock.inserted[0]).toMatchObject({
      serverId: 'peer.test',
      publicKey: 'peer-public-key',
    })
  })

  test('accepts a matching pinned key and refreshes lastSeenAt', async () => {
    http.get.mockResolvedValueOnce({ data: manifest() })
    dbMock.queueSelect([
      { serverId: 'peer.test', publicKey: 'peer-public-key' },
    ])

    await resolvePeerServer('peer.test')

    expect(dbMock.insertCount).toBe(0)
    expect((dbMock.updated[0] as any).lastSeenAt).toBeInstanceOf(Date)
  })

  test('REFUSES a changed identity key rather than rotating silently', async () => {
    // Silent rotation would hand the peer relationship to anyone who can
    // answer for the domain.
    http.get.mockResolvedValueOnce({ data: manifest({ public_key: 'attacker-key' }) })
    dbMock.queueSelect([
      { serverId: 'peer.test', publicKey: 'peer-public-key' },
    ])

    await expect(resolvePeerServer('peer.test')).rejects.toThrow(
      'presented a different identity key',
    )
  })

  test('a rejected key change writes nothing', async () => {
    http.get.mockResolvedValueOnce({ data: manifest({ public_key: 'attacker-key' }) })
    dbMock.queueSelect([
      { serverId: 'peer.test', publicKey: 'peer-public-key' },
    ])

    await resolvePeerServer('peer.test').catch(() => {})

    expect(dbMock.insertCount).toBe(0)
    expect(dbMock.updateCount).toBe(0)
  })

  test('the rejection tells the operator to re-pin out of band', async () => {
    http.get.mockResolvedValueOnce({ data: manifest({ public_key: 'attacker-key' }) })
    dbMock.queueSelect([
      { serverId: 'peer.test', publicKey: 'peer-public-key' },
    ])

    const error = await resolvePeerServer('peer.test').catch((e) => e)

    expect(error.message).toContain('Re-pin manually')
  })
})

describe('signOutboundRequest', () => {
  const params = {
    method: 'POST',
    path: '/federation/inbox',
    bodyJson: '{"a":1}',
    peerServerId: 'peer.test',
    nonce: 'nonce-1',
    timestamp: '2026-01-01T00:00:00.000Z',
  }

  test('returns the full header set', async () => {
    const headers = await signOutboundRequest(params)

    expect(headers).toEqual({
      'X-Parchment-Server-Id': 'parchment.test',
      'X-Parchment-Protocol-Version': '2',
      'X-Parchment-Nonce': 'nonce-1',
      'X-Parchment-Timestamp': '2026-01-01T00:00:00.000Z',
      'X-Parchment-Server-Signature': 'our-signature',
    })
  })

  test('signs over a body hash, not the raw body', async () => {
    await signOutboundRequest(params)

    const wrapper = buildServerSignableWrapper.mock.calls[0][0] as any
    expect(wrapper.body_hash).toBe('hash({"a":1})')
    expect(JSON.stringify(wrapper)).not.toContain('"a":1')
  })

  test('binds the signature to method, path and both server ids', async () => {
    await signOutboundRequest(params)

    expect(buildServerSignableWrapper.mock.calls[0][0]).toMatchObject({
      method: 'POST',
      path: '/federation/inbox',
      peer_server_id: 'peer.test',
      sender_server_id: 'parchment.test',
      protocol_version: 2,
    })
  })
})

describe('verifyInboundRequest — header and freshness checks', () => {
  const required = [
    'X-Parchment-Server-Id',
    'X-Parchment-Protocol-Version',
    'X-Parchment-Nonce',
    'X-Parchment-Timestamp',
    'X-Parchment-Server-Signature',
  ]

  for (const header of required) {
    test(`rejects a request missing ${header}`, async () => {
      const headers = authHeaders()
      headers.delete(header)

      await expect(
        verifyInboundRequest({ ...inbound, headers }),
      ).rejects.toThrow('Missing required federation auth headers')
    })
  }

  test('rejects an unsupported protocol version', async () => {
    await expect(
      verifyInboundRequest({
        ...inbound,
        headers: authHeaders({ 'X-Parchment-Protocol-Version': '1' }),
      }),
    ).rejects.toThrow('Unsupported protocol version')
  })

  test('rejects a non-numeric protocol version', async () => {
    await expect(
      verifyInboundRequest({
        ...inbound,
        headers: authHeaders({ 'X-Parchment-Protocol-Version': 'two' }),
      }),
    ).rejects.toThrow('Unsupported protocol version')
  })

  test('rejects a stale timestamp', async () => {
    timestampFresh = false

    await expect(
      verifyInboundRequest({ ...inbound, headers: authHeaders() }),
    ).rejects.toThrow('Timestamp skew too large')
  })

  test('a stale timestamp is rejected before any peer lookup', async () => {
    timestampFresh = false

    await verifyInboundRequest({ ...inbound, headers: authHeaders() }).catch(
      () => {},
    )

    expect(http.get).not.toHaveBeenCalled()
  })
})

describe('verifyInboundRequest — signature', () => {
  /** Queue a successful peer resolution with a pinned, matching key. */
  function peerResolves() {
    http.get.mockResolvedValueOnce({ data: manifest() })
    dbMock.queueSelect([
      { serverId: 'peer.test', publicKey: 'peer-public-key' },
    ])
  }

  test('accepts a valid signature and returns the sender', async () => {
    peerResolves()

    expect(
      await verifyInboundRequest({ ...inbound, headers: authHeaders() }),
    ).toEqual({ senderServerId: 'peer.test', protocolVersion: 2 })
  })

  test('verifies against the peer’s pinned public key', async () => {
    peerResolves()

    await verifyInboundRequest({ ...inbound, headers: authHeaders() })

    expect(verifySignature.mock.calls[0][2]).toBe('peer-public-key')
  })

  test('rejects a sender id that disagrees with the peer manifest', async () => {
    http.get.mockResolvedValueOnce({ data: manifest({ server_id: 'other.test' }) })
    dbMock.queueSelect([])

    await expect(
      verifyInboundRequest({ ...inbound, headers: authHeaders() }),
    ).rejects.toThrow('does not match peer manifest')
  })

  test('rejects an invalid signature', async () => {
    peerResolves()
    signatureValid = false

    await expect(
      verifyInboundRequest({ ...inbound, headers: authHeaders() }),
    ).rejects.toThrow('Invalid server signature')
  })

  test('reports a malformed signature distinctly', async () => {
    peerResolves()
    signatureThrows = new MalformedSignatureInputError('bad base64')

    await expect(
      verifyInboundRequest({ ...inbound, headers: authHeaders() }),
    ).rejects.toThrow('Malformed server signature')
  })

  test('propagates an unexpected verifier error', async () => {
    peerResolves()
    signatureThrows = new Error('crypto backend exploded')

    await expect(
      verifyInboundRequest({ ...inbound, headers: authHeaders() }),
    ).rejects.toThrow('crypto backend exploded')
  })

  test('binds the signature to OUR server id as the recipient', async () => {
    peerResolves()

    await verifyInboundRequest({ ...inbound, headers: authHeaders() })

    const wrapper = buildServerSignableWrapper.mock.calls[0][0] as any
    expect(wrapper.peer_server_id).toBe('parchment.test')
    expect(wrapper.sender_server_id).toBe('peer.test')
  })
})

describe('verifyInboundRequest — nonce handling', () => {
  const workingInsert = dbMock.db.insert

  /** Make the nonce insert fail the way Postgres would. */
  function insertFailsWith(message: string) {
    dbMock.db.insert = () => ({
      values: () => {
        throw new Error(message)
      },
    })
  }

  afterEach(() => {
    dbMock.db.insert = workingInsert
  })

  function peerResolves() {
    http.get.mockResolvedValueOnce({ data: manifest() })
    dbMock.queueSelect([
      { serverId: 'peer.test', publicKey: 'peer-public-key' },
    ])
  }

  test('records the nonce after a successful verification', async () => {
    peerResolves()

    await verifyInboundRequest({ ...inbound, headers: authHeaders() })

    expect(dbMock.inserted.at(-1)).toMatchObject({
      senderServerId: 'peer.test',
      nonce: 'nonce-1',
    })
  })

  test('does NOT record the nonce when the signature fails', async () => {
    // Otherwise a spoofed sender id could poison the peer's nonce cache and
    // lock the real server out.
    peerResolves()
    signatureValid = false

    await verifyInboundRequest({ ...inbound, headers: authHeaders() }).catch(
      () => {},
    )

    const nonceInserts = dbMock.inserted.filter(
      (row: any) => row?.nonce !== undefined,
    )
    expect(nonceInserts).toHaveLength(0)
  })

  test('rejects a replayed nonce', async () => {
    peerResolves()
    insertFailsWith(
      'duplicate key value violates unique constraint "federation_nonces_sender_nonce_uq"',
    )

    await expect(
      verifyInboundRequest({ ...inbound, headers: authHeaders() }),
    ).rejects.toThrow('Replay rejected')
  })

  test('propagates a non-uniqueness insert failure unchanged', async () => {
    peerResolves()
    insertFailsWith('connection terminated')

    await expect(
      verifyInboundRequest({ ...inbound, headers: authHeaders() }),
    ).rejects.toThrow('connection terminated')
  })

  test('sweeps expired nonces opportunistically', async () => {
    peerResolves()

    await verifyInboundRequest({ ...inbound, headers: authHeaders() })

    expect(dbMock.deleteCount).toBe(1)
  })
})
