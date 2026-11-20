import { t } from 'elysia'
import { TRIP_MODE_TOKENS } from './departure-profile.types'

export const CoordinateSchema = t.Object({
  lat: t.Number(),
  lng: t.Number(),
})

/** A vehicle the user owns, where it is now, for trips that pick it up. */
export const VehicleSchema = t.Object({
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

// Route request schema for the basic directions endpoint
export const RouteRequestSchema = t.Object({
  locations: t.Array(
    t.Object({
      type: t.Literal('coordinates'),
      value: t.Tuple([t.Number(), t.Number()]),
    }),
  ),
  costing: t.Optional(t.String()),
  options: t.Optional(t.Any()),
})

// Trips request schema for the trips endpoint
export const TripsRequestSchema = t.Object({
  waypoints: t.Array(
    t.Object({
      id: t.Optional(t.String()),
      coordinate: t.Object({
        lat: t.Number(),
        lng: t.Number(),
      }),
      type: t.Optional(
        t.Union([
          t.Literal('stop'),
          t.Literal('via'),
          t.Literal('transfer'),
          t.Literal('hazard'),
        ]),
      ),
      name: t.Optional(t.String()),
      arrivalTime: t.Optional(t.String()),
      departureTime: t.Optional(t.String()),
      serviceTime: t.Optional(t.Number()),
      heading: t.Optional(t.Number()),
      radius: t.Optional(t.Number()),
    }),
  ),
  availableVehicles: t.Optional(
    t.Array(
      t.Union([
        t.Literal('car'),
        t.Literal('bike'),
        t.Literal('scooter'),
        t.Literal('motorcycle'),
        t.Literal('truck'),
        t.Literal('walking'),
      ]),
    ),
  ),
  userVehicles: t.Optional(
    t.Array(
      t.Object({
        id: t.String(),
        name: t.String(),
        mode: t.Union([
          t.Literal('driving'),
          t.Literal('walking'),
          t.Literal('cycling'),
          t.Literal('transit'),
          t.Literal('motorcycle'),
          t.Literal('truck'),
        ]),
        vehicleType: t.Union([
          t.Literal('car'),
          t.Literal('bike'),
          t.Literal('scooter'),
          t.Literal('motorcycle'),
          t.Literal('truck'),
          t.Literal('walking'),
        ]),
        height: t.Optional(t.Number()),
        width: t.Optional(t.Number()),
        weight: t.Optional(t.Number()),
        avoidTolls: t.Optional(t.Boolean()),
        avoidHighways: t.Optional(t.Boolean()),
        maxSpeed: t.Optional(t.Number()),
      }),
    ),
  ),
  departureTime: t.Optional(t.String()),
  arrivalTime: t.Optional(t.String()),
  maxOptions: t.Optional(t.Number()),
  includeWalking: t.Optional(t.Boolean()),
  preferences: t.Optional(
    t.Object({
      optimize: t.Optional(
        t.Union([
          t.Literal('time'),
          t.Literal('distance'),
          t.Literal('balanced'),
        ]),
      ),
      alternatives: t.Optional(t.Boolean()),
      maxAlternatives: t.Optional(t.Number()),
      avoidTolls: t.Optional(t.Boolean()),
      avoidHighways: t.Optional(t.Boolean()),
      avoidFerries: t.Optional(t.Boolean()),
      avoidUnpaved: t.Optional(t.Boolean()),
      maxWalkDistance: t.Optional(t.Number()),
      maxTransfers: t.Optional(t.Number()),
      wheelchairAccessible: t.Optional(t.Boolean()),
      providerOptions: t.Optional(t.Record(t.String(), t.Any())),
    }),
  ),
  requestId: t.Optional(t.String()),
})

// Single trip request schema for the trip endpoint
export const SingleTripRequestSchema = t.Object({
  waypoints: t.Array(
    t.Object({
      id: t.Optional(t.String()),
      coordinate: t.Object({
        lat: t.Number(),
        lng: t.Number(),
      }),
      type: t.Optional(
        t.Union([
          t.Literal('stop'),
          t.Literal('via'),
          t.Literal('transfer'),
          t.Literal('hazard'),
        ]),
      ),
      name: t.Optional(t.String()),
      arrivalTime: t.Optional(t.String()),
      departureTime: t.Optional(t.String()),
      serviceTime: t.Optional(t.Number()),
      heading: t.Optional(t.Number()),
      radius: t.Optional(t.Number()),
    }),
  ),
  mode: t.Union([
    t.Literal('driving'),
    t.Literal('walking'),
    t.Literal('cycling'),
    t.Literal('transit'),
    t.Literal('motorcycle'),
    t.Literal('truck'),
  ]),
  vehicleType: t.Optional(
    t.Union([
      t.Literal('car'),
      t.Literal('bike'),
      t.Literal('scooter'),
      t.Literal('motorcycle'),
      t.Literal('truck'),
      t.Literal('walking'),
    ]),
  ),
  userVehicles: t.Optional(
    t.Array(
      t.Object({
        id: t.String(),
        name: t.String(),
        mode: t.Union([
          t.Literal('driving'),
          t.Literal('walking'),
          t.Literal('cycling'),
          t.Literal('transit'),
          t.Literal('motorcycle'),
          t.Literal('truck'),
        ]),
        vehicleType: t.Union([
          t.Literal('car'),
          t.Literal('bike'),
          t.Literal('scooter'),
          t.Literal('motorcycle'),
          t.Literal('truck'),
          t.Literal('walking'),
        ]),
        height: t.Optional(t.Number()),
        width: t.Optional(t.Number()),
        weight: t.Optional(t.Number()),
        avoidTolls: t.Optional(t.Boolean()),
        avoidHighways: t.Optional(t.Boolean()),
        maxSpeed: t.Optional(t.Number()),
      }),
    ),
  ),
  departureTime: t.Optional(t.String()),
  arrivalTime: t.Optional(t.String()),
  preferences: t.Optional(
    t.Object({
      optimize: t.Optional(
        t.Union([
          t.Literal('time'),
          t.Literal('distance'),
          t.Literal('balanced'),
        ]),
      ),
      alternatives: t.Optional(t.Boolean()),
      maxAlternatives: t.Optional(t.Number()),
      avoidTolls: t.Optional(t.Boolean()),
      avoidHighways: t.Optional(t.Boolean()),
      avoidFerries: t.Optional(t.Boolean()),
      avoidUnpaved: t.Optional(t.Boolean()),
      maxWalkDistance: t.Optional(t.Number()),
      maxTransfers: t.Optional(t.Number()),
      wheelchairAccessible: t.Optional(t.Boolean()),
      providerOptions: t.Optional(t.Record(t.String(), t.Any())),
    }),
  ),
  requestId: t.Optional(t.String()),
})

export const RoutingPreferencesSchema = t.Object({
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

export const TripModeTokenSchema = t.UnionEnum(TRIP_MODE_TOKENS)
