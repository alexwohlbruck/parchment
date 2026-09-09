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
} from '../types/layers.types'
import { generateId } from '../util'

// ============================================================================
// USER-OWNED LAYERS (the user's own custom layers)
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
// DEFAULT LAYER USER STATE (sidecar: the user's preferences for templates)
// ============================================================================

export type DefaultStateType = 'layer' | 'group'

export interface DefaultStatePatch {
  /**
   * Whether the user has removed this template from their library. NULL means
   * "follow the template's `installedByDefault`", which is what an untouched
   * store item looks like.
   */
  hidden?: boolean | null
  visible?: boolean | null
  order?: number | null
  enabled?: boolean | null
  showInLayerSelector?: boolean | null
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
    hidden: patch.hidden ?? null,
    visible: patch.visible ?? null,
    order: patch.order ?? null,
    enabled: patch.enabled ?? null,
    showInLayerSelector: patch.showInLayerSelector ?? null,
    groupId: patch.groupId ?? null,
    parentGroupId: patch.parentGroupId ?? null,
    createdAt: now,
    updatedAt: now,
  }

  // For upsert on composite PK, build the SET clause dynamically so we only
  // overwrite the fields the caller explicitly passed (others keep their
  // existing values).
  const setClause: Record<string, any> = { updatedAt: now }
  if ('hidden' in patch) setClause.hidden = patch.hidden
  if ('visible' in patch) setClause.visible = patch.visible
  if ('order' in patch) setClause.order = patch.order
  if ('enabled' in patch) setClause.enabled = patch.enabled
  if ('showInLayerSelector' in patch) {
    setClause.showInLayerSelector = patch.showInLayerSelector
  }
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
