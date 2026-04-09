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
        fadeBasemap: t.Optional(t.Boolean()),
        icon: t.Optional(t.String()),
        order: t.Number(),
        groupId: t.Optional(t.Union([t.String(), t.Null()])),
        configuration: t.Any(),
        category: t.Optional(t.String()),
        defaultTemplateId: t.Optional(t.Union([t.String(), t.Null()])),
        isSubLayer: t.Optional(t.Boolean()),
        enabled: t.Optional(t.Boolean()),
        integrationId: t.Optional(t.Union([t.String(), t.Null()])),
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
        fadeBasemap: t.Optional(t.Boolean()),
        icon: t.Optional(t.String()),
        order: t.Optional(t.Number()),
        groupId: t.Optional(t.Union([t.String(), t.Null()])),
        configuration: t.Optional(t.Any()),
        category: t.Optional(t.String()),
        defaultTemplateId: t.Optional(t.Union([t.String(), t.Null()])),
        isSubLayer: t.Optional(t.Boolean()),
        enabled: t.Optional(t.Boolean()),
        integrationId: t.Optional(t.Union([t.String(), t.Null()])),
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
        fadeBasemap: t.Optional(t.Boolean()),
        icon: t.Optional(t.String()),
        order: t.Number(),
        category: t.Optional(t.String()),
        defaultTemplateId: t.Optional(t.Union([t.String(), t.Null()])),
        parentGroupId: t.Optional(t.Union([t.String(), t.Null()])),
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
        fadeBasemap: t.Optional(t.Boolean()),
        icon: t.Optional(t.String()),
        order: t.Optional(t.Number()),
        category: t.Optional(t.String()),
        defaultTemplateId: t.Optional(t.Union([t.String(), t.Null()])),
        parentGroupId: t.Optional(t.Union([t.String(), t.Null()])),
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
      const { DEFAULT_LAYER_TEMPLATES, DEFAULT_GROUP_TEMPLATES } = await import(
        '../../constants/default-layers'
      )

      const defaultGroupNames = new Set(DEFAULT_GROUP_TEMPLATES.map((g) => g.name))
      const defaultLayerConfigIds = new Set(
        DEFAULT_LAYER_TEMPLATES.map((l) => l.configuration?.id).filter(Boolean),
      )

      // Delete all user layers/groups that were cloned from defaults
      const userLayers = await layersService.getLayers(user.id)
      const userGroups = await layersService.getLayerGroups(user.id)

      let layerCount = 0
      let groupCount = 0

      // Delete default layers (by templateId or by matching configuration.id)
      for (const layer of userLayers) {
        if (
          layer.defaultTemplateId ||
          layer.name?.startsWith('__tombstone__:') ||
          defaultLayerConfigIds.has(layer.configuration?.id)
        ) {
          await layersService.deleteLayer(layer.id, user.id)
          layerCount++
        }
      }

      // Delete default groups (by templateId or by matching name)
      for (const group of userGroups) {
        if (group.defaultTemplateId || defaultGroupNames.has(group.name)) {
          await layersService.deleteLayerGroup(group.id, user.id)
          groupCount++
        }
      }

      return { success: true, restoredLayers: layerCount, restoredGroups: groupCount }
    },
    {
      detail: {
        tags: ['Layers'],
        summary: 'Restore default layers by removing user overrides',
      },
    },
  )

// Get default layer templates (no auth required for caching)
app
  .get(
    '/layers/defaults',
    async () => {
      const { DEFAULT_LAYER_TEMPLATES, DEFAULT_GROUP_TEMPLATES } = await import(
        '../../constants/default-layers'
      )
      return {
        layers: DEFAULT_LAYER_TEMPLATES,
        groups: DEFAULT_GROUP_TEMPLATES,
      }
    },
    {
      detail: {
        tags: ['Layers'],
        summary: 'Get default layer templates',
      },
    },
  )

// Initialize default layers for a user (called on first login or when requesting defaults)
app
  .use(requireAuth)
  .use(permissions(PermissionId.LAYERS_WRITE))
  .post(
    '/layers/initialize-defaults',
    async ({ user }) => {
      const { DEFAULT_LAYER_TEMPLATES, DEFAULT_GROUP_TEMPLATES, resolveProxyUrls } = await import(
        '../../constants/default-layers'
      )

      const existingLayers = await layersService.getLayers(user.id)
      const existingGroups = await layersService.getLayerGroups(user.id)

      // Build a set of already-provisioned template IDs
      const existingLayerTemplateIds = new Set(
        existingLayers.map((l) => l.defaultTemplateId).filter(Boolean),
      )
      const existingGroupTemplateIds = new Set(
        existingGroups.map((g) => g.defaultTemplateId).filter(Boolean),
      )

      // Determine server URL for proxy URL resolution
      // Use the request origin or a default
      const serverUrl = process.env.SERVER_URL || 'http://localhost:5000'

      // Create missing groups first (layers reference group IDs)
      const groupIdMap: Record<string, string> = {} // templateId -> actual DB id
      let groupsCreated = 0

      for (const groupTemplate of DEFAULT_GROUP_TEMPLATES) {
        // 1. Match by defaultTemplateId
        if (existingGroupTemplateIds.has(groupTemplate.templateId)) {
          const existing = existingGroups.find(
            (g) => g.defaultTemplateId === groupTemplate.templateId,
          )
          if (existing) groupIdMap[groupTemplate.templateId] = existing.id
          continue
        }

        // 2. Fall back to name match — adopt old groups that lack defaultTemplateId
        const nameMatch = existingGroups.find(
          (g) => g.name === groupTemplate.name && !g.defaultTemplateId,
        )
        if (nameMatch) {
          await layersService.updateLayerGroup(nameMatch.id, user.id, {
            defaultTemplateId: groupTemplate.templateId,
            category: 'default',
          })
          groupIdMap[groupTemplate.templateId] = nameMatch.id
          continue
        }

        // 3. No match — create new group
        const group = await layersService.createLayerGroup({
          name: groupTemplate.name,
          showInLayerSelector: groupTemplate.showInLayerSelector,
          visible: groupTemplate.visible,
          fadeBasemap: groupTemplate.fadeBasemap ?? false,
          icon: groupTemplate.icon ?? null,
          order: groupTemplate.order,
          category: 'default',
          defaultTemplateId: groupTemplate.templateId,
          parentGroupId: groupTemplate.parentGroupId ?? null,
          userId: user.id,
        })
        groupIdMap[groupTemplate.templateId] = group.id
        groupsCreated++
      }

      // Also map any existing groups by templateId
      for (const group of existingGroups) {
        if (group.defaultTemplateId) {
          groupIdMap[group.defaultTemplateId] = group.id
        }
      }

      // Create missing layers
      let layersCreated = 0
      for (const layerTemplate of DEFAULT_LAYER_TEMPLATES) {
        // 1. Match by defaultTemplateId
        if (existingLayerTemplateIds.has(layerTemplate.templateId)) {
          continue
        }

        // 2. Fall back to configuration.id match — adopt old layers lacking defaultTemplateId
        const configIdMatch = existingLayers.find(
          (l) =>
            l.configuration?.id === layerTemplate.configuration?.id &&
            !l.defaultTemplateId,
        )
        if (configIdMatch) {
          const actualGroupId = layerTemplate.groupId
            ? groupIdMap[layerTemplate.groupId] ?? configIdMatch.groupId
            : configIdMatch.groupId
          await layersService.updateLayer(configIdMatch.id, user.id, {
            defaultTemplateId: layerTemplate.templateId,
            category: 'default',
            isSubLayer: layerTemplate.isSubLayer,
            integrationId: layerTemplate.integrationId ?? null,
            groupId: actualGroupId,
          })
          continue
        }

        // 3. No match — create new layer
        // Resolve the actual group ID from the template group reference
        const actualGroupId = layerTemplate.groupId
          ? groupIdMap[layerTemplate.groupId] ?? null
          : null

        // Resolve proxy URLs in configuration
        const resolvedConfig = resolveProxyUrls(
          layerTemplate.configuration,
          serverUrl,
        )

        await layersService.createLayer({
          name: layerTemplate.name,
          type: layerTemplate.type ?? 'custom',
          engine: layerTemplate.engine ?? ['mapbox', 'maplibre'],
          showInLayerSelector: layerTemplate.showInLayerSelector,
          visible: layerTemplate.visible,
          fadeBasemap: layerTemplate.fadeBasemap ?? false,
          icon: layerTemplate.icon ?? null,
          order: layerTemplate.order,
          groupId: actualGroupId,
          configuration: resolvedConfig,
          category: 'default',
          defaultTemplateId: layerTemplate.templateId,
          isSubLayer: layerTemplate.isSubLayer,
          enabled: true,
          integrationId: layerTemplate.integrationId ?? null,
          userId: user.id,
        })
        layersCreated++
      }

      return { success: true, layersCreated, groupsCreated }
    },
    {
      detail: {
        tags: ['Layers'],
        summary: 'Initialize default layers for the current user',
      },
    },
  )

export default app
