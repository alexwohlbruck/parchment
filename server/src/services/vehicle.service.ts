import { eq, and } from 'drizzle-orm'
import { db } from '../db'
import { userVehicles, type UserVehicle, type NewUserVehicle } from '../schema/user-vehicles.schema'
import { generateId } from '../util'
import { getRoutingMode } from '../lib/vehicle-mode-mapping'

// =============================================================================
// Read operations
// =============================================================================

/**
 * Get all vehicles for a user.
 */
export async function getUserVehicles(userId: string): Promise<UserVehicle[]> {
  return db
    .select()
    .from(userVehicles)
    .where(eq(userVehicles.userId, userId))
    .orderBy(userVehicles.createdAt)
}

/**
 * Get only the active vehicles for a user (at most one per routing mode).
 */
export async function getActiveVehicles(userId: string): Promise<UserVehicle[]> {
  return db
    .select()
    .from(userVehicles)
    .where(and(eq(userVehicles.userId, userId), eq(userVehicles.isActive, true)))
}

/**
 * Get a single vehicle by ID, scoped to user.
 */
export async function getVehicle(
  userId: string,
  vehicleId: string,
): Promise<UserVehicle | undefined> {
  const [vehicle] = await db
    .select()
    .from(userVehicles)
    .where(and(eq(userVehicles.id, vehicleId), eq(userVehicles.userId, userId)))
    .limit(1)
  return vehicle
}

// =============================================================================
// Write operations
// =============================================================================

/**
 * Create a new vehicle. Auto-activates if it's the first vehicle for its
 * routing mode.
 */
export async function createVehicle(
  userId: string,
  data: { type: string; energyType?: string; name?: string },
): Promise<UserVehicle> {
  const id = generateId()
  const routingMode = getRoutingMode(data.type)

  // Check if user already has an active vehicle for this routing mode
  const existingActive = await getActiveVehicles(userId)
  const hasActiveForMode = existingActive.some(
    (v) => getRoutingMode(v.type) === routingMode,
  )

  const [vehicle] = await db
    .insert(userVehicles)
    .values({
      id,
      userId,
      type: data.type,
      energyType: data.energyType ?? null,
      name: data.name ?? null,
      isActive: !hasActiveForMode, // Auto-activate if first for this mode
    })
    .returning()

  return vehicle
}

/**
 * Update vehicle metadata (name, type, energy type).
 */
export async function updateVehicle(
  userId: string,
  vehicleId: string,
  data: { type?: string; energyType?: string | null; name?: string | null },
): Promise<UserVehicle | undefined> {
  const [updated] = await db
    .update(userVehicles)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(and(eq(userVehicles.id, vehicleId), eq(userVehicles.userId, userId)))
    .returning()

  return updated
}

/**
 * Delete a vehicle. If it was the active vehicle for its routing mode,
 * promote the most recently created sibling.
 */
export async function deleteVehicle(
  userId: string,
  vehicleId: string,
): Promise<boolean> {
  const vehicle = await getVehicle(userId, vehicleId)
  if (!vehicle) return false

  await db
    .delete(userVehicles)
    .where(and(eq(userVehicles.id, vehicleId), eq(userVehicles.userId, userId)))

  // If the deleted vehicle was active, promote the most recent sibling
  if (vehicle.isActive) {
    const routingMode = getRoutingMode(vehicle.type)
    const siblings = await getUserVehicles(userId)
    const sameModeVehicles = siblings.filter(
      (v) => getRoutingMode(v.type) === routingMode,
    )

    if (sameModeVehicles.length > 0) {
      // Promote the last one (most recently created)
      const promoted = sameModeVehicles[sameModeVehicles.length - 1]
      await db
        .update(userVehicles)
        .set({ isActive: true, updatedAt: new Date() })
        .where(eq(userVehicles.id, promoted.id))
    }
  }

  return true
}

/**
 * Set a vehicle as active for its routing mode.
 * Deactivates all other vehicles of the same mode in a transaction.
 */
export async function setActiveVehicle(
  userId: string,
  vehicleId: string,
): Promise<UserVehicle | undefined> {
  const vehicle = await getVehicle(userId, vehicleId)
  if (!vehicle) return undefined

  const routingMode = getRoutingMode(vehicle.type)

  // Get all user's vehicles of the same routing mode
  const allVehicles = await getUserVehicles(userId)
  const sameModeIds = allVehicles
    .filter((v) => getRoutingMode(v.type) === routingMode)
    .map((v) => v.id)

  // Deactivate all same-mode, then activate this one
  await db.transaction(async (tx) => {
    for (const id of sameModeIds) {
      await tx
        .update(userVehicles)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(userVehicles.id, id), eq(userVehicles.userId, userId)))
    }
    await tx
      .update(userVehicles)
      .set({ isActive: true, updatedAt: new Date() })
      .where(and(eq(userVehicles.id, vehicleId), eq(userVehicles.userId, userId)))
  })

  return getVehicle(userId, vehicleId)
}

/**
 * Update a vehicle's last known location.
 */
export async function updateVehicleLocation(
  userId: string,
  vehicleId: string,
  location: { lat: number; lng: number },
  source: 'manual' | 'inferred' | 'tracker' = 'manual',
): Promise<UserVehicle | undefined> {
  const [updated] = await db
    .update(userVehicles)
    .set({
      lastKnownLat: location.lat,
      lastKnownLng: location.lng,
      locationSource: source,
      locationUpdatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(userVehicles.id, vehicleId), eq(userVehicles.userId, userId)))
    .returning()

  return updated
}
