import { Elysia, t } from 'elysia'
import { requireAuth } from '../../middleware/auth.middleware'
import { permissions } from '../../middleware/auth.middleware'
import { PermissionId } from '../../types/auth.types'
import * as layersService from '../../services/layers.service'
import { layerGroups as layerGroupsTable } from '../../schema/layers.schema'
import { db } from '../../db'
import { and, eq } from 'drizzle-orm'
import {
  IntegrationCapabilityId,
  IntegrationId,
} from '../../types/integration.enums'

const app = new Elysia()

// Helper functions for layer operations
async function ensureGroupId(
  userId: string,
  groupName: string | null | undefined,
): Promise<string | null> {
  if (!groupName) return null
  const existing = await db
    .select()
    .from(layerGroupsTable)
    .where(
      and(
        eq(layerGroupsTable.userId, userId),
        eq(layerGroupsTable.name, groupName),
      ),
    )
    .limit(1)

  if (existing.length > 0) return existing[0].id

  const newGroup = await layersService.createLayerGroup({
    name: groupName,
    showInLayerSelector: true,
    visible: false,
    icon: null,
    order: 0,
    userId,
  })
  return newGroup.id
}

// Layer endpoints
app
  .use(requireAuth)
  .use(permissions(PermissionId.LAYERS_READ))
  .get('/layers', async ({ user }) => {
    // Only return user-created layers (no default layers merging)
    const userLayers = await layersService.getLayers(user.id)
    
    // Filter out tombstones and return clean user layers
    return userLayers.filter((l) => {
      if (l.name && l.name.startsWith('__tombstone__')) return false
      return true
    })
  })

app
  .use(requireAuth)
  .use(permissions(PermissionId.LAYERS_WRITE))
  .post(
    '/layers',
    async ({ user, body }) => {
      return await layersService.createLayer({
        ...body,
        userId: user.id,
      })
    },
    {
      body: t.Object({
        name: t.String(),
        type: t.Optional(t.String()),
        engine: t.Optional(t.Array(t.String())),
        showInLayerSelector: t.Optional(t.Boolean()),
        visible: t.Optional(t.Boolean()),
        icon: t.Optional(t.String()),
        order: t.Number(),
        groupId: t.Optional(t.Union([t.String(), t.Null()])),
        configuration: t.Any(),
      }),
    },
  )

app
  .use(requireAuth)
  .use(permissions(PermissionId.LAYERS_WRITE))
  .put(
    '/layers/:id',
    async ({ user, params: { id }, body, set }) => {
      // Only allow updating user-owned layers
      const layer = await layersService.updateLayer(id, user.id, body)
      if (!layer) {
        set.status = 404
        return { error: 'Layer not found' }
      }
      return layer
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        name: t.Optional(t.String()),
        type: t.Optional(t.String()),
        engine: t.Optional(t.Array(t.String())),
        showInLayerSelector: t.Optional(t.Boolean()),
        visible: t.Optional(t.Boolean()),
        icon: t.Optional(t.String()),
        order: t.Optional(t.Number()),
        groupId: t.Optional(t.Union([t.String(), t.Null()])),
        configuration: t.Optional(t.Any()),
      }),
    },
  )

app
  .use(requireAuth)
  .use(permissions(PermissionId.LAYERS_DELETE))
  .delete(
    '/layers/:id',
    async ({ user, params: { id } }) => {
      await layersService.deleteLayer(id, user.id)
      return { success: true }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

// Layer group endpoints
app
  .use(requireAuth)
  .use(permissions(PermissionId.LAYERS_READ))
  .get('/layers/groups', async ({ user }) => {
    // Only return user-created layer groups (no default groups merging)
    const groups = await layersService.getLayerGroups(user.id)
    return groups
  })

app
  .use(requireAuth)
  .use(permissions(PermissionId.LAYERS_WRITE))
  .post(
    '/layers/groups',
    async ({ user, body }) => {
      return await layersService.createLayerGroup({
        ...body,
        userId: user.id,
      })
    },
    {
      body: t.Object({
        name: t.String(),
        showInLayerSelector: t.Optional(t.Boolean()),
        visible: t.Optional(t.Boolean()),
        icon: t.Optional(t.String()),
        order: t.Number(),
      }),
    },
  )

app
  .use(requireAuth)
  .use(permissions(PermissionId.LAYERS_WRITE))
  .put(
    '/layers/groups/:id',
    async ({ user, params: { id }, body, set }) => {
      const group = await layersService.updateLayerGroup(id, user.id, body)
      if (!group) {
        set.status = 404
        return { error: 'Layer group not found' }
      }
      return group
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        name: t.Optional(t.String()),
        showInLayerSelector: t.Optional(t.Boolean()),
        visible: t.Optional(t.Boolean()),
        icon: t.Optional(t.String()),
        order: t.Optional(t.Number()),
      }),
    },
  )

app
  .use(requireAuth)
  .use(permissions(PermissionId.LAYERS_DELETE))
  .delete(
    '/layers/groups/:id',
    async ({ user, params: { id } }) => {
      await layersService.deleteLayerGroup(id, user.id)
      return { success: true }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

// Move endpoints
app
  .use(requireAuth)
  .use(permissions(PermissionId.LAYERS_WRITE))
  .put(
    '/layers/:id/move',
    async ({ user, params: { id }, body }) => {
      await layersService.moveLayer(
        user.id,
        id,
        body.targetGroupId ?? null,
        body.targetOrder,
      )
      return { success: true }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        targetGroupId: t.Optional(t.Union([t.String(), t.Null()])),
        targetOrder: t.Number(),
      }),
    },
  )

app
  .use(requireAuth)
  .use(permissions(PermissionId.LAYERS_WRITE))
  .put(
    '/layers/groups/:id/move',
    async ({ user, params: { id }, body }) => {
      await layersService.moveLayerGroup(user.id, id, body.targetOrder)
      return { success: true }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        targetOrder: t.Number(),
      }),
    },
  )

// Reordering endpoint
app
  .use(requireAuth)
  .use(permissions(PermissionId.LAYERS_WRITE))
  .put(
    '/layers/reorder',
    async ({ user, body }) => {
      await layersService.reorderLayers(user.id, body)
      return { success: true }
    },
    {
      body: t.Object({
        items: t.Array(
          t.Object({
            id: t.String(),
            order: t.Number(),
            groupId: t.Optional(t.Union([t.String(), t.Null()])),
          }),
        ),
      }),
    },
  )


app
  .use(requireAuth)
  .use(permissions(PermissionId.LAYERS_WRITE))
  .post('/layers/restore-defaults', async ({ user }) => {
    // Delete only tombstone rows used to hide reserved defaults for this user
    const userLayers = await layersService.getLayers(user.id)
    const tombstones = userLayers.filter((l) =>
      l.name?.startsWith('__tombstone__:'),
    )
    let count = 0
    for (const t of tombstones) {
      await layersService.deleteLayer(t.id, user.id)
      count++
    }
    return { success: true, restored: count }
  })

export default app
