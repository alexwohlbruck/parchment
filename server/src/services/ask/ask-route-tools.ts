import { planTripFor } from '../planned-trip.service'
import { createRoute, getRoutes, updateRoute } from '../library/routes.service'
import { getPermissions, hasPermission } from '../auth.service'
import { PermissionId } from '../../types/auth.types'
import { pathFromTrip } from '../../lib/directions/route-path'
import { climbText, distanceText } from '../../lib/ask/distance-text'
import { ASK_ROUTE_MODES, type AskEndpoint, type AskRouteMode, type AskUnits } from '../../types/ask.types'
import type { RouteBody } from '../../schema/routes.schema'
import type { SelectedMode, TripResponse, Waypoint } from '../../types/trip.types'
import {
  AskToolError,
  endpoint,
  pointSchema,
  type AskContext,
  type AskTool,
  type PointArg,
} from './ask-tool-base'

const MAX_POINTS = 25

const ROUTE_TAB: Record<AskRouteMode, SelectedMode> = {
  cycling: 'biking',
  walking: 'walking',
  driving: 'driving',
}

const ROUTE_SEGMENT: Record<AskRouteMode, string> = {
  cycling: 'biking',
  walking: 'walking',
  driving: 'driving',
}

function waypoints(points: AskEndpoint[]): Waypoint[] {
  return points.map((point, index) => ({
    location: { lat: point.lat, lng: point.lng },
    type: index === 0 ? 'origin' : index === points.length - 1 ? 'destination' : 'via',
    label: point.name ?? '',
  }))
}

/** The trip that travels the whole way in the route's own mode, as the route builder snaps it. */
function routedTrip(trips: { trip: TripResponse }[], mode: AskRouteMode): TripResponse | undefined {
  const own = trips.find(({ trip }) => trip.segments.some((segment) => segment.mode === ROUTE_SEGMENT[mode]))
  return (own ?? trips[0])?.trip
}

function stats(body: RouteBody, units: AskUnits) {
  const stats = body.stats
  return {
    distance: distanceText(stats?.distance ?? 0, units),
    minutes: Math.round((stats?.duration ?? 0) / 60),
    ...(stats?.elevationGain && { climb: climbText(stats.elevationGain, units) }),
  }
}

async function requireLibrary(userId: string) {
  if (!hasPermission(await getPermissions(userId), PermissionId.LIBRARY_WRITE)) {
    throw new AskToolError('Saving to the library needs a Basic or Premium plan.')
  }
}

const createRouteTool: AskTool<{
  name: string
  mode?: AskRouteMode
  points: PointArg[]
  loop?: boolean
}> = {
  name: 'create_route',
  description:
    "Build and save a route to the user's library, as the app's route builder does: the routing engine snaps a path through the points in order, on paths suited to the mode. For a ride, run or walk taken for its own sake (a loop, a tour, around an island, over a bridge), not for getting somewhere. The user can open it, edit it and turn it into directions.",
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short title, e.g. "Manhattan loop via Randall\'s Island"' },
      mode: { type: 'string', enum: [...ASK_ROUTE_MODES], description: 'Defaults to cycling' },
      points: {
        type: 'array',
        minItems: 2,
        maxItems: MAX_POINTS,
        description:
          'Where the route goes, in order. Enough of them to hold the path to the way you mean: to follow a shoreline or greenway, give points along it (parks, piers, bridges), not just its ends. Place ids, names, known places like "home", or coordinates.',
        items: pointSchema('A point on the route.'),
      },
      loop: { type: 'boolean', description: 'Return to the first point at the end' },
    },
    required: ['name', 'points'],
  },
  label: () => 'Building a route',
  detail: ({ name }) => name,
  async run(args, context) {
    await requireLibrary(context.userId)
    const mode = args.mode ?? 'cycling'
    const given = args.points ?? []
    if (given.length < 2) throw new AskToolError('A route needs at least 2 points.')
    if (given.length > MAX_POINTS) throw new AskToolError(`A route takes at most ${MAX_POINTS} points.`)
    const points = await Promise.all(given.map((point) => endpoint(point, context)))
    if (args.loop) points.push(points[0])

    const plan = await planTripFor(
      {
        waypoints: waypoints(points),
        selectedMode: ROUTE_TAB[mode],
        excludedModes: ['bikeshare', 'transit', 'rideshare'],
        routingPreferences: { ...context.routingPreferences, useKnownParkingLocations: false },
        availableVehicles: [],
        language: context.language,
        requestId: `ask-route-${crypto.randomUUID()}`,
      },
      context.userId,
    )
    const trip = routedTrip(plan.trips, mode)
    if (!trip) throw new AskToolError('No route through those points: move one onto a street or path.')

    const name = args.name.trim() || 'Route'
    const path = pathFromTrip(trip)
    const body: RouteBody = {
      name,
      waypoints: points.map(({ lat, lng, name }) => ({ lat, lng, ...(name && { name }) })),
      geometry: path.geometry,
      ...(path.elevation && { elevation: path.elevation }),
      segments: path.segments,
      pathMode: 'snap',
      stats: path.stats,
    }
    const route = await createRoute({ userId: context.userId, mode, scheme: 'server-key' })
    await updateRoute(route.id, context.userId, {
      body,
      distance: path.stats.distance,
      duration: path.stats.duration,
      elevationGain: path.stats.elevationGain ?? null,
      elevationLoss: path.stats.elevationLoss ?? null,
    })
    context.routes.set(route.id, { name })
    context.emit({
      type: 'route',
      id: route.id,
      name,
      mode,
      distance: path.stats.distance,
      duration: path.stats.duration,
      ...(path.stats.elevationGain && { elevationGain: path.stats.elevationGain }),
    })
    return { saved: true, id: route.id, name, ...stats(body, context.units) }
  },
}

/** Ask names the routes it builds; the user's own names are encrypted, so those go by their ends. */
function routeLabel(body: RouteBody): string {
  if (body.name) return body.name
  const named = body.waypoints.filter((point) => point.name)
  return named.length ? [named[0].name, named.at(-1)!.name].filter(Boolean).join(' to ') : 'A saved route'
}

const myRoutes: AskTool<Record<string, never>> = {
  name: 'my_routes',
  description:
    "The routes saved in the user's library, with their distance and climb, to put on a canvas or plan directions along.",
  parameters: { type: 'object', properties: {} },
  label: () => 'Checking your routes',
  async run(_args, context) {
    const routes = await getRoutes(context.userId)
    return routes
      .filter((route) => !route.archivedAt && route.body)
      .map((route) => {
        const body = route.body as RouteBody
        return {
          id: route.id,
          name: routeLabel(body),
          mode: route.mode,
          ...stats(body, context.units),
          stops: body.waypoints.length,
        }
      })
  },
}

export const routeTools: AskTool[] = [createRouteTool, myRoutes]
