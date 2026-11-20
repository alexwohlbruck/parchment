import { planTripFor } from '../planned-trip.service'
import { createRoute, getRouteById, getRoutes, updateRoute } from '../library/routes.service'
import { requireLibrary } from './ask-library-tools'
import { pathFromTrip, type RoutePath } from '../../lib/directions/route-path'
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
    const points = await routePoints(args.points ?? [], args.loop, context)
    const path = await snap(points, mode, context)
    const route = await createRoute({ userId: context.userId, mode, scheme: 'server-key' })
    return saveRoute(route.id, args.name.trim() || 'Route', mode, points, path, context)
  },
}

const editRoute: AskTool<{
  id: string
  name?: string
  mode?: AskRouteMode
  points?: PointArg[]
  loop?: boolean
}> = {
  name: 'edit_route',
  description:
    'Change a saved route: give new points to re-route it (all of them, in order), a mode to re-snap it for another way of travelling, or a new name.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'From create_route or my_routes' },
      name: { type: 'string' },
      mode: { type: 'string', enum: [...ASK_ROUTE_MODES] },
      points: {
        type: 'array',
        minItems: 2,
        maxItems: MAX_POINTS,
        description: 'Every point of the new route, in order',
        items: pointSchema('A point on the route.'),
      },
      loop: { type: 'boolean', description: 'Return to the first point at the end' },
    },
    required: ['id'],
  },
  label: () => 'Changing the route',
  async run(args, context) {
    await requireLibrary(context.userId)
    const route = await getRouteById(args.id, context.userId)
    const body = route?.body as RouteBody | null | undefined
    if (!route || route.scheme !== 'server-key' || !body) {
      throw new AskToolError(`Can't change route ${args.id}: use an id create_route or my_routes returned.`)
    }
    const mode = args.mode ?? (route.mode as AskRouteMode)
    const points = args.points?.length
      ? await routePoints(args.points, args.loop, context)
      : body.waypoints.map(({ lat, lng, name }) => ({ lat, lng, ...(name && { name }) }))
    const path = args.points?.length || args.mode ? await snap(points, mode, context) : undefined
    const name = args.name?.trim() || routeLabel(body)
    if (args.mode && args.mode !== route.mode) await updateRoute(route.id, context.userId, { mode })
    if (path) return saveRoute(route.id, name, mode, points, path, context)
    await updateRoute(route.id, context.userId, { body: { ...body, name } })
    context.routes.set(route.id, { name })
    return { saved: true, id: route.id, name, ...stats(body, context.units) }
  },
}

async function routePoints(given: PointArg[], loop: boolean | undefined, context: AskContext) {
  if (given.length < 2) throw new AskToolError('A route needs at least 2 points.')
  if (given.length > MAX_POINTS) throw new AskToolError(`A route takes at most ${MAX_POINTS} points.`)
  const points = await Promise.all(given.map((point) => endpoint(point, context)))
  if (loop) points.push(points[0])
  return points
}

/** Snaps a path through the points as the route builder does: one trip on the mode's own Directions tab. */
async function snap(points: AskEndpoint[], mode: AskRouteMode, context: AskContext): Promise<RoutePath> {
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
  return pathFromTrip(trip)
}

async function saveRoute(
  id: string,
  name: string,
  mode: AskRouteMode,
  points: AskEndpoint[],
  path: RoutePath,
  context: AskContext,
) {
  const body: RouteBody = {
    name,
    waypoints: points.map(({ lat, lng, name }) => ({ lat, lng, ...(name && { name }) })),
    geometry: path.geometry,
    ...(path.elevation && { elevation: path.elevation }),
    segments: path.segments,
    pathMode: 'snap',
    stats: path.stats,
  }
  await updateRoute(id, context.userId, {
    body,
    distance: path.stats.distance,
    duration: path.stats.duration,
    elevationGain: path.stats.elevationGain ?? null,
    elevationLoss: path.stats.elevationLoss ?? null,
  })
  context.routes.set(id, { name })
  context.emit({
    type: 'route',
    id,
    name,
    mode,
    distance: path.stats.distance,
    duration: path.stats.duration,
    ...(path.stats.elevationGain && { elevationGain: path.stats.elevationGain }),
  })
  return { saved: true, id, name, ...stats(body, context.units) }
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

export const routeTools: AskTool[] = [createRouteTool, editRoute, myRoutes]
