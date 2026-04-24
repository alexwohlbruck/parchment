/**
 * Federation canonical message builder (v2)
 *
 * Produces deterministic string representations of federation messages and
 * server-to-server request envelopes for signing and verification. Covers
 * nonce, timestamp, and protocol_version so those fields are integrity-
 * protected against tampering.
 */

import { sha256 } from '@noble/hashes/sha2.js'

function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function sortObjectKeys(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) return obj
  if (Array.isArray(obj)) return obj.map(sortObjectKeys)
  return Object.keys(obj as Record<string, unknown>)
    .sort()
    .reduce((sorted: Record<string, unknown>, key) => {
      sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key])
      return sorted
    }, {})
}

export interface SignableEnvelopeV2 {
  protocol_version: number
  message_type: string
  message_version: number
  from: string
  to: string
  nonce: string
  timestamp: string
  payload: Record<string, unknown>
}

/**
 * Canonical string for the client-level federation message signature (v2).
 * Covers every field a recipient needs to trust before it executes the message.
 */
export function buildClientSignableV2(env: SignableEnvelopeV2): string {
  return JSON.stringify(
    sortObjectKeys({
      protocol_version: env.protocol_version,
      message_type: env.message_type,
      message_version: env.message_version,
      from: env.from,
      to: env.to,
      nonce: env.nonce,
      timestamp: env.timestamp,
      payload: env.payload,
    }),
  )
}

/**
 * Backwards-compat helper: build a v1 signable. Kept only to verify any legacy
 * messages still in flight before v2 fully rolls out. Do NOT use for new writes.
 *
 * IMPORTANT: matches the original `buildSignableMessage` contract exactly —
 * payload keys are sorted alphabetically, then `type` is placed FIRST (not
 * sorted among the payload keys). Changing this order would invalidate every
 * v1 signature produced by the original clients.
 */
export function buildLegacySignableV1(
  type: string,
  payload: Record<string, unknown>,
): string {
  const sortedPayload = sortObjectKeys(payload) as Record<string, unknown>
  return JSON.stringify({
    type,
    ...sortedPayload,
  })
}

/**
 * Canonical JSON serializer used for body hashing in the server-to-server
 * wrapper signature. Both sender and receiver must serialize the message with
 * the SAME function so the `body_hash` binding is byte-stable regardless of
 * JSON parser key-order behavior.
 */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(sortObjectKeys(value))
}

export interface ServerWrapperSignable {
  method: string
  path: string
  body_hash: string
  nonce: string
  timestamp: string
  peer_server_id: string
  sender_server_id: string
  protocol_version: number
}

/**
 * Canonical string for the server-level (S2S) request signature.
 * Binds the server signature to the exact HTTP request line it authenticates.
 */
export function buildServerSignableWrapper(w: ServerWrapperSignable): string {
  return JSON.stringify(
    sortObjectKeys({
      method: w.method.toUpperCase(),
      path: w.path,
      body_hash: w.body_hash,
      nonce: w.nonce,
      timestamp: w.timestamp,
      peer_server_id: w.peer_server_id,
      sender_server_id: w.sender_server_id,
      protocol_version: w.protocol_version,
    }),
  )
}

export function hashBody(body: string): string {
  return bytesToBase64(sha256(new TextEncoder().encode(body)))
}

export function generateNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return bytesToBase64(bytes)
}

export function nowIso(): string {
  return new Date().toISOString()
}

/**
 * Validate a timestamp string: must parse, and must be within skewSeconds of now.
 */
export function isTimestampFresh(
  timestamp: string,
  skewSeconds = 300,
): boolean {
  const t = Date.parse(timestamp)
  if (Number.isNaN(t)) return false
  const diff = Math.abs(Date.now() - t) / 1000
  return diff <= skewSeconds
}
