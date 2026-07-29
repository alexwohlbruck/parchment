/**
 * Endpoint tests for the federation controller.
 *
 * This is the server-to-server attack surface, so the important guarantees are
 * ordering ones: S2S signature verification runs *before* any message is
 * processed, a rejected signature never reaches the handler, and a 401 tells
 * the peer which protocol versions we speak so it can retry correctly.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createTestApp, req } from '../test/app'

const resolveLocalUser = mock(
  async (_alias: string) =>
    ({ alias: 'alice', publicKey: 'pk', handle: 'alice@parchment.test' }) as unknown,
)
const processFederationMessage = mock(
  async (_message: unknown) =>
    ({ success: true }) as { success: boolean; error?: string },
)

mock.module('../services/federation.service', () => ({
  resolveLocalUser,
  processFederationMessage,
}))

let authThrows: Error | null = null
const verifyInboundRequest = mock(async (_args: unknown) => {
  if (authThrows) throw authThrows
  return { senderServerId: 'peer.example', protocolVersion: 2 }
})

mock.module('../services/federation-auth.service', () => ({
  verifyInboundRequest,
  getOurServerId: () => 'parchment.test',
}))

mock.module('../lib/server-identity', () => ({
  buildServerManifest: (serverId: string) => ({
    server_id: serverId,
    public_key: 'server-pk',
    protocol_versions: [2],
    capabilities: ['location-live'],
  }),
  getSupportedProtocolVersions: () => [2],
}))

mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
}))

const federation = (await import('./federation.controller')).default
const app = createTestApp(federation)

const validMessage = {
  protocol_version: 2,
  message_type: 'FRIEND_INVITE',
  message_version: 1,
  nonce: 'nonce-1',
  from: 'bob@peer.example',
  to: 'alice@parchment.test',
  timestamp: '2026-01-01T00:00:00.000Z',
  signature: 'sig',
  payload: { note: 'hi' },
}

beforeEach(() => {
  authThrows = null
  resolveLocalUser.mockClear()
  resolveLocalUser.mockImplementation(async () => ({
    alias: 'alice',
    publicKey: 'pk',
    handle: 'alice@parchment.test',
  }))
  processFederationMessage.mockClear()
  processFederationMessage.mockImplementation(async () => ({ success: true }))
  verifyInboundRequest.mockClear()
})

describe('GET /.well-known/parchment-server', () => {
  test('publishes the server manifest without authentication', async () => {
    const res = await req(app).get('/.well-known/parchment-server')

    expect(res.status).toBe(200)
    expect(res.body.server_id).toBe('parchment.test')
    expect(res.body.protocol_versions).toEqual([2])
  })
})

describe('GET /.well-known/user/:alias', () => {
  test('resolves a local user for a peer server', async () => {
    const res = await req(app).get('/.well-known/user/alice')

    expect(res.status).toBe(200)
    expect(resolveLocalUser).toHaveBeenCalledWith('alice')
    expect(res.body.handle).toBe('alice@parchment.test')
  })

  test('404s for an alias that does not exist here', async () => {
    resolveLocalUser.mockResolvedValueOnce(null)

    const res = await req(app).get('/.well-known/user/nobody')

    expect(res.status).toBe(404)
  })

  test('is reachable without a session — peers have no account here', async () => {
    const res = await req(app).get('/.well-known/user/alice')

    expect(res.status).toBe(200)
  })
})

describe('POST /federation/inbox — S2S authentication', () => {
  test('accepts a signed message and answers 202', async () => {
    const res = await req(app).post('/federation/inbox', { body: validMessage })

    expect(res.status).toBe(202)
    expect(res.body).toEqual({ success: true })
    expect(processFederationMessage).toHaveBeenCalled()
  })

  test('401s when the server signature does not verify', async () => {
    authThrows = new Error('bad signature')

    const res = await req(app).post('/federation/inbox', { body: validMessage })

    expect(res.status).toBe(401)
    expect(res.body.message).toContain('bad signature')
  })

  test('a failed signature check never reaches the message handler', async () => {
    authThrows = new Error('replayed nonce')

    await req(app).post('/federation/inbox', { body: validMessage })

    expect(processFederationMessage).not.toHaveBeenCalled()
  })

  test('the 401 advertises the protocol versions we speak', async () => {
    authThrows = new Error('unsupported protocol version 1')

    const res = await req(app).post('/federation/inbox', { body: validMessage })

    expect(res.body.supported_protocol_versions).toEqual([2])
  })

  test('verification is handed the canonicalized body, method and path', async () => {
    await req(app).post('/federation/inbox', { body: validMessage })

    const args = verifyInboundRequest.mock.calls[0][0] as any
    expect(args.method).toBe('POST')
    expect(args.path).toBe('/federation/inbox')
    expect(typeof args.bodyJson).toBe('string')
  })

  test('the canonical body has stably ordered keys, not wire order', async () => {
    // The sender canonicalizes too; if we hashed raw wire order the digests
    // would disagree whenever either JSON parser reordered keys.
    await req(app).post('/federation/inbox', {
      body: { ...validMessage, zzz_last: 'x' } as any,
    })

    const { bodyJson } = verifyInboundRequest.mock.calls[0][0] as any
    const keys = Object.keys(JSON.parse(bodyJson))
    expect(keys).toEqual([...keys].sort())
  })
})

describe('POST /federation/inbox — message handling', () => {
  test('400s when the handler rejects the message', async () => {
    processFederationMessage.mockResolvedValueOnce({
      success: false,
      error: 'unknown recipient',
    })

    const res = await req(app).post('/federation/inbox', { body: validMessage })

    expect(res.status).toBe(400)
    expect(res.body.message).toBe('unknown recipient')
  })

  test('falls back to a generic message when the handler gives no reason', async () => {
    processFederationMessage.mockResolvedValueOnce({ success: false })

    const res = await req(app).post('/federation/inbox', { body: validMessage })

    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Failed to process message')
  })

  test('accepts a legacy v1 message shape', async () => {
    const legacy = {
      type: 'FRIEND_INVITE',
      from: 'bob@peer.example',
      to: 'alice@parchment.test',
      timestamp: '2026-01-01T00:00:00.000Z',
      signature: 'sig',
      payload: {},
    }

    const res = await req(app).post('/federation/inbox', { body: legacy })

    expect(res.status).toBe(202)
  })

  for (const field of ['from', 'to', 'timestamp', 'signature'] as const) {
    test(`422s when ${field} is missing`, async () => {
      const body: Record<string, unknown> = { ...validMessage }
      delete body[field]

      const res = await req(app).post('/federation/inbox', { body })

      expect(res.status).toBe(422)
      expect(verifyInboundRequest).not.toHaveBeenCalled()
    })
  }
})
