import { createCanvas, updateCanvas } from '../library/canvases.service'
import { getPermissions, hasPermission } from '../auth.service'
import { PermissionId } from '../../types/auth.types'
import { askCanvasBody, type CanvasPlaceGroup } from '../../lib/ask/ask-canvas'
import { AskToolError, type AskContext, type AskTool } from './ask-tool-base'

interface LayerArg {
  name: string
  place_ids: string[]
  color?: string
}

function placeGroup(layer: LayerArg, context: AskContext, unknown: string[]): CanvasPlaceGroup {
  const places = (layer.place_ids ?? []).flatMap((id) => {
    const place = context.seen.get(id)
    const center = place?.geometry?.value?.center
    if (!place || !center) {
      unknown.push(id)
      return []
    }
    return [{
      lat: center.lat,
      lng: center.lng,
      name: place.name.value ?? place.placeType?.value ?? 'Place',
      placeId: id,
      ...(place.placeType?.value && { type: place.placeType.value }),
    }]
  })
  return { name: layer.name || 'Places', color: layer.color, places }
}

const createCanvasTool: AskTool<{
  name: string
  description?: string
  layers?: LayerArg[]
  include_trip?: boolean
}> = {
  name: 'create_canvas',
  description:
    "Save a canvas (a map of the user's own, kept in their library) with places tools returned, in named layers, and optionally the trip plan_trip proposed. Only when the user asks for a map or canvas.",
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short title, e.g. "Pizza in the East Village"' },
      description: { type: 'string' },
      layers: {
        type: 'array',
        description: 'One layer per kind of place, e.g. "Pizza" and "Bagels"',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            place_ids: { type: 'array', items: { type: 'string' }, description: 'Ids tools returned' },
            color: { type: 'string', description: 'Hex colour, e.g. #dc2626' },
          },
          required: ['name', 'place_ids'],
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
    const unknown: string[] = []
    const groups = (args.layers ?? []).map((layer) => placeGroup(layer, context, unknown))
    if (unknown.length) {
      throw new AskToolError(`Unknown place ids ${unknown.join(', ')}. Use only ids tools returned.`)
    }
    const trip = args.include_trip ? context.trip : undefined
    if (!groups.some((group) => group.places.length) && !trip) {
      throw new AskToolError('Nothing to put on the canvas: find places or plan a trip first.')
    }
    const name = args.name.trim() || 'Canvas'
    const canvas = await createCanvas({ userId: context.userId })
    await updateCanvas(canvas.id, context.userId, {
      name,
      description: args.description?.trim() || null,
      body: askCanvasBody(groups, trip),
    })
    context.emit({ type: 'canvas', id: canvas.id, name })
    return { saved: true, name, layers: groups.length + (trip ? 1 : 0) }
  },
}

export const canvasTools: AskTool[] = [createCanvasTool]
