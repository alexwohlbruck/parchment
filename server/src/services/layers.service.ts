import { and, eq, isNull, ne } from 'drizzle-orm'
import { db } from '../db'
import { layers, layerGroups } from '../schema/layers.schema'
import type { Layer, LayerGroup } from '../schema/layers.schema'
import type {
  CreateLayerParams,
  CreateLayerGroupParams,
  ReorderParams,
} from '../types/layers.types'
import { generateId } from '../util'

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
    // First delete all layers in this group
    await tx
      .delete(layers)
      .where(and(eq(layers.groupId, id), eq(layers.userId, userId)))

    // Then delete the group
    await tx
      .delete(layerGroups)
      .where(and(eq(layerGroups.id, id), eq(layerGroups.userId, userId)))
  })
}

// Simplified reordering operations
export async function moveLayer(
  userId: string,
  layerId: string,
  targetGroupId: string | null,
  targetOrder: number,
) {
  console.log('=== Backend moveLayer ===')
  console.log(
    'Moving layer:',
    layerId,
    'to group:',
    targetGroupId,
    'at order:',
    targetOrder,
  )

  return await db.transaction(async (tx) => {
    // Get the layer being moved
    const [movingLayer] = await tx
      .select()
      .from(layers)
      .where(and(eq(layers.id, layerId), eq(layers.userId, userId)))
      .limit(1)

    if (!movingLayer) {
      throw new Error('Layer not found')
    }

    console.log(
      `Moving layer ${movingLayer.name} from group ${movingLayer.groupId} to group ${targetGroupId}`,
    )

    // Get all layers in the target group (excluding the moving layer)
    const targetGroupLayers = await tx
      .select()
      .from(layers)
      .where(
        and(
          eq(layers.userId, userId),
          targetGroupId
            ? eq(layers.groupId, targetGroupId)
            : isNull(layers.groupId),
          ne(layers.id, layerId), // Exclude the moving layer
        ),
      )
      .orderBy(layers.order)

    console.log(`Target group has ${targetGroupLayers.length} existing layers`)

    // Insert the moving layer at the target position
    const reorderedLayers = [...targetGroupLayers]
    reorderedLayers.splice(targetOrder, 0, {
      ...movingLayer,
      groupId: targetGroupId,
    })

    console.log(
      'New order will be:',
      reorderedLayers.map((l, idx) => ({
        id: l.id,
        name: l.name,
        newOrder: idx,
      })),
    )

    // Update all layers in the target group with new orders
    for (let i = 0; i < reorderedLayers.length; i++) {
      const layer = reorderedLayers[i]
      await tx
        .update(layers)
        .set({
          order: i,
          groupId: targetGroupId,
          updatedAt: new Date(),
        })
        .where(and(eq(layers.id, layer.id), eq(layers.userId, userId)))
    }

    // If the layer came from a different group, recompute orders for the old group
    if (movingLayer.groupId !== targetGroupId && movingLayer.groupId !== null) {
      console.log(`Recomputing orders for old group: ${movingLayer.groupId}`)
      await recomputeGroupOrders(tx, userId, movingLayer.groupId)
    }
  })
}

export async function moveLayerGroup(
  userId: string,
  groupId: string,
  targetOrder: number,
) {
  console.log('=== Backend moveLayerGroup ===')
  console.log('Moving group:', groupId, 'to order:', targetOrder)

  return await db.transaction(async (tx) => {
    // Update group order
    await tx
      .update(layerGroups)
      .set({ order: targetOrder, updatedAt: new Date() })
      .where(and(eq(layerGroups.id, groupId), eq(layerGroups.userId, userId)))

    // Recompute orders for all groups
    await recomputeAllGroupOrders(tx, userId)
  })
}

// Helper function to recompute order indexes for layers within a group
async function recomputeGroupOrders(
  tx: typeof db,
  userId: string,
  groupId: string | null,
) {
  console.log(`=== recomputeGroupOrders for group ${groupId} ===`)

  // Get all layers in this group, sorted by current order
  const groupLayers = await tx
    .select()
    .from(layers)
    .where(
      and(
        eq(layers.userId, userId),
        groupId ? eq(layers.groupId, groupId) : isNull(layers.groupId),
      ),
    )
    .orderBy(layers.order)

  // Update orders sequentially
  for (let i = 0; i < groupLayers.length; i++) {
    await tx
      .update(layers)
      .set({ order: i, updatedAt: new Date() })
      .where(and(eq(layers.id, groupLayers[i].id), eq(layers.userId, userId)))
  }
}

// Helper function to recompute order indexes for all layer groups
async function recomputeAllGroupOrders(tx: typeof db, userId: string) {
  console.log(`=== recomputeAllGroupOrders ===`)

  // Get all groups, sorted by current order
  const allGroups = await tx
    .select()
    .from(layerGroups)
    .where(eq(layerGroups.userId, userId))
    .orderBy(layerGroups.order)

  // Update orders sequentially
  for (let i = 0; i < allGroups.length; i++) {
    await tx
      .update(layerGroups)
      .set({ order: i, updatedAt: new Date() })
      .where(
        and(
          eq(layerGroups.id, allGroups[i].id),
          eq(layerGroups.userId, userId),
        ),
      )
  }
}

// Legacy function - replace the complex reorderLayers with simple batch updates
export async function reorderLayers(userId: string, params: ReorderParams) {
  console.log('=== Backend reorderLayers (simplified) ===')
  console.log('userId:', userId)
  console.log('params:', JSON.stringify(params, null, 2))

  return await db.transaction(async (tx) => {
    // Process each update individually
    for (const item of params.items) {
      const { id, order, groupId } = item

      // Check if this is a group or layer
      const isGroup = await tx
        .select()
        .from(layerGroups)
        .where(and(eq(layerGroups.id, id), eq(layerGroups.userId, userId)))
        .limit(1)

      if (isGroup.length > 0) {
        // Update group order
        await tx
          .update(layerGroups)
          .set({ order, updatedAt: new Date() })
          .where(and(eq(layerGroups.id, id), eq(layerGroups.userId, userId)))
      } else {
        // Update layer order and group
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

    // After all updates, normalize orders within each affected group
    const affectedGroups = new Set<string | null>()

    for (const item of params.items) {
      const { groupId } = item
      affectedGroups.add(groupId ?? null)
    }

    for (const groupId of affectedGroups) {
      await recomputeGroupOrders(tx, userId, groupId)
    }

    console.log('=== End Backend reorderLayers (simplified) ===')
  })
}
