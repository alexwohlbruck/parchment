/**
 * Round-trip integration tests for the federation-auth sign / verify path.
 *
 * We don't stand up a full HTTP server here — instead we exercise the
 * canonicalization + signing + verification logic end-to-end, which is where
 * subtle ordering / key-name / hash-mismatch bugs hide.
 *
 * These tests DO NOT touch the database. The TOFU pinning and nonce-uniqueness
 * paths are covered separately in a DB-backed integration test (not in this
 * file — see Part B.7 plan).
 */

import { describe, test, expect, beforeAll } from 'bun:test'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'

ed.hashes.sha512 = (...m) => sha512(ed.etc.concatBytes(...m))

import {
  buildServerSignableWrapper,
  hashBody,
  canonicalJsonStringify,
  generateNonce,
  nowIso,
  buildClientSignableV2,
  buildLegacySignableV1,
} from '../lib/federation-canonical'
import { verifySignature } from '../lib/crypto'

function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

describe('server wrapper signature round-trip', () => {
  let senderPriv: Uint8Array
  let senderPubBase64: string

  beforeAll(() => {
    senderPriv = new Uint8Array(32)
    for (let i = 0; i < 32; i++) senderPriv[i] = (i + 7) & 0xff
    senderPubBase64 = bytesToBase64(ed.getPublicKey(senderPriv))
  })

  test('signature computed by sender verifies on receiver', async () => {
    const message = {
      type: 'LOCATION_UPDATE' as const,
      from: 'alice@a.example',
      to: 'bob@b.example',
      timestamp: nowIso(),
      signature: 'client-sig-placeholder',
      encryptedLocation: 'ciphertext',
      nonce: 'loc-nonce',
    }

    // Sender side: canonicalize body, sign wrapper
    const bodyJsonSender = canonicalJsonStringify(message)
    const transportNonce = generateNonce()
    const timestamp = nowIso()

    const canonicalSend = buildServerSignableWrapper({
      method: 'POST',
      path: '/federation/inbox',
      body_hash: hashBody(bodyJsonSender),
      nonce: transportNonce,
      timestamp,
      peer_server_id: 'b.example',
      sender_server_id: 'a.example',
      protocol_version: 2,
    })

    const sig = await ed.signAsync(
      new TextEncoder().encode(canonicalSend),
      senderPriv,
    )
    const sigBase64 = bytesToBase64(sig)

    // Receiver side: after JSON parse (which may re-order keys), canonicalize
    // again, compute the same wrapper, verify.
    const parsed = JSON.parse(JSON.stringify(message)) // simulates roundtrip
    const bodyJsonRecv = canonicalJsonStringify(parsed)

    const canonicalRecv = buildServerSignableWrapper({
      method: 'POST',
      path: '/federation/inbox',
      body_hash: hashBody(bodyJsonRecv),
      nonce: transportNonce,
      timestamp,
      peer_server_id: 'b.example',
      sender_server_id: 'a.example',
      protocol_version: 2,
    })

    expect(canonicalRecv).toBe(canonicalSend)
    expect(verifySignature(canonicalRecv, sigBase64, senderPubBase64)).toBe(true)
  })

  test('body tampering invalidates the wrapper signature', async () => {
    const original = { type: 'X', payload: { a: 1 } }
    const tampered = { type: 'X', payload: { a: 2 } }

    const canonical = buildServerSignableWrapper({
      method: 'POST',
      path: '/p',
      body_hash: hashBody(canonicalJsonStringify(original)),
      nonce: 'n',
      timestamp: nowIso(),
      peer_server_id: 'p',
      sender_server_id: 's',
      protocol_version: 2,
    })
    const sig = bytesToBase64(
      await ed.signAsync(new TextEncoder().encode(canonical), senderPriv),
    )

    const canonicalTampered = buildServerSignableWrapper({
      method: 'POST',
      path: '/p',
      body_hash: hashBody(canonicalJsonStringify(tampered)),
      nonce: 'n',
      timestamp: canonical.includes('timestamp') ? JSON.parse(canonical).timestamp : nowIso(),
      peer_server_id: 'p',
      sender_server_id: 's',
      protocol_version: 2,
    })

    expect(verifySignature(canonicalTampered, sig, senderPubBase64)).toBe(false)
  })
})

describe('client v1 signature round-trip', () => {
  let clientPriv: Uint8Array
  let clientPubBase64: string

  beforeAll(() => {
    clientPriv = new Uint8Array(32)
    for (let i = 0; i < 32; i++) clientPriv[i] = (i * 3 + 1) & 0xff
    clientPubBase64 = bytesToBase64(ed.getPublicKey(clientPriv))
  })

  test('v1 FRIEND_INVITE signed by the client verifies server-side', async () => {
    const from = 'alice@a.example'
    const to = 'bob@b.example'
    const timestamp = '2026-04-20T12:00:00.000Z'

    // Client produces the v1 signable. Must match what the legacy
    // buildSignableMessage in web/src/lib/federation-crypto.ts produces.
    const signable = buildLegacySignableV1('FRIEND_INVITE', {
      from,
      to,
      timestamp,
    })
    expect(signable).toBe(
      `{"type":"FRIEND_INVITE","from":"${from}","timestamp":"${timestamp}","to":"${to}"}`,
    )

    const sig = bytesToBase64(
      await ed.signAsync(new TextEncoder().encode(signable), clientPriv),
    )

    // Server rebuilds and verifies.
    const rebuilt = buildLegacySignableV1('FRIEND_INVITE', {
      from,
      to,
      timestamp,
    })
    expect(verifySignature(rebuilt, sig, clientPubBase64)).toBe(true)
  })
})

describe('client v2 signature round-trip', () => {
  let clientPriv: Uint8Array
  let clientPubBase64: string

  beforeAll(() => {
    clientPriv = new Uint8Array(32)
    for (let i = 0; i < 32; i++) clientPriv[i] = (i * 5 + 11) & 0xff
    clientPubBase64 = bytesToBase64(ed.getPublicKey(clientPriv))
  })

  test('v2 envelope with nonce + timestamp verifies round-trip', async () => {
    const envelope = {
      protocol_version: 2,
      message_type: 'FRIEND_INVITE',
      message_version: 1,
      from: 'alice@a.example',
      to: 'bob@b.example',
      nonce: 'abc123==',
      timestamp: '2026-04-20T12:00:00.000Z',
      payload: {},
    }

    const signable = buildClientSignableV2(envelope)
    const sig = bytesToBase64(
      await ed.signAsync(new TextEncoder().encode(signable), clientPriv),
    )
    expect(verifySignature(signable, sig, clientPubBase64)).toBe(true)

    // Mutating any covered field invalidates.
    const tamperedNonce = buildClientSignableV2({ ...envelope, nonce: 'xyz' })
    expect(verifySignature(tamperedNonce, sig, clientPubBase64)).toBe(false)
    const tamperedTs = buildClientSignableV2({
      ...envelope,
      timestamp: '2026-04-20T13:00:00.000Z',
    })
    expect(verifySignature(tamperedTs, sig, clientPubBase64)).toBe(false)
  })
})
