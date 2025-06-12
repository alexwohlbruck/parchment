import { Elysia, t } from 'elysia'
import { routingService } from '../services/routing.service'
import { tripsService } from '../services/trips.service'
import type { Location } from '../types/valhalla.types.ts'
import {
  TripsRequest,
  WaypointType,
  TravelMode,
} from '../types/unified-routing.types'

const app = new Elysia({ prefix: '/directions' })

app.post(
  '/',
  async ({ body: { locations, costing, options } }) => {
    try {
      const result = await routingService.getRoute(
        locations as Location[],
        costing,
        options,
      )

      // Return the unified route format
      return result
    } catch (error) {
      console.error('Directions error:', error)
      throw new Error(
        `Failed to get directions: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      )
    }
  },
  {
    body: t.Object({
      locations: t.Array(
        t.Object({
          type: t.Literal('coordinates'),
          value: t.Tuple([t.Number(), t.Number()]),
        }),
      ),
      costing: t.Optional(t.String()),
      options: t.Optional(t.Any()),
    }),
  },
)

app.post(
  '/trips',
  async ({ body }) => {
    try {
      const request: TripsRequest = {
        waypoints: body.waypoints.map((wp, index) => ({
          id: wp.id || `waypoint-${index}`,
          coordinate: {
            lat: wp.coordinate.lat,
            lng: wp.coordinate.lng,
          },
          type: (wp.type as WaypointType) || WaypointType.STOP,
          name: wp.name,
          arrivalTime: wp.arrivalTime ? new Date(wp.arrivalTime) : undefined,
          departureTime: wp.departureTime
            ? new Date(wp.departureTime)
            : undefined,
          serviceTime: wp.serviceTime,
          heading: wp.heading,
          radius: wp.radius,
        })),
        availableVehicles: body.availableVehicles,
        userVehicles: body.userVehicles?.map((vehicle) => ({
          id: vehicle.id,
          name: vehicle.name,
          mode: vehicle.mode as TravelMode,
          vehicleType: vehicle.vehicleType,
          height: vehicle.height,
          width: vehicle.width,
          weight: vehicle.weight,
          avoidTolls: vehicle.avoidTolls,
          avoidHighways: vehicle.avoidHighways,
          maxSpeed: vehicle.maxSpeed,
        })),
        departureTime: body.departureTime
          ? new Date(body.departureTime)
          : undefined,
        arrivalTime: body.arrivalTime ? new Date(body.arrivalTime) : undefined,
        maxOptions: body.maxOptions || 3,
        includeWalking: body.includeWalking !== false,
        preferences: body.preferences,
        requestId: body.requestId,
      }

      const result = await tripsService.getTrips(request)
      return result
    } catch (error) {
      console.error('Trips error:', error)
      throw new Error(
        `Failed to get trips: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      )
    }
  },
  {
    body: t.Object({
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
    }),
  },
)

export default app
