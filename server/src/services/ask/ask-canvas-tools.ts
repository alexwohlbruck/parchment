import {
  createCanvas,
  createPublicLink,
  getCanvases,
  PublicLinkNotAllowedOnE2eeError,
  setCanvasArchived,
  updateCanvas,
} from '../library/canvases.service'
import { getRouteById, setRouteArchived } from '../library/routes.service'
import { clientOrigin } from '../../config/origins.config'
import { askCanvasBody, type CanvasArea, type CanvasPlaceGroup, type CanvasRoute } from '../../lib/ask/ask-canvas'
import { ISOCHRONE_MODES, type IsochroneMode } from '../../types/isochrone.types'
import type { RouteBody } from '../../schema/routes.schema'
import type { CanvasBody } from '../../schema/canvases.schema'
import { requireLibrary } from './ask-library-tools'
import { reachPolygon } from './ask-reach'
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

interface AreaArg {
  from?: PointArg
  mode: IsochroneMode
  minutes: number
  name?: string
}

const AREA_MODES: Record<IsochroneMode, string> = {
  walk: 'walk',
  bike: 'ride',
  car: 'drive',
  transit: 'by transit',
}

async function reachArea(area: AreaArg, context: AskContext): Promise<CanvasArea> {
  const from = await endpoint(area.from, context)
  const polygon = await reachPolygon({ lat: from.lat, lng: from.lng }, area.mode, area.minutes, context)
  return {
    name: area.name?.trim() || `${area.minutes} min ${AREA_MODES[area.mode] ?? area.mode}${from.name ? ` from ${from.name}` : ''}`,
    geometry: polygon.geometry,
  }
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
  areas?: AreaArg[]
  include_trip?: boolean
}> = {
  name: 'create_canvas',
  description:
    "Save a canvas (a map of the user's own, kept in their library) with saved routes, points in named layers, shaded areas a travel time reaches, and optionally the trip plan_trip proposed.",
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
      areas: {
        type: 'array',
        description: 'Areas to shade: how far a travel time reaches from a point',
        items: {
          type: 'object',
          properties: {
            from: pointSchema('Where the time is measured from.'),
            mode: { type: 'string', enum: [...ISOCHRONE_MODES] },
            minutes: { type: 'number' },
            name: { type: 'string' },
          },
          required: ['mode', 'minutes'],
        },
      },
      include_trip: { type: 'boolean', description: 'Draw the trip plan_trip proposed' },
    },
    required: ['name'],
  },
  label: () => 'Making a canvas',
  detail: ({ name }) => name,
  async run(args, context) {
    await requireLibrary(context.userId)
    const [groups, routes, areas] = await Promise.all([
      Promise.all((args.layers ?? []).map((layer) => placeGroup(layer, context))),
      Promise.all([...new Set(args.route_ids ?? [])].map((id) => savedRoute(id, context))),
      Promise.all((args.areas ?? []).map((area) => reachArea(area, context))),
    ])
    const trip = args.include_trip ? context.trip : undefined
    if (!groups.some((group) => group.places.length) && !routes.length && !areas.length && !trip) {
      throw new AskToolError('Nothing to put on the canvas: build a route, find places or plan a trip first.')
    }
    const name = args.name.trim() || 'Canvas'
    const canvas = await createCanvas({ userId: context.userId })
    await updateCanvas(canvas.id, context.userId, {
      name,
      description: args.description?.trim() || null,
      body: askCanvasBody(groups, { trip, routes, areas }),
    })
    context.emit({ type: 'canvas', id: canvas.id, name })
    return {
      saved: true,
      id: canvas.id,
      name,
      layers: groups.length + routes.length + areas.length + (trip ? 1 : 0),
    }
  },
}

const myCanvases: AskTool<Record<string, never>> = {
  name: 'my_canvases',
  description: "The canvases saved in the user's library, newest first. Private ones are encrypted and have no name here.",
  parameters: { type: 'object', properties: {} },
  label: () => 'Checking your canvases',
  async run(_args, context) {
    const canvases = await getCanvases(context.userId)
    return canvases
      .filter((canvas) => !canvas.archivedAt && canvas.scheme === 'server-key')
      .map((canvas) => ({
        id: canvas.id,
        name: canvas.name ?? 'Untitled canvas',
        ...(canvas.description && { description: canvas.description }),
        layers: (canvas.body as CanvasBody | null)?.layers?.length ?? 0,
        shared: !!canvas.publicToken,
        updated: canvas.updatedAt.toISOString().slice(0, 10),
      }))
  },
}

const shareCanvas: AskTool<{ id: string }> = {
  name: 'share_canvas',
  description:
    'A public link to a canvas that anyone can open without signing in. Only when the user asks to share it or wants a link.',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: 'From create_canvas or my_canvases' } },
    required: ['id'],
  },
  label: () => 'Making a share link',
  async run({ id }, context) {
    await requireLibrary(context.userId)
    const link = await createPublicLink(id, context.userId).catch((error) => {
      if (error instanceof PublicLinkNotAllowedOnE2eeError) {
        throw new AskToolError("Private canvases can't be shared by link.")
      }
      throw error
    })
    if (!link) throw new AskToolError(`Unknown canvas ${id}. Use an id create_canvas or my_canvases returned.`)
    return { url: `${clientOrigin?.replace(/\/$/, '') ?? ''}/c/${link.publicToken}` }
  },
}

const archiveTool: AskTool<{ kind: 'route' | 'canvas'; id: string; restore?: boolean }> = {
  name: 'archive',
  description:
    "File a route or canvas away in the user's archive, or bring it back with restore. Only when the user asks. Nothing is deleted.",
  parameters: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['route', 'canvas'] },
      id: { type: 'string' },
      restore: { type: 'boolean', description: 'Take it back out of the archive' },
    },
    required: ['kind', 'id'],
  },
  label: ({ restore }) => (restore ? 'Restoring' : 'Archiving'),
  async run({ kind, id, restore }, context) {
    await requireLibrary(context.userId)
    const archived = !restore
    const updated =
      kind === 'route'
        ? await setRouteArchived(id, context.userId, archived)
        : await setCanvasArchived(id, context.userId, archived)
    if (!updated) throw new AskToolError(`Unknown ${kind} ${id}.`)
    context.emit({ type: 'archived', kind, id, archived })
    return { archived, kind, id }
  },
}

export const canvasTools: AskTool[] = [createCanvasTool, myCanvases, shareCanvas, archiveTool]
