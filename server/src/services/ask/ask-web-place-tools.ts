import { randomUUID } from 'node:crypto'
import { summarizePlace } from '../../lib/ask/place-summary'
import { findPlaceOnWeb, WebPlaceError, type WebPlaceStage } from '../web-place.service'
import { mentionsAddress } from '../../lib/web-place/address-match'
import {
  AskToolError,
  cached,
  centre,
  nearSchema,
  type AskContext,
  type AskTool,
  type PointArg,
} from './ask-tool-base'

const STAGE_LABELS: Record<WebPlaceStage, string> = {
  site: 'Finding the website',
  read: 'Reading the website',
  classify: 'Figuring out what kind of place it is',
  images: 'Checking its photos for an address',
  fields: 'Getting the details',
  locate: 'Finding the address',
  map: 'Checking the map',
}

/** Shows each stage of a lookup as a step of its own, closing the last one when the next begins. */
function stageSteps(context: AskContext) {
  const run = randomUUID()
  let open: { id: string; tool: string; label: string; detail?: string } | null = null
  const close = (status: 'done' | 'failed', detail?: string) => {
    if (!open) return
    context.emit({ type: 'step', ...open, ...(detail && { detail }), status })
    open = null
  }
  return {
    report(stage: WebPlaceStage, detail?: string) {
      const id = `${run}:${stage}`
      if (open?.id !== id) close('done')
      open = { id, tool: 'find_place_on_web', label: STAGE_LABELS[stage], ...(detail && { detail }) }
      context.emit({ type: 'step', ...open, status: 'running' })
    },
    close,
  }
}

const findPlaceOnWebTool: AskTool<{ query: string; near?: PointArg; website?: string; address?: string }> = {
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
      address: {
        type: 'string',
        description:
          'The street address, only when the user gave it, e.g. "215 Union St, Brooklyn". Pass it with the website from an earlier lookup when the site gave none.',
      },
    },
    required: ['query'],
  },
  label: () => 'Looking it up online',
  detail: ({ query }) => query,
  async run({ query, near, website, address }, context) {
    if (address && context.userText !== undefined && !mentionsAddress(context.userText, address)) {
      throw new AskToolError("Pass an address only when the user typed it, never one from a web search. Leave it out to use the site's own.")
    }
    const origin = await centre(near, context)
    const steps = stageSteps(context)
    const lookup = await cached(
      'find_place_on_web',
      { query, website, address, origin: { lat: origin.lat.toFixed(2), lng: origin.lng.toFixed(2) } },
      { language: context.language },
      () =>
        findPlaceOnWeb(query, {
          near: origin,
          website,
          address,
          progress: steps.report,
          model: context.model,
          language: context.language,
          signal: context.signal,
        }),
    ).catch((error) => {
      steps.close('failed')
      throw error instanceof WebPlaceError ? new AskToolError(error.message) : error
    })
    if (lookup.status === 'not-found') {
      steps.close('failed', lookup.reason)
      return lookup
    }
    steps.close('done')
    const { place } = lookup
    context.seen.set(place.id, place)
    const summary = summarizePlace(place, { now: context.now, origin, units: context.units })
    return lookup.status === 'mapped'
      ? { status: 'on-map', place: summary }
      : {
          status: 'not-on-map',
          place: summary,
          website: place.contactInfo.website?.value,
          ...(place.unmapped?.opensSoon && { opensSoon: true }),
          alsoMentionedBy: lookup.corroboratedBy,
        }
  },
}

export const webPlaceTools: AskTool[] = [findPlaceOnWebTool]
