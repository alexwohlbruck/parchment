import { bbox, booleanPointInPolygon, circle, point } from '@turf/turf'
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import { lookupPlacesByNameAndLocation, lookupEnrichedPlaceById } from '../place.service'
import { searchByCategory } from '../search.service'
import { categoryService } from '../category.service'
import { forwardGeocode } from '../geocoding.service'
import { requestBarrelman } from '../barrelman.service'
import { describePlace, openNow, summarizePlace } from '../../lib/ask/place-summary'
import { toolCacheKey } from '../../lib/ask/tool-cache-key'
import { MemoCache } from '../../lib/memo-cache'
import { ISOCHRONE_MODES, maxDurationForMode, type IsochroneGeometry, type IsochroneMode } from '../../types/isochrone.types'
import type { Language } from '../../lib/i18n/i18n.types'
import type { MapBounds } from '../../types/integration.types'
import type { Place } from '../../types/place.types'
import type { Source } from '../../lib/constants'
import type { ChatTool } from '../../types/language-model.types'
import type { AskEvent, LatLng } from '../../types/ask.types'


/** A failure worth showing the model or an MCP client; anything else is reported generically. */
export class AskToolError extends Error {}

/** What a caller may see of a tool failure, without upstream hosts or stack details. */
export function toolErrorMessage(error: unknown): string {
  return error instanceof AskToolError ? error.message : 'This search failed. Try another approach.'
}

export interface AskContext {
  userId: string
  language: Language
  origin?: LatLng
  now: Date
  signal?: AbortSignal
  /** Every place a tool has returned, by id. The answer may only cite these. */
  seen: Map<string, Place>
  emit(event: AskEvent): void
}

export interface AskTool<Args = any> {
  name: string
  description: string
  parameters: Record<string, unknown>
  label(args: Args): string
  run(args: Args, context: AskContext): Promise<unknown>
}

const DEFAULT_RADIUS_M = 3000
const TOOL_CACHE_TTL_MS = 5 * 60_000
const MAX_RADIUS_M = 50_000
const DEFAULT_LIMIT = 15
const MAX_LIMIT = 30

const latLngSchema = {
  type: 'object',
  properties: { lat: { type: 'number' }, lng: { type: 'number' } },
  required: ['lat', 'lng'],
  description: "Centre of the search. Defaults to the user's map position when one is known.",
}

const listOptions = {
  radius_m: { type: 'number', description: `Search radius in metres, default ${DEFAULT_RADIUS_M}` },
  open_now: { type: 'boolean', description: 'Only places open right now' },
  limit: { type: 'number', description: `Max results, default ${DEFAULT_LIMIT}` },
}

const toolCache = new MemoCache<unknown>({ max: 500, ttlMs: TOOL_CACHE_TTL_MS })

/** Shares lookups across steps and follow-ups, so a repeated question doesn't refetch. */
function cached<T>(
  tool: string,
  args: Record<string, unknown>,
  scope: { language: string; userId?: string },
  load: () => Promise<T>,
): Promise<T> {
  return toolCache.get(toolCacheKey(tool, args, scope), load) as Promise<T>
}

function placesByName(query: string, origin: LatLng, radius: number, context: AskContext) {
  return cached(
    'find_places',
    { query, origin, radius },
    { language: context.language, userId: context.userId },
    () =>
      lookupPlacesByNameAndLocation(query, origin, {
        radius,
        userId: context.userId,
        language: context.language,
        signal: context.signal,
      }),
  )
}

function placesByCategory(
  categoryId: string,
  options: { bounds: MapBounds; limit: number; tags?: Record<string, string> },
  context: AskContext,
) {
  return cached('browse_category', { categoryId, ...options }, { language: context.language }, () =>
    searchByCategory(categoryId, { ...options, sort: 'distance' }),
  )
}

function centre(near: LatLng | undefined, context: AskContext): LatLng {
  const target = near ?? context.origin
  if (!target) throw new AskToolError('No location: call locate first, or ask the user where')
  return target
}

function boundsAround({ lat, lng }: LatLng, radiusM: number): MapBounds {
  const [west, south, east, north] = bbox(circle([lng, lat], radiusM / 1000, { steps: 8 }))
  return { north, south, east, west }
}

function clamp(value: number | undefined, fallback: number, max: number): number {
  return Math.min(Math.max(1, Math.round(value ?? fallback)), max)
}

function listPlaces(
  places: Place[],
  context: AskContext,
  options: { openNow?: boolean; limit?: number; origin: LatLng },
) {
  const kept = options.openNow
    ? places.filter((place) => openNow(place, context.now) === true)
    : places
  const limited = kept.slice(0, clamp(options.limit, DEFAULT_LIMIT, MAX_LIMIT))
  for (const place of limited) context.seen.set(place.id, place)
  return {
    count: limited.length,
    places: limited.map((place) => summarizePlace(place, { now: context.now, origin: options.origin })),
  }
}

function splitPlaceId(id: string): { source: Source; externalId: string } | null {
  const slash = id.indexOf('/')
  if (slash <= 0) return null
  return { source: id.slice(0, slash) as Source, externalId: id.slice(slash + 1) }
}

interface ListArgs {
  near?: LatLng
  radius_m?: number
  open_now?: boolean
  limit?: number
}

const findPlaces: AskTool<ListArgs & { query: string }> = {
  name: 'find_places',
  description:
    'Search places by name or free text ("ramen", "Blue Bottle", "dog park"). Results are ranked by relevance and distance.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' }, near: latLngSchema, ...listOptions },
    required: ['query'],
  },
  label: ({ query }) => `Searching for ${query}`,
  async run(args, context) {
    const origin = centre(args.near, context)
    const radius = clamp(args.radius_m, DEFAULT_RADIUS_M, MAX_RADIUS_M)
    const places = await placesByName(args.query, origin, radius, context)
    return listPlaces(places, context, { openNow: args.open_now, limit: args.limit, origin })
  },
}

const findCategories: AskTool<{ query: string }> = {
  name: 'find_categories',
  description:
    'Look up category ids (e.g. "amenity/cafe") for a kind of place. Use them with browse_category for complete, nearest-first lists.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'A kind of place, e.g. "bakery"' } },
    required: ['query'],
  },
  label: ({ query }) => `Looking up ${query}`,
  async run({ query }, context) {
    return categoryService
      .searchCategories(query, context.language, 8)
      .map(({ id, name }) => ({ id, name }))
  },
}

const browseCategory: AskTool<ListArgs & { category_id: string; tags?: Record<string, string> }> = {
  name: 'browse_category',
  description:
    'List places of one category nearest-first. `tags` narrows by OpenStreetMap tags, e.g. {"outdoor_seating":"yes"}, {"cuisine":"thai"}, {"wheelchair":"yes"}, {"internet_access":"wlan"}.',
  parameters: {
    type: 'object',
    properties: {
      category_id: { type: 'string', description: 'From find_categories' },
      tags: { type: 'object', additionalProperties: { type: 'string' } },
      near: latLngSchema,
      ...listOptions,
    },
    required: ['category_id'],
  },
  label: () => 'Finding places nearby',
  async run(args, context) {
    const origin = centre(args.near, context)
    const limit = clamp(args.limit, DEFAULT_LIMIT, MAX_LIMIT)
    const places = await placesByCategory(
      args.category_id,
      {
        bounds: boundsAround(origin, clamp(args.radius_m, DEFAULT_RADIUS_M, MAX_RADIUS_M)),
        // Fetch extra so an open-now filter still leaves a full list.
        limit: args.open_now ? MAX_LIMIT * 2 : limit,
        tags: args.tags,
      },
      context,
    )
    return listPlaces(places, context, { openNow: args.open_now, limit, origin })
  },
}

const getPlace: AskTool<{ id: string }> = {
  name: 'get_place',
  description: 'Full details for one place: hours, amenities, website and recent reviews.',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: 'A place id from another tool' } },
    required: ['id'],
  },
  label: () => 'Checking details',
  async run({ id }, context) {
    const parts = splitPlaceId(id)
    if (!parts) throw new AskToolError(`Unknown place id ${id}`)
    const place = await cached(
      'get_place',
      { id },
      { language: context.language, userId: context.userId },
      () =>
        lookupEnrichedPlaceById(parts.source, parts.externalId, {
          userId: context.userId,
          language: context.language,
        }),
    )
    if (!place) throw new AskToolError(`No place found for ${id}`)
    context.seen.set(id, { ...place, id })
    return describePlace({ ...place, id }, { now: context.now, origin: context.origin })
  },
}

const locate: AskTool<{ query: string }> = {
  name: 'locate',
  description:
    'Resolve a neighbourhood, address, city or landmark name to coordinates, to search around it.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  label: ({ query }) => `Finding ${query}`,
  async run({ query }, context) {
    const { results } = await cached(
      'locate',
      { query, origin: context.origin },
      { language: context.language },
      () => forwardGeocode(query, context.origin?.lat, context.origin?.lng),
    )
    return results.slice(0, 3).map((place) => ({
      name: place.name.value,
      address: place.address?.value?.formatted,
      ...place.geometry.value.center,
    }))
  },
}

function reachPolygon(
  from: LatLng,
  mode: IsochroneMode,
  minutes: number,
  context: AskContext,
): Promise<Feature<Polygon | MultiPolygon>> {
  return cached('reach', { from, mode, minutes }, { language: context.language }, () =>
    loadReachPolygon(from, mode, minutes),
  )
}

async function loadReachPolygon(
  from: LatLng,
  mode: IsochroneMode,
  minutes: number,
): Promise<Feature<Polygon | MultiPolygon>> {
  const seconds = Math.min(minutes * 60, maxDurationForMode(mode))
  const response = await requestBarrelman(
    '/isochrone',
    { lat: from.lat, lng: from.lng, mode, durations: seconds },
    { timeoutMs: 60_000 },
  )
  if (!response.ok) throw new AskToolError(`Could not compute reach (${response.status})`)
  const collection = (await response.json()) as FeatureCollection<Polygon | MultiPolygon>
  const feature = collection.features?.[0]
  if (!feature) throw new AskToolError('No reachable area')
  return feature
}

const placesWithinReach: AskTool<{
  from?: LatLng
  mode: IsochroneMode
  minutes: number
  category_id?: string
  query?: string
  tags?: Record<string, string>
  open_now?: boolean
  limit?: number
}> = {
  name: 'places_within_reach',
  description:
    'Places reachable within a travel time ("within a 10 minute walk", "20 minutes by transit"). Give category_id (preferred) or query.',
  parameters: {
    type: 'object',
    properties: {
      from: { ...latLngSchema, description: "Start point. Defaults to the user's map position." },
      mode: { type: 'string', enum: [...ISOCHRONE_MODES] },
      minutes: { type: 'number' },
      category_id: { type: 'string' },
      query: { type: 'string' },
      tags: { type: 'object', additionalProperties: { type: 'string' } },
      open_now: listOptions.open_now,
      limit: listOptions.limit,
    },
    required: ['mode', 'minutes'],
  },
  label: ({ minutes, mode }) => `Finding what's within ${minutes} min by ${mode}`,
  async run(args, context) {
    if (!args.category_id && !args.query) throw new AskToolError('Give category_id or query')
    const origin = centre(args.from, context)
    const reach = await reachPolygon(origin, args.mode, args.minutes, context)
    context.emit({ type: 'reach', geometry: reach.geometry as IsochroneGeometry })

    const [west, south, east, north] = bbox(reach)
    const candidates = args.category_id
      ? await placesByCategory(
          args.category_id,
          { bounds: { north, south, east, west }, limit: MAX_LIMIT * 2, tags: args.tags },
          context,
        )
      : await placesByName(
          args.query!,
          origin,
          Math.max(east - west, north - south) * 111_000,
          context,
        )

    const inside = candidates.filter((place) => {
      const { lat, lng } = place.geometry.value.center
      return booleanPointInPolygon(point([lng, lat]), reach)
    })
    return listPlaces(inside, context, { openNow: args.open_now, limit: args.limit, origin })
  },
}

export const askTools: AskTool[] = [
  findPlaces,
  findCategories,
  browseCategory,
  getPlace,
  locate,
  placesWithinReach,
]

export const ANSWER_TOOL = 'answer'

export const answerTool: ChatTool = {
  type: 'function',
  function: {
    name: ANSWER_TOOL,
    description:
      'Finish with your answer. Only cite place ids returned by other tools. Order places best first.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'One short sentence answering the question. No lists, markdown, distances or hours.',
        },
        places: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              reason: { type: 'string', description: 'What sets it apart for this question, under 10 words. Not its distance or hours.' },
            },
            required: ['id', 'reason'],
          },
        },
      },
      required: ['text', 'places'],
    },
  },
}

export function toChatTools(tools: AskTool[]): ChatTool[] {
  return tools.map(({ name, description, parameters }) => ({
    type: 'function',
    function: { name, description, parameters },
  }))
}
