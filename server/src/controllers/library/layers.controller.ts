import { Elysia, t } from 'elysia'
import { requireAuth } from '../../middleware/auth.middleware'
import { permissions } from '../../middleware/auth.middleware'
import { PermissionId } from '../../types/auth.types'
import * as layersService from '../../services/layers.service'

const app = new Elysia()

// ============================================================================
// USER-OWNED LAYERS (custom + clones)
// ============================================================================

// GET /layers — user-owned layers (custom + clones). Defaults are served via
// the /layers/defaults endpoint and composed client-side.
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
      detail: { tags: ['Layers'], summary: 'Get user-owned layers' },
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
        isSubLayer: t.Optional(t.Boolean()),
        enabled: t.Optional(t.Boolean()),
        integrationId: t.Optional(t.Union([t.String(), t.Null()])),
      }),
      detail: { tags: ['Layers'], summary: 'Create a custom layer' },
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
      params: t.Object({ id: t.String() }),
      detail: { tags: ['Layers'], summary: 'Delete a user-owned layer' },
    },
  )

// ============================================================================
// LAYER GROUPS (custom + clones)
// ============================================================================

app
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
        parentGroupId: t.Optional(t.Union([t.String(), t.Null()])),
        integrationId: t.Optional(t.Union([t.String(), t.Null()])),
      }),
      detail: { tags: ['Layers'], summary: 'Create a custom layer group' },
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
      detail: { tags: ['Layers'], summary: 'Update a user-owned layer group' },
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
      params: t.Object({ id: t.String() }),
      detail: { tags: ['Layers'], summary: 'Delete a user-owned layer group' },
    },
  )

// ============================================================================
// MOVE / REORDER (user-owned rows only)
// ============================================================================

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
      params: t.Object({ id: t.String() }),
      body: t.Object({
        targetGroupId: t.Optional(t.Union([t.String(), t.Null()])),
        targetOrder: t.Number(),
      }),
      detail: { tags: ['Layers'], summary: 'Move a user-owned layer' },
    },
  )

app
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
      detail: { tags: ['Layers'], summary: 'Move a user-owned layer group' },
    },
  )

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
      detail: { tags: ['Layers'], summary: 'Bulk reorder user-owned rows' },
    },
  )

// ============================================================================
// DEFAULT TEMPLATES + USER STATE + CLONE/RESTORE
// ============================================================================

// Get the canonical default layer/group templates. Client fetches this on
// app load and composes with getUserLayers + getDefaultState.
// Auth-gated because the resolved configuration includes server-side proxy
// URLs that we do not want exposed to unauthenticated callers.
app
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
      const serverUrl = process.env.SERVER_URL || 'http://localhost:5000'
      return {
        layers: DEFAULT_LAYER_TEMPLATES.map((t) => ({
          ...t,
          configuration: resolveProxyUrls(t.configuration, serverUrl),
        })),
        groups: DEFAULT_GROUP_TEMPLATES,
      }
    },
    {
      detail: { tags: ['Layers'], summary: 'Get default layer templates' },
    },
  )

// Get the user's state sidecar for default templates (overrides + tombstones)
app
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
  )

// Upsert state for a default template (visibility, order, parent, hidden, etc.)
// templateId is passed in the body because it's a dotted string (e.g.
// "default:bicycle-routes") that URL-encodes awkwardly.
app
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
  )

// Clear a specific default state row (un-hide / un-override a single template)
app
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
  )

// Clone a default layer into a user-owned layer, optionally with patch edits.
// Also tombstones the template so the user only sees their clone.
app
  .use(requireAuth)
  .use(permissions(PermissionId.LAYERS_WRITE))
  .post(
    '/layers/default-clone/layer',
    async ({ user, body, set }) => {
      const { DEFAULT_LAYER_TEMPLATES, resolveProxyUrls } = await import(
        '../../constants/default-layers'
      )
      const template = DEFAULT_LAYER_TEMPLATES.find(
        (t) => t.templateId === body.templateId,
      )
      if (!template) {
        set.status = 404
        return { error: 'Default layer template not found' }
      }
      const serverUrl = process.env.SERVER_URL || 'http://localhost:5000'
      const resolved = resolveProxyUrls(template.configuration, serverUrl)
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
  )

// Clone a default group into a user-owned group.
app
  .use(requireAuth)
  .use(permissions(PermissionId.LAYERS_WRITE))
  .post(
    '/layers/default-clone/group',
    async ({ user, body, set }) => {
      const { DEFAULT_GROUP_TEMPLATES } = await import(
        '../../constants/default-layers'
      )
      const template = DEFAULT_GROUP_TEMPLATES.find(
        (t) => t.templateId === body.templateId,
      )
      if (!template) {
        set.status = 404
        return { error: 'Default group template not found' }
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
  )

// Restore defaults: wipe all user state for defaults (un-hide tombstones,
// clear visibility/order overrides). Cloned user-owned layers are NOT touched.
app
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
  )

export default app
