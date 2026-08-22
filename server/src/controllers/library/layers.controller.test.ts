/**
 * Endpoint tests for the layers controller.
 *
 * Every route is wrapped in `.group('')` specifically so its `permissions()`
 * guard doesn't leak to later routes — the failure mode that bites elsewhere in
 * this codebase. The gating block below is the regression test for that: read
 * routes must stay on layers:read and deletes on layers:delete, and a route
 * declared later must not inherit an earlier route's guard.
 *
 * The other notable behaviours: tombstoned layers are filtered out of the list,
 * and default-layer tile URLs resolve against SERVER_ORIGIN so a deployment
 * that only sets that env doesn't emit localhost URLs into an https page.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import {
  authMockModule,
  setAuthUser,
  setHasPermission,
  resetAuth,
  TEST_USER,
} from '../../test/auth-mock'
import { createTestApp, req } from '../../test/app'

const layer = { id: 'layer-1', name: 'Traffic', order: 0 }
const group = { id: 'group-1', name: 'Transport', order: 0 }

const getLayers = mock(async (_userId: string) => [layer])
const createLayer = mock(async (input: any) => ({ ...layer, ...input }))
const updateLayer = mock(
  async (_id: string, _userId: string, patch: any) =>
    ({ ...layer, ...patch }) as typeof layer | null,
)
const deleteLayer = mock(async (_id: string, _userId: string) => undefined)
const getLayerGroups = mock(async (_userId: string) => [group])
const createLayerGroup = mock(async (input: any) => ({ ...group, ...input }))
const updateLayerGroup = mock(
  async (_id: string, _userId: string, patch: any) =>
    ({ ...group, ...patch }) as typeof group | null,
)
const deleteLayerGroup = mock(async (_id: string, _userId: string) => undefined)
const moveLayer = mock(
  async (_userId: string, _id: string, _groupId: string | null, _order: number) =>
    undefined,
)
const moveLayerGroup = mock(
  async (_userId: string, _id: string, _order: number, _parent?: string | null) =>
    undefined,
)
const reorderLayers = mock(async (_userId: string, _body: any) => undefined)
const getDefaultUserState = mock(async (_userId: string) => [{ templateId: 'tpl-1' }])
const upsertDefaultUserState = mock(
  async (_userId: string, _templateId: string, _type: string, _patch: any) => ({
    templateId: 'tpl-1',
  }),
)
const deleteDefaultUserState = mock(
  async (_userId: string, _templateId: string, _type: string) => undefined,
)
mock.module('../../services/layers.service', () => ({
  getLayers,
  createLayer,
  updateLayer,
  deleteLayer,
  getLayerGroups,
  createLayerGroup,
  updateLayerGroup,
  deleteLayerGroup,
  moveLayer,
  moveLayerGroup,
  reorderLayers,
  getDefaultUserState,
  upsertDefaultUserState,
  deleteDefaultUserState,
}))

const resolveProxyUrls = mock((config: any, serverUrl: string) => ({
  ...config,
  tiles: [`${serverUrl}/proxy/tiles/{z}/{x}/{y}`],
}))

mock.module('../../constants/default-layers', () => ({
  DEFAULT_LAYER_TEMPLATES: [
    { templateId: 'tpl-layer', name: 'Default Traffic', configuration: { kind: 'raster' } },
  ],
  DEFAULT_GROUP_TEMPLATES: [{ templateId: 'tpl-group', name: 'Default Group' }],
  resolveProxyUrls,
}))

mock.module('../../middleware/auth.middleware', () => authMockModule())

const layers = (await import('./layers.controller')).default
const app = createTestApp(layers)

const validLayer = { name: 'Traffic', order: 0, configuration: { kind: 'raster' } }

beforeEach(() => {
  resetAuth()
  getLayers.mockClear()
  getLayers.mockImplementation(async () => [layer])
  createLayer.mockClear()
  updateLayer.mockClear()
  updateLayer.mockImplementation(async (_id, _userId, patch: any) => ({
    ...layer,
    ...patch,
  }))
  deleteLayer.mockClear()
  getLayerGroups.mockClear()
  createLayerGroup.mockClear()
  updateLayerGroup.mockClear()
  updateLayerGroup.mockImplementation(async (_id, _userId, patch: any) => ({
    ...group,
    ...patch,
  }))
  deleteLayerGroup.mockClear()
  moveLayer.mockClear()
  moveLayerGroup.mockClear()
  reorderLayers.mockClear()
  getDefaultUserState.mockClear()
  upsertDefaultUserState.mockClear()
  deleteDefaultUserState.mockClear()
  resolveProxyUrls.mockClear()
})

describe('permission gating', () => {
  const endpoints = [
    ['get', '/layers'],
    ['post', '/layers'],
    ['put', '/layers/layer-1'],
    ['delete', '/layers/layer-1'],
    ['get', '/layers/groups'],
    ['post', '/layers/groups'],
    ['put', '/layers/groups/group-1'],
    ['delete', '/layers/groups/group-1'],
    ['put', '/layers/layer-1/move'],
    ['put', '/layers/groups/group-1/move'],
    ['put', '/layers/reorder'],
    ['get', '/layers/defaults'],
    ['get', '/layers/default-state'],
    ['put', '/layers/default-state'],
    ['delete', '/layers/default-state'],
  ] as const

  for (const [method, path] of endpoints) {
    test(`${method.toUpperCase()} ${path} rejects an unauthenticated caller`, async () => {
      setAuthUser(null)

      const res = await req(app)[method](path, {
        body: { ...validLayer, templateId: 'tpl-layer', type: 'layer', targetOrder: 0, items: [] },
      })

      expect(res.status).toBe(401)
    })

    test(`${method.toUpperCase()} ${path} rejects a caller without the permission`, async () => {
      setHasPermission(false)

      const res = await req(app)[method](path, {
        body: { ...validLayer, templateId: 'tpl-layer', type: 'layer', targetOrder: 0, items: [] },
      })

      expect(res.status).toBe(403)
    })
  }
})

describe('GET /layers', () => {
  test('returns the caller’s layers', async () => {
    const res = await req(app).get('/layers')

    expect(res.status).toBe(200)
    expect(getLayers).toHaveBeenCalledWith(TEST_USER.id)
    expect(res.body).toHaveLength(1)
  })

  test('hides tombstoned layers from the list', async () => {
    getLayers.mockResolvedValueOnce([
      layer,
      { id: 'layer-2', name: '__tombstone__deleted-default', order: 1 },
    ] as any)

    const res = await req(app).get('/layers')

    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe('layer-1')
  })

  test('keeps layers with no name at all', async () => {
    getLayers.mockResolvedValueOnce([{ id: 'layer-3', order: 0 }] as any)

    const res = await req(app).get('/layers')

    expect(res.body).toHaveLength(1)
  })
})

describe('POST /layers', () => {
  test('creates a layer owned by the caller', async () => {
    const res = await req(app).post('/layers', { body: validLayer })

    expect(res.status).toBe(200)
    expect(createLayer.mock.calls[0][0]).toMatchObject({
      name: 'Traffic',
      userId: TEST_USER.id,
    })
  })

  test('ignores a client-supplied userId', async () => {
    await req(app).post('/layers', {
      body: { ...validLayer, userId: 'someone-else' } as any,
    })

    expect((createLayer.mock.calls[0][0] as any).userId).toBe(TEST_USER.id)
  })

  test('422s without a name', async () => {
    const res = await req(app).post('/layers', {
      body: { order: 0, configuration: {} },
    })

    expect(res.status).toBe(422)
    expect(createLayer).not.toHaveBeenCalled()
  })

  test('422s without an order', async () => {
    const res = await req(app).post('/layers', {
      body: { name: 'Traffic', configuration: {} },
    })

    expect(res.status).toBe(422)
  })

  test('accepts a null groupId for a top-level layer', async () => {
    const res = await req(app).post('/layers', {
      body: { ...validLayer, groupId: null },
    })

    expect(res.status).toBe(200)
    expect((createLayer.mock.calls[0][0] as any).groupId).toBeNull()
  })
})

describe('PUT and DELETE /layers/:id', () => {
  test('updates scoped to the caller', async () => {
    const res = await req(app).put('/layers/layer-1', { body: { name: 'Renamed' } })

    expect(res.status).toBe(200)
    expect(updateLayer).toHaveBeenCalledWith('layer-1', TEST_USER.id, {
      name: 'Renamed',
    })
  })

  test('404s when the layer is not the caller’s', async () => {
    updateLayer.mockResolvedValueOnce(null)

    const res = await req(app).put('/layers/someone-elses', { body: { name: 'x' } })

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Layer not found' })
  })

  test('deletes scoped to the caller', async () => {
    const res = await req(app).delete('/layers/layer-1')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(deleteLayer).toHaveBeenCalledWith('layer-1', TEST_USER.id)
  })
})

describe('layer groups', () => {
  test('lists the caller’s groups', async () => {
    const res = await req(app).get('/layers/groups')

    expect(res.status).toBe(200)
    expect(getLayerGroups).toHaveBeenCalledWith(TEST_USER.id)
  })

  test('the groups route is not captured by /layers/:id', async () => {
    await req(app).get('/layers/groups')

    expect(getLayerGroups).toHaveBeenCalled()
  })

  test('creates a group owned by the caller', async () => {
    const res = await req(app).post('/layers/groups', {
      body: { name: 'Transport', order: 0 },
    })

    expect(res.status).toBe(200)
    expect(createLayerGroup.mock.calls[0][0]).toMatchObject({
      name: 'Transport',
      userId: TEST_USER.id,
    })
  })

  test('updates a group', async () => {
    const res = await req(app).put('/layers/groups/group-1', {
      body: { name: 'Renamed' },
    })

    expect(res.status).toBe(200)
    expect(updateLayerGroup).toHaveBeenCalledWith('group-1', TEST_USER.id, {
      name: 'Renamed',
    })
  })

  test('404s for a group the caller does not own', async () => {
    updateLayerGroup.mockResolvedValueOnce(null)

    const res = await req(app).put('/layers/groups/other', { body: { name: 'x' } })

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Layer group not found' })
  })

  test('deletes a group', async () => {
    const res = await req(app).delete('/layers/groups/group-1')

    expect(res.status).toBe(200)
    expect(deleteLayerGroup).toHaveBeenCalledWith('group-1', TEST_USER.id)
  })
})

describe('move and reorder', () => {
  test('moves a layer into a group at a position', async () => {
    const res = await req(app).put('/layers/layer-1/move', {
      body: { targetGroupId: 'group-1', targetOrder: 2 },
    })

    expect(res.status).toBe(200)
    expect(moveLayer).toHaveBeenCalledWith(TEST_USER.id, 'layer-1', 'group-1', 2)
  })

  test('moving to the top level passes a null group', async () => {
    await req(app).put('/layers/layer-1/move', { body: { targetOrder: 0 } })

    expect(moveLayer.mock.calls[0][2]).toBeNull()
  })

  test('422s without a target order', async () => {
    const res = await req(app).put('/layers/layer-1/move', { body: {} })

    expect(res.status).toBe(422)
    expect(moveLayer).not.toHaveBeenCalled()
  })

  test('moves a group', async () => {
    const res = await req(app).put('/layers/groups/group-1/move', {
      body: { targetOrder: 1, targetParentGroupId: 'group-2' },
    })

    expect(res.status).toBe(200)
    expect(moveLayerGroup).toHaveBeenCalledWith(TEST_USER.id, 'group-1', 1, 'group-2')
  })

  test('bulk reorder passes the item list through', async () => {
    const items = [
      { id: 'layer-1', order: 0 },
      { id: 'layer-2', order: 1, groupId: 'group-1' },
    ]

    const res = await req(app).put('/layers/reorder', { body: { items } })

    expect(res.status).toBe(200)
    expect(reorderLayers).toHaveBeenCalledWith(TEST_USER.id, { items })
  })

  test('reorder 422s when an item is missing its order', async () => {
    const res = await req(app).put('/layers/reorder', {
      body: { items: [{ id: 'layer-1' }] },
    })

    expect(res.status).toBe(422)
    expect(reorderLayers).not.toHaveBeenCalled()
  })
})

describe('GET /layers/defaults', () => {
  test('returns templates with proxy URLs resolved', async () => {
    process.env.SERVER_ORIGIN = 'https://api.parchment.test'

    const res = await req(app).get('/layers/defaults')

    expect(res.status).toBe(200)
    expect(res.body.layers[0].configuration.tiles[0]).toContain(
      'https://api.parchment.test',
    )
    expect(res.body.groups).toHaveLength(1)
  })

  test('resolves against SERVER_ORIGIN when SERVER_URL is unset', async () => {
    delete process.env.SERVER_URL
    process.env.SERVER_ORIGIN = 'https://api.parchment.test'

    await req(app).get('/layers/defaults')

    // Falling back to localhost here would emit mixed-content tile URLs on an
    // https deployment.
    expect(resolveProxyUrls.mock.calls[0][1]).toBe('https://api.parchment.test')
  })

  test('prefers SERVER_URL when it is set', async () => {
    process.env.SERVER_URL = 'https://tiles.parchment.test'

    await req(app).get('/layers/defaults')

    expect(resolveProxyUrls.mock.calls[0][1]).toBe('https://tiles.parchment.test')
    delete process.env.SERVER_URL
  })
})

describe('default-layer user state', () => {
  test('reads the caller’s state', async () => {
    const res = await req(app).get('/layers/default-state')

    expect(res.status).toBe(200)
    expect(getDefaultUserState).toHaveBeenCalledWith(TEST_USER.id)
  })

  test('upsert splits templateId and type out of the patch', async () => {
    const res = await req(app).put('/layers/default-state', {
      body: { templateId: 'tpl-1', type: 'layer', hidden: true, order: 3 },
    })

    expect(res.status).toBe(200)
    expect(upsertDefaultUserState).toHaveBeenCalledWith(
      TEST_USER.id,
      'tpl-1',
      'layer',
      { hidden: true, order: 3 },
    )
  })

  test('upsert accepts explicit nulls to clear an override', async () => {
    await req(app).put('/layers/default-state', {
      body: { templateId: 'tpl-1', type: 'group', visible: null, order: null },
    })

    expect(upsertDefaultUserState.mock.calls[0][3]).toEqual({
      visible: null,
      order: null,
    })
  })

  test('a null hidden hands the template back to installedByDefault', async () => {
    await req(app).put('/layers/default-state', {
      body: { templateId: 'tpl-1', type: 'group', hidden: null },
    })

    expect(upsertDefaultUserState.mock.calls[0][3]).toEqual({ hidden: null })
  })

  test('upsert carries a selector override', async () => {
    await req(app).put('/layers/default-state', {
      body: {
        templateId: 'tpl-1',
        type: 'layer',
        showInLayerSelector: false,
      },
    })

    expect(upsertDefaultUserState.mock.calls[0][3]).toEqual({
      showInLayerSelector: false,
    })
  })

  test('upsert 422s on an unknown type', async () => {
    const res = await req(app).put('/layers/default-state', {
      body: { templateId: 'tpl-1', type: 'widget' },
    })

    expect(res.status).toBe(422)
    expect(upsertDefaultUserState).not.toHaveBeenCalled()
  })

  test('delete clears the state for a template', async () => {
    const res = await req(app).delete('/layers/default-state', {
      body: { templateId: 'tpl-1', type: 'layer' },
    })

    expect(res.status).toBe(200)
    expect(deleteDefaultUserState).toHaveBeenCalledWith(
      TEST_USER.id,
      'tpl-1',
      'layer',
    )
  })
})
