/**
 * Unit tests for master-key rotation commits.
 *
 * The CAS check is the whole point: two devices rotating concurrently must not
 * both win, because the loser's public keys would overwrite the winner's while
 * the winner's re-encrypted data stayed. So the tests assert that a stale
 * `expectedCurrent` throws BEFORE anything is written — not merely that it
 * throws — and that every write carries the new key version.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createDbMock } from '../test/db-mock'

const dbMock = createDbMock()
mock.module('../db', () => ({ db: dbMock.db }))

const { getUserKmVersion, commitRotation, RotationConflict } = await import(
  './km-rotation.service'
)

const baseParams = {
  userId: 'user-1',
  expectedCurrent: 3,
  signingKey: 'new-signing-key',
  encryptionKey: 'new-encryption-key',
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

  test('returns version 0 rather than treating it as missing', async () => {
    dbMock.queueSelect([{ kmVersion: 0 }])

    expect(await getUserKmVersion('user-1')).toBe(0)
  })
})

describe('commitRotation — CAS gate', () => {
  test('rejects a stale expectedCurrent', async () => {
    dbMock.queueSelect([{ kmVersion: 5 }])

    await expect(commitRotation({ ...baseParams })).rejects.toBeInstanceOf(
      RotationConflict,
    )
  })

  test('writes nothing when the CAS check fails', async () => {
    dbMock.queueSelect([{ kmVersion: 5 }])

    await commitRotation({
      ...baseParams,
      blobs: [{ blobType: 'settings', encryptedBlob: 'cipher' }],
      slots: [{ credentialId: 'c1', wrappedKm: 'w', slotSignature: 's' }],
    }).catch(() => {})

    expect(dbMock.updateCount).toBe(0)
    expect(dbMock.insertCount).toBe(0)
  })

  test('the conflict names the cause so the client can re-stage', async () => {
    dbMock.queueSelect([{ kmVersion: 5 }])

    const error = await commitRotation({ ...baseParams }).catch((e) => e)

    expect(error.name).toBe('RotationConflict')
    expect(error.message).toContain('another device rotated first')
    expect(error.message).toContain('Nothing was written')
  })

  test('throws when the user row is gone', async () => {
    dbMock.queueSelect([])

    await expect(commitRotation({ ...baseParams })).rejects.toThrow(
      'User not found',
    )
  })

  test('proceeds when the version matches exactly', async () => {
    dbMock.queueSelect([{ kmVersion: 3 }])

    expect(await commitRotation({ ...baseParams })).toBe(4)
  })

  test('accepts rotation from version 0', async () => {
    dbMock.queueSelect([{ kmVersion: 0 }])

    expect(
      await commitRotation({ ...baseParams, expectedCurrent: 0 }),
    ).toBe(1)
  })
})

describe('commitRotation — writes', () => {
  beforeEach(() => {
    dbMock.queueSelect([{ kmVersion: 3 }])
  })

  test('advances the key version by exactly one', async () => {
    await commitRotation({ ...baseParams })

    expect((dbMock.updated[0] as any).kmVersion).toBe(4)
  })

  test('stores both new public keys', async () => {
    await commitRotation({ ...baseParams })

    expect(dbMock.updated[0]).toMatchObject({
      signingKey: 'new-signing-key',
      encryptionKey: 'new-encryption-key',
    })
  })

  test('upserts every rebuilt personal blob at the new version', async () => {
    await commitRotation({
      ...baseParams,
      blobs: [
        { blobType: 'settings', encryptedBlob: 'cipher-1' },
        { blobType: 'frequents', encryptedBlob: 'cipher-2' },
      ],
    })

    expect(dbMock.inserted).toHaveLength(2)
    expect(dbMock.inserted[0]).toMatchObject({
      userId: 'user-1',
      blobType: 'settings',
      encryptedBlob: 'cipher-1',
      kmVersion: 4,
    })
  })

  test('the blob conflict path also records the new version', async () => {
    await commitRotation({
      ...baseParams,
      blobs: [{ blobType: 'settings', encryptedBlob: 'cipher-1' }],
    })

    expect(dbMock.conflictUpdates[0]).toMatchObject({
      encryptedBlob: 'cipher-1',
      kmVersion: 4,
    })
  })

  test('updates each collection metadata envelope', async () => {
    await commitRotation({
      ...baseParams,
      collections: [
        { id: 'col-1', metadataEncrypted: 'meta-1' },
        { id: 'col-2', metadataEncrypted: 'meta-2' },
      ],
    })

    // One update for the user row plus one per collection.
    expect(dbMock.updateCount).toBe(3)
    expect(dbMock.updated[1]).toMatchObject({ metadataEncrypted: 'meta-1' })
  })

  test('upserts every re-sealed wrapped-key slot', async () => {
    await commitRotation({
      ...baseParams,
      slots: [
        { credentialId: 'cred-1', wrappedKm: 'w1', slotSignature: 'sig-1' },
      ],
    })

    expect(dbMock.inserted[0]).toMatchObject({
      userId: 'user-1',
      credentialId: 'cred-1',
      wrappedKm: 'w1',
      slotSignature: 'sig-1',
    })
  })

  test('defaults the wrap algorithm on slots', async () => {
    await commitRotation({
      ...baseParams,
      slots: [
        { credentialId: 'cred-1', wrappedKm: 'w1', slotSignature: 'sig-1' },
      ],
    })

    expect((dbMock.inserted[0] as any).wrapAlgo).toBe('aes-256-gcm-prf-v1')
    expect((dbMock.conflictUpdates[0] as any).wrapAlgo).toBe(
      'aes-256-gcm-prf-v1',
    )
  })

  test('honours an explicit wrap algorithm', async () => {
    await commitRotation({
      ...baseParams,
      slots: [
        {
          credentialId: 'cred-1',
          wrappedKm: 'w1',
          slotSignature: 'sig-1',
          wrapAlgo: 'xchacha20-poly1305-v2',
        },
      ],
    })

    expect((dbMock.inserted[0] as any).wrapAlgo).toBe('xchacha20-poly1305-v2')
  })

  test('handles a rotation carrying no payload at all', async () => {
    const next = await commitRotation({ ...baseParams })

    expect(next).toBe(4)
    expect(dbMock.insertCount).toBe(0)
    expect(dbMock.updateCount).toBe(1)
  })

  test('applies blobs, collections and slots together', async () => {
    await commitRotation({
      ...baseParams,
      blobs: [{ blobType: 'settings', encryptedBlob: 'cipher' }],
      collections: [{ id: 'col-1', metadataEncrypted: 'meta' }],
      slots: [{ credentialId: 'c1', wrappedKm: 'w', slotSignature: 's' }],
    })

    expect(dbMock.insertCount).toBe(2)
    expect(dbMock.updateCount).toBe(2)
  })

  test('runs everything inside one transaction', async () => {
    // A mid-write failure has to roll the whole rotation back — a partially
    // rotated account can't decrypt its own data.
    let usedTransaction = false
    const realTransaction = dbMock.db.transaction
    dbMock.db.transaction = async (fn: any) => {
      usedTransaction = true
      return realTransaction(fn)
    }

    try {
      await commitRotation({ ...baseParams })
    } finally {
      dbMock.db.transaction = realTransaction
    }

    expect(usedTransaction).toBe(true)
  })
})
