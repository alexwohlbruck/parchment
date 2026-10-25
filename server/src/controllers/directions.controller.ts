import { Elysia, t } from 'elysia'
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { DEFAULT_LANGUAGE } from '../lib/i18n/i18n.types'
import { db } from '../db'
import { plannedTrips } from '../schema/planned-trips.schema'
import { multimodalTripService } from '../services/trip.service'
import { alternativeSegments, rerouteSegment } from '../services/reroute.service'
import { attachHazards } from '../lib/route-hazards'
import { attachLanes } from '../services/route-lanes.service'
import { optionalAuth } from '../middleware/auth.middleware'
import { getPermissions, hasPermission } from '../services/auth.service'
import { PermissionId } from '../types/auth.types'
import {
  TripRequest,
  SelectedMode,
  VehicleType,
  WaypointType,
  EnergyType,
} from '../types/trip.types'
import { logError } from '../lib/logger'
import { i18nPlugin } from '../lib/i18n/plugin'

// Validation schemas for multimodal trip planning
const CoordinateSchema = t.Object({
  lat: t.Number(),
  lng: t.Number(),
})

const RerouteBodySchema = t.Object({
  position: CoordinateSchema,
  heading: t.Optional(t.Number({ minimum: 0, maximum: 360 })),
  destination: CoordinateSchema,
  mode: t.Union([t.Literal('walking'), t.Literal('cycling'), t.Literal('driving')]),
  routingPreferences: t.Optional(t.Record(t.String(), t.Any())),
})

const WaypointSchema = t.Object({
  location: CoordinateSchema,
  address: t.Optional(t.String()),
  label: t.Optional(t.String()),
  type: t.Union([
    t.Literal('origin'),
    t.Literal('destination'),
    t.Literal('via'),
  ]),
  // Per-waypoint time constraints
  departAfter: t.Optional(t.String({ format: 'date-time' })),
  arriveBy: t.Optional(t.String({ format: 'date-time' })),
  dwellTime: t.Optional(t.Number({ minimum: 0 })),
})

const VehicleSchema = t.Object({
  id: t.String(),
  type: t.Union([
    t.Literal('car'),
    t.Literal('bike'),
    t.Literal('scooter'),
    t.Literal('e-bike'),
    t.Literal('e-scooter'),
    t.Literal('moped'),
    t.Literal('truck'),
  ]),
  energyType: t.Optional(
    t.Union([
      t.Literal('electric'),
      t.Literal('gas'),
      t.Literal('diesel'),
      t.Literal('hybrid'),
    ]),
  ),
  name: t.Optional(t.String()),
  location: t.Optional(CoordinateSchema),
})

const AccessPointSchema = t.Object({
  osmId: t.String(),
  code: t.Optional(t.String()),
  name: t.Optional(t.String()),
  location: t.Optional(CoordinateSchema),
})

const RoutingPreferencesSchema = t.Object({
  // Range preferences (0-1 floats, 5-stop sliders)
  highways: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  tolls: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  ferries: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  hills: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  surfaceQuality: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  litPaths: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  safetyVsSpeed: t.Optional(t.Number({ minimum: 0, maximum: 1 })),

  // Boolean preferences
  shortest: t.Optional(t.Boolean()),
  preferHOV: t.Optional(t.Boolean()),
  wheelchairAccessible: t.Optional(t.Boolean()),

  // Numeric/enum preferences
  cyclingSpeed: t.Optional(t.Number({ minimum: 1, maximum: 60 })),
  walkingSpeed: t.Optional(t.Number({ minimum: 0.5, maximum: 25 })),
  bicycleType: t.Optional(t.String()),

  // Transit
  maxWalkingDistance: t.Optional(t.Number({ minimum: 0 })),
  maxTransfers: t.Optional(t.Number({ minimum: 0 })),
  transitBufferMinutes: t.Optional(t.Number({ minimum: 0, maximum: 5 })),

  // UI state
  useKnownVehicleLocations: t.Optional(t.Boolean()),
  useKnownParkingLocations: t.Optional(t.Boolean()),
  includePrivateParking: t.Optional(t.Boolean()),
  routingEngine: t.Optional(t.String()),

  // Advanced: raw custom_model JSON override
  customModelOverride: t.Optional(t.String()),

  // Legacy boolean fields (backward compat)
  avoidHighways: t.Optional(t.Boolean()),
  avoidTolls: t.Optional(t.Boolean()),
  avoidFerries: t.Optional(t.Boolean()),
  avoidHills: t.Optional(t.Boolean()),
  preferLitPaths: t.Optional(t.Boolean()),
  preferPavedPaths: t.Optional(t.Boolean()),
  safetyVsEfficiency: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
})

// Schema for SelectedMode type
const SelectedModeSchema = t.Union([
  t.Literal('multi'),
  t.Literal('walking'),
  t.Literal('driving'),
  t.Literal('biking'),
  t.Literal('transit'),
  t.Literal('rideshare'),
] as const)

const SortPreferenceSchema = t.Union([
  t.Literal('shortest'),
  t.Literal('earliest_arrival'),
  t.Literal('cheapest'),
  t.Literal('fewest_transfers'),
  t.Literal('least_walking'),
  t.Literal('greenest'),
] as const)

const TripRequestSchema = t.Object({
  waypoints: t.Array(WaypointSchema, { minItems: 2 }),
  selectedMode: t.Optional(SelectedModeSchema),
  sortPreference: t.Optional(SortPreferenceSchema),
  routingPreferences: t.Optional(RoutingPreferencesSchema),
  availableVehicles: t.Optional(t.Array(VehicleSchema)),
  knownAccessPoints: t.Optional(t.Array(AccessPointSchema)),
  preferredDepartureTime: t.Optional(t.String()),
  preferredArrivalTime: t.Optional(t.String()),
  requestId: t.Optional(t.String()),
  timestamp: t.Optional(t.String()),
})

const app = new Elysia({ prefix: '/directions' }).use(i18nPlugin).use(optionalAuth)

/** Comfort hazards are a premium feature; safety ones go to everyone. */
async function seesPremiumHazards(userId: string | undefined): Promise<boolean> {
  if (!userId) return false
  return hasPermission(await getPermissions(userId), PermissionId.PREMIUM_NAVIGATION)
}

/**
 * Plan a multimodal trip (replaces original directions endpoint)
 * POST /directions/
 */
app.post(
  '/',
  async (ctx) => {
    const { body, language, user } = ctx
    try {
      const request: TripRequest = {
        language,
        waypoints: body.waypoints.map((wp, index) => ({
          location: {
            lat: wp.location.lat,
            lng: wp.location.lng,
          },
          address: wp.address,
          label: wp.label,
          type: wp.type as WaypointType,
          departAfter: wp.departAfter,
          arriveBy: wp.arriveBy,
          dwellTime: wp.dwellTime,
        })),
        selectedMode: body.selectedMode,
        sortPreference: body.sortPreference as any,
        routingPreferences: body.routingPreferences,
        availableVehicles: body.availableVehicles?.map((vehicle) => ({
          id: vehicle.id,
          type: vehicle.type as VehicleType,
          energyType: vehicle.energyType as EnergyType,
          name: vehicle.name,
          location: vehicle.location
            ? {
                lat: vehicle.location.lat,
                lng: vehicle.location.lng,
              }
            : undefined,
        })),
        knownAccessPoints: body.knownAccessPoints,
        preferredDepartureTime: body.preferredDepartureTime,
        preferredArrivalTime: body.preferredArrivalTime,
        requestId:
          body.requestId ||
          `trip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: body.timestamp || new Date().toISOString(),
      }

      // Validate departure/arrival times
      if (request.preferredDepartureTime && request.preferredArrivalTime) {
        const depTime = new Date(request.preferredDepartureTime)
        const arrTime = new Date(request.preferredArrivalTime)

        if (depTime >= arrTime) {
          throw new Error('Departure time must be before arrival time')
        }
      }

      // Plan the trip using multimodal strategy
      const result = await multimodalTripService.planTrip(request)
      const premium = await seesPremiumHazards(user?.id)
      for (const candidate of result.trips) attachHazards((candidate.trip?.segments ?? []) as any[], { premium })
      await attachLanes(result.trips.flatMap(candidate => (candidate.trip?.segments ?? []).flatMap(s => [s, ...(s.details?.multimodalSegments ?? [])])))

      return result
    } catch (error) {
      logError('Multimodal trip planning error', error)
      throw new Error(
        `Failed to plan trip: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      )
    }
  },
  {
    body: TripRequestSchema,
    detail: {
      summary: 'Plan a multimodal trip',
      description:
        'Generate multiple trip options using different transportation modes and combinations. '
        + 'A request with more than two waypoints returns one whole journey per travel '
        + 'strategy, each carried from stop to stop — a journey that cycles to the first stop '
        + 'still has the bike at the second. Segments carry `legIndex` to say which hop they '
        + 'belong to. A transit leg\'s `routeOptions` lists the other lines running the same '
        + 'stops at that time. Its `shortName` names the line; a line with no GTFS short name '
        + 'reads by its long name, and the train number moves to `trip.shortName`. A walking '
        + 'segment with `streetTransfer` leaves the paid area '
        + 'between stations the agency does not connect, so the next ride is a new fare. '
        + 'Street segments carry `hazards`: crosswalks, rail crossings, tunnels, fords, steep '
        + 'grades, stairs, sharp curves and the like, placed by distance along the segment. '
        + 'Comfort hazards (rough surfaces, dismount sections, ferries) appear only for users '
        + 'with premium navigation. Driving segments carry `drivingSide`, and where the routing '
        + 'engine knows the lanes, `laneGeometry` (the route drawn in the lanes it takes, with '
        + '`measures` giving the distance along `geometry` each coordinate stands for) and '
        + '`lanePlan` (per instruction index, the approach lanes left to right and which lead on).',
      tags: ['Trip Planning'],
    },
  },
)

app.post(
  '/reroute',
  async ({ body, language, set, user }) => {
    try {
      const segment = await rerouteSegment({ ...body, language })
      if (!segment) {
        set.status = 404
        return { error: 'No route found' }
      }
      attachHazards([segment], { premium: await seesPremiumHazards(user?.id) })
      await attachLanes([segment])
      return { segment }
    } catch (error) {
      logError('Reroute failed', error)
      set.status = 502
      return { error: error instanceof Error ? error.message : 'Reroute failed' }
    }
  },
  {
    body: RerouteBodySchema,
    detail: {
      summary: 'Reroute the current segment during navigation',
      description:
        'Plans a fresh street route from where the traveller is to the end of the segment '
        + 'they are on, favouring the direction they are already heading so the new route '
        + 'does not open with a U-turn. Send a position projected a few seconds ahead of the '
        + 'last fix. Returns one segment in the same shape as a `/directions` trip segment.',
      tags: ['Trip Planning'],
    },
  },
)

app.post(
  '/alternatives',
  async ({ body, language, set, user }) => {
    try {
      const alternatives = await alternativeSegments({ ...body, language })
      attachHazards(alternatives, { premium: await seesPremiumHazards(user?.id) })
      await attachLanes(alternatives)
      return { alternatives }
    } catch (error) {
      logError('Route alternatives failed', error)
      set.status = 502
      return { error: error instanceof Error ? error.message : 'Route alternatives failed' }
    }
  },
  {
    body: RerouteBodySchema,
    detail: {
      summary: 'Alternative routes for the rest of the current segment',
      description:
        'The same request as `/reroute`, answered with up to three routes from where the traveller '
        + 'is to the end of their segment. Each is a segment like `/reroute` returns, plus `metrics`: '
        + '`duration`, `distance`, `turns`, `protectedShare` and `majorRoadShare` (fractions of '
        + 'distance), `crossings`, and `via`, the street carrying most of the route.',
      tags: ['Trip Planning'],
    },
  },
)


/**
 * Get available vehicle types
 * GET /directions/vehicle-types
 */
app.get(
  '/vehicle-types',
  async () => {
    return {
      vehicleTypes: [
        {
          type: 'car',
          name: 'Car',
          description: 'Personal automobile',
          supportedEnergyTypes: ['gas', 'electric', 'hybrid'],
        },
        {
          type: 'bike',
          name: 'Bicycle',
          description: 'Traditional bicycle',
          supportedEnergyTypes: [],
        },
        {
          type: 'e-bike',
          name: 'Electric Bike',
          description: 'Electric-assisted bicycle',
          supportedEnergyTypes: ['electric'],
        },
        {
          type: 'scooter',
          name: 'Scooter',
          description: 'Kick scooter',
          supportedEnergyTypes: [],
        },
        {
          type: 'e-scooter',
          name: 'Electric Scooter',
          description: 'Electric scooter',
          supportedEnergyTypes: ['electric'],
        },
        {
          type: 'moped',
          name: 'Moped',
          description: 'Small motorcycle',
          supportedEnergyTypes: ['gas', 'electric'],
        },
        {
          type: 'truck',
          name: 'Truck',
          description: 'Commercial vehicle',
          supportedEnergyTypes: ['gas', 'diesel', 'electric'],
        },
      ],
    }
  },
  {
    detail: {
      summary: 'Get available vehicle types',
      description: 'List all supported vehicle types and their characteristics',
      tags: ['Trip Planning'],
    },
  },
)

/**
 * Validate a trip request without planning
 * POST /directions/validate
 */
app.post(
  '/validate',
  async ({ body }) => {
    try {
      // Basic validation
      if (!body.waypoints || body.waypoints.length < 2) {
        return {
          valid: false,
          errors: ['At least 2 waypoints are required'],
        }
      }

      const errors: string[] = []
      const warnings: string[] = []

      // Validate waypoints
      for (let i = 0; i < body.waypoints.length; i++) {
        const wp = body.waypoints[i]
        if (
          !wp.location ||
          typeof wp.location.lat !== 'number' ||
          typeof wp.location.lng !== 'number'
        ) {
          errors.push(`Waypoint ${i + 1} must have valid coordinates`)
        }

        if (Math.abs(wp.location.lat) > 90) {
          errors.push(`Waypoint ${i + 1} latitude must be between -90 and 90`)
        }

        if (Math.abs(wp.location.lng) > 180) {
          errors.push(
            `Waypoint ${i + 1} longitude must be between -180 and 180`,
          )
        }
      }

      // Validate time constraints
      if (body.preferredDepartureTime && body.preferredArrivalTime) {
        const depTime = new Date(body.preferredDepartureTime)
        const arrTime = new Date(body.preferredArrivalTime)

        if (depTime >= arrTime) {
          errors.push('Departure time must be before arrival time')
        }

        const timeDiff = arrTime.getTime() - depTime.getTime()
        if (timeDiff < 60000) {
          // Less than 1 minute
          warnings.push('Very short time window between departure and arrival')
        }
      }

      // Validate vehicles
      if (body.availableVehicles) {
        for (let i = 0; i < body.availableVehicles.length; i++) {
          const vehicle = body.availableVehicles[i]
          if (!vehicle.id || !vehicle.type) {
            errors.push(`Vehicle ${i + 1} must have id and type`)
          }
        }
      }

      // Validate routing preferences
      if (body.routingPreferences) {
        const prefs = body.routingPreferences
        if (
          prefs.safetyVsSpeed !== undefined &&
          (prefs.safetyVsSpeed < 0 || prefs.safetyVsSpeed > 1)
        ) {
          errors.push('safetyVsSpeed must be between 0 and 1')
        }

        if (
          prefs.maxWalkingDistance !== undefined &&
          prefs.maxWalkingDistance < 0
        ) {
          errors.push('maxWalkingDistance must be non-negative')
        }

        if (prefs.maxTransfers !== undefined && prefs.maxTransfers < 0) {
          errors.push('maxTransfers must be non-negative')
        }
      }

      return {
        valid: errors.length === 0,
        errors: errors.length > 0 ? errors : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
      }
    } catch (error) {
      return {
        valid: false,
        errors: ['Invalid request format'],
      }
    }
  },
  {
    body: TripRequestSchema,
    detail: {
      summary: 'Validate trip request',
      description: 'Validate a trip request without actually planning the trip',
      tags: ['Trip Planning'],
    },
  },
)

/**
 * Get service status and capabilities
 * GET /directions/status
 */
app.get(
  '/status',
  async () => {
    return {
      status: 'operational',
      version: '1.0.0',
      capabilities: {
        supportedModes: [
          'walking',
          'driving',
          'biking',
          'transit',
          'rideshare',
          'paratransit',
          'mixed',
        ],
        supportedVehicleTypes: [
          'car',
          'bike',
          'scooter',
          'e-bike',
          'e-scooter',
          'moped',
          'truck',
        ],
        features: {
          multimodalPlanning: true,
          realtimeTransit: false, // TODO: Implement when GTFS-RT is added
          vehicleStateTracking: true,
          accessibilitySupport: true,
          costEstimation: true,
          co2Estimation: true,
          hazardDetection: false, // TODO: Implement hazard detection
        },
        limits: {
          maxWaypoints: 10,
          maxVehicles: 5,
          maxTripDuration: 86400, // 24 hours in seconds
          requestTimeout: 30000, // 30 seconds
        },
      },
      integrations: {
        transitData: [], // TODO: Add GTFS feeds
        rideshareProviders: [], // TODO: Add rideshare integrations
      },
      lastUpdated: new Date().toISOString(),
    }
  },
  {
    detail: {
      summary: 'Get service status and capabilities',
      description:
        'Get the current status and capabilities of the trip planning service',
      tags: ['Trip Planning'],
    },
  },
)

// ── Persisted trip snapshots ─────────────────────────────────────────
// A planned trip the user opened is saved as a snapshot addressed by a
// random capability token (the `pt` query param in trip URLs). Schedules
// and vehicle availability drift, so re-planning can't faithfully recreate
// a past trip — the snapshot makes refresh and cross-device shares
// deterministic. Unauthenticated by design: the unguessable token is the
// access control, like an unlisted link. Rows expire after 30 days.

const PLANNED_TRIP_TTL_MS = 30 * 24 * 3600 * 1000
const PLANNED_TRIP_MAX_BYTES = 1_500_000

app.post(
  '/trips',
  async ({ body, set, t }) => {
    if (JSON.stringify(body).length > PLANNED_TRIP_MAX_BYTES) {
      set.status = 413
      return { error: t('errors.trip.snapshotTooLarge') }
    }
    const id = randomBytes(8).toString('hex')
    const expiresAt = new Date(Date.now() + PLANNED_TRIP_TTL_MS)
    await db.insert(plannedTrips).values({
      id,
      request: body.request,
      trip: body.trip,
      expiresAt,
    })
    return { id, expiresAt: expiresAt.toISOString() }
  },
  {
    body: t.Object({
      request: t.Any(),
      trip: t.Any(),
    }),
    detail: {
      summary: 'Persist a planned trip snapshot',
      description:
        'Saves the chosen trip and its planning inputs under a random ' +
        'capability token so trip URLs survive refresh and can be shared ' +
        'across devices. Snapshots expire after 30 days.',
      tags: ['Trip Planning'],
    },
  },
)

app.get(
  '/trips/:id',
  async ({ params, set, t }) => {
    const rows = await db
      .select()
      .from(plannedTrips)
      .where(eq(plannedTrips.id, params.id))
      .limit(1)
    const row = rows[0]
    if (!row) {
      set.status = 404
      return { error: t('errors.trip.snapshotNotFound') }
    }
    if (row.expiresAt.getTime() < Date.now()) {
      await db.delete(plannedTrips).where(eq(plannedTrips.id, params.id))
      set.status = 404
      return { error: t('errors.trip.snapshotExpired') }
    }
    return {
      id: row.id,
      request: row.request,
      trip: row.trip,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    }
  },
  {
    detail: {
      summary: 'Fetch a persisted trip snapshot',
      description:
        'Returns the trip and planning inputs saved under this token, or ' +
        '404 when unknown or expired.',
      tags: ['Trip Planning'],
    },
  },
)

export default app
