/**
 * Unit tests for the federation service.
 *
 * The security-relevant rules:
 *   - remote resolution and sending both refuse plain HTTP outside dev, and
 *     both require the peer's manifest to resolve (which pins/verifies its
 *     identity key) BEFORE trusting anything the peer says;
 *   - the outbound envelope is never mutated — protocol_version, nonce and
 *     timestamp are covered by the *client's* signature, so rewriting any of
 *     them would silently invalidate it at the recipient;
 *   - inbound messages are rejected unless addressed to a local handle, fresh,
 *     from a resolvable sender, and correctly signed under the v2 signable form.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createDbMock } from '../test/db-mock'
import { createAxiosMock } from '../test/axios-mock'

const http = createAxiosMock()
mock.module('axios', () => http.module)

const dbMock = createDbMock()
mock.module('../db', () => ({ db: dbMock.db }))

class MalformedSignatureInputError extends Error {}
let signatureValid = true
let signatureThrows: Error | null = null

const verifySignature = mock((_message: string, _signature: string, _publicKey: string) => {
  if (signatureThrows) throw signatureThrows
  return signatureValid
})

mock.module('../lib/crypto', () => ({
  parseHandle: (handle: string) => {
    const match = /^([^@]+)@(.+)$/.exec(handle)
    return match ? { alias: match[1], domain: match[2] } : null
  },
  verifySignature,
  MalformedSignatureInputError,
}))

let timestampFresh = true
const buildClientSignableV2 = mock((envelope: any) => `v2:${JSON.stringify(envelope)}`)

mock.module('../lib/federation-canonical', () => ({
  buildClientSignableV2,
  canonicalJsonStringify: (value: unknown) => JSON.stringify(value),
  generateNonce: () => 'generated-nonce',
  isTimestampFresh: (_ts: string, _skew: number) => timestampFresh,
}))

let peerResolveError: Error | null = null
const resolvePeerServer = mock(async (_domain: string) => {
  if (peerResolveError) throw peerResolveError
  return { serverId: 'peer.test', publicKey: 'peer-key' }
})
const signOutboundRequest = mock(async (_params: any) => ({
  'X-Parchment-Server-Signature': 'server-sig',
}))

mock.module('./federation-auth.service', () => ({
  resolvePeerServer,
  signOutboundRequest,
}))

mock.module('../config', () => ({
  origins: {
    serverOrigin: 'https://parchment.test',
    serverHostname: 'parchment.test',
  },
}))

mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
}))

const friendHandlers = {
  handleIncomingFriendInvite: mock(async () => ({ success: true })),
  handleIncomingFriendAccept: mock(async () => ({ success: true })),
}
mock.module('./friends.service', () => friendHandlers)

const handleIncomingRealtimeEvent = mock(async () => ({ success: true }))
mock.module('./realtime/federation-inbound', () => ({
  handleIncomingRealtimeEvent,
}))

const {
  getServerDomain,
  buildHandle,
  isLocalHandle,
  resolveHandle,
  resolveLocalUser,
  resolveRemoteUser,
  sendFederationMessage,
  processFederationMessage,
} = await import('./federation.service')

const localUserRow = {
  alias: 'alice',
  signingKey: 'alice-signing',
  encryptionKey: 'alice-encryption',
  firstName: 'Alice',
  lastName: 'Smith',
  picture: 'https://pic.test/a.png',
}

const v2Message = {
  protocol_version: 2,
  message_type: 'FRIEND_INVITE',
  message_version: 1,
  nonce: 'msg-nonce',
  timestamp: '2026-01-01T00:00:00.000Z',
  from: 'bob@peer.test',
  to: 'alice@parchment.test',
  signature: 'client-sig',
  payload: {},
} as any

beforeEach(() => {
  http.reset()
  dbMock.reset()
  signatureValid = true
  signatureThrows = null
  timestampFresh = true
  peerResolveError = null
  verifySignature.mockClear()
  resolvePeerServer.mockClear()
  signOutboundRequest.mockClear()
  buildClientSignableV2.mockClear()
  friendHandlers.handleIncomingFriendInvite.mockClear()
  friendHandlers.handleIncomingFriendInvite.mockImplementation(async () => ({
    success: true,
  }))
})

describe('handle helpers', () => {
  test('getServerDomain returns the configured hostname', () => {
    expect(getServerDomain()).toBe('parchment.test')
  })

  test('buildHandle appends our domain', () => {
    expect(buildHandle('alice')).toBe('alice@parchment.test')
  })

  test('isLocalHandle recognizes our own domain', () => {
    expect(isLocalHandle('alice@parchment.test')).toBe(true)
  })

  test('isLocalHandle rejects a remote domain', () => {
    expect(isLocalHandle('bob@peer.test')).toBe(false)
  })

  test('isLocalHandle rejects a malformed handle', () => {
    expect(isLocalHandle('not-a-handle')).toBe(false)
  })
})

describe('resolveLocalUser', () => {
  test('returns the public identity with an inbox URL', async () => {
    dbMock.queueSelect([localUserRow])

    expect(await resolveLocalUser('alice')).toEqual({
      handle: 'alice@parchment.test',
      signingKey: 'alice-signing',
      encryptionKey: 'alice-encryption',
      inbox: 'https://parchment.test/federation/inbox',
      name: 'Alice Smith',
      picture: 'https://pic.test/a.png',
    })
  })

  test('returns null for an unknown alias', async () => {
    dbMock.queueSelect([])

    expect(await resolveLocalUser('nobody')).toBeNull()
  })

  test('returns null when the user has no signing key yet', async () => {
    // Identity setup hasn't run — there is nothing to federate with.
    dbMock.queueSelect([{ ...localUserRow, signingKey: null }])

    expect(await resolveLocalUser('alice')).toBeNull()
  })

  test('omits the display name when both name parts are empty', async () => {
    dbMock.queueSelect([{ ...localUserRow, firstName: null, lastName: null }])

    expect((await resolveLocalUser('alice'))!.name).toBeUndefined()
  })

  test('uses whichever name part exists', async () => {
    dbMock.queueSelect([{ ...localUserRow, lastName: null }])

    expect((await resolveLocalUser('alice'))!.name).toBe('Alice')
  })

  test('defaults a missing encryption key to an empty string', async () => {
    dbMock.queueSelect([{ ...localUserRow, encryptionKey: null }])

    expect((await resolveLocalUser('alice'))!.encryptionKey).toBe('')
  })
})

describe('resolveRemoteUser', () => {
  test('fetches the peer’s well-known user document', async () => {
    http.get.mockResolvedValueOnce({
      status: 200,
      data: { handle: 'bob@peer.test', signingKey: 'bob-key' },
    })

    const user = await resolveRemoteUser('bob', 'peer.test')

    expect(user!.handle).toBe('bob@peer.test')
    expect(http.get.mock.calls[0][0]).toBe(
      'https://peer.test/.well-known/user/bob',
    )
  })

  test('pins or verifies the peer manifest before trusting the response', async () => {
    http.get.mockResolvedValueOnce({ status: 200, data: { handle: 'bob@peer.test' } })

    await resolveRemoteUser('bob', 'peer.test')

    expect(resolvePeerServer).toHaveBeenCalledWith('peer.test')
  })

  test('refuses to resolve when the manifest check fails', async () => {
    // A failed check includes the "pinned key changed" case.
    peerResolveError = new Error('identity key changed')

    expect(await resolveRemoteUser('bob', 'peer.test')).toBeNull()
    expect(http.get).not.toHaveBeenCalled()
  })

  test('refuses a plain-HTTP domain', async () => {
    await expect(resolveRemoteUser('bob', 'http://peer.test')).rejects.toThrow()
  })

  test('returns null on a non-200 response', async () => {
    http.get.mockResolvedValueOnce({ status: 404, data: null })

    expect(await resolveRemoteUser('bob', 'peer.test')).toBeNull()
  })

  test('returns null when the request throws', async () => {
    http.get.mockRejectedValueOnce(new Error('ETIMEDOUT'))

    expect(await resolveRemoteUser('bob', 'peer.test')).toBeNull()
  })
})

describe('resolveHandle', () => {
  test('routes a local handle to the local resolver', async () => {
    dbMock.queueSelect([localUserRow])

    const user = await resolveHandle('alice@parchment.test')

    expect(user!.handle).toBe('alice@parchment.test')
    expect(http.get).not.toHaveBeenCalled()
  })

  test('routes a remote handle to the remote resolver', async () => {
    http.get.mockResolvedValueOnce({ status: 200, data: { handle: 'bob@peer.test' } })

    await resolveHandle('bob@peer.test')

    expect(http.get).toHaveBeenCalled()
  })

  test('returns null for a malformed handle', async () => {
    expect(await resolveHandle('garbage')).toBeNull()
  })
})

describe('sendFederationMessage', () => {
  const message = { ...v2Message, from: 'alice@parchment.test', to: 'bob@peer.test' }

  function inboxResolves(inbox = 'https://peer.test/federation/inbox') {
    http.get.mockResolvedValueOnce({
      status: 200,
      data: { handle: 'bob@peer.test', inbox },
    })
  }

  test('posts the canonicalized message to the handle’s inbox', async () => {
    inboxResolves()
    http.post.mockResolvedValueOnce({ status: 202 })

    expect(await sendFederationMessage('bob@peer.test', message)).toBe(true)
    expect(http.post.mock.calls[0][0]).toBe('https://peer.test/federation/inbox')
  })

  test('treats 200 as delivered too', async () => {
    inboxResolves()
    http.post.mockResolvedValueOnce({ status: 200 })

    expect(await sendFederationMessage('bob@peer.test', message)).toBe(true)
  })

  test('reports failure on any other status', async () => {
    inboxResolves()
    http.post.mockResolvedValueOnce({ status: 400 })

    expect(await sendFederationMessage('bob@peer.test', message)).toBe(false)
  })

  test('refuses a plain-HTTP inbox outside dev', async () => {
    inboxResolves('http://peer.test/federation/inbox')

    expect(await sendFederationMessage('bob@peer.test', message)).toBe(false)
    expect(http.post).not.toHaveBeenCalled()
  })

  test('refuses an inbox hosted off the handle’s domain', async () => {
    inboxResolves('https://internal.test/admin')

    expect(await sendFederationMessage('bob@peer.test', message)).toBe(false)
    expect(http.post).not.toHaveBeenCalled()
  })

  test('fails when the target handle cannot be resolved', async () => {
    http.get.mockRejectedValueOnce(new Error('unreachable'))

    expect(await sendFederationMessage('bob@peer.test', message)).toBe(false)
    expect(http.post).not.toHaveBeenCalled()
  })

  test('aborts when the peer manifest check fails', async () => {
    peerResolveError = new Error('pin mismatch')

    expect(await sendFederationMessage('bob@peer.test', message)).toBe(false)
    expect(http.post).not.toHaveBeenCalled()
  })

  test('refuses to send a message with no timestamp or nonce', async () => {
    expect(
      await sendFederationMessage('bob@peer.test', { ...message, timestamp: undefined }),
    ).toBe(false)
    expect(
      await sendFederationMessage('bob@peer.test', { ...message, nonce: undefined }),
    ).toBe(false)
    expect(http.post).not.toHaveBeenCalled()
  })

  test('never mutates the client-signed envelope fields', async () => {
    inboxResolves()
    http.post.mockResolvedValueOnce({ status: 202 })

    await sendFederationMessage('bob@peer.test', message)

    const body = JSON.parse(http.post.mock.calls[0][1] as string)
    expect(body.nonce).toBe('msg-nonce')
    expect(body.timestamp).toBe('2026-01-01T00:00:00.000Z')
    expect(body.protocol_version).toBe(2)
  })

  test('uses the envelope nonce for the transport signature', async () => {
    inboxResolves()
    http.post.mockResolvedValueOnce({ status: 202 })

    await sendFederationMessage('bob@peer.test', message)

    expect((signOutboundRequest.mock.calls[0][0] as any).nonce).toBe('msg-nonce')
  })

  test('attaches the server auth headers to the request', async () => {
    inboxResolves()
    http.post.mockResolvedValueOnce({ status: 202 })

    await sendFederationMessage('bob@peer.test', message)

    expect(http.post.mock.calls[0][2].headers).toMatchObject({
      'X-Parchment-Server-Signature': 'server-sig',
    })
  })

  test('reports failure rather than throwing when the post errors', async () => {
    inboxResolves()
    http.post.mockRejectedValueOnce(new Error('ECONNRESET'))

    expect(await sendFederationMessage('bob@peer.test', message)).toBe(false)
  })
})

describe('processFederationMessage — envelope validation', () => {
  test('rejects a message with no type', async () => {
    const result = await processFederationMessage({
      ...v2Message,
      message_type: undefined,
      type: undefined,
    })

    expect(result).toEqual({
      success: false,
      error: 'Invalid message structure',
    })
  })

  test('rejects a message with no signature', async () => {
    const result = await processFederationMessage({
      ...v2Message,
      signature: undefined,
    })

    expect(result.error).toBe('Invalid message structure')
  })

  test('rejects a message addressed to another server', async () => {
    const result = await processFederationMessage({
      ...v2Message,
      to: 'someone@elsewhere.test',
    })

    expect(result.error).toBe('Recipient is not on this server')
  })

  test('rejects a stale message', async () => {
    timestampFresh = false

    const result = await processFederationMessage(v2Message)

    expect(result.error).toContain('timestamp outside acceptable skew')
  })

  test('rejects when the sender cannot be resolved', async () => {
    http.get.mockRejectedValueOnce(new Error('unreachable'))

    const result = await processFederationMessage(v2Message)

    expect(result.error).toBe('Could not resolve sender')
  })

  test('rejects a message with no nonce', async () => {
    const result = await processFederationMessage({ ...v2Message, nonce: undefined })

    expect(result.error).toBe('Invalid message structure')
  })

  test('rejects a legacy v1 message', async () => {
    const result = await processFederationMessage({
      type: 'FRIEND_INVITE',
      from: 'bob@peer.test',
      to: 'alice@parchment.test',
      timestamp: '2026-01-01T00:00:00.000Z',
      signature: 'client-sig',
    } as any)

    expect(result.error).toBe('Invalid message structure')
    expect(verifySignature).not.toHaveBeenCalled()
  })
})

describe('processFederationMessage — signature', () => {
  function senderResolves() {
    http.get.mockResolvedValueOnce({
      status: 200,
      data: { handle: 'bob@peer.test', signingKey: 'bob-key' },
    })
  }

  test('verifies a v2 message against the v2 signable form', async () => {
    senderResolves()

    await processFederationMessage(v2Message)

    expect(buildClientSignableV2).toHaveBeenCalled()
  })

  test('reads handler fields from the signed payload only', async () => {
    senderResolves()

    const result = await processFederationMessage({
      ...v2Message,
      message_type: 'RESOURCE_SHARE',
      payload: {},
      encryptedData: 'unsigned',
      nonce: 'msg-nonce',
      resourceType: 'collection',
      resourceId: 'c1',
    })

    expect(result.error).toBe('Missing resource data')
  })

  test('refuses cross-server location updates', async () => {
    senderResolves()

    const result = await processFederationMessage({
      ...v2Message,
      message_type: 'LOCATION_UPDATE',
      payload: { encryptedLocation: 'x', nonce: 'n' },
    })

    expect(result.success).toBe(false)
  })

  test('verifies against the SENDER’s signing key', async () => {
    senderResolves()

    await processFederationMessage(v2Message)

    expect(verifySignature.mock.calls[0][2]).toBe('bob-key')
  })

  test('rejects an invalid signature', async () => {
    senderResolves()
    signatureValid = false

    const result = await processFederationMessage(v2Message)

    expect(result).toEqual({ success: false, error: 'Invalid signature' })
  })

  test('an invalid signature never reaches a domain handler', async () => {
    senderResolves()
    signatureValid = false

    await processFederationMessage(v2Message)

    expect(friendHandlers.handleIncomingFriendInvite).not.toHaveBeenCalled()
  })

  test('reports a malformed signature distinctly', async () => {
    senderResolves()
    signatureThrows = new MalformedSignatureInputError('bad base64')

    const result = await processFederationMessage(v2Message)

    expect(result.error).toContain('Malformed signature input')
  })

  test('dispatches a verified FRIEND_INVITE to the friends service', async () => {
    senderResolves()

    const result = await processFederationMessage(v2Message)

    expect(result).toEqual({ success: true })
    expect(friendHandlers.handleIncomingFriendInvite).toHaveBeenCalledWith(
      'bob@peer.test',
      'alice@parchment.test',
      expect.objectContaining({ signingKey: 'bob-key' }),
      'client-sig',
    )
  })
})

describe('processFederationMessage — server-attested realtime events', () => {
  const realtimeMessage = {
    ...v2Message,
    message_type: 'REALTIME_EVENT',
    signature: '',
    payload: {
      eventType: 'collection:updated',
      eventPayload: { id: 'c1' },
      recipientAliases: ['alice'],
    },
  }

  test('dispatches a REALTIME_EVENT without a user signature', async () => {
    http.get.mockResolvedValueOnce({
      status: 200,
      data: { handle: 'bob@peer.test', signingKey: 'bob-key' },
    })

    const result = await processFederationMessage(realtimeMessage)

    expect(result).toEqual({ success: true })
    expect(verifySignature).not.toHaveBeenCalled()
    expect(handleIncomingRealtimeEvent).toHaveBeenCalledWith(
      'bob@peer.test',
      'collection:updated',
      { id: 'c1' },
      ['alice'],
    )
  })

  test('still requires a user signature for every other type', async () => {
    const result = await processFederationMessage({
      ...v2Message,
      message_type: 'RESOURCE_SHARE',
      signature: '',
    })

    expect(result.error).toBe('Invalid message structure')
  })
})
