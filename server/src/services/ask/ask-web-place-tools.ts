import { summarizePlace } from '../../lib/ask/place-summary'
import { findPlaceOnWeb, WebPlaceError } from '../web-place.service'
import {
  AskToolError,
  cached,
  centre,
  nearSchema,
  type AskTool,
  type PointArg,
} from './ask-tool-base'

const findPlaceOnWebTool: AskTool<{ query: string; near?: PointArg; website?: string }> = {
  name: 'find_place_on_web',
  description:
    "Last resort for a named business that find_places can't find: finds the business's own website and reads the place from it. Returns a place you can cite that isn't on the map yet (the app offers to add it), the mapped place if the map has it after all, or why it couldn't be confirmed.",
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The business name and its city, e.g. "Sunflower Bakery, Asheville"',
      },
      near: nearSchema,
      website: {
        type: 'string',
        description: "The business's own website, when already known. Never a directory, review or social media page.",
      },
    },
    required: ['query'],
  },
  label: () => 'Looking for its website',
  detail: ({ query }) => query,
  async run({ query, near, website }, context) {
    const origin = await centre(near, context)
    const lookup = await cached(
      'find_place_on_web',
      { query, website, origin: { lat: origin.lat.toFixed(2), lng: origin.lng.toFixed(2) } },
      { language: context.language },
      () =>
        findPlaceOnWeb(query, {
          near: origin,
          website,
          model: context.model,
          language: context.language,
          signal: context.signal,
        }),
    ).catch((error) => {
      throw error instanceof WebPlaceError ? new AskToolError(error.message) : error
    })
    if (lookup.status === 'not-found') return lookup
    const { place } = lookup
    context.seen.set(place.id, place)
    const summary = summarizePlace(place, { now: context.now, origin, units: context.units })
    return lookup.status === 'mapped'
      ? { status: 'on-map', place: summary }
      : {
          status: 'not-on-map',
          place: summary,
          website: place.contactInfo.website?.value,
          alsoMentionedBy: lookup.corroboratedBy,
        }
  },
}

export const webPlaceTools: AskTool[] = [findPlaceOnWebTool]
