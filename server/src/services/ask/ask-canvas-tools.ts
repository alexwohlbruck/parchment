import { createCanvas, updateCanvas } from '../library/canvases.service'
import { getRouteById } from '../library/routes.service'
import { getPermissions, hasPermission } from '../auth.service'
import { PermissionId } from '../../types/auth.types'
import { askCanvasBody, type CanvasPlaceGroup, type CanvasRoute } from '../../lib/ask/ask-canvas'
import type { RouteBody } from '../../schema/routes.schema'
import {
  AskToolError,
  endpoint,
  pointSchema,
  type AskContext,
  type AskTool,
  type PointArg,
} from './ask-tool-base'

interface LayerArg {
  name: string
  points: PointArg[]
  color?: string
}

async function placeGroup(layer: LayerArg, context: AskContext): Promise<CanvasPlaceGroup> {
  const places = await Promise.all(
    (layer.points ?? []).map(async (point) => {
      const { lat, lng, name, placeId } = await endpoint(point, context)
      const type = placeId ? context.seen.get(placeId)?.placeType?.value : undefined
      return {
        lat,
        lng,
        name: name ?? type ?? 'Place',
        ...(placeId && { placeId }),
        ...(type && { type }),
      }
    }),
  )
  return { name: layer.name || 'Places', color: layer.color, places }
}

async function savedRoute(id: string, context: AskContext): Promise<CanvasRoute> {
  const route = await getRouteById(id, context.userId)
  if (!route) throw new AskToolError(`Unknown route ${id}. Use ids create_route or my_routes returned.`)
  const geometry = (route.body as RouteBody | null)?.geometry ?? []
  return {
    routeId: id,
    path: geometry.map(([lng, lat]) => ({ lat, lng })),
  }
}

const createCanvasTool: AskTool<{
  name: string
  description?: string
  layers?: LayerArg[]
  route_ids?: string[]
  include_trip?: boolean
}> = {
  name: 'create_canvas',
  description:
    "Save a canvas (a map of the user's own, kept in their library) with saved routes, points in named layers, and optionally the trip plan_trip proposed.",
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short title, e.g. "Pizza in the East Village"' },
      description: { type: 'string' },
      route_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Routes to draw, by the id create_route or my_routes returned',
      },
      layers: {
        type: 'array',
        description: 'One layer per kind of point, e.g. "Pizza" and "Bagels", or "Stops" on a route',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            points: {
              type: 'array',
              items: pointSchema('A point to mark: a place id a tool returned, a known place like "home", or coordinates.'),
            },
            color: { type: 'string', description: 'Hex colour, e.g. #dc2626' },
          },
          required: ['name', 'points'],
        },
      },
      include_trip: { type: 'boolean', description: 'Draw the trip plan_trip proposed' },
    },
    required: ['name'],
  },
  label: () => 'Making a canvas',
  detail: ({ name }) => name,
  async run(args, context) {
    if (!hasPermission(await getPermissions(context.userId), PermissionId.LIBRARY_WRITE)) {
      throw new AskToolError('Saving canvases needs a Basic or Premium plan.')
    }
    const [groups, routes] = await Promise.all([
      Promise.all((args.layers ?? []).map((layer) => placeGroup(layer, context))),
      Promise.all([...new Set(args.route_ids ?? [])].map((id) => savedRoute(id, context))),
    ])
    const trip = args.include_trip ? context.trip : undefined
    if (!groups.some((group) => group.places.length) && !routes.length && !trip) {
      throw new AskToolError('Nothing to put on the canvas: build a route, find places or plan a trip first.')
    }
    const name = args.name.trim() || 'Canvas'
    const canvas = await createCanvas({ userId: context.userId })
    await updateCanvas(canvas.id, context.userId, {
      name,
      description: args.description?.trim() || null,
      body: askCanvasBody(groups, { trip, routes }),
    })
    context.emit({ type: 'canvas', id: canvas.id, name })
    return { saved: true, id: canvas.id, name, layers: groups.length + routes.length + (trip ? 1 : 0) }
  },
}

export const canvasTools: AskTool[] = [createCanvasTool]
