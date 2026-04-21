/**
 * Tests for server identity loading, signing, and manifest shape.
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'

ed.hashes.sha512 = (...m) => sha512(ed.etc.concatBytes(...m))

import {
  getServerIdentity,
  signWithServerKey,
  buildServerManifest,
  serverIdentityInternals,
} from './server-identity'

function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

describe('server identity', () => {
  beforeEach(() => {
    serverIdentityInternals.resetCache()
  })

  test('loads deterministic keypair from env', () => {
    const seed = new Uint8Array(32)
    for (let i = 0; i < 32; i++) seed[i] = i
    process.env.SERVER_IDENTITY_PRIVATE_KEY = bytesToBase64(seed)
    serverIdentityInternals.resetCache()

    const identity1 = getServerIdentity()
    serverIdentityInternals.resetCache()
    const identity2 = getServerIdentity()

    expect(identity1.publicKeyBase64).toBe(identity2.publicKeyBase64)
  })

  test('rejects wrong-length seed', () => {
    process.env.SERVER_IDENTITY_PRIVATE_KEY = bytesToBase64(new Uint8Array(16))
    serverIdentityInternals.resetCache()
    expect(() => getServerIdentity()).toThrow()
    delete process.env.SERVER_IDENTITY_PRIVATE_KEY
  })

  test('throws when env var is missing — no silent ephemeral fallback', () => {
    const originalEnv = process.env.NODE_ENV
    const originalKey = process.env.SERVER_IDENTITY_PRIVATE_KEY
    try {
      delete process.env.SERVER_IDENTITY_PRIVATE_KEY
      process.env.NODE_ENV = 'development'
      serverIdentityInternals.resetCache()
      expect(() => getServerIdentity()).toThrow(/is not set/)
    } finally {
      if (originalKey !== undefined)
        process.env.SERVER_IDENTITY_PRIVATE_KEY = originalKey
      if (originalEnv !== undefined) process.env.NODE_ENV = originalEnv
      else delete process.env.NODE_ENV
      serverIdentityInternals.resetCache()
    }
  })

  test('signs and verifies with the server key', async () => {
    const seed = new Uint8Array(32)
    for (let i = 0; i < 32; i++) seed[i] = i + 1
    process.env.SERVER_IDENTITY_PRIVATE_KEY = bytesToBase64(seed)
    serverIdentityInternals.resetCache()

    const identity = getServerIdentity()
    const message = 'hello parchment'
    const signature = await signWithServerKey(message)

    const valid = ed.verify(
      base64ToBytes(signature),
      new TextEncoder().encode(message),
      base64ToBytes(identity.publicKeyBase64),
    )
    expect(valid).toBe(true)
  })

  test('manifest exposes public key and supported versions', () => {
    const seed = new Uint8Array(32)
    for (let i = 0; i < 32; i++) seed[i] = i + 2
    process.env.SERVER_IDENTITY_PRIVATE_KEY = bytesToBase64(seed)
    serverIdentityInternals.resetCache()

    const manifest = buildServerManifest('test.example.com')
    expect(manifest.server_id).toBe('test.example.com')
    expect(manifest.public_key).toBe(getServerIdentity().publicKeyBase64)
    expect(manifest.protocol_versions).toContain(2)
    expect(manifest.minimum_protocol_version).toBe(2)
    expect(manifest.capabilities.length).toBeGreaterThan(0)
    expect(manifest.key_transparency_anchor).toBeNull()
  })
})
