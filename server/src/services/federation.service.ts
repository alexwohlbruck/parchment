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
  buildSignableMessage,
} from '../lib/crypto'
import { origins } from '../config'

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

export interface FederationMessage {
  type: FederationMessageType
  from: string // Full handle
  to: string // Full handle
  timestamp: string
  signature: string
  payload?: Record<string, unknown>
  // Location-specific fields
  encryptedLocation?: string
  nonce?: string
  // Resource sharing fields
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

/**
 * Get the current server's domain (hostname without protocol)
 */
export function getServerDomain(): string {
  const serverOrigin = origins.serverOrigin
  if (!serverOrigin) {
    throw new Error('SERVER_ORIGIN environment variable is not set')
  }
  return origins.serverHostname
}

/**
 * Build a full handle for a local user
 */
export function buildHandle(alias: string): string {
  return `${alias}@${getServerDomain()}`
}

/**
 * Check if a handle belongs to this server
 */
export function isLocalHandle(handle: string): boolean {
  const parsed = parseHandle(handle)
  if (!parsed) return false
  return parsed.domain === getServerDomain()
}

// ============================================================================
// User Resolution
// ============================================================================

/**
 * Resolve a user by their handle (local or remote)
 */
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

/**
 * Resolve a local user by alias
 */
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

  // Build display name from first/last name
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
 * Resolve a remote user via .well-known endpoint
 */
export async function resolveRemoteUser(
  alias: string,
  domain: string,
): Promise<RemoteUserInfo | null> {
  try {
    const url = `https://${domain}/.well-known/user/${alias}`
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
    console.error(`Failed to resolve remote user ${alias}@${domain}:`, error)
    return null
  }
}

// ============================================================================
// Message Transport
// ============================================================================

/**
 * Send a federation message to a remote server
 * @param target - Either an inbox URL or a user handle to resolve
 * @param message - The federation message to send
 */
export async function sendFederationMessage(
  target: string,
  message: FederationMessage,
): Promise<boolean> {
  try {
    // Determine inbox URL
    let inboxUrl: string
    if (target.startsWith('http://') || target.startsWith('https://')) {
      inboxUrl = target
    } else {
      // It's a handle, resolve it
      const userInfo = await resolveHandle(target)
      if (!userInfo) {
        console.error(`Failed to resolve handle ${target}`)
        return false
      }
      inboxUrl = userInfo.inbox
    }

    const response = await axios.post(inboxUrl, message, {
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `Parchment Federation/${
          process.env.npm_package_version || '1.0.0'
        }`,
      },
    })

    return response.status === 202 || response.status === 200
  } catch (error) {
    console.error(`Failed to send federation message to ${target}:`, error)
    return false
  }
}

// ============================================================================
// Message Processing
// ============================================================================

/**
 * Process an incoming federation message
 * Validates the message, verifies signature, then delegates to appropriate service
 */
export async function processFederationMessage(
  message: FederationMessage,
): Promise<{ success: boolean; error?: string }> {
  // Validate message structure
  if (!message.type || !message.from || !message.to || !message.signature) {
    return { success: false, error: 'Invalid message structure' }
  }

  // Check recipient is local
  if (!isLocalHandle(message.to)) {
    return { success: false, error: 'Recipient is not on this server' }
  }

  // Resolve sender to get their public key
  const sender = await resolveHandle(message.from)
  if (!sender) {
    return { success: false, error: 'Could not resolve sender' }
  }

  // Verify signature
  const signableMessage = buildSignableMessage(message.type, {
    from: message.from,
    to: message.to,
    timestamp: message.timestamp,
    ...message.payload,
  })

  const isValid = verifySignature(
    signableMessage,
    message.signature,
    sender.signingKey,
  )
  if (!isValid) {
    return { success: false, error: 'Invalid signature' }
  }

  // Parse recipient alias
  const parsed = parseHandle(message.to)
  if (!parsed) {
    return { success: false, error: 'Invalid recipient handle' }
  }

  // Delegate to appropriate domain service based on message type
  switch (message.type) {
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
    case 'LOCATION_UPDATE': {
      if (!message.encryptedLocation || !message.nonce) {
        return { success: false, error: 'Missing encrypted location data' }
      }
      const { handleIncomingLocationUpdate } = await import(
        './location-e2ee.service'
      )
      return handleIncomingLocationUpdate(
        message.from,
        parsed.alias,
        message.encryptedLocation,
        message.nonce,
      )
    }
    case 'LOCATION_REQUEST': {
      const { handleIncomingLocationRequest } = await import(
        './location-e2ee.service'
      )
      return handleIncomingLocationRequest(message.from, parsed.alias)
    }
    case 'RESOURCE_SHARE': {
      if (
        !message.encryptedData ||
        !message.nonce ||
        !message.resourceType ||
        !message.resourceId
      ) {
        return { success: false, error: 'Missing resource data' }
      }
      const { handleIncomingResourceShare } = await import('./sharing.service')
      return handleIncomingResourceShare(
        message.from,
        parsed.alias,
        message.resourceType,
        message.resourceId,
        message.encryptedData,
        message.nonce,
        message.signature,
      )
    }
    default:
      return { success: false, error: 'Unknown message type' }
  }
}
