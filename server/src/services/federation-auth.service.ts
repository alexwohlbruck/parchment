/**
 * Federation auth service
 *
 * Manages:
 * - Resolving peer servers' identity manifests (.well-known/parchment-server)
 * - Pinning peer server public keys on first successful interaction (TOFU)
 * - Verifying server-level Ed25519 signatures on inbound S2S requests
 * - Tracking per-sender nonces to reject replayed requests
 */

import axios from 'axios'
import { and, eq, lt } from 'drizzle-orm'
import { db } from '../db'
import {
  federatedServerKeys,
  federationNonces,
} from '../schema/federation.schema'
import { verifySignature, MalformedSignatureInputError } from '../lib/crypto'
import {
  buildServerSignableWrapper,
  hashBody,
  isTimestampFresh,
} from '../lib/federation-canonical'
import {
  signWithServerKey,
  supportsProtocolVersion,
  getProtocolVersion,
  type ServerManifest,
} from '../lib/server-identity'
import { logger } from '../lib/logger'

const MANIFEST_PATH = '/.well-known/parchment-server'
const NONCE_SKEW_SECONDS = 300
const NONCE_RETAIN_SECONDS = 600

function isLocalDevHost(host: string): boolean {
  if (process.env.NODE_ENV === 'production') return false
  const h = host.replace(/:\d+$/, '').toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '::1'
}

function federationScheme(host: string): 'http' | 'https' {
  return isLocalDevHost(host) ? 'http' : 'https'
}

export interface PeerServerInfo {
  serverId: string
  publicKey: string
  minimumProtocolVersion: number
  protocolVersions: number[]
  capabilities: string[]
}

/**
 * Fetch a peer server's published identity manifest and pin its key if unseen.
 * Throws on a pin mismatch.
 */
export async function resolvePeerServer(
  domain: string,
): Promise<PeerServerInfo> {
  enforceHttpsDomain(domain)
  const url = `${federationScheme(domain)}://${domain}${MANIFEST_PATH}`

  const response = await axios.get<ServerManifest>(url, {
    timeout: 10000,
    headers: { Accept: 'application/json' },
  })

  const manifest = response.data
  if (
    !manifest ||
    !manifest.server_id ||
    !manifest.public_key ||
    !Array.isArray(manifest.protocol_versions)
  ) {
    throw new Error(`Peer ${domain} returned a malformed server manifest`)
  }

  // Find a mutually supported protocol version.
  const shared = manifest.protocol_versions.filter(supportsProtocolVersion)
  if (shared.length === 0) {
    throw new Error(
      `No mutually supported protocol version with peer ${domain} ` +
        `(peer supports ${manifest.protocol_versions.join(',')}, ` +
        `we support ${getProtocolVersion()})`,
    )
  }

  await pinOrVerifyServerKey(manifest.server_id, manifest.public_key, manifest)

  return {
    serverId: manifest.server_id,
    publicKey: manifest.public_key,
    minimumProtocolVersion:
      manifest.minimum_protocol_version ??
      Math.min(...manifest.protocol_versions),
    protocolVersions: manifest.protocol_versions,
    capabilities: manifest.capabilities ?? [],
  }
}

/**
 * Pin a peer server's public key on first contact, or verify it matches the
 * existing pin. Refuses to silently accept a changed key.
 */
async function pinOrVerifyServerKey(
  serverId: string,
  publicKey: string,
  manifest: ServerManifest,
): Promise<void> {
  const existing = await db
    .select()
    .from(federatedServerKeys)
    .where(eq(federatedServerKeys.serverId, serverId))
    .limit(1)

  if (!existing[0]) {
    await db.insert(federatedServerKeys).values({
      serverId,
      publicKey,
      minimumProtocolVersion:
        manifest.minimum_protocol_version ??
        Math.min(...manifest.protocol_versions),
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    })
    logger.info({ serverId }, 'Pinned new peer server identity key (TOFU)')
    return
  }

  if (existing[0].publicKey !== publicKey) {
    logger.warn(
      { serverId, expected: existing[0].publicKey.slice(0, 12) + '...' },
      'Peer server identity key changed — rejecting. Out-of-band re-pin required.',
    )
    throw new Error(
      `Peer server ${serverId} presented a different identity key than the ` +
        `pinned value. Refusing to rotate automatically. Re-pin manually after ` +
        `verifying out of band.`,
    )
  }

  await db
    .update(federatedServerKeys)
    .set({ lastSeenAt: new Date() })
    .where(eq(federatedServerKeys.serverId, serverId))
}

/**
 * Compute a server-level signature over the outbound request envelope.
 * Returns headers the caller should attach.
 */
export async function signOutboundRequest(params: {
  method: string
  path: string
  bodyJson: string
  peerServerId: string
  nonce: string
  timestamp: string
}): Promise<Record<string, string>> {
  const senderServerId = getOurServerId()

  const canonical = buildServerSignableWrapper({
    method: params.method,
    path: params.path,
    body_hash: hashBody(params.bodyJson),
    nonce: params.nonce,
    timestamp: params.timestamp,
    peer_server_id: params.peerServerId,
    sender_server_id: senderServerId,
    protocol_version: getProtocolVersion(),
  })

  const signature = await signWithServerKey(canonical)
  return {
    'X-Parchment-Server-Id': senderServerId,
    'X-Parchment-Protocol-Version': String(getProtocolVersion()),
    'X-Parchment-Nonce': params.nonce,
    'X-Parchment-Timestamp': params.timestamp,
    'X-Parchment-Server-Signature': signature,
  }
}

/**
 * The current server's public ID — the hostname portion of SERVER_ORIGIN.
 * Mirrors federation.service.getServerDomain() but re-derived here to avoid
 * a circular import.
 */
export function getOurServerId(): string {
  const origin = process.env.SERVER_ORIGIN
  if (!origin) throw new Error('SERVER_ORIGIN not set')
  return origin.replace(/(^\w+:|^)\/\//, '')
}

/**
 * Verify a server-level signature on an inbound request. Returns the sender
 * server ID on success, throws on any failure (bad sig, replay, stale ts).
 */
export async function verifyInboundRequest(params: {
  method: string
  path: string
  bodyJson: string
  headers: Headers
}): Promise<{ senderServerId: string; protocolVersion: number }> {
  const senderServerId = params.headers.get('X-Parchment-Server-Id')
  const protocolVersionRaw = params.headers.get('X-Parchment-Protocol-Version')
  const nonce = params.headers.get('X-Parchment-Nonce')
  const timestamp = params.headers.get('X-Parchment-Timestamp')
  const signature = params.headers.get('X-Parchment-Server-Signature')

  if (!senderServerId || !protocolVersionRaw || !nonce || !timestamp || !signature) {
    throw new Error('Missing required federation auth headers')
  }

  const protocolVersion = Number.parseInt(protocolVersionRaw, 10)
  if (!Number.isFinite(protocolVersion) || !supportsProtocolVersion(protocolVersion)) {
    throw new Error(
      `Unsupported protocol version ${protocolVersionRaw} from ${senderServerId}`,
    )
  }

  if (!isTimestampFresh(timestamp, NONCE_SKEW_SECONDS)) {
    throw new Error(`Timestamp skew too large for ${senderServerId}`)
  }

  // Resolve peer (will pin-or-verify) and verify the signature BEFORE
  // recording the nonce. Otherwise an unauthenticated attacker spoofing
  // the sender_server_id could poison our per-sender nonce cache.
  const peer = await resolvePeerServer(extractDomain(senderServerId))
  if (peer.serverId !== senderServerId) {
    throw new Error(
      `Sender server id ${senderServerId} does not match peer manifest ${peer.serverId}`,
    )
  }

  const canonical = buildServerSignableWrapper({
    method: params.method,
    path: params.path,
    body_hash: hashBody(params.bodyJson),
    nonce,
    timestamp,
    peer_server_id: getOurServerId(),
    sender_server_id: senderServerId,
    protocol_version: protocolVersion,
  })

  let valid = false
  try {
    valid = verifySignature(canonical, signature, peer.publicKey)
  } catch (err) {
    if (err instanceof MalformedSignatureInputError) {
      throw new Error(`Malformed server signature from ${senderServerId}`)
    }
    throw err
  }

  if (!valid) {
    throw new Error(`Invalid server signature from ${senderServerId}`)
  }

  // Signature is valid → now record the nonce so a genuine replay of this
  // signed request is rejected. (Replays from unauthenticated senders are
  // rejected above at the signature step.)
  await assertNonceUnseen(senderServerId, nonce, new Date(timestamp))

  return { senderServerId, protocolVersion }
}

/**
 * Insert a (sender, nonce) row. If it already exists, reject as a replay.
 * Also opportunistically sweeps older-than-retain rows for the sender.
 */
async function assertNonceUnseen(
  senderServerId: string,
  nonce: string,
  messageTimestamp: Date,
): Promise<void> {
  try {
    await db.insert(federationNonces).values({
      senderServerId,
      nonce,
      timestamp: messageTimestamp,
      createdAt: new Date(),
    })
  } catch (err) {
    // Postgres unique-constraint violation == replay.
    const message = (err as Error).message || ''
    if (message.includes('federation_nonces_sender_nonce_uq')) {
      throw new Error(`Replay rejected: nonce seen from ${senderServerId}`)
    }
    throw err
  }

  // Opportunistic sweep.
  const cutoff = new Date(Date.now() - NONCE_RETAIN_SECONDS * 1000)
  await db
    .delete(federationNonces)
    .where(
      and(
        eq(federationNonces.senderServerId, senderServerId),
        lt(federationNonces.createdAt, cutoff),
      ),
    )
}

function enforceHttpsDomain(domain: string): void {
  if (isLocalDevHost(domain)) return
  if (domain.startsWith('http://')) {
    throw new Error('Federation requires HTTPS peers')
  }
}

function extractDomain(serverId: string): string {
  // serverId is already a hostname (e.g. "parchment.example.com" or "host:port")
  return serverId
}
