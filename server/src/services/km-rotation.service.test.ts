/**
 * Unit tests for master-key rotation commits.
 *
 * Two guarantees matter: two devices rotating at once can't both win, and a
 * commit can never leave a record sealed under the discarded seed. Both
 * abort inside the transaction, so a throw means nothing was written.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createDbMock } from '../test/db-mock'

const dbMock = createDbMock()
mock.module('../db', () => ({ db: dbMock.db }))

const {
  getUserKmVersion,
  commitRotation,
  RotationConflict,
  RotationIncomplete,
  RotationBlocked,
} = await import('./km-rotation.service')

const baseParams = {
  userId: 'user-1',
  expectedCurrent: 3,
  signingKey: 'new-signing-key',
  encryptionKey: 'new-encryption-key',
  recoveryKeyConfirmed: true,
}

/** Queue the inventory selects in the order commitRotation reads them. */
function inventory(rows: {
  blobs?: unknown[]
  collections?: unknown[]
  points?: unknown[]
  routes?: unknown[]
  canvases?: unknown[]
  outgoing?: unknown[]
  incoming?: unknown[]
  pins?: unknown[]
} = {}) {
  dbMock.queueSelect(rows.blobs ?? [])
  dbMock.queueSelect(rows.collections ?? [])
  const hasPrivate = (rows.collections ?? []).some(
    (c: any) => c.scheme === 'user-e2ee',
  )
  if (hasPrivate) dbMock.queueSelect(rows.points ?? [])
  dbMock.queueSelect(rows.routes ?? [])
  dbMock.queueSelect(rows.canvases ?? [])
  if (hasPrivate) dbMock.queueSelect(rows.outgoing ?? [])
  dbMock.queueSelect(rows.incoming ?? [])
  dbMock.queueSelect(rows.pins ?? [])
}

function casWins() {
  dbMock.queueReturning([{ id: 'user-1' }])
}

beforeEach(() => {
  dbMock.reset()
})

describe('getUserKmVersion', () => {
  test('returns the stored version', async () => {
    dbMock.queueSelect([{ kmVersion: 7 }])

    expect(await getUserKmVersion('user-1')).toBe(7)
  })

  test('returns null when the user does not exist', async () => {
    dbMock.queueSelect([])

    expect(await getUserKmVersion('ghost')).toBeNull()
  })
})

describe('commitRotation — CAS gate', () => {
  test('rejects a stale expectedCurrent', async () => {
    dbMock.queueReturning([])
    dbMock.queueSelect([{ id: 'user-1' }])

    await expect(commitRotation({ ...baseParams })).rejects.toBeInstanceOf(
      RotationConflict,
    )
  })

  test('advances only when the stored version matches', async () => {
    casWins()
    inventory()

    expect(await commitRotation({ ...baseParams })).toBe(4)
    expect(dbMock.updated[0]).toMatchObject({
      signingKey: 'new-signing-key',
      encryptionKey: 'new-encryption-key',
      kmVersion: 4,
    })
  })

  test('throws when the user row is gone', async () => {
    dbMock.queueReturning([])
    dbMock.queueSelect([])

    await expect(commitRotation({ ...baseParams })).rejects.toThrow(
      'User not found',
    )
  })
})

describe('commitRotation — unlock path', () => {
  test('refuses when nothing could unlock the new keys', async () => {
    await expect(
      commitRotation({ ...baseParams, recoveryKeyConfirmed: false }),
    ).rejects.toBeInstanceOf(RotationBlocked)
    expect(dbMock.updateCount).toBe(0)
  })

  test('a re-sealed passkey slot is enough', async () => {
    casWins()
    inventory()

    await expect(
      commitRotation({
        ...baseParams,
        recoveryKeyConfirmed: false,
        slots: [{ credentialId: 'c1', wrappedKm: 'w', slotSignature: 's' }],
      }),
    ).resolves.toBe(4)
  })

  test('deletes slots that were not re-sealed', async () => {
    casWins()
    inventory()

    await commitRotation({
      ...baseParams,
      slots: [{ credentialId: 'c1', wrappedKm: 'w', slotSignature: 's' }],
    })

    expect(dbMock.deleteCount).toBe(1)
  })
})

describe('commitRotation — coverage', () => {
  test('refuses when a stored blob was not re-encrypted', async () => {
    casWins()
    inventory({ blobs: [{ blobType: 'settings' }, { blobType: 'frequents' }] })

    const error = await commitRotation({
      ...baseParams,
      blobs: [{ blobType: 'settings', encryptedBlob: 'c' }],
    }).catch((e) => e)

    expect(error).toBeInstanceOf(RotationIncomplete)
    expect(error.missing).toEqual(['blob frequents'])
  })

  test('refuses when a route or canvas is left under the old seed', async () => {
    casWins()
    inventory({
      routes: [{ id: 'r1', metadataEncrypted: 'm', bodyEncrypted: 'b' }],
      canvases: [{ id: 'cv1', metadataEncrypted: 'm', bodyEncrypted: null }],
    })

    const error = await commitRotation({
      ...baseParams,
      routes: [{ id: 'r1', metadataEncrypted: 'm2' }],
    }).catch((e) => e)

    expect(error.missing).toEqual(['route r1', 'canvas cv1'])
  })

  test('refuses when a private collection point is missing', async () => {
    casWins()
    inventory({
      collections: [{ id: 'col-1', scheme: 'user-e2ee', metadataEncrypted: 'm' }],
      points: [
        { id: 'pt-1', collectionId: 'col-1' },
        { id: 'pt-2', collectionId: 'col-1' },
      ],
    })

    const error = await commitRotation({
      ...baseParams,
      collections: [
        {
          id: 'col-1',
          metadataEncrypted: 'm2',
          points: [{ id: 'pt-1', encryptedData: 'p1' }],
        },
      ],
    }).catch((e) => e)

    expect(error.missing).toEqual(['point pt-2'])
  })

  test('refuses while a private collection is shared with another server', async () => {
    casWins()
    inventory({
      collections: [{ id: 'col-1', scheme: 'user-e2ee', metadataEncrypted: null }],
      outgoing: [
        { id: 's1', recipientUserId: null, recipientHandle: 'bob@elsewhere.test' },
      ],
    })

    const error = await commitRotation({ ...baseParams }).catch((e) => e)

    expect(error).toBeInstanceOf(RotationBlocked)
    expect(error.message).toContain('bob@elsewhere.test')
  })

  test('requires every local share envelope to be re-sealed', async () => {
    casWins()
    inventory({
      collections: [{ id: 'col-1', scheme: 'user-e2ee', metadataEncrypted: null }],
      outgoing: [{ id: 's1', recipientUserId: 'u2', recipientHandle: 'u2@here' }],
      incoming: [{ id: 'in-1' }],
    })

    const error = await commitRotation({ ...baseParams }).catch((e) => e)

    expect(error.missing).toEqual(['share s1', 'incoming share in-1'])
  })

  test('requires stored friend pins to be re-encrypted', async () => {
    casWins()
    inventory({ pins: [{ friendHandle: 'bob@here' }] })

    const error = await commitRotation({ ...baseParams }).catch((e) => e)

    expect(error.missing).toEqual(['friend pin bob@here'])
  })
})

describe('commitRotation — writes', () => {
  test('upserts every blob at the new version', async () => {
    casWins()
    inventory({ blobs: [{ blobType: 'settings' }] })

    await commitRotation({
      ...baseParams,
      blobs: [{ blobType: 'settings', encryptedBlob: 'cipher-1' }],
    })

    expect(dbMock.inserted[0]).toMatchObject({
      blobType: 'settings',
      encryptedBlob: 'cipher-1',
      kmVersion: 4,
    })
    expect(dbMock.conflictUpdates[0]).toMatchObject({ kmVersion: 4 })
  })

  test('writes collections, points, routes and canvases', async () => {
    casWins()
    inventory()

    await commitRotation({
      ...baseParams,
      collections: [
        {
          id: 'col-1',
          metadataEncrypted: 'meta',
          points: [{ id: 'pt-1', encryptedData: 'p1' }],
        },
      ],
      routes: [{ id: 'r1', metadataEncrypted: 'rm', bodyEncrypted: 'rb' }],
      canvases: [{ id: 'cv1', metadataEncrypted: 'cm' }],
    })

    expect(dbMock.updated.slice(1)).toMatchObject([
      { metadataEncrypted: 'meta' },
      { encryptedData: 'p1' },
      { metadataEncrypted: 'rm', bodyEncrypted: 'rb' },
      { metadataEncrypted: 'cm' },
    ])
    expect(dbMock.updated[4]).not.toHaveProperty('bodyEncrypted')
  })

  test('mirrors a re-sealed share envelope onto the recipient row', async () => {
    casWins()
    inventory()
    dbMock.queueReturning([
      { recipientUserId: 'u2', resourceType: 'collection', resourceId: 'col-1' },
    ])

    await commitRotation({
      ...baseParams,
      shares: [{ id: 's1', encryptedData: 'env', nonce: 'n' }],
    })

    expect(dbMock.updated.slice(1)).toEqual([
      { encryptedData: 'env', nonce: 'n' },
      { encryptedData: 'env', nonce: 'n' },
    ])
  })

  test('runs everything inside one transaction', async () => {
    let usedTransaction = false
    const realTransaction = dbMock.db.transaction
    dbMock.db.transaction = async (fn: any) => {
      usedTransaction = true
      return realTransaction(fn)
    }
    casWins()
    inventory()

    try {
      await commitRotation({ ...baseParams })
    } finally {
      dbMock.db.transaction = realTransaction
    }

    expect(usedTransaction).toBe(true)
  })
})
