/**
 * Unit tests for the layers service.
 *
 * The tricky parts are all about the split between *default templates* (which
 * live in code, not the database) and *user-owned rows*:
 *
 *   - `upsertDefaultUserState` must only overwrite fields the caller actually
 *     passed, using `in` rather than a nullish check, so clearing an override
 *     with `null` is distinguishable from omitting it;
 *   - an insert leaves every unmentioned column NULL, `hidden` included — a
 *     row written to record an order must not read back as "user added this",
 *     which is what a non-NULL `hidden` means;
 *   - bulk reorder silently skips `default:` ids — those are not rows and must
 *     go through the state endpoints instead.
 *
 * Group deletion also has to null out `groupId` on member layers by hand: the
 * foreign key was dropped in migration 0027, so nothing else prevents orphans.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createDbMock } from '../test/db-mock'

const dbMock = createDbMock()
mock.module('../db', () => ({ db: dbMock.db }))
mock.module('../util', () => ({ generateId: () => 'generated-id' }))

const {
  getLayers,
  getLayerById,
  createLayer,
  updateLayer,
  deleteLayer,
  getLayerGroups,
  deleteLayerGroup,
  getDefaultUserState,
  upsertDefaultUserState,
  deleteDefaultUserState,
  moveLayer,
  moveLayerGroup,
  reorderLayers,
} = await import('./layers.service')

beforeEach(() => {
  dbMock.reset()
})

describe('user-owned layers', () => {
  test('getLayers scopes to the user', async () => {
    dbMock.queueSelect([{ id: 'layer-1' }])

    expect(await getLayers('user-1')).toHaveLength(1)
  })

  test('getLayerById returns undefined when not the caller’s', async () => {
    dbMock.queueSelect([])

    expect(await getLayerById('layer-1', 'other')).toBeUndefined()
  })

  test('createLayer stamps an id and the owner', async () => {
    dbMock.setReturningRows([{ id: 'generated-id' }])

    await createLayer({ userId: 'user-1', name: 'Custom', order: 0 } as any)

    expect(dbMock.inserted[0]).toMatchObject({
      id: 'generated-id',
      userId: 'user-1',
      name: 'Custom',
    })
  })

  test('updateLayer stamps updatedAt', async () => {
    dbMock.setReturningRows([{ id: 'layer-1' }])

    await updateLayer('layer-1', 'user-1', { name: 'Renamed' } as any)

    expect((dbMock.updated[0] as any).updatedAt).toBeInstanceOf(Date)
  })

  test('deleteLayer issues a scoped delete', async () => {
    await deleteLayer('layer-1', 'user-1')

    expect(dbMock.deleteCount).toBe(1)
  })

  test('getLayerGroups scopes to the user', async () => {
    dbMock.queueSelect([{ id: 'group-1' }])

    expect(await getLayerGroups('user-1')).toHaveLength(1)
  })
})

describe('deleteLayerGroup', () => {
  test('detaches member layers before deleting the group', async () => {
    dbMock.queueSelect([]) // no descendants

    await deleteLayerGroup('group-1', 'user-1')

    // Nothing enforces this at the DB level since migration 0027 dropped the FK.
    expect(dbMock.updated[0]).toMatchObject({ groupId: null })
    expect(dbMock.deleteCount).toBe(1)
  })

  test('recurses into nested groups', async () => {
    dbMock.queueSelect([{ id: 'child-1' }]) // children of group-1
    dbMock.queueSelect([{ id: 'grandchild-1' }]) // children of child-1
    dbMock.queueSelect([]) // children of grandchild-1

    await deleteLayerGroup('group-1', 'user-1')

    // Three groups deleted, three detach updates.
    expect(dbMock.deleteCount).toBe(3)
    expect(dbMock.updateCount).toBe(3)
  })

  test('runs the cascade in one transaction', async () => {
    let usedTransaction = false
    const realTransaction = dbMock.db.transaction
    dbMock.db.transaction = async (fn: any) => {
      usedTransaction = true
      return realTransaction(fn)
    }
    dbMock.queueSelect([])

    try {
      await deleteLayerGroup('group-1', 'user-1')
    } finally {
      dbMock.db.transaction = realTransaction
    }

    expect(usedTransaction).toBe(true)
  })
})

describe('upsertDefaultUserState', () => {
  test('inserts a full row with defaults for unset fields', async () => {
    dbMock.setReturningRows([{ templateId: 'default:layer:traffic' }])

    await upsertDefaultUserState('user-1', 'default:layer:traffic', 'layer', {
      visible: true,
    })

    expect(dbMock.inserted[0]).toMatchObject({
      userId: 'user-1',
      templateId: 'default:layer:traffic',
      type: 'layer',
      hidden: null,
      visible: true,
      order: null,
      showInLayerSelector: null,
    })
  })

  test('the conflict set only touches fields the caller passed', async () => {
    dbMock.setReturningRows([{}])

    await upsertDefaultUserState('user-1', 'default:layer:traffic', 'layer', {
      visible: true,
    })

    const set = dbMock.conflictUpdates[0] as any
    expect(set.visible).toBe(true)
    expect('order' in set).toBe(false)
    expect('hidden' in set).toBe(false)
  })

  test('an explicit null clears an override', async () => {
    dbMock.setReturningRows([{}])

    await upsertDefaultUserState('user-1', 'default:layer:traffic', 'layer', {
      order: null,
    })

    const set = dbMock.conflictUpdates[0] as any
    expect('order' in set).toBe(true)
    expect(set.order).toBeNull()
  })

  test('hidden is only written when explicitly passed', async () => {
    dbMock.setReturningRows([{}])

    await upsertDefaultUserState('user-1', 'default:layer:traffic', 'layer', {
      hidden: true,
    })

    expect((dbMock.conflictUpdates[0] as any).hidden).toBe(true)
  })

  test('adding a removed template back writes hidden: false', async () => {
    dbMock.setReturningRows([{}])

    await upsertDefaultUserState('user-1', 'default:group:terrain', 'group', {
      hidden: false,
    })

    expect((dbMock.conflictUpdates[0] as any).hidden).toBe(false)
  })

  test('carries a selector override through to the conflict set', async () => {
    dbMock.setReturningRows([{}])

    await upsertDefaultUserState('user-1', 'default:layer:traffic', 'layer', {
      showInLayerSelector: false,
    })

    expect((dbMock.conflictUpdates[0] as any).showInLayerSelector).toBe(false)
  })

  test('always bumps updatedAt', async () => {
    dbMock.setReturningRows([{}])

    await upsertDefaultUserState('user-1', 'default:layer:traffic', 'layer', {})

    expect((dbMock.conflictUpdates[0] as any).updatedAt).toBeInstanceOf(Date)
  })
})

describe('default state teardown', () => {
  test('getDefaultUserState scopes to the user', async () => {
    dbMock.queueSelect([{ templateId: 'default:layer:traffic' }])

    expect(await getDefaultUserState('user-1')).toHaveLength(1)
  })

  test('deleteDefaultUserState removes one template row', async () => {
    await deleteDefaultUserState('user-1', 'default:layer:traffic', 'layer')

    expect(dbMock.deleteCount).toBe(1)
  })
})

describe('moveLayer', () => {
  test('writes the new order and group', async () => {
    dbMock.queueSelect([{ id: 'layer-1', userId: 'user-1' }])

    await moveLayer('user-1', 'layer-1', 'group-2', 4)

    expect(dbMock.updated[0]).toMatchObject({ order: 4, groupId: 'group-2' })
  })

  test('moving to the top level writes a null group', async () => {
    dbMock.queueSelect([{ id: 'layer-1' }])

    await moveLayer('user-1', 'layer-1', null, 0)

    expect((dbMock.updated[0] as any).groupId).toBeNull()
  })

  test('throws for a layer the caller does not own', async () => {
    dbMock.queueSelect([])

    await expect(moveLayer('user-1', 'other', null, 0)).rejects.toThrow(
      'Layer not found',
    )
    expect(dbMock.updateCount).toBe(0)
  })
})

describe('moveLayerGroup', () => {
  test('writes the new order', async () => {
    await moveLayerGroup('user-1', 'group-1', 2)

    expect((dbMock.updated[0] as any).order).toBe(2)
  })

  test('omits parentGroupId when it was not supplied', async () => {
    await moveLayerGroup('user-1', 'group-1', 2)

    expect('parentGroupId' in (dbMock.updated[0] as any)).toBe(false)
  })

  test('an explicit null reparents to the top level', async () => {
    await moveLayerGroup('user-1', 'group-1', 2, null)

    expect('parentGroupId' in (dbMock.updated[0] as any)).toBe(true)
    expect((dbMock.updated[0] as any).parentGroupId).toBeNull()
  })

  test('a new parent is written through', async () => {
    await moveLayerGroup('user-1', 'group-1', 2, 'group-parent')

    expect((dbMock.updated[0] as any).parentGroupId).toBe('group-parent')
  })
})

describe('reorderLayers', () => {
  test('skips template ids entirely', async () => {
    // They are not rows; reordering defaults goes through the state endpoints.
    await reorderLayers('user-1', {
      items: [{ id: 'default:bicycle-routes', order: 1 }],
    } as any)

    expect(dbMock.selectCount).toBe(0)
    expect(dbMock.updateCount).toBe(0)
  })

  test('updates a group row when the id matches a group', async () => {
    dbMock.queueSelect([{ id: 'group-1' }])

    await reorderLayers('user-1', {
      items: [{ id: 'group-1', order: 5 }],
    } as any)

    expect(dbMock.updated[0]).toMatchObject({ order: 5 })
    expect('groupId' in (dbMock.updated[0] as any)).toBe(false)
  })

  test('updates a layer row when the id is not a group', async () => {
    dbMock.queueSelect([])

    await reorderLayers('user-1', {
      items: [{ id: 'layer-1', order: 2, groupId: 'group-1' }],
    } as any)

    expect(dbMock.updated[0]).toMatchObject({ order: 2, groupId: 'group-1' })
  })

  test('a layer with no group is moved to the top level', async () => {
    dbMock.queueSelect([])

    await reorderLayers('user-1', {
      items: [{ id: 'layer-1', order: 2 }],
    } as any)

    expect((dbMock.updated[0] as any).groupId).toBeNull()
  })

  test('processes a mixed batch', async () => {
    dbMock.queueSelect([{ id: 'group-1' }]) // group-1 is a group
    dbMock.queueSelect([]) // layer-1 is not

    await reorderLayers('user-1', {
      items: [
        { id: 'default:skipped', order: 0 },
        { id: 'group-1', order: 1 },
        { id: 'layer-1', order: 2 },
      ],
    } as any)

    expect(dbMock.updateCount).toBe(2)
  })
})
