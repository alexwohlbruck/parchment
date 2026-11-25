/**
 * DB-backed tests for time-limited location shares: once a share's expiry
 * passes, the server neither serves nor holds that friend's location.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../schema/users.schema'
import { friendships } from '../schema/friendships.schema'
import { encryptedLocations, locationSharingConfig } from '../schema/location.schema'
import { generateId } from '../util'
import { buildHandle } from './federation.service'
import {
  getEncryptedLocationsFromFriends,
  getLocationSharingConfigs,
  setLocationSharingConfig,
  sweepExpiredShares,
} from './location-e2ee.service'

const RUN_SUFFIX = Math.random().toString(36).slice(2, 8)
const sharerId = generateId()
const viewerId = generateId()
const sharerAlias = `expsharer${RUN_SUFFIX}`
const viewerAlias = `expviewer${RUN_SUFFIX}`
const viewerHandle = () => buildHandle(viewerAlias)

const now = new Date()
const hourFromNow = new Date(now.getTime() + 60 * 60_000)
const hourAgo = new Date(now.getTime() - 60 * 60_000)

async function shareWith(expiresAt: Date | null) {
  await db
    .delete(locationSharingConfig)
    .where(eq(locationSharingConfig.userId, sharerId))
  await db.insert(locationSharingConfig).values({
    id: generateId(),
    userId: sharerId,
    friendHandle: viewerHandle(),
    expiresAt,
  })
}

beforeAll(async () => {
  await db.insert(users).values([
    { id: sharerId, email: `${sharerAlias}@parchment.test`, alias: sharerAlias },
    { id: viewerId, email: `${viewerAlias}@parchment.test`, alias: viewerAlias },
  ])
  await db.insert(friendships).values([
    { id: generateId(), userId: sharerId, friendHandle: viewerHandle() },
    { id: generateId(), userId: viewerId, friendHandle: buildHandle(sharerAlias) },
  ])
})

beforeEach(async () => {
  await db.delete(encryptedLocations).where(eq(encryptedLocations.userId, sharerId))
  await db.insert(encryptedLocations).values({
    id: generateId(),
    userId: sharerId,
    forFriendHandle: viewerHandle(),
    encryptedLocation: 'cipher',
    nonce: now.toISOString(),
  })
})

afterAll(async () => {
  await db.delete(users).where(inArray(users.id, [sharerId, viewerId]))
})

describe('time-limited location shares', () => {
  test('a share before its expiry is served to the friend', async () => {
    await shareWith(hourFromNow)

    expect(await getLocationSharingConfigs(sharerId)).toHaveLength(1)
    const locations = await getEncryptedLocationsFromFriends(viewerId)
    expect(locations.map((l) => l.senderHandle)).toEqual([buildHandle(sharerAlias)])
  })

  test('an expired share is hidden from both sides even before the sweep', async () => {
    await shareWith(hourAgo)

    expect(await getLocationSharingConfigs(sharerId)).toEqual([])
    expect(await getEncryptedLocationsFromFriends(viewerId)).toEqual([])
  })

  test('the sweep removes an expired share and the location held for it', async () => {
    await shareWith(hourAgo)

    expect(await sweepExpiredShares()).toBeGreaterThanOrEqual(1)

    const configs = await db
      .select()
      .from(locationSharingConfig)
      .where(eq(locationSharingConfig.userId, sharerId))
    const held = await db
      .select()
      .from(encryptedLocations)
      .where(
        and(
          eq(encryptedLocations.userId, sharerId),
          eq(encryptedLocations.forFriendHandle, viewerHandle()),
        ),
      )
    expect(configs).toEqual([])
    expect(held).toEqual([])
  })

  test('the sweep leaves open-ended and unexpired shares alone', async () => {
    await shareWith(null)
    await sweepExpiredShares()
    expect(await getLocationSharingConfigs(sharerId)).toHaveLength(1)

    await shareWith(hourFromNow)
    await sweepExpiredShares()
    expect(await getLocationSharingConfigs(sharerId)).toHaveLength(1)
  })

  test('sharing again replaces the old expiry', async () => {
    await shareWith(hourAgo)

    await setLocationSharingConfig(sharerId, viewerHandle(), {
      enabled: true,
      expiresAt: null,
    })

    const [config] = await getLocationSharingConfigs(sharerId)
    expect(config.expiresAt).toBeNull()
  })
})
