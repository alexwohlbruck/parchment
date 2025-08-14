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
import { getConfiguredIntegrations } from '../../services/integration.service'

const app = new Elysia()

// Helper: reserved default layer configuration IDs and group names
const RESERVED_DEFAULT_LAYER_IDS = new Set([
  'mapillary-overview',
  'mapillary-sequence',
  'mapillary-image',
  'transitland',
])
const RESERVED_DEFAULT_GROUP_NAMES = new Set(['Mapillary'])

function isReservedLayerId(id: string): boolean {
  return id.startsWith('reserved:')
}

function getConfigIdFromReserved(id: string): string {
  return id.replace(/^reserved:/, '')
}

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

function getRequiredIntegrationForConfigId(
  configId: string,
): IntegrationId | null {
  if (configId.startsWith('mapillary-')) return IntegrationId.MAPILLARY
  if (configId === 'transitland') return IntegrationId.TRANSITLAND
  return null
}

function isIntegrationAllowed(
  integrationId: IntegrationId,
  allowed: Set<IntegrationId>,
): boolean {
  return allowed.has(integrationId)
}

// Layer endpoints
app
  .use(requireAuth)
  .use(permissions(PermissionId.LAYERS_READ))
  .get('/layers', async ({ user }) => {
    const userLayers = await layersService.getLayers(user.id)

    // Pull backend hardcoded defaults without inserting into DB here
    const { defaultLayers, defaultLayerGroups } = await import(
      '../../services/layers/default-layers'
    )

    // Determine which integrations permit default map layers
    const configured = await getConfiguredIntegrations()
    const allowedIntegrationIds = new Set<IntegrationId>()
    for (const integ of configured) {
      const def = integ.integrationId as IntegrationId
      const hasMapLayer = (integ.capabilities || []).some(
        (c) => c.id === IntegrationCapabilityId.MAP_LAYER && c.active,
      )
      if (hasMapLayer) allowedIntegrationIds.add(def)
    }

    // Build a set of configuration ids the user already owns (to hide reserved defaults)
    const userOwnedConfigIds = new Set(
      userLayers
        .filter((l) => !l.name?.startsWith('__tombstone__:'))
        .map((l) => (l as any)?.configuration?.id)
        .filter(Boolean) as string[],
    )

    // Merge default layers: include reserved defaults unless user owns an override with same config id
    const mergedLayers = [
      // Start with user layers, excluding tombstones and layers requiring disabled integrations
      ...userLayers.filter((l) => {
        if (l.name && l.name.startsWith('__tombstone__')) return false
        const cfgId = (l as any)?.configuration?.id as string | undefined
        const required = cfgId ? getRequiredIntegrationForConfigId(cfgId) : null
        if (
          required &&
          !isIntegrationAllowed(required, allowedIntegrationIds)
        ) {
          return false
        }
        return true
      }),
    ]

    for (const l of defaultLayers) {
      const configId = (l as any)?.configuration?.id as string
      const isReserved = RESERVED_DEFAULT_LAYER_IDS.has(configId)

      if (!isReserved) continue

      // Check integration requirement
      const required = getRequiredIntegrationForConfigId(configId)
      if (required && !isIntegrationAllowed(required, allowedIntegrationIds)) {
        continue
      }

      const userOverrideExists = userOwnedConfigIds.has(configId)

      if (!userOverrideExists) {
        // Inject a transient layer for rendering (not persisted)
        mergedLayers.push({
          id: `reserved:${configId}`,
          name: l.name,
          type: l.type,
          engine: l.engine,
          showInLayerSelector: l.showInLayerSelector,
          visible: l.visible,
          icon: (l as any).icon || null,
          order: l.order,
          groupId: l.groupId ? `reserved:${l.groupId}` : null,
          configuration: (l as any).configuration,
          userId: user.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any)
      }
    }

    return mergedLayers
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
      // If editing a reserved default, create a user-owned copy and apply updates
      if (isReservedLayerId(id)) {
        const configId = getConfigIdFromReserved(id)
        const { defaultLayers } = await import(
          '../../services/layers/default-layers'
        )
        const def = (defaultLayers as any[]).find(
          (d) => d.configuration?.id === configId,
        )
        if (!def) {
          set.status = 404
          return { error: 'Default layer not found' }
        }

        const groupName = def.groupId || null
        const resolvedGroupId = await ensureGroupId(user.id, groupName)

        const created = await layersService.createLayer({
          name: body.name ?? def.name,
          type: (body.type as any) ?? def.type,
          engine: (body.engine as any) ?? def.engine,
          showInLayerSelector:
            body.showInLayerSelector !== undefined
              ? body.showInLayerSelector
              : def.showInLayerSelector,
          visible: body.visible !== undefined ? body.visible : def.visible,
          icon: (body.icon as any) ?? def.icon ?? null,
          order: body.order ?? 0,
          groupId: body.groupId ?? resolvedGroupId,
          configuration: {
            ...(def.configuration || {}),
            ...(body.configuration || {}),
          },
          userId: user.id,
        } as any)
        return created
      }

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
      if (isReservedLayerId(id)) {
        // Create a tombstone to hide this reserved default for the user
        const configId = getConfigIdFromReserved(id)
        await layersService.createLayer({
          name: `__tombstone__:${configId}`,
          type: 'custom' as any,
          engine: [] as any,
          showInLayerSelector: false,
          visible: false,
          icon: null,
          order: 0,
          groupId: null,
          configuration: { id: configId } as any,
          userId: user.id,
        } as any)
        return { success: true }
      }

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
    const groups = await layersService.getLayerGroups(user.id)
    const { defaultLayerGroups } = await import(
      '../../services/layers/default-layers'
    )

    // Determine integration availability
    const configured = await getConfiguredIntegrations()
    const allowed = new Set<IntegrationId>()
    for (const integ of configured) {
      const hasMapLayer = (integ.capabilities || []).some(
        (c) => c.id === IntegrationCapabilityId.MAP_LAYER && c.active,
      )
      if (hasMapLayer) allowed.add(integ.integrationId as IntegrationId)
    }

    const baseGroups = groups.filter(
      (g) => !(g.name === 'Mapillary' && !allowed.has(IntegrationId.MAPILLARY)),
    )

    const merged = [...baseGroups]
    for (const g of defaultLayerGroups) {
      if (RESERVED_DEFAULT_GROUP_NAMES.has(g.name)) {
        // Only include Mapillary group if Mapillary integration is allowed
        if (g.name === 'Mapillary' && !allowed.has(IntegrationId.MAPILLARY)) {
          continue
        }
        const exists = groups.some((ug) => ug.name === g.name)
        if (!exists) {
          merged.push({
            id: `reserved:${g.name}`,
            name: g.name,
            showInLayerSelector: g.showInLayerSelector,
            visible: g.visible,
            icon: (g as any).icon || null,
            order: g.order,
            userId: user.id,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any)
        }
      }
    }

    return merged
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
      if (isReservedLayerId(id)) {
        // Create a copy then move it
        const configId = getConfigIdFromReserved(id)
        const { defaultLayers } = await import(
          '../../services/layers/default-layers'
        )
        const def = (defaultLayers as any[]).find(
          (d) => d.configuration?.id === configId,
        )
        if (!def) return { success: false }

        const groupName = def.groupId || null
        const resolvedGroupId = await ensureGroupId(user.id, groupName)

        const created = await layersService.createLayer({
          name: def.name,
          type: def.type,
          engine: def.engine,
          showInLayerSelector: def.showInLayerSelector,
          visible: def.visible,
          icon: def.icon ?? null,
          order: 0,
          groupId: body.targetGroupId ?? resolvedGroupId,
          configuration: def.configuration,
          userId: user.id,
        } as any)

        await layersService.moveLayer(
          user.id,
          created.id,
          body.targetGroupId ?? resolvedGroupId,
          body.targetOrder,
        )
        return { success: true }
      }

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

// Default layers population endpoint (for debugging)
app
  .use(requireAuth)
  .use(permissions(PermissionId.LAYERS_WRITE))
  .post('/layers/populate-custom-layers', async ({ user }) => {
    await layersService.populateDefaultLayers(user.id)
    return { success: true }
  })

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
