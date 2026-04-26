/**
 * Location E2EE Service
 *
 * Handles encrypted location sharing with friends via federation handles.
 * All location data is end-to-end encrypted - the server only stores ciphertext.
 */

import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import {
  locationSharingConfig,
  encryptedLocations,
  LocationSharingConfig,
  NewLocationSharingConfig,
  EncryptedLocation,
  NewEncryptedLocation,
} from '../schema/location.schema'
import { friendships } from '../schema/friendships.schema'
import { generateId } from '../util'
import { sendFederationMessage } from './federation.service'

// ============================================================================
// Location Sharing Configuration
// ============================================================================

/**
 * Get all location sharing configs for a user
 */
export async function getLocationSharingConfigs(
  userId: string,
): Promise<LocationSharingConfig[]> {
  return await db
    .select()
    .from(locationSharingConfig)
    .where(eq(locationSharingConfig.userId, userId))
}

/**
 * Get location sharing config for a specific friend
 */
export async function getLocationSharingConfigForFriend(
  userId: string,
  friendHandle: string,
): Promise<LocationSharingConfig | null> {
  const [config] = await db
    .select()
    .from(locationSharingConfig)
    .where(
      and(
        eq(locationSharingConfig.userId, userId),
        eq(locationSharingConfig.friendHandle, friendHandle),
      ),
    )
    .limit(1)

  return config || null
}

/**
 * Enable or update location sharing with a friend
 */
export async function setLocationSharingConfig(
  userId: string,
  friendHandle: string,
  config: {
    enabled?: boolean
    refreshInterval?: number
    expiresAt?: Date | null
  },
): Promise<LocationSharingConfig> {
  // Check if config exists
  const existing = await getLocationSharingConfigForFriend(userId, friendHandle)

  if (existing) {
    // Update existing
    const [updated] = await db
      .update(locationSharingConfig)
      .set({
        enabled: config.enabled ?? existing.enabled,
        refreshInterval: config.refreshInterval ?? existing.refreshInterval,
        expiresAt:
          config.expiresAt !== undefined
            ? config.expiresAt
            : existing.expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(locationSharingConfig.id, existing.id))
      .returning()

    return updated
  }

  // Create new
  const newConfig: NewLocationSharingConfig = {
    id: generateId(),
    userId,
    friendHandle,
    enabled: config.enabled ?? true,
    refreshInterval: config.refreshInterval ?? 60,
    expiresAt: config.expiresAt ?? null,
  }

  const [created] = await db
    .insert(locationSharingConfig)
    .values(newConfig)
    .returning()

  return created
}

/**
 * Disable location sharing with a friend
 */
export async function disableLocationSharing(
  userId: string,
  friendHandle: string,
): Promise<boolean> {
  const result = await db
    .delete(locationSharingConfig)
    .where(
      and(
        eq(locationSharingConfig.userId, userId),
        eq(locationSharingConfig.friendHandle, friendHandle),
      ),
    )
    .returning()

  // Also delete cached encrypted location
  await db
    .delete(encryptedLocations)
    .where(
      and(
        eq(encryptedLocations.userId, userId),
        eq(encryptedLocations.forFriendHandle, friendHandle),
      ),
    )

  return result.length > 0
}

/**
 * Get list of friends who share their location with a user
 */
export async function getFriendsWhoShareWithMe(
  userId: string,
): Promise<string[]> {
  // Get all friends
  const userFriends = await db
    .select({ friendHandle: friendships.friendHandle })
    .from(friendships)
    .where(eq(friendships.userId, userId))

  return userFriends.map((f) => f.friendHandle)
}

// ============================================================================
// Encrypted Location Cache (for live sharing)
// ============================================================================

/**
 * Store encrypted location for a friend
 * Called when user broadcasts their location
 */
export async function storeEncryptedLocation(
  userId: string,
  forFriendHandle: string,
  encryptedLocation: string,
  nonce: string,
): Promise<EncryptedLocation> {
  // Upsert
  const existing = await db
    .select()
    .from(encryptedLocations)
    .where(
      and(
        eq(encryptedLocations.userId, userId),
        eq(encryptedLocations.forFriendHandle, forFriendHandle),
      ),
    )
    .limit(1)

  if (existing.length > 0) {
    const [updated] = await db
      .update(encryptedLocations)
      .set({
        encryptedLocation,
        nonce,
        updatedAt: new Date(),
      })
      .where(eq(encryptedLocations.id, existing[0].id))
      .returning()

    return updated
  }

  const newLocation: NewEncryptedLocation = {
    id: generateId(),
    userId,
    forFriendHandle,
    encryptedLocation,
    nonce,
  }

  const [created] = await db
    .insert(encryptedLocations)
    .values(newLocation)
    .returning()

  return created
}

/**
 * Get encrypted location that a user has stored for a specific friend
 * (Used when friend requests location)
 */
export async function getEncryptedLocationForFriend(
  userId: string,
  forFriendHandle: string,
): Promise<EncryptedLocation | null> {
  const [location] = await db
    .select()
    .from(encryptedLocations)
    .where(
      and(
        eq(encryptedLocations.userId, userId),
        eq(encryptedLocations.forFriendHandle, forFriendHandle),
      ),
    )
    .limit(1)

  return location || null
}

/**
 * Result type for friend locations with sender info
 */
export interface FriendEncryptedLocation extends EncryptedLocation {
  senderHandle: string | null
}

/**
 * Get all encrypted locations stored by friends for a user
 * (Used to display friends on map)
 */
export async function getEncryptedLocationsFromFriends(
  userId: string,
): Promise<FriendEncryptedLocation[]> {
  // First get the user's handle
  const { users } = await import('../schema/users.schema')
  const [user] = await db
    .select({ alias: users.alias })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user?.alias) {
    return []
  }

  const { buildHandle } = await import('./federation.service')
  const userHandle = buildHandle(user.alias)

  // Get encrypted locations where the user is the recipient, joined with sender info
  const results = await db
    .select({
      id: encryptedLocations.id,
      userId: encryptedLocations.userId,
      forFriendHandle: encryptedLocations.forFriendHandle,
      encryptedLocation: encryptedLocations.encryptedLocation,
      nonce: encryptedLocations.nonce,
      updatedAt: encryptedLocations.updatedAt,
      senderAlias: users.alias,
    })
    .from(encryptedLocations)
    .leftJoin(users, eq(users.id, encryptedLocations.userId))
    .where(eq(encryptedLocations.forFriendHandle, userHandle))

  // Convert to include full sender handle
  return results.map((r) => ({
    id: r.id,
    userId: r.userId,
    forFriendHandle: r.forFriendHandle,
    encryptedLocation: r.encryptedLocation,
    nonce: r.nonce,
    updatedAt: r.updatedAt,
    senderHandle: r.senderAlias ? buildHandle(r.senderAlias) : null,
  }))
}

// ============================================================================
// Federation helpers
// ============================================================================

/**
 * Send location update to a friend's server
 */
export async function sendLocationUpdateToFriend(
  fromHandle: string,
  toHandle: string,
  encryptedLocation: string,
  nonce: string,
  signature: string,
): Promise<boolean> {
  try {
    await sendFederationMessage(toHandle, {
      type: 'LOCATION_UPDATE',
      from: fromHandle,
      to: toHandle,
      encryptedLocation,
      nonce,
      timestamp: new Date().toISOString(),
      signature,
    })
    return true
  } catch (error) {
    console.error('Failed to send location update:', error)
    return false
  }
}

/**
 * Request fresh location from a friend's server
 */
export async function requestLocationFromFriend(
  fromHandle: string,
  toHandle: string,
  signature: string,
): Promise<boolean> {
  try {
    await sendFederationMessage(toHandle, {
      type: 'LOCATION_REQUEST',
      from: fromHandle,
      to: toHandle,
      timestamp: new Date().toISOString(),
      signature,
    })
    return true
  } catch (error) {
    console.error('Failed to request location:', error)
    return false
  }
}

// ============================================================================
// Federation Handlers - Called by federation.service when receiving messages
// ============================================================================

/**
 * Handle incoming location update from a remote friend
 */
export async function handleIncomingLocationUpdate(
  senderHandle: string,
  recipientAlias: string,
  encryptedLocation: string,
  nonce: string,
): Promise<{ success: boolean; error?: string }> {
  const { getLocalUserIdByAlias } = await import('./user.service')
  const { isFriend } = await import('./friends.service')

  const localUserId = await getLocalUserIdByAlias(recipientAlias)
  if (!localUserId) {
    return { success: false, error: 'Recipient not found' }
  }

  const areFriends = await isFriend(localUserId, senderHandle)
  if (!areFriends) {
    return { success: false, error: 'Not a friend' }
  }

  await storeEncryptedLocation(
    localUserId,
    senderHandle,
    encryptedLocation,
    nonce,
  )
  return { success: true }
}

/**
 * Handle incoming location request from a remote friend
 */
export async function handleIncomingLocationRequest(
  senderHandle: string,
  recipientAlias: string,
): Promise<{ success: boolean; error?: string }> {
  const { getLocalUserIdByAlias } = await import('./user.service')

  const localUserId = await getLocalUserIdByAlias(recipientAlias)
  if (!localUserId) {
    return { success: false, error: 'User not found' }
  }

  const config = await getLocationSharingConfigForFriend(
    localUserId,
    senderHandle,
  )
  if (!config || !config.enabled) {
    return { success: false, error: 'Location sharing not enabled' }
  }

  // Note: The actual location response happens via client polling, not server push
  return { success: true }
}
