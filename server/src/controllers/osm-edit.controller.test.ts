import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { authMockModule, setAuthUser, resetAuth, TEST_USER } from '../test/auth-mock'
import { createTestApp, req } from '../test/app'

const edit = {
  id: 'edit-1',
  userId: TEST_USER.id,
  action: 'modify',
  osmType: 'node',
  osmId: '42',
  version: 3,
  changesetId: '9001',
  tags: { amenity: 'cafe' },
  lat: 35.2,
  lng: -80.8,
  comment: 'Fix opening hours',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  resolvedAt: new Date('2026-01-02T00:00:00Z'),
}

const getEditHistory = mock(async (_userId: string) => [edit])

class OsmEditError extends Error {}

mock.module('../services/osm-edit.service', () => ({
  getLiveElement: mock(),
  submitEdit: mock(),
  getPendingEdits: mock(async () => []),
  getEditHistory,
  OsmEditError,
}))
mock.module('../middleware/auth.middleware', () => authMockModule())

const osmEdits = (await import('./osm-edit.controller')).default
const app = createTestApp(osmEdits)

beforeEach(() => {
  resetAuth()
  getEditHistory.mockClear()
})

describe('GET /osm/edits/history', () => {
  test("returns the caller's edits, resolved ones included", async () => {
    const res = await req(app).get('/osm/edits/history')

    expect(res.status).toBe(200)
    expect(getEditHistory).toHaveBeenCalledWith(TEST_USER.id)
    expect(res.body.edits).toHaveLength(1)
    expect(res.body.edits[0].resolvedAt).toBe('2026-01-02T00:00:00.000Z')
  })

  test('requires a signed-in user', async () => {
    setAuthUser(null)

    const res = await req(app).get('/osm/edits/history')

    expect(res.status).toBe(401)
    expect(getEditHistory).not.toHaveBeenCalled()
  })
})
