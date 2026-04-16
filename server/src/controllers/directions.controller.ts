import { Elysia, t } from 'elysia'
import { DEFAULT_LANGUAGE } from '../lib/i18n/i18n.types'
import { multimodalTripService } from '../services/trip.service'
import {
  TripRequest,
  SelectedMode,
  VehicleType,
  WaypointType,
  EnergyType,
} from '../types/trip.types'

// Validation schemas for multimodal trip planning
const CoordinateSchema = t.Object({
  lat: t.Number(),
  lng: t.Number(),
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
})

const VehicleSchema = t.Object({
  id: t.String(),
  type: t.Union([
    t.Literal('car'),
    t.Literal('bike'),
    t.Literal('scooter'),
    t.Literal('e-bike'),
    t.Literal('e-scooter'),
    t.Literal('wheelchair'),
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

  // UI state
  useKnownVehicleLocations: t.Optional(t.Boolean()),
  useKnownParkingLocations: t.Optional(t.Boolean()),
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
  t.Literal('wheelchair'),
] as const)

const TripRequestSchema = t.Object({
  waypoints: t.Array(WaypointSchema, { minItems: 2 }),
  selectedMode: t.Optional(SelectedModeSchema),
  routingPreferences: t.Optional(RoutingPreferencesSchema),
  availableVehicles: t.Optional(t.Array(VehicleSchema)),
  knownAccessPoints: t.Optional(t.Array(AccessPointSchema)),
  preferredDepartureTime: t.Optional(t.String()),
  preferredArrivalTime: t.Optional(t.String()),
  requestId: t.Optional(t.String()),
  timestamp: t.Optional(t.String()),
})

const app = new Elysia({ prefix: '/directions' })

/**
 * Plan a multimodal trip (replaces original directions endpoint)
 * POST /directions/
 */
app.post(
  '/',
  async (ctx) => {
    const { body, i18n } = ctx as typeof ctx & { i18n?: { language: import('../lib/i18n').Language } }
    try {
      // Language from elysia-i18next context; fallback from lib/i18n config only (no magic strings)
      const request: TripRequest = {
        language: i18n?.language ?? DEFAULT_LANGUAGE,
        waypoints: body.waypoints.map((wp, index) => ({
          location: {
            lat: wp.location.lat,
            lng: wp.location.lng,
          },
          address: wp.address,
          label: wp.label,
          type: wp.type as WaypointType,
        })),
        selectedMode: body.selectedMode,
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

      return result
    } catch (error) {
      console.error('Multimodal trip planning error:', error)
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
        'Generate multiple trip options using different transportation modes and combinations',
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
          type: 'wheelchair',
          name: 'Wheelchair',
          description: 'Mobility device',
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
          'wheelchair',
          'paratransit',
          'mixed',
        ],
        supportedVehicleTypes: [
          'car',
          'bike',
          'scooter',
          'e-bike',
          'e-scooter',
          'wheelchair',
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

export default app
