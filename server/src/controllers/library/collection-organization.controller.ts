import { Elysia, t } from 'elysia'
import { permissions } from '../../middleware/auth.middleware.js'
import { PermissionId } from '../../types/auth.types'
import * as collectionOrganizationService from '../../services/library/collection-organization.service'

const organization = t.Object({
  groups: t.Array(
    t.Object({
      id: t.String({ minLength: 1, maxLength: 100 }),
      name: t.String({ minLength: 1, maxLength: 100 }),
      parentId: t.Union([t.String({ minLength: 1, maxLength: 100 }), t.Null()]),
    }),
    { maxItems: 500 },
  ),
  placements: t.Array(
    t.Object({
      collectionId: t.String({ minLength: 1, maxLength: 100 }),
      groupId: t.String({ minLength: 1, maxLength: 100 }),
    }),
    { maxItems: 10000 },
  ),
  revision: t.Integer({ minimum: 0 }),
})

export default new Elysia({ prefix: '/collection-organization' })
  .use(permissions(PermissionId.LIBRARY_WRITE))
  .get(
    '/',
    ({ user }) => collectionOrganizationService.getOrganization(user.id),
    {
      response: organization,
      detail: {
        tags: ['Library'],
        summary: 'Get personal collection groups',
        description:
          'Returns the caller’s nested groups and collection placements. Organization is personal and does not affect collection sharing.',
      },
    },
  )
  .put(
    '/',
    async ({ user, body, set }) => {
      try {
        return await collectionOrganizationService.saveOrganization(
          user.id,
          body,
        )
      } catch (error) {
        if (
          error instanceof
          collectionOrganizationService.OrganizationValidationError
        ) {
          set.status = 400
          return { error: error.message }
        }
        if (
          error instanceof
          collectionOrganizationService.OrganizationConflictError
        ) {
          set.status = 409
          return { error: error.message }
        }
        throw error
      }
    },
    {
      body: organization,
      response: {
        200: organization,
        400: t.Object({ error: t.String() }),
        409: t.Object({ error: t.String() }),
      },
      detail: {
        tags: ['Library'],
        summary: 'Save personal collection groups',
        description:
          'Replaces the caller’s organization. Parent groups must exist and cycles are rejected. Inaccessible collection placements are discarded. Send the revision returned by GET; stale revisions return 409. Group removal does not delete collections.',
      },
    },
  )
