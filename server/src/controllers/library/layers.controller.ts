import { Elysia, t } from 'elysia'
import { requireAuth } from '../../middleware/auth.middleware'
import { permissions } from '../../middleware/auth.middleware'
import { PermissionId } from '../../types/auth.types'
import * as layersService from '../../services/layers.service'
import { resolveBarrelmanTileConfig } from '../../services/barrelman.service'
import { i18nPlugin } from '../../lib/i18n/plugin'

/**
 * What a default template's placeholders resolve against: this server's public
 * origin, and where a browser reaches Barrelman's tiles.
 *
 * SERVER_ORIGIN is the canonical public-origin env everything else uses; fall
 * back to it so a deployment that sets only SERVER_ORIGIN doesn't silently emit
 * localhost tile URLs (mixed-content-blocked on https).
 */
function templateContext(): [string, ReturnType<typeof resolveBarrelmanTileConfig>] {
  const serverUrl =
    process.env.SERVER_URL || process.env.SERVER_ORIGIN || 'http://localhost:5000'
  return [serverUrl, resolveBarrelmanTileConfig()]
}

const app = new Elysia().use(i18nPlugin)

// Each route is wrapped in .group('') to isolate the permissions()
// middleware — Elysia's .use() leaks to all subsequent routes otherwise.

// ============================================================================
// USER-OWNED LAYERS (custom + clones)
// ============================================================================

app.group('', (g) =>
  g
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
        detail: { tags: ['Layers'], summary: 'Get user-owned layers' },
      },
    ),
)

app.group('', (g) =>
  g
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
          isSubLayer: t.Optional(t.Boolean()),
          enabled: t.Optional(t.Boolean()),
          integrationId: t.Optional(t.Union([t.String(), t.Null()])),
        }),
        detail: { tags: ['Layers'], summary: 'Create a custom layer' },
      },
    ),
)

app.group('', (g) =>
  g
    .use(requireAuth)
    .use(permissions(PermissionId.LAYERS_WRITE))
    .put(
      '/layers/:id',
      async ({ user, params: { id }, body, set, t }) => {
        const layer = await layersService.updateLayer(id, user.id, body)
        if (!layer) {
          set.status = 404
          return { error: t('errors.library.layerNotFound') }
        }
        return layer
      },
      {
        params: t.Object({ id: t.String() }),
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
          isSubLayer: t.Optional(t.Boolean()),
          enabled: t.Optional(t.Boolean()),
          integrationId: t.Optional(t.Union([t.String(), t.Null()])),
        }),
        detail: { tags: ['Layers'], summary: 'Update a user-owned layer' },
      },
    ),
)

app.group('', (g) =>
  g
    .use(requireAuth)
    .use(permissions(PermissionId.LAYERS_DELETE))
    .delete(
      '/layers/:id',
      async ({ user, params: { id } }) => {
        await layersService.deleteLayer(id, user.id)
        return { success: true }
      },
      {
        params: t.Object({ id: t.String() }),
        detail: { tags: ['Layers'], summary: 'Delete a user-owned layer' },
      },
    ),
)

// ============================================================================
// LAYER GROUPS (custom + clones)
// ============================================================================

app.group('', (g) =>
  g
    .use(requireAuth)
    .use(permissions(PermissionId.LAYERS_READ))
    .get(
      '/layers/groups',
      async ({ user }) => {
        return await layersService.getLayerGroups(user.id)
      },
      {
        detail: { tags: ['Layers'], summary: 'Get user-owned layer groups' },
      },
    ),
)

app.group('', (g) =>
  g
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
          parentGroupId: t.Optional(t.Union([t.String(), t.Null()])),
          integrationId: t.Optional(t.Union([t.String(), t.Null()])),
        }),
        detail: { tags: ['Layers'], summary: 'Create a custom layer group' },
      },
    ),
)

app.group('', (g) =>
  g
    .use(requireAuth)
    .use(permissions(PermissionId.LAYERS_WRITE))
    .put(
      '/layers/groups/:id',
      async ({ user, params: { id }, body, set, t }) => {
        const group = await layersService.updateLayerGroup(id, user.id, body)
        if (!group) {
          set.status = 404
          return { error: t('errors.library.layerGroupNotFound') }
        }
        return group
      },
      {
        params: t.Object({ id: t.String() }),
        body: t.Object({
          name: t.Optional(t.String()),
          showInLayerSelector: t.Optional(t.Boolean()),
          visible: t.Optional(t.Boolean()),
          fadeBasemap: t.Optional(t.Boolean()),
          icon: t.Optional(t.String()),
          order: t.Optional(t.Number()),
          parentGroupId: t.Optional(t.Union([t.String(), t.Null()])),
          integrationId: t.Optional(t.Union([t.String(), t.Null()])),
        }),
        detail: {
          tags: ['Layers'],
          summary: 'Update a user-owned layer group',
        },
      },
    ),
)

app.group('', (g) =>
  g
    .use(requireAuth)
    .use(permissions(PermissionId.LAYERS_DELETE))
    .delete(
      '/layers/groups/:id',
      async ({ user, params: { id } }) => {
        await layersService.deleteLayerGroup(id, user.id)
        return { success: true }
      },
      {
        params: t.Object({ id: t.String() }),
        detail: {
          tags: ['Layers'],
          summary: 'Delete a user-owned layer group',
        },
      },
    ),
)

// ============================================================================
// MOVE / REORDER (user-owned rows only)
// ============================================================================

app.group('', (g) =>
  g
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
        params: t.Object({ id: t.String() }),
        body: t.Object({
          targetGroupId: t.Optional(t.Union([t.String(), t.Null()])),
          targetOrder: t.Number(),
        }),
        detail: { tags: ['Layers'], summary: 'Move a user-owned layer' },
      },
    ),
)

app.group('', (g) =>
  g
    .use(requireAuth)
    .use(permissions(PermissionId.LAYERS_WRITE))
    .put(
      '/layers/groups/:id/move',
      async ({ user, params: { id }, body }) => {
        await layersService.moveLayerGroup(
          user.id,
          id,
          body.targetOrder,
          body.targetParentGroupId,
        )
        return { success: true }
      },
      {
        params: t.Object({ id: t.String() }),
        body: t.Object({
          targetOrder: t.Number(),
          targetParentGroupId: t.Optional(t.Union([t.String(), t.Null()])),
        }),
        detail: {
          tags: ['Layers'],
          summary: 'Move a user-owned layer group',
        },
      },
    ),
)

app.group('', (g) =>
  g
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
          summary: 'Bulk reorder user-owned rows',
        },
      },
    ),
)

// ============================================================================
// DEFAULT TEMPLATES + USER STATE + CLONE/RESTORE
// ============================================================================

app.group('', (g) =>
  g
    .use(requireAuth)
    .use(permissions(PermissionId.LAYERS_READ))
    .get(
      '/layers/defaults',
      async () => {
        const {
          DEFAULT_LAYER_TEMPLATES,
          DEFAULT_GROUP_TEMPLATES,
          resolveProxyUrls,
        } = await import('../../constants/default-layers')
        const [serverUrl, barrelman] = templateContext()
        return {
          layers: DEFAULT_LAYER_TEMPLATES.map((t) => ({
            ...t,
            configuration: resolveProxyUrls(t.configuration, serverUrl, barrelman),
          })),
          groups: DEFAULT_GROUP_TEMPLATES,
        }
      },
      {
        detail: { tags: ['Layers'], summary: 'Get default layer templates' },
      },
    ),
)

app.group('', (g) =>
  g
    .use(requireAuth)
    .use(permissions(PermissionId.LAYERS_READ))
    .get(
      '/layers/default-state',
      async ({ user }) => {
        return await layersService.getDefaultUserState(user.id)
      },
      {
        detail: {
          tags: ['Layers'],
          summary: 'Get user state for default layers/groups',
        },
      },
    ),
)

app.group('', (g) =>
  g
    .use(requireAuth)
    .use(permissions(PermissionId.LAYERS_WRITE))
    .put(
      '/layers/default-state',
      async ({ user, body }) => {
        const { templateId, type, ...patch } = body
        return await layersService.upsertDefaultUserState(
          user.id,
          templateId,
          type,
          patch,
        )
      },
      {
        body: t.Object({
          templateId: t.String(),
          type: t.Union([t.Literal('layer'), t.Literal('group')]),
          hidden: t.Optional(t.Boolean()),
          visible: t.Optional(t.Union([t.Boolean(), t.Null()])),
          order: t.Optional(t.Union([t.Number(), t.Null()])),
          enabled: t.Optional(t.Union([t.Boolean(), t.Null()])),
          groupId: t.Optional(t.Union([t.String(), t.Null()])),
          parentGroupId: t.Optional(t.Union([t.String(), t.Null()])),
        }),
        detail: {
          tags: ['Layers'],
          summary: 'Upsert user state for a default template',
        },
      },
    ),
)

app.group('', (g) =>
  g
    .use(requireAuth)
    .use(permissions(PermissionId.LAYERS_WRITE))
    .delete(
      '/layers/default-state',
      async ({ user, body }) => {
        await layersService.deleteDefaultUserState(
          user.id,
          body.templateId,
          body.type,
        )
        return { success: true }
      },
      {
        body: t.Object({
          templateId: t.String(),
          type: t.Union([t.Literal('layer'), t.Literal('group')]),
        }),
        detail: {
          tags: ['Layers'],
          summary: 'Clear user state for a default template',
        },
      },
    ),
)

app.group('', (g) =>
  g
    .use(requireAuth)
    .use(permissions(PermissionId.LAYERS_WRITE))
    .post(
      '/layers/default-clone/layer',
      async ({ user, body, set, t }) => {
        const { DEFAULT_LAYER_TEMPLATES, resolveProxyUrls } = await import(
          '../../constants/default-layers'
        )
        const template = DEFAULT_LAYER_TEMPLATES.find(
          (t) => t.templateId === body.templateId,
        )
        if (!template) {
          set.status = 404
          return { error: t('errors.library.layerTemplateNotFound') }
        }
        const [serverUrl, barrelman] = templateContext()
        const resolved = resolveProxyUrls(template.configuration, serverUrl, barrelman)
        const clone = await layersService.cloneDefaultLayer(
          user.id,
          template,
          body.patch ?? {},
          resolved,
        )
        return clone
      },
      {
        body: t.Object({
          templateId: t.String(),
          patch: t.Optional(t.Any()),
        }),
        detail: {
          tags: ['Layers'],
          summary: 'Clone a default layer into a user-owned layer',
        },
      },
    ),
)

app.group('', (g) =>
  g
    .use(requireAuth)
    .use(permissions(PermissionId.LAYERS_WRITE))
    .post(
      '/layers/default-clone/group',
      async ({ user, body, set, t }) => {
        const { DEFAULT_GROUP_TEMPLATES } = await import(
          '../../constants/default-layers'
        )
        const template = DEFAULT_GROUP_TEMPLATES.find(
          (t) => t.templateId === body.templateId,
        )
        if (!template) {
          set.status = 404
          return { error: t('errors.library.layerGroupTemplateNotFound') }
        }
        const clone = await layersService.cloneDefaultGroup(
          user.id,
          template,
          body.patch ?? {},
        )
        return clone
      },
      {
        body: t.Object({
          templateId: t.String(),
          patch: t.Optional(t.Any()),
        }),
        detail: {
          tags: ['Layers'],
          summary: 'Clone a default group into a user-owned group',
        },
      },
    ),
)

app.group('', (g) =>
  g
    .use(requireAuth)
    .use(permissions(PermissionId.LAYERS_WRITE))
    .post(
      '/layers/restore-defaults',
      async ({ user }) => {
        const result = await layersService.restoreAllDefaults(user.id)
        return { success: true, ...result }
      },
      {
        detail: {
          tags: ['Layers'],
          summary: 'Restore default layers (clears state; clones remain)',
        },
      },
    ),
)

export default app
