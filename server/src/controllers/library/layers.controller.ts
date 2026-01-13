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
  .get(
    '/layers',
    async ({ user }) => {
      const userLayers = await layersService.getLayers(user.id)
      return userLayers.filter((l) => {
        if (l.name && l.name.startsWith('__tombstone__')) return false
        return true
      })
    },
    {
      detail: {
        tags: ['Layers'],
        summary: 'Get all layers',
      },
    },
  )

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
      detail: {
        tags: ['Layers'],
        summary: 'Create a layer',
      },
    },
  )

app
  .use(requireAuth)
  .use(permissions(PermissionId.LAYERS_WRITE))
  .put(
    '/layers/:id',
    async ({ user, params: { id }, body, set }) => {
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
      detail: {
        tags: ['Layers'],
        summary: 'Update a layer',
      },
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
      detail: {
        tags: ['Layers'],
        summary: 'Delete a layer',
      },
    },
  )

// Layer group endpoints
app
  .use(requireAuth)
  .use(permissions(PermissionId.LAYERS_READ))
  .get(
    '/layers/groups',
    async ({ user }) => {
      const groups = await layersService.getLayerGroups(user.id)
      return groups
    },
    {
      detail: {
        tags: ['Layers'],
        summary: 'Get all layer groups',
      },
    },
  )

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
      detail: {
        tags: ['Layers'],
        summary: 'Create a layer group',
      },
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
      detail: {
        tags: ['Layers'],
        summary: 'Update a layer group',
      },
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
      detail: {
        tags: ['Layers'],
        summary: 'Delete a layer group',
      },
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
      detail: {
        tags: ['Layers'],
        summary: 'Move a layer',
      },
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
      detail: {
        tags: ['Layers'],
        summary: 'Move a layer group',
      },
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
      detail: {
        tags: ['Layers'],
        summary: 'Reorder layers',
      },
    },
  )

app
  .use(requireAuth)
  .use(permissions(PermissionId.LAYERS_WRITE))
  .post(
    '/layers/restore-defaults',
    async ({ user }) => {
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
    },
    {
      detail: {
        tags: ['Layers'],
        summary: 'Restore default layers',
      },
    },
  )

export default app
