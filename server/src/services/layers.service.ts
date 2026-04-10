import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import {
  layers,
  layerGroups,
  defaultLayerUserState,
} from '../schema/layers.schema'
import type {
  CreateLayerParams,
  CreateLayerGroupParams,
  ReorderParams,
  DefaultLayerTemplate,
  DefaultLayerGroupTemplate,
} from '../types/layers.types'
import { generateId } from '../util'

// ============================================================================
// USER-OWNED LAYERS (custom + clones)
// ============================================================================

export async function getLayers(userId: string) {
  return await db
    .select()
    .from(layers)
    .where(eq(layers.userId, userId))
    .orderBy(layers.order)
}

export async function getLayerById(id: string, userId: string) {
  const [layer] = await db
    .select()
    .from(layers)
    .where(and(eq(layers.id, id), eq(layers.userId, userId)))
    .limit(1)
  return layer
}

export async function createLayer(params: CreateLayerParams) {
  const [layer] = await db
    .insert(layers)
    .values({
      id: generateId(),
      ...params,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()
  return layer
}

export async function updateLayer(
  id: string,
  userId: string,
  updates: Partial<CreateLayerParams>,
) {
  const [layer] = await db
    .update(layers)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(layers.id, id), eq(layers.userId, userId)))
    .returning()
  return layer
}

export async function deleteLayer(id: string, userId: string) {
  await db
    .delete(layers)
    .where(and(eq(layers.id, id), eq(layers.userId, userId)))
}

export async function getLayerGroups(userId: string) {
  return await db
    .select()
    .from(layerGroups)
    .where(eq(layerGroups.userId, userId))
    .orderBy(layerGroups.order)
}

export async function getLayerGroupById(id: string, userId: string) {
  const [group] = await db
    .select()
    .from(layerGroups)
    .where(and(eq(layerGroups.id, id), eq(layerGroups.userId, userId)))
    .limit(1)
  return group
}

export async function createLayerGroup(params: CreateLayerGroupParams) {
  const [group] = await db
    .insert(layerGroups)
    .values({
      id: generateId(),
      ...params,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()
  return group
}

export async function updateLayerGroup(
  id: string,
  userId: string,
  updates: Partial<CreateLayerGroupParams>,
) {
  const [group] = await db
    .update(layerGroups)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(layerGroups.id, id), eq(layerGroups.userId, userId)))
    .returning()
  return group
}

export async function deleteLayerGroup(id: string, userId: string) {
  return await db.transaction(async (tx) => {
    // Recursively collect all descendant group IDs
    async function collectDescendantIds(parentId: string): Promise<string[]> {
      const children = await tx
        .select({ id: layerGroups.id })
        .from(layerGroups)
        .where(
          and(
            eq(layerGroups.parentGroupId, parentId),
            eq(layerGroups.userId, userId),
          ),
        )
      const ids: string[] = []
      for (const child of children) {
        ids.push(child.id)
        ids.push(...(await collectDescendantIds(child.id)))
      }
      return ids
    }

    const allGroupIds = [id, ...(await collectDescendantIds(id))]

    // Null out groupId on any layers that referenced these groups so they
    // don't become orphaned. (The FK was dropped in migration 0027, so
    // group_id can hold template IDs or dangling refs; we clean up explicitly.)
    for (const groupId of allGroupIds) {
      await tx
        .update(layers)
        .set({ groupId: null, updatedAt: new Date() })
        .where(
          and(eq(layers.groupId, groupId), eq(layers.userId, userId)),
        )
    }

    // Delete groups children-first
    for (const groupId of allGroupIds.reverse()) {
      await tx
        .delete(layerGroups)
        .where(
          and(eq(layerGroups.id, groupId), eq(layerGroups.userId, userId)),
        )
    }
  })
}

// ============================================================================
// DEFAULT LAYER USER STATE (sidecar for template overrides + tombstones)
// ============================================================================

export type DefaultStateType = 'layer' | 'group'

export interface DefaultStatePatch {
  hidden?: boolean
  visible?: boolean | null
  order?: number | null
  enabled?: boolean | null
  groupId?: string | null
  parentGroupId?: string | null
}

export async function getDefaultUserState(userId: string) {
  return await db
    .select()
    .from(defaultLayerUserState)
    .where(eq(defaultLayerUserState.userId, userId))
}

export async function upsertDefaultUserState(
  userId: string,
  templateId: string,
  type: DefaultStateType,
  patch: DefaultStatePatch,
) {
  // Build the value set, treating null as "clear override" on nullable columns
  const now = new Date()
  const values: Record<string, any> = {
    userId,
    templateId,
    type,
    hidden: patch.hidden ?? false,
    visible: patch.visible ?? null,
    order: patch.order ?? null,
    enabled: patch.enabled ?? null,
    groupId: patch.groupId ?? null,
    parentGroupId: patch.parentGroupId ?? null,
    createdAt: now,
    updatedAt: now,
  }

  // For upsert on composite PK, build the SET clause dynamically so we only
  // overwrite the fields the caller explicitly passed (others keep their
  // existing values). `hidden` is special: if not passed, leave it untouched.
  const setClause: Record<string, any> = { updatedAt: now }
  if ('hidden' in patch) setClause.hidden = patch.hidden
  if ('visible' in patch) setClause.visible = patch.visible
  if ('order' in patch) setClause.order = patch.order
  if ('enabled' in patch) setClause.enabled = patch.enabled
  if ('groupId' in patch) setClause.groupId = patch.groupId
  if ('parentGroupId' in patch) setClause.parentGroupId = patch.parentGroupId

  const [row] = await db
    .insert(defaultLayerUserState)
    .values(values as any)
    .onConflictDoUpdate({
      target: [
        defaultLayerUserState.userId,
        defaultLayerUserState.templateId,
        defaultLayerUserState.type,
      ],
      set: setClause,
    })
    .returning()
  return row
}

export async function deleteDefaultUserState(
  userId: string,
  templateId: string,
  type: DefaultStateType,
) {
  await db
    .delete(defaultLayerUserState)
    .where(
      and(
        eq(defaultLayerUserState.userId, userId),
        eq(defaultLayerUserState.templateId, templateId),
        eq(defaultLayerUserState.type, type),
      ),
    )
}

/**
 * Restore all defaults: clears every state row for this user (removing
 * hidden flags, visibility overrides, order overrides, etc). Cloned layers
 * remain as user-owned customs.
 */
export async function restoreAllDefaults(userId: string) {
  const result = await db
    .delete(defaultLayerUserState)
    .where(eq(defaultLayerUserState.userId, userId))
    .returning()
  return { cleared: result.length }
}

// ============================================================================
// CLONE HELPERS (content modification on a default → full user-owned copy)
// ============================================================================

/**
 * Clone a default layer template into a user-owned layer, optionally with
 * patch edits applied. Also tombstones the template so the user doesn't see
 * both the original and the clone simultaneously.
 */
export async function cloneDefaultLayer(
  userId: string,
  template: DefaultLayerTemplate,
  patch: Partial<CreateLayerParams> = {},
  resolvedConfiguration: any,
) {
  return await db.transaction(async (tx) => {
    const now = new Date()

    // Resolve the cloned layer's groupId. `template.groupId` is a template id
    // (e.g. "default:group:cycling:cycleways"). If the user has already
    // cloned that parent group, we want to attach the layer to their clone's
    // real DB id rather than the template string. Otherwise preserve the
    // template id so the client's merged-layer pipeline still groups the
    // clone under the projected default group.
    let resolvedGroupId: string | null | undefined = patch.groupId
    if (resolvedGroupId === undefined) {
      const templateGroupId = template.groupId ?? null
      if (templateGroupId) {
        const [cloneRow] = await tx
          .select({ id: layerGroups.id })
          .from(layerGroups)
          .where(
            and(
              eq(layerGroups.userId, userId),
              eq(layerGroups.clonedFromTemplateId, templateGroupId),
            ),
          )
          .limit(1)
        resolvedGroupId = cloneRow?.id ?? templateGroupId
      } else {
        resolvedGroupId = null
      }
    }

    const [layer] = await tx
      .insert(layers)
      .values({
        id: generateId(),
        name: patch.name ?? template.name,
        type: (patch.type ?? template.type ?? 'custom') as any,
        engine: (patch.engine ?? template.engine ?? ['mapbox', 'maplibre']) as any,
        showInLayerSelector:
          patch.showInLayerSelector ?? template.showInLayerSelector,
        visible: patch.visible ?? template.visible,
        fadeBasemap: patch.fadeBasemap ?? template.fadeBasemap ?? false,
        icon: patch.icon ?? template.icon ?? null,
        order: patch.order ?? template.order,
        groupId: resolvedGroupId,
        configuration: patch.configuration ?? resolvedConfiguration,
        isSubLayer: patch.isSubLayer ?? template.isSubLayer,
        enabled: patch.enabled ?? true,
        integrationId: patch.integrationId ?? template.integrationId ?? null,
        clonedFromTemplateId: template.templateId,
        userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    // Tombstone the template so the user only sees their clone
    await tx
      .insert(defaultLayerUserState)
      .values({
        userId,
        templateId: template.templateId,
        type: 'layer',
        hidden: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          defaultLayerUserState.userId,
          defaultLayerUserState.templateId,
          defaultLayerUserState.type,
        ],
        set: { hidden: true, updatedAt: now },
      })

    return layer
  })
}

/**
 * Clone a default group template into a user-owned group, tombstoning the
 * original so the user only sees their owned copy.
 */
export async function cloneDefaultGroup(
  userId: string,
  template: DefaultLayerGroupTemplate,
  patch: Partial<CreateLayerGroupParams> = {},
) {
  return await db.transaction(async (tx) => {
    const now = new Date()

    // Resolve the cloned group's parentGroupId the same way `cloneDefaultLayer`
    // resolves its groupId: prefer a user-owned clone of the parent template
    // if one exists, otherwise fall back to the template id so the merged
    // pipeline still nests correctly.
    let resolvedParentId: string | null | undefined = patch.parentGroupId
    if (resolvedParentId === undefined) {
      const templateParentId = template.parentGroupId ?? null
      if (templateParentId) {
        const [parentClone] = await tx
          .select({ id: layerGroups.id })
          .from(layerGroups)
          .where(
            and(
              eq(layerGroups.userId, userId),
              eq(layerGroups.clonedFromTemplateId, templateParentId),
            ),
          )
          .limit(1)
        resolvedParentId = parentClone?.id ?? templateParentId
      } else {
        resolvedParentId = null
      }
    }

    const [group] = await tx
      .insert(layerGroups)
      .values({
        id: generateId(),
        name: patch.name ?? template.name,
        showInLayerSelector:
          patch.showInLayerSelector ?? template.showInLayerSelector,
        visible: patch.visible ?? template.visible,
        fadeBasemap: patch.fadeBasemap ?? template.fadeBasemap ?? false,
        icon: patch.icon ?? template.icon ?? null,
        order: patch.order ?? template.order,
        parentGroupId: resolvedParentId,
        integrationId: patch.integrationId ?? template.integrationId ?? null,
        clonedFromTemplateId: template.templateId,
        userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    await tx
      .insert(defaultLayerUserState)
      .values({
        userId,
        templateId: template.templateId,
        type: 'group',
        hidden: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          defaultLayerUserState.userId,
          defaultLayerUserState.templateId,
          defaultLayerUserState.type,
        ],
        set: { hidden: true, updatedAt: now },
      })

    return group
  })
}

// ============================================================================
// REORDER / MOVE (user-owned layers only; defaults are repositioned via state)
// ============================================================================

export async function moveLayer(
  userId: string,
  layerId: string,
  targetGroupId: string | null,
  targetOrder: number,
) {
  return await db.transaction(async (tx) => {
    const [movingLayer] = await tx
      .select()
      .from(layers)
      .where(and(eq(layers.id, layerId), eq(layers.userId, userId)))
      .limit(1)

    if (!movingLayer) throw new Error('Layer not found')

    await tx
      .update(layers)
      .set({
        order: targetOrder,
        groupId: targetGroupId,
        updatedAt: new Date(),
      })
      .where(and(eq(layers.id, layerId), eq(layers.userId, userId)))
  })
}

export async function moveLayerGroup(
  userId: string,
  groupId: string,
  targetOrder: number,
  targetParentGroupId?: string | null,
) {
  return await db.transaction(async (tx) => {
    const updates: Record<string, any> = {
      order: targetOrder,
      updatedAt: new Date(),
    }
    if (targetParentGroupId !== undefined) {
      updates.parentGroupId = targetParentGroupId
    }

    await tx
      .update(layerGroups)
      .set(updates)
      .where(and(eq(layerGroups.id, groupId), eq(layerGroups.userId, userId)))
  })
}

/**
 * Bulk reorder of user-owned layers and groups. Template IDs are silently
 * skipped — reordering of defaults must go through upsertDefaultUserState.
 */
export async function reorderLayers(userId: string, params: ReorderParams) {
  return await db.transaction(async (tx) => {
    for (const item of params.items) {
      const { id, order, groupId } = item

      // Template IDs (e.g. 'default:bicycle-routes') are not stored in the
      // layers/layer_groups tables. They should be handled by the state
      // endpoints instead. Skip here to avoid no-op updates.
      if (id.startsWith('default:')) continue

      // Is this a group row?
      const isGroup = await tx
        .select()
        .from(layerGroups)
        .where(and(eq(layerGroups.id, id), eq(layerGroups.userId, userId)))
        .limit(1)

      if (isGroup.length > 0) {
        await tx
          .update(layerGroups)
          .set({ order, updatedAt: new Date() })
          .where(
            and(eq(layerGroups.id, id), eq(layerGroups.userId, userId)),
          )
      } else {
        await tx
          .update(layers)
          .set({
            order,
            groupId: groupId ?? null,
            updatedAt: new Date(),
          })
          .where(and(eq(layers.id, id), eq(layers.userId, userId)))
      }
    }
  })
}
