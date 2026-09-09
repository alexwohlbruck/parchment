/**
 * Unit tests for personal-blob storage.
 *
 * The server treats these as opaque envelopes, so the contract is narrow but
 * strict: reads and writes are always keyed on (userId, blobType), a PUT fully
 * replaces rather than merges, and the type listing used by the rotation
 * orchestrator must never include ciphertext.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createDbMock } from '../test/db-mock'

const dbMock = createDbMock()
mock.module('../db', () => ({ db: dbMock.db }))

const {
  getPersonalBlob,
  putPersonalBlob,
  deletePersonalBlob,
  listPersonalBlobTypes,
  getPersonalBlobsByTypePrefix,
} = await import('./personal-blob.service')

const storedRow = {
  userId: 'user-1',
  blobType: 'settings',
  encryptedBlob: 'cipher',
  nonce: 'nonce',
  kmVersion: 2,
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

beforeEach(() => {
  dbMock.reset()
})

describe('getPersonalBlob', () => {
  test('returns the stored envelope', async () => {
    dbMock.queueSelect([storedRow])

    expect(await getPersonalBlob('user-1', 'settings')).toEqual({
      encryptedBlob: 'cipher',
      nonce: 'nonce',
      kmVersion: 2,
      updatedAt: storedRow.updatedAt,
    })
  })

  test('returns null for an empty slot', async () => {
    dbMock.queueSelect([])

    expect(await getPersonalBlob('user-1', 'settings')).toBeNull()
  })

  test('projects only envelope fields, not the raw row', async () => {
    dbMock.queueSelect([{ ...storedRow, secretColumn: 'leak' }])

    const blob = await getPersonalBlob('user-1', 'settings')

    expect(Object.keys(blob!).sort()).toEqual([
      'encryptedBlob',
      'kmVersion',
      'nonce',
      'updatedAt',
    ])
  })
})

describe('putPersonalBlob', () => {
  const value = { encryptedBlob: 'new-cipher', nonce: 'new-nonce', kmVersion: 3 }

  test('writes the envelope keyed by user and type', async () => {
    await putPersonalBlob('user-1', 'settings', value)

    expect(dbMock.inserted[0]).toMatchObject({
      userId: 'user-1',
      blobType: 'settings',
      encryptedBlob: 'new-cipher',
      nonce: 'new-nonce',
      kmVersion: 3,
    })
  })

  test('replaces an existing envelope wholesale on conflict', async () => {
    // Each PUT fully overwrites — merging is the client's job.
    await putPersonalBlob('user-1', 'settings', value)

    expect(dbMock.conflictUpdates[0]).toMatchObject({
      encryptedBlob: 'new-cipher',
      nonce: 'new-nonce',
      kmVersion: 3,
    })
  })

  test('stamps updatedAt on both the insert and the conflict path', async () => {
    await putPersonalBlob('user-1', 'settings', value)

    expect((dbMock.inserted[0] as any).updatedAt).toBeInstanceOf(Date)
    expect((dbMock.conflictUpdates[0] as any).updatedAt).toBeInstanceOf(Date)
  })

  test('does not carry a userId from the value payload', async () => {
    await putPersonalBlob('user-1', 'settings', {
      ...value,
      userId: 'someone-else',
    } as any)

    expect((dbMock.inserted[0] as any).userId).toBe('user-1')
  })
})

describe('deletePersonalBlob', () => {
  test('issues a delete', async () => {
    await deletePersonalBlob('user-1', 'settings')

    expect(dbMock.deleteCount).toBe(1)
  })

  test('is a no-op-shaped call when nothing matches', async () => {
    await expect(
      deletePersonalBlob('user-1', 'never-stored'),
    ).resolves.toBeUndefined()
  })
})

describe('listPersonalBlobTypes', () => {
  test('returns types with their key versions', async () => {
    dbMock.queueSelect([
      { blobType: 'settings', kmVersion: 2 },
      { blobType: 'frequents', kmVersion: 2 },
    ])

    expect(await listPersonalBlobTypes('user-1')).toEqual([
      { blobType: 'settings', kmVersion: 2 },
      { blobType: 'frequents', kmVersion: 2 },
    ])
  })

  test('returns an empty list for a user with no blobs', async () => {
    dbMock.queueSelect([])

    expect(await listPersonalBlobTypes('user-1')).toEqual([])
  })
})

describe('getPersonalBlobsByTypePrefix', () => {
  test('returns matching envelopes with their ciphertext', async () => {
    dbMock.queueSelect([
      {
        blobType: 'integration-config:dawarich',
        encryptedBlob: 'cipher-1',
        nonce: 'n1',
        kmVersion: 2,
      },
    ])

    const rows = await getPersonalBlobsByTypePrefix(
      'user-1',
      'integration-config:',
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].encryptedBlob).toBe('cipher-1')
  })

  test('returns an empty list when nothing matches the prefix', async () => {
    dbMock.queueSelect([])

    expect(
      await getPersonalBlobsByTypePrefix('user-1', 'integration-config:'),
    ).toEqual([])
  })
})
