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

/** Thrown by the service when a switch targets the scheme already in use. */
class SchemeAlreadySetError extends Error {}

const changeCanvasScheme = mock(
  async (params: any) =>
    ({ ...canvasRow, scheme: params.targetScheme }) as typeof canvasRow | null,
)

mock.module('../../services/library/canvases.service', () => ({
  getCanvases,
  createCanvas,
  getCanvasById,
  updateCanvas,
  changeCanvasScheme,
  deleteCanvas,
  SchemeAlreadySetError,
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
  changeCanvasScheme.mockClear()
  changeCanvasScheme.mockImplementation(async (params: any) => ({
    ...canvasRow,
    scheme: params.targetScheme,
  }))
})

describe('gating', () => {
  const endpoints = [
    ['get', '/canvases'],
    ['post', '/canvases'],
    ['get', '/canvases/canvas-1'],
    ['put', '/canvases/canvas-1'],
    ['post', '/canvases/canvas-1/change-scheme'],
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
  test('writes cleartext metadata and the body together', async () => {
    const body = { layers: [{ id: 'a', kind: 'library', layerId: 'l', visible: true }] }

    const res = await req(app).put('/canvases/canvas-1', {
      body: { name: 'Weekend ride', body, metadataEncrypted: null },
    })

    expect(res.status).toBe(200)
    expect(updateCanvas).toHaveBeenCalledWith('canvas-1', TEST_USER.id, {
      name: 'Weekend ride',
      body,
      metadataEncrypted: null,
    })
  })

  test('accepts an explicit null name, so a switch can clear it', async () => {
    const res = await req(app).put('/canvases/canvas-1', {
      body: { name: null, description: null, metadataEncrypted: 'envelope' },
    })

    expect(res.status).toBe(200)
    expect(updateCanvas).toHaveBeenCalledWith('canvas-1', TEST_USER.id, {
      name: null,
      description: null,
      metadataEncrypted: 'envelope',
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

describe('POST /canvases/:id/change-scheme', () => {
  test('hands the re-packaged record to the service', async () => {
    const res = await req(app).post('/canvases/canvas-1/change-scheme', {
      body: {
        targetScheme: 'user-e2ee',
        metadataEncrypted: 'envelope',
        bodyEncrypted: 'body-envelope',
        name: null,
        body: null,
      },
    })

    expect(res.status).toBe(200)
    expect(changeCanvasScheme).toHaveBeenCalledWith({
      canvasId: 'canvas-1',
      userId: TEST_USER.id,
      targetScheme: 'user-e2ee',
      metadataEncrypted: 'envelope',
      bodyEncrypted: 'body-envelope',
      name: null,
      body: null,
    })
    expect(res.body.scheme).toBe('user-e2ee')
  })

  test('accepts the cleartext direction too', async () => {
    const res = await req(app).post('/canvases/canvas-1/change-scheme', {
      body: {
        targetScheme: 'server-key',
        name: 'Weekend ride',
        body: { layers: [] },
        metadataEncrypted: null,
        bodyEncrypted: null,
      },
    })

    expect(res.status).toBe(200)
    expect(res.body.scheme).toBe('server-key')
  })

  test('rejects a scheme that is neither of the two', async () => {
    const res = await req(app).post('/canvases/canvas-1/change-scheme', {
      body: { targetScheme: 'plaintext' },
    })

    expect(res.status).toBe(422)
  })

  test('reports switching to the scheme already in use as a bad request', async () => {
    changeCanvasScheme.mockImplementation(async () => {
      throw new SchemeAlreadySetError('already server-key')
    })

    const res = await req(app).post('/canvases/canvas-1/change-scheme', {
      body: { targetScheme: 'server-key' },
    })

    expect(res.status).toBe(400)
  })

  test('404s when the canvas is not the caller’s', async () => {
    changeCanvasScheme.mockImplementation(async () => null)

    const res = await req(app).post('/canvases/canvas-1/change-scheme', {
      body: { targetScheme: 'user-e2ee' },
    })

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
