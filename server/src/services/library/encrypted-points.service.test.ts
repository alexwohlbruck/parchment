/**
 * Unit tests for encrypted points.
 *
 * Encrypted points only belong in `user-e2ee` collections — writing one into a
 * server-key collection would leave ciphertext the server has no key for and
 * that the normal bookmark reads would never surface. So both the read and the
 * create path re-check the scheme rather than trusting the caller.
 *
 * Realtime emission is also asserted per operation: a create/update/delete
 * that silently skips its broadcast leaves other devices showing stale points.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createDbMock } from '../../test/db-mock'

const dbMock = createDbMock()
mock.module('../../db', () => ({ db: dbMock.db }))
mock.module('../../util', () => ({ generateId: () => 'new-point-id' }))

const emitCollection = mock(async (..._args: unknown[]) => undefined)
mock.module('../realtime/emit', () => ({
  emit: { collection: emitCollection },
}))

const {
  getEncryptedPointsInCollection,
  getEncryptedPointById,
  createEncryptedPoint,
  updateEncryptedPoint,
  deleteEncryptedPoint,
  deleteAllEncryptedPointsInCollection,
} = await import('./encrypted-points.service')

const e2eeCollection = { id: 'col-1', userId: 'user-1', scheme: 'user-e2ee' }
const serverKeyCollection = { id: 'col-1', userId: 'user-1', scheme: 'server-key' }
const point = {
  id: 'pt-1',
  collectionId: 'col-1',
  userId: 'user-1',
  encryptedData: 'cipher',
  nonce: 'nonce',
}

beforeEach(() => {
  dbMock.reset()
  emitCollection.mockClear()
})

describe('getEncryptedPointsInCollection', () => {
  test('returns the points for an e2ee collection', async () => {
    dbMock.queueSelect([e2eeCollection])
    dbMock.queueSelect([point])

    expect(await getEncryptedPointsInCollection('col-1', 'user-1')).toHaveLength(1)
  })

  test('returns empty when the collection is not the caller’s', async () => {
    dbMock.queueSelect([])

    expect(await getEncryptedPointsInCollection('col-1', 'other')).toEqual([])
  })

  test('returns empty for a server-key collection', async () => {
    dbMock.queueSelect([serverKeyCollection])

    expect(await getEncryptedPointsInCollection('col-1', 'user-1')).toEqual([])
    // The point query is never issued.
    expect(dbMock.selectCount).toBe(1)
  })
})

describe('getEncryptedPointById', () => {
  test('returns the point', async () => {
    dbMock.queueSelect([point])

    expect((await getEncryptedPointById('pt-1', 'user-1'))!.id).toBe('pt-1')
  })

  test('returns null when it is not the caller’s', async () => {
    dbMock.queueSelect([])

    expect(await getEncryptedPointById('pt-1', 'other')).toBeNull()
  })
})

describe('createEncryptedPoint', () => {
  const params = {
    collectionId: 'col-1',
    userId: 'user-1',
    encryptedData: 'cipher',
    nonce: 'nonce',
  }

  test('creates the point in an e2ee collection', async () => {
    dbMock.queueSelect([e2eeCollection])
    dbMock.setReturningRows([point])

    const created = await createEncryptedPoint(params)

    expect(created.id).toBe('pt-1')
    expect(dbMock.inserted[0]).toMatchObject({
      id: 'new-point-id',
      collectionId: 'col-1',
      userId: 'user-1',
      encryptedData: 'cipher',
    })
  })

  test('keeps the id the client sealed the envelope with', async () => {
    dbMock.queueSelect([e2eeCollection])
    dbMock.setReturningRows([point])

    await createEncryptedPoint({ ...params, id: 'client-point-id' })

    expect(dbMock.inserted[0]).toMatchObject({ id: 'client-point-id' })
  })

  test('throws when the collection is not the caller’s', async () => {
    dbMock.queueSelect([])

    await expect(createEncryptedPoint(params)).rejects.toThrow(
      'Collection not found',
    )
    expect(dbMock.insertCount).toBe(0)
  })

  test('refuses a server-key collection', async () => {
    dbMock.queueSelect([serverKeyCollection])

    await expect(createEncryptedPoint(params)).rejects.toThrow(
      'not user-e2ee',
    )
    expect(dbMock.insertCount).toBe(0)
  })

  test('broadcasts the new point to the collection', async () => {
    dbMock.queueSelect([e2eeCollection])
    dbMock.setReturningRows([point])

    await createEncryptedPoint(params)

    expect(emitCollection).toHaveBeenCalledWith(
      'encrypted-point:created',
      point,
      'col-1',
    )
  })
})

describe('updateEncryptedPoint', () => {
  test('writes the new envelope and stamps updatedAt', async () => {
    dbMock.setReturningRows([point])

    await updateEncryptedPoint('pt-1', 'user-1', 'new-cipher', 'new-nonce')

    expect(dbMock.updated[0]).toMatchObject({
      encryptedData: 'new-cipher',
      nonce: 'new-nonce',
    })
    expect((dbMock.updated[0] as any).updatedAt).toBeInstanceOf(Date)
  })

  test('returns null when nothing matched', async () => {
    dbMock.setReturningRows([])

    expect(
      await updateEncryptedPoint('pt-1', 'other', 'c', 'n'),
    ).toBeNull()
  })

  test('broadcasts on success', async () => {
    dbMock.setReturningRows([point])

    await updateEncryptedPoint('pt-1', 'user-1', 'c', 'n')

    expect(emitCollection).toHaveBeenCalledWith(
      'encrypted-point:updated',
      point,
      'col-1',
    )
  })

  test('does not broadcast when nothing matched', async () => {
    dbMock.setReturningRows([])

    await updateEncryptedPoint('pt-1', 'other', 'c', 'n')

    expect(emitCollection).not.toHaveBeenCalled()
  })
})

describe('deleteEncryptedPoint', () => {
  test('reports true and broadcasts the removal', async () => {
    dbMock.setReturningRows([point])

    expect(await deleteEncryptedPoint('pt-1', 'user-1')).toBe(true)
    expect(emitCollection).toHaveBeenCalledWith(
      'encrypted-point:deleted',
      { id: 'pt-1', collectionId: 'col-1' },
      'col-1',
    )
  })

  test('broadcasts only ids, never the ciphertext', async () => {
    dbMock.setReturningRows([point])

    await deleteEncryptedPoint('pt-1', 'user-1')

    const payload = emitCollection.mock.calls[0][1] as any
    expect(Object.keys(payload).sort()).toEqual(['collectionId', 'id'])
  })

  test('reports false and stays quiet when nothing matched', async () => {
    dbMock.setReturningRows([])

    expect(await deleteEncryptedPoint('pt-1', 'other')).toBe(false)
    expect(emitCollection).not.toHaveBeenCalled()
  })
})

describe('deleteAllEncryptedPointsInCollection', () => {
  test('returns the number of rows removed', async () => {
    dbMock.setReturningRows([point, { ...point, id: 'pt-2' }])

    expect(
      await deleteAllEncryptedPointsInCollection('col-1', 'user-1'),
    ).toBe(2)
  })

  test('returns zero when nothing matched', async () => {
    dbMock.setReturningRows([])

    expect(
      await deleteAllEncryptedPointsInCollection('col-1', 'other'),
    ).toBe(0)
  })
})
