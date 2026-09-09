/**
 * Server Identity
 *
 * Each Parchment server holds a long-lived Ed25519 keypair that authenticates it
 * to peer servers. The private key is loaded from SERVER_IDENTITY_PRIVATE_KEY
 * (base64 32-byte seed). In dev, if missing, a key is generated in-memory and a
 * warning is logged so the operator can persist it.
 */

import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
ed.hashes.sha512 = (...m) => sha512(ed.etc.concatBytes(...m))

const PROTOCOL_VERSION = 2
const SUPPORTED_PROTOCOL_VERSIONS = [2]
const SERVER_CAPABILITIES = [
  'location-live',
  'metadata-encryption-v1',
  'ecies-friend-v2',
  'signed-server-messages',
  'replay-protection',
  'revocation-propagation',
]

interface ServerIdentity {
  privateKey: Uint8Array
  publicKey: Uint8Array
  publicKeyBase64: string
}

let cached: ServerIdentity | null = null

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function loadSeed(): Uint8Array {
  const envSeed = process.env.SERVER_IDENTITY_PRIVATE_KEY
  if (!envSeed) {
    throw new Error(
      'SERVER_IDENTITY_PRIVATE_KEY is not set. Add it to server/.env: run `openssl rand -base64 32` and paste the output.',
    )
  }
  const bytes = base64ToBytes(envSeed.trim())
  if (bytes.length !== 32) {
    throw new Error(
      `SERVER_IDENTITY_PRIVATE_KEY must be 32 bytes (base64). Got ${bytes.length}.`,
    )
  }
  return bytes
}

export function getServerIdentity(): ServerIdentity {
  if (cached) return cached

  const privateKey = loadSeed()
  const publicKey = ed.getPublicKey(privateKey)
  cached = {
    privateKey,
    publicKey,
    publicKeyBase64: bytesToBase64(publicKey),
  }
  return cached
}

export async function signWithServerKey(message: string): Promise<string> {
  const identity = getServerIdentity()
  const bytes = new TextEncoder().encode(message)
  const signature = await ed.signAsync(bytes, identity.privateKey)
  return bytesToBase64(signature)
}

export interface ServerManifest {
  server_id: string
  public_key: string
  protocol_versions: number[]
  minimum_protocol_version: number
  capabilities: string[]
  key_transparency_anchor: string | null
}

export function buildServerManifest(serverId: string): ServerManifest {
  return {
    server_id: serverId,
    public_key: getServerIdentity().publicKeyBase64,
    protocol_versions: SUPPORTED_PROTOCOL_VERSIONS,
    minimum_protocol_version: Math.min(...SUPPORTED_PROTOCOL_VERSIONS),
    capabilities: SERVER_CAPABILITIES,
    key_transparency_anchor: null,
  }
}

export function getProtocolVersion(): number {
  return PROTOCOL_VERSION
}

export function getSupportedProtocolVersions(): number[] {
  return SUPPORTED_PROTOCOL_VERSIONS
}

export function supportsProtocolVersion(v: number): boolean {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(v)
}

export const serverIdentityInternals = {
  resetCache: () => {
    cached = null
  },
}
