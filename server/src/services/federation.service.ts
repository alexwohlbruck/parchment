/**
 * Federation Service
 *
 * Core federation infrastructure for cross-server communication.
 * Handles user resolution, message sending, and signature verification.
 *
 * Business logic for specific message types is delegated to domain services:
 * - Friend invitations → friends.service
 * - Location updates → location-e2ee.service
 * - Resource sharing → sharing.service
 */

import axios from 'axios'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../schema/users.schema'
import {
  parseHandle,
  verifySignature,
  MalformedSignatureInputError,
} from '../lib/crypto'
import {
  buildClientSignableV2,
  buildLegacySignableV1,
  canonicalJsonStringify,
  generateNonce,
  isTimestampFresh,
  type SignableEnvelopeV2,
} from '../lib/federation-canonical'
import {
  resolvePeerServer,
  signOutboundRequest,
} from './federation-auth.service'
import { origins } from '../config'
import { logger } from '../lib/logger'

// ============================================================================
// Types
// ============================================================================

export type FederationMessageType =
  | 'FRIEND_INVITE'
  | 'FRIEND_ACCEPT'
  | 'FRIEND_REJECT'
  | 'LOCATION_UPDATE'
  | 'LOCATION_REQUEST'
  | 'RESOURCE_SHARE'
  | 'RELATIONSHIP_REVOKE'

/**
 * v2 federation message envelope. All new messages MUST use this shape.
 * Legacy (no `protocol_version`) messages are accepted at the inbox for a
 * short transition window via the v1 verification path.
 */
export interface FederationMessage {
  protocol_version?: number
  message_type?: FederationMessageType
  message_version?: number
  nonce?: string
  timestamp: string
  from: string
  to: string
  signature: string
  payload?: Record<string, unknown>
  // Legacy v1 field (kept for compat during transition)
  type?: FederationMessageType
  // Legacy per-message-type fields (kept; v2 moves these into payload)
  encryptedLocation?: string
  encryptedNonce?: string
  nonceField?: string
  resourceType?: string
  resourceId?: string
  encryptedData?: string
}

export interface RemoteUserInfo {
  handle: string
  signingKey: string
  encryptionKey: string
  inbox: string
  name?: string
  picture?: string
}

// ============================================================================
// Server Identity
// ============================================================================

export function getServerDomain(): string {
  if (!origins.serverOrigin) {
    throw new Error('SERVER_ORIGIN environment variable is not set')
  }
  return origins.serverHostname
}

export function buildHandle(alias: string): string {
  return `${alias}@${getServerDomain()}`
}

export function isLocalHandle(handle: string): boolean {
  const parsed = parseHandle(handle)
  if (!parsed) return false
  return parsed.domain === getServerDomain()
}

// ============================================================================
// User Resolution
// ============================================================================

export async function resolveHandle(
  handle: string,
): Promise<RemoteUserInfo | null> {
  const parsed = parseHandle(handle)
  if (!parsed) return null

  if (isLocalHandle(handle)) {
    return resolveLocalUser(parsed.alias)
  } else {
    return resolveRemoteUser(parsed.alias, parsed.domain)
  }
}

export async function resolveLocalUser(
  alias: string,
): Promise<RemoteUserInfo | null> {
  const user = await db
    .select({
      alias: users.alias,
      signingKey: users.signingKey,
      encryptionKey: users.encryptionKey,
      firstName: users.firstName,
      lastName: users.lastName,
      picture: users.picture,
    })
    .from(users)
    .where(eq(users.alias, alias))
    .limit(1)

  if (!user[0] || !user[0].alias || !user[0].signingKey) {
    return null
  }

  const serverOrigin = origins.serverOrigin

  const nameParts = [user[0].firstName, user[0].lastName].filter(Boolean)
  const displayName = nameParts.length > 0 ? nameParts.join(' ') : undefined

  return {
    handle: buildHandle(user[0].alias),
    signingKey: user[0].signingKey,
    encryptionKey: user[0].encryptionKey || '',
    inbox: `${serverOrigin}/federation/inbox`,
    name: displayName,
    picture: user[0].picture || undefined,
  }
}

/**
 * Resolve a remote user via .well-known endpoint. Enforces HTTPS and triggers
 * a peer-server manifest resolve so the peer's identity key gets pinned (or
 * verified against an existing pin) before we trust anything it says.
 */
export async function resolveRemoteUser(
  alias: string,
  domain: string,
): Promise<RemoteUserInfo | null> {
  enforceHttpsDomain(domain)

  try {
    await resolvePeerServer(domain)
  } catch (err) {
    logger.warn(
      { domain, err: (err as Error).message },
      'Peer server manifest check failed; refusing to resolve remote user',
    )
    return null
  }

  try {
    const scheme = isLocalDevDomain(domain) ? 'http' : 'https'
    const url = `${scheme}://${domain}/.well-known/user/${alias}`
    const response = await axios.get<RemoteUserInfo>(url, {
      timeout: 10000,
      headers: {
        Accept: 'application/json',
        'User-Agent': `Parchment Federation/${
          process.env.npm_package_version || '1.0.0'
        }`,
      },
    })

    if (response.status === 200 && response.data) {
      return response.data
    }
    return null
  } catch (error) {
    logger.error(
      { err: error, alias, domain },
      'Failed to resolve remote user',
    )
    return null
  }
}

// ============================================================================
// Message Transport
// ============================================================================

/**
 * Send a federation message to a remote server. Automatically wraps outbound
 * messages with a server-level signature for S2S authentication.
 */
export async function sendFederationMessage(
  target: string,
  message: FederationMessage,
): Promise<boolean> {
  try {
    let inboxUrl: string
    let peerDomain: string

    if (target.startsWith('http://') || target.startsWith('https://')) {
      const targetHost = new URL(target).host
      if (target.startsWith('http://') && !isLocalDevDomain(targetHost)) {
        logger.error({ target }, 'Refusing to send federation message over HTTP')
        return false
      }
      inboxUrl = target
      peerDomain = targetHost
    } else {
      const userInfo = await resolveHandle(target)
      if (!userInfo) {
        logger.error({ target }, 'Failed to resolve handle for federation send')
        return false
      }
      inboxUrl = userInfo.inbox
      const inboxHost = new URL(inboxUrl).host
      if (inboxUrl.startsWith('http://') && !isLocalDevDomain(inboxHost)) {
        logger.error({ inboxUrl }, 'Refusing to send federation message over HTTP')
        return false
      }
      peerDomain = inboxHost
    }

    let peer
    try {
      peer = await resolvePeerServer(peerDomain)
    } catch (err) {
      logger.error(
        { peerDomain, err: (err as Error).message },
        'Peer server manifest check failed; aborting federation send',
      )
      return false
    }

    // Envelope policy: the client (caller) owns protocol_version, nonce, and
    // timestamp, because they are covered by the client's message signature.
    // We MUST NOT mutate any field a client signature binds to — doing so
    // silently invalidates the signature at the recipient. For v1 messages
    // that have no client-side nonce at all, we still produce a per-request
    // transport nonce for the server-wrapper signature only; that one is
    // separate from the message envelope.
    const envelopeNonce = message.nonce
    const envelopeTimestamp = message.timestamp
    if (!envelopeTimestamp) {
      // Callers must set timestamp; it's part of the v1 signed surface too.
      logger.error({ target }, 'Federation message missing timestamp')
      return false
    }

    // Canonicalize the body for transport. Both sender and receiver hash the
    // canonical form, so JSON key-ordering differences between hosts can't
    // break signature verification.
    const bodyJson = canonicalJsonStringify(message)
    const url = new URL(inboxUrl)

    // Server-wrapper nonce: tied to this HTTP request, independent of the
    // message envelope nonce. Reuse the envelope nonce if present so there's
    // one less thing to track; otherwise mint a fresh one.
    const transportNonce = envelopeNonce ?? generateNonce()

    const serverAuthHeaders = await signOutboundRequest({
      method: 'POST',
      path: url.pathname,
      bodyJson,
      peerServerId: peer.serverId,
      nonce: transportNonce,
      timestamp: envelopeTimestamp,
    })

    const response = await axios.post(inboxUrl, bodyJson, {
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `Parchment Federation/${
          process.env.npm_package_version || '1.0.0'
        }`,
        ...serverAuthHeaders,
      },
    })

    return response.status === 202 || response.status === 200
  } catch (error) {
    logger.error(
      { err: error, target },
      'Failed to send federation message',
    )
    return false
  }
}

// ============================================================================
// Message Processing
// ============================================================================

/**
 * Process an incoming federation message.
 *
 * S2S authentication (server signature + replay check) is handled by the
 * inbox controller BEFORE this function is called. Here we verify the
 * client-level (user) signature and dispatch to the appropriate domain
 * service.
 */
export async function processFederationMessage(
  message: FederationMessage,
): Promise<{ success: boolean; error?: string }> {
  const messageType = message.message_type ?? message.type
  if (!messageType || !message.from || !message.to || !message.signature) {
    return { success: false, error: 'Invalid message structure' }
  }

  if (!isLocalHandle(message.to)) {
    return { success: false, error: 'Recipient is not on this server' }
  }

  if (!isTimestampFresh(message.timestamp, 300)) {
    return { success: false, error: 'Message timestamp outside acceptable skew' }
  }

  const sender = await resolveHandle(message.from)
  if (!sender) {
    return { success: false, error: 'Could not resolve sender' }
  }

  let signableMessage: string
  if (message.protocol_version && message.protocol_version >= 2) {
    if (!message.nonce || !message.message_type) {
      return { success: false, error: 'v2 message missing nonce or message_type' }
    }
    const envelope: SignableEnvelopeV2 = {
      protocol_version: message.protocol_version,
      message_type: message.message_type,
      message_version: message.message_version ?? 1,
      from: message.from,
      to: message.to,
      nonce: message.nonce,
      timestamp: message.timestamp,
      payload: message.payload ?? {},
    }
    signableMessage = buildClientSignableV2(envelope)
  } else {
    // Legacy v1 verification path — retained for transition only.
    signableMessage = buildLegacySignableV1(messageType, {
      from: message.from,
      to: message.to,
      timestamp: message.timestamp,
      ...message.payload,
    })
  }

  let isValid = false
  try {
    isValid = verifySignature(
      signableMessage,
      message.signature,
      sender.signingKey,
    )
  } catch (err) {
    if (err instanceof MalformedSignatureInputError) {
      return {
        success: false,
        error: `Malformed signature input: ${(err as Error).message}`,
      }
    }
    throw err
  }

  if (!isValid) {
    return { success: false, error: 'Invalid signature' }
  }

  const parsed = parseHandle(message.to)
  if (!parsed) {
    return { success: false, error: 'Invalid recipient handle' }
  }

  // v2 puts domain-specific data in `payload`; v1 keeps legacy top-level fields.
  const payload = message.payload ?? {}
  const pick = (k: string): unknown =>
    payload[k] ?? (message as unknown as Record<string, unknown>)[k]

  switch (messageType) {
    case 'FRIEND_INVITE': {
      const { handleIncomingFriendInvite } = await import('./friends.service')
      return handleIncomingFriendInvite(
        message.from,
        message.to,
        sender,
        message.signature,
      )
    }
    case 'FRIEND_ACCEPT': {
      const { handleIncomingFriendAccept } = await import('./friends.service')
      return handleIncomingFriendAccept(message.from, message.to, sender)
    }
    case 'FRIEND_REJECT': {
      const { handleIncomingFriendReject } = await import('./friends.service')
      return handleIncomingFriendReject(message.from)
    }
    case 'RELATIONSHIP_REVOKE': {
      const { handleIncomingRelationshipRevoke } = await import(
        './friends.service'
      )
      return handleIncomingRelationshipRevoke(message.from, message.to)
    }
    case 'LOCATION_UPDATE': {
      const encryptedLocation = pick('encryptedLocation') as string | undefined
      const nonce = pick('nonce') as string | undefined
      if (!encryptedLocation || !nonce) {
        return { success: false, error: 'Missing encrypted location data' }
      }
      const { handleIncomingLocationUpdate } = await import(
        './location-e2ee.service'
      )
      return handleIncomingLocationUpdate(
        message.from,
        parsed.alias,
        encryptedLocation,
        nonce,
      )
    }
    case 'LOCATION_REQUEST': {
      const { handleIncomingLocationRequest } = await import(
        './location-e2ee.service'
      )
      return handleIncomingLocationRequest(message.from, parsed.alias)
    }
    case 'RESOURCE_SHARE': {
      const encryptedData = pick('encryptedData') as string | undefined
      const nonce = pick('nonce') as string | undefined
      const resourceType = pick('resourceType') as string | undefined
      const resourceId = pick('resourceId') as string | undefined
      if (!encryptedData || !nonce || !resourceType || !resourceId) {
        return { success: false, error: 'Missing resource data' }
      }
      const { handleIncomingResourceShare } = await import('./sharing.service')
      return handleIncomingResourceShare(
        message.from,
        parsed.alias,
        resourceType,
        resourceId,
        encryptedData,
        nonce,
        message.signature,
      )
    }
    default:
      return {
        success: false,
        error: `Unsupported message type: ${messageType}`,
      }
  }
}

function enforceHttpsDomain(domain: string): void {
  if (isLocalDevDomain(domain)) return
  if (domain.startsWith('http://')) {
    throw new Error('Federation requires HTTPS peers')
  }
}

function isLocalDevDomain(domain: string): boolean {
  if (process.env.NODE_ENV === 'production') return false
  const host = domain.replace(/:\d+$/, '').toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

export { isLocalDevDomain }
