/**
 * Endpoint tests for the canvases controller.
 *
 * Every route is owner-scoped: the service takes the caller's id alongside the
 * canvas id, and a miss is reported as 404 rather than 403 so the endpoint
 * can't be used to probe which canvas ids exist.
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

const canvasRow = {
  id: 'canvas-1',
  userId: TEST_USER.id,
  scheme: 'server-key',
  body: { layers: [] },
}

const getCanvases = mock(async (_userId: string) => [canvasRow])
const createCanvas = mock(async (input: any) => ({ ...canvasRow, ...input }))
const getCanvasById = mock(
  async (_id: string, _userId: string) => canvasRow as typeof canvasRow | null,
)
const updateCanvas = mock(
  async (_id: string, _userId: string, patch: any) =>
    ({ ...canvasRow, ...patch }) as typeof canvasRow | null,
)
const deleteCanvas = mock(async (_id: string, _userId: string) => true)

mock.module('../../services/library/canvases.service', () => ({
  getCanvases,
  createCanvas,
  getCanvasById,
  updateCanvas,
  deleteCanvas,
}))

mock.module('../../middleware/auth.middleware.js', () => authMockModule())
mock.module('../../middleware/auth.middleware', () => authMockModule())

const canvases = (await import('./canvases.controller')).default
const app = createTestApp(canvases)

beforeEach(() => {
  resetAuth()
  getCanvases.mockClear()
  createCanvas.mockClear()
  getCanvasById.mockClear()
  getCanvasById.mockImplementation(async () => canvasRow)
  updateCanvas.mockClear()
  updateCanvas.mockImplementation(async (_id, _userId, patch: any) => ({
    ...canvasRow,
    ...patch,
  }))
  deleteCanvas.mockClear()
  deleteCanvas.mockImplementation(async () => true)
})

describe('gating', () => {
  const endpoints = [
    ['get', '/canvases'],
    ['post', '/canvases'],
    ['get', '/canvases/canvas-1'],
    ['put', '/canvases/canvas-1'],
    ['delete', '/canvases/canvas-1'],
  ] as const

  for (const [method, path] of endpoints) {
    test(`${method.toUpperCase()} ${path} rejects an unauthenticated caller`, async () => {
      setAuthUser(null)

      const res = await req(app)[method](path, { body: {} })

      expect(res.status).toBe(401)
    })

    test(`${method.toUpperCase()} ${path} rejects a caller without library:write`, async () => {
      setHasPermission(false)

      const res = await req(app)[method](path, { body: {} })

      expect(res.status).toBe(403)
    })
  }
})

describe('GET /canvases', () => {
  test('lists only the caller’s canvases', async () => {
    const res = await req(app).get('/canvases')

    expect(res.status).toBe(200)
    expect(getCanvases).toHaveBeenCalledWith(TEST_USER.id)
    expect(res.body).toHaveLength(1)
  })
})

describe('POST /canvases', () => {
  test('creates a canvas owned by the caller', async () => {
    const res = await req(app).post('/canvases', {
      body: { scheme: 'user-e2ee' },
    })

    expect(res.status).toBe(200)
    expect(createCanvas).toHaveBeenCalledWith({
      scheme: 'user-e2ee',
      userId: TEST_USER.id,
    })
  })

  test('rejects a scheme that is neither of the two', async () => {
    const res = await req(app).post('/canvases', {
      body: { scheme: 'plaintext' },
    })

    expect(res.status).toBe(422)
  })
})

describe('GET /canvases/:id', () => {
  test('returns the canvas', async () => {
    const res = await req(app).get('/canvases/canvas-1')

    expect(res.status).toBe(200)
    expect(getCanvasById).toHaveBeenCalledWith('canvas-1', TEST_USER.id)
  })

  test('reports someone else’s canvas as missing, not forbidden', async () => {
    getCanvasById.mockImplementation(async () => null)

    const res = await req(app).get('/canvases/canvas-1')

    expect(res.status).toBe(404)
  })
})

describe('PUT /canvases/:id', () => {
  test('writes the encrypted metadata and the body together', async () => {
    const body = { layers: [{ id: 'a', kind: 'library', layerId: 'l', visible: true }] }

    const res = await req(app).put('/canvases/canvas-1', {
      body: { metadataEncrypted: 'envelope', body },
    })

    expect(res.status).toBe(200)
    expect(updateCanvas).toHaveBeenCalledWith('canvas-1', TEST_USER.id, {
      metadataEncrypted: 'envelope',
      body,
    })
  })

  test('accepts an e2ee body and an explicit null for the cleartext one', async () => {
    const res = await req(app).put('/canvases/canvas-1', {
      body: { bodyEncrypted: 'envelope', body: null },
    })

    expect(res.status).toBe(200)
    expect(updateCanvas).toHaveBeenCalledWith('canvas-1', TEST_USER.id, {
      bodyEncrypted: 'envelope',
      body: null,
    })
  })

  test('404s when the canvas is not the caller’s', async () => {
    updateCanvas.mockImplementation(async () => null)

    const res = await req(app).put('/canvases/canvas-1', { body: {} })

    expect(res.status).toBe(404)
  })
})

describe('DELETE /canvases/:id', () => {
  test('deletes the caller’s canvas', async () => {
    const res = await req(app).delete('/canvases/canvas-1')

    expect(res.status).toBe(200)
    expect(deleteCanvas).toHaveBeenCalledWith('canvas-1', TEST_USER.id)
  })

  test('404s when there was nothing to delete', async () => {
    deleteCanvas.mockImplementation(async () => false)

    const res = await req(app).delete('/canvases/canvas-1')

    expect(res.status).toBe(404)
  })
})
