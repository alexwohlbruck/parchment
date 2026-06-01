import Elysia, { t } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import {
  getUserVehicles,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  setActiveVehicle,
  updateVehicleLocation,
} from '../services/vehicle.service'

const app = new Elysia({ prefix: '/vehicles' })

/**
 * List user's vehicles
 */
app.use(requireAuth).get(
  '/',
  async ({ user }) => {
    const vehicles = await getUserVehicles(user.id)
    return {
      vehicles: vehicles.map(serializeVehicle),
    }
  },
  {
    detail: {
      tags: ['Vehicles'],
      summary: 'List user vehicles',
    },
  },
)

/**
 * Create a new vehicle
 */
app.use(requireAuth).post(
  '/',
  async ({ body, user }) => {
    const vehicle = await createVehicle(user.id, body)
    return { vehicle: serializeVehicle(vehicle) }
  },
  {
    body: t.Object({
      type: t.String(),
      energyType: t.Optional(t.String()),
      name: t.Optional(t.String()),
    }),
    detail: {
      tags: ['Vehicles'],
      summary: 'Create a new vehicle',
    },
  },
)

/**
 * Update vehicle metadata
 */
app.use(requireAuth).patch(
  '/:id',
  async ({ params, body, user, status }) => {
    const vehicle = await updateVehicle(user.id, params.id, body)
    if (!vehicle) return status(404, { message: 'Vehicle not found' })
    return { vehicle: serializeVehicle(vehicle) }
  },
  {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      type: t.Optional(t.String()),
      energyType: t.Optional(t.Nullable(t.String())),
      name: t.Optional(t.Nullable(t.String())),
    }),
    detail: {
      tags: ['Vehicles'],
      summary: 'Update vehicle metadata',
    },
  },
)

/**
 * Delete a vehicle
 */
app.use(requireAuth).delete(
  '/:id',
  async ({ params, user, status }) => {
    const deleted = await deleteVehicle(user.id, params.id)
    if (!deleted) return status(404, { message: 'Vehicle not found' })
    return { deleted: true }
  },
  {
    params: t.Object({ id: t.String() }),
    detail: {
      tags: ['Vehicles'],
      summary: 'Delete a vehicle',
    },
  },
)

/**
 * Set a vehicle as active for its routing mode
 */
app.use(requireAuth).post(
  '/:id/activate',
  async ({ params, user, status }) => {
    const vehicle = await setActiveVehicle(user.id, params.id)
    if (!vehicle) return status(404, { message: 'Vehicle not found' })
    return { vehicle: serializeVehicle(vehicle) }
  },
  {
    params: t.Object({ id: t.String() }),
    detail: {
      tags: ['Vehicles'],
      summary: 'Set vehicle as active for its routing mode',
    },
  },
)

/**
 * Update vehicle location
 */
app.use(requireAuth).put(
  '/:id/location',
  async ({ params, body, user, status }) => {
    const vehicle = await updateVehicleLocation(
      user.id,
      params.id,
      { lat: body.lat, lng: body.lng },
      body.source ?? 'manual',
    )
    if (!vehicle) return status(404, { message: 'Vehicle not found' })
    return { vehicle: serializeVehicle(vehicle) }
  },
  {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      lat: t.Number(),
      lng: t.Number(),
      source: t.Optional(
        t.Union([
          t.Literal('manual'),
          t.Literal('inferred'),
          t.Literal('tracker'),
        ]),
      ),
    }),
    detail: {
      tags: ['Vehicles'],
      summary: 'Update vehicle location',
    },
  },
)

/**
 * Serialize vehicle for API response (camelCase keys, structured location)
 */
function serializeVehicle(v: any) {
  return {
    id: v.id,
    type: v.type,
    energyType: v.energyType,
    name: v.name,
    isActive: v.isActive,
    lastKnownLocation:
      v.lastKnownLat != null && v.lastKnownLng != null
        ? { lat: v.lastKnownLat, lng: v.lastKnownLng }
        : null,
    locationSource: v.locationSource,
    locationUpdatedAt: v.locationUpdatedAt?.toISOString() ?? null,
    createdAt: v.createdAt?.toISOString() ?? null,
    updatedAt: v.updatedAt?.toISOString() ?? null,
  }
}

export default app
