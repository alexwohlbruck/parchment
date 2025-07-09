import { t } from 'elysia'

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
