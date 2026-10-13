import { beforeEach, test, expect, mock } from 'bun:test'
import {
  authMockModule,
  resetAuth,
  setAuthUser,
  setHasPermission,
  TEST_USER,
} from '../../test/auth-mock'
import { createTestApp, req } from '../../test/app'

class OrganizationValidationError extends Error {}
class OrganizationConflictError extends Error {}
const value = { groups: [], placements: [], revision: 0 }
const getOrganization = mock(async (_userId: string) => value)
const saveOrganization = mock(
  async (_userId: string, input: typeof value) => input,
)
mock.module('../../middleware/auth.middleware.js', () => authMockModule())
mock.module('../../services/library/collection-organization.service', () => ({
  getOrganization,
  saveOrganization,
  OrganizationValidationError,
  OrganizationConflictError,
}))
const controller = (await import('./collection-organization.controller'))
  .default
const app = createTestApp(controller)
const path = '/collection-organization/'

beforeEach(() => {
  resetAuth()
  getOrganization.mockClear()
  saveOrganization.mockClear()
  saveOrganization.mockImplementation(async (_userId, input) => input)
})

test('reads and writes organization only under the authenticated user', async () => {
  expect((await req(app).get(path)).status).toBe(200)
  expect(getOrganization).toHaveBeenCalledWith(TEST_USER.id)
  expect((await req(app).put(path, { body: value })).status).toBe(200)
  expect(saveOrganization).toHaveBeenCalledWith(TEST_USER.id, value)
})

test('requires authentication and library permission', async () => {
  setAuthUser(null)
  expect((await req(app).get(path)).status).toBe(401)
  expect((await req(app).put(path, { body: value })).status).toBe(401)
  resetAuth()
  setHasPermission(false)
  expect((await req(app).put(path, { body: value })).status).toBe(403)
  expect(saveOrganization).not.toHaveBeenCalled()
})

test('rejects invalid request shapes and oversized names', async () => {
  expect(
    (await req(app).put(path, { body: { ...value, revision: -1 } })).status,
  ).toBe(422)
  expect(
    (
      await req(app).put(path, {
        body: {
          ...value,
          groups: [{ id: 'a', name: 'x'.repeat(101), parentId: null }],
        },
      })
    ).status,
  ).toBe(422)
  expect(saveOrganization).not.toHaveBeenCalled()
})

test('maps invalid trees to 400 and stale revisions to 409', async () => {
  saveOrganization.mockImplementation(async () => {
    throw new OrganizationValidationError('Invalid groups')
  })
  expect((await req(app).put(path, { body: value })).status).toBe(400)
  saveOrganization.mockImplementation(async () => {
    throw new OrganizationConflictError('Changed')
  })
  expect((await req(app).put(path, { body: value })).status).toBe(409)
})
