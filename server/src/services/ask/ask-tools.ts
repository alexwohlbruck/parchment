import { bbox, booleanPointInPolygon, circle, point } from '@turf/turf'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import {
  lookupPlacesByNameAndLocation,
  lookupEnrichedPlaceById,
} from '../place.service'
import { searchByCategory } from '../search.service'
import { categoryService } from '../category.service'
import { routingService } from '../routing.service'
import { searchAlongNavRoute } from '../route-search.service'
import { MODE_COSTING, type RerouteMode } from '../reroute.service'
import { samplePoints } from '../../lib/ask/route-sample'
import { distanceText } from '../../lib/ask/distance-text'
import type { Location } from '../../types/valhalla.types'
import { requestBarrelman } from '../barrelman.service'
import {
  describePlace,
  openNow,
  summarizePlace,
} from '../../lib/ask/place-summary'
import {
  ISOCHRONE_MODES,
  maxDurationForMode,
  type IsochroneGeometry,
  type IsochroneMode,
  type IsochroneResponse,
} from '../../types/isochrone.types'
import type { MapBounds } from '../../types/integration.types'
import type { Place } from '../../types/place.types'
import type { Source } from '../../lib/constants'
import type { ChatTool } from '../../types/language-model.types'
import type { LatLng } from '../../types/ask.types'
import {
  AskToolError,
  cached,
  centre,
  clamp,
  geocodeResults,
  nearSchema,
  pointSchema,
  type PointArg,
  type AskContext,
  type AskTool,
} from './ask-tool-base'
import { tripTools } from './ask-trip-tools'
import { libraryTools } from './ask-library-tools'

export {
  AskToolError,
  toolErrorMessage,
  type AskContext,
  type AskTool,
} from './ask-tool-base'

const DEFAULT_RADIUS_M = 3000
const MAX_RADIUS_M = 50_000
const DEFAULT_LIMIT = 15
const MAX_LIMIT = 30

const listOptions = {
  radius_m: {
    type: 'number',
    description: `Search radius in metres, default ${DEFAULT_RADIUS_M}`,
  },
  open_now: { type: 'boolean', description: 'Only places open right now' },
  limit: {
    type: 'number',
    description: `Max results, default ${DEFAULT_LIMIT}`,
  },
}

function placesByName(
  query: string,
  origin: LatLng,
  radius: number,
  context: AskContext,
) {
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
  return cached(
    'browse_category',
    { categoryId, ...options },
    { language: context.language },
    () => searchByCategory(categoryId, { ...options, sort: 'distance' }),
  )
}

function boundsAround({ lat, lng }: LatLng, radiusM: number): MapBounds {
  const [west, south, east, north] = bbox(
    circle([lng, lat], radiusM / 1000, { steps: 8 }),
  )
  return { north, south, east, west }
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
    places: limited.map((place) =>
      summarizePlace(place, {
        now: context.now,
        origin: options.origin,
        units: context.units,
      }),
    ),
  }
}

function splitPlaceId(
  id: string,
): { source: Source; externalId: string } | null {
  const slash = id.indexOf('/')
  if (slash <= 0) return null
  return {
    source: id.slice(0, slash) as Source,
    externalId: id.slice(slash + 1),
  }
}

interface ListArgs {
  near?: PointArg
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
    properties: { query: { type: 'string' }, near: nearSchema, ...listOptions },
    required: ['query'],
  },
  label: () => 'Searching',
  detail: ({ query }) => query,
  async run(args, context) {
    const origin = await centre(args.near, context)
    const radius = clamp(args.radius_m, DEFAULT_RADIUS_M, MAX_RADIUS_M)
    const places = await placesByName(args.query, origin, radius, context)
    return listPlaces(places, context, {
      openNow: args.open_now,
      limit: args.limit,
      origin,
    })
  },
}

const findCategories: AskTool<{ query: string }> = {
  name: 'find_categories',
  description:
    'Look up category ids (e.g. "amenity/cafe") for a kind of place. Use them with browse_category for complete, nearest-first lists.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'A kind of place, e.g. "bakery"' },
    },
    required: ['query'],
  },
  label: () => 'Looking up',
  detail: ({ query }) => query,
  async run({ query }, context) {
    return categoryService
      .searchCategories(query, context.language, 8)
      .map(({ id, name }) => ({ id, name }))
  },
}

/** "cafe · outdoor seating" from a category id and its tag filters. */
function browseDetail(
  categoryId: string,
  tags: Record<string, string> = {},
): string {
  const words = (text: string) => text.replaceAll('_', ' ')
  const filters = Object.entries(tags).map(([key, value]) =>
    words(value === 'yes' ? key : value),
  )
  return [words(categoryId.split('/').pop() ?? categoryId), ...filters].join(
    ' · ',
  )
}

const browseCategory: AskTool<
  ListArgs & { category_id: string; tags?: Record<string, string> }
> = {
  name: 'browse_category',
  description:
    'List places of one category nearest-first. `tags` narrows by OpenStreetMap tags, e.g. {"outdoor_seating":"yes"}, {"cuisine":"thai"}, {"wheelchair":"yes"}, {"internet_access":"wlan"}.',
  parameters: {
    type: 'object',
    properties: {
      category_id: { type: 'string', description: 'From find_categories' },
      tags: { type: 'object', additionalProperties: { type: 'string' } },
      near: nearSchema,
      ...listOptions,
    },
    required: ['category_id'],
  },
  label: () => 'Finding places nearby',
  detail: ({ category_id, tags }) => browseDetail(category_id, tags),
  async run(args, context) {
    const origin = await centre(args.near, context)
    const limit = clamp(args.limit, DEFAULT_LIMIT, MAX_LIMIT)
    const places = await placesByCategory(
      args.category_id,
      {
        bounds: boundsAround(
          origin,
          clamp(args.radius_m, DEFAULT_RADIUS_M, MAX_RADIUS_M),
        ),
        // Fetch extra so an open-now filter still leaves a full list.
        limit: args.open_now ? MAX_LIMIT * 2 : limit,
        tags: args.tags,
      },
      context,
    )
    return listPlaces(places, context, {
      openNow: args.open_now,
      limit,
      origin,
    })
  },
}

const getPlace: AskTool<{ id: string }> = {
  name: 'get_place',
  description:
    'Full details for one place: hours, amenities, website and recent reviews.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'A place id from another tool' },
    },
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
    return describePlace(
      { ...place, id },
      { now: context.now, origin: context.origin, units: context.units },
    )
  },
}

const locate: AskTool<{ query: string }> = {
  name: 'locate',
  description:
    'Resolve a neighbourhood, address, city or landmark name to coordinates, to search around it. Tools that take a point also accept a name directly.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  label: () => 'Finding',
  detail: ({ query }) => query,
  async run({ query }, context) {
    const results = await geocodeResults(query, context)
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
  return cached(
    'reach',
    { from, mode, minutes },
    { language: context.language },
    () => loadReachPolygon(from, mode, minutes),
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
  if (!response.ok)
    throw new AskToolError(`Could not compute reach (${response.status})`)
  const { isochrones } = (await response.json()) as IsochroneResponse
  const feature = isochrones?.features?.[0] as
    Feature<Polygon | MultiPolygon> | undefined
  if (!feature) throw new AskToolError('No reachable area')
  return feature
}

const MODE_PHRASES: Record<IsochroneMode, string> = {
  walk: 'on foot',
  bike: 'by bike',
  car: 'by car',
  transit: 'by transit',
}

const placesWithinReach: AskTool<{
  from?: PointArg
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
      from: pointSchema("Start. Defaults to the map's centre."),
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
  label: () => "Finding what's in reach",
  detail: ({ minutes, mode }) =>
    `${minutes} min ${MODE_PHRASES[mode] ?? `by ${mode}`}`,
  async run(args, context) {
    if (!args.category_id && !args.query)
      throw new AskToolError('Give category_id or query')
    const origin = await centre(args.from, context)
    const reach = await reachPolygon(origin, args.mode, args.minutes, context)
    context.emit({
      type: 'reach',
      geometry: reach.geometry as IsochroneGeometry,
    })

    const [west, south, east, north] = bbox(reach)
    const candidates = args.category_id
      ? await placesByCategory(
          args.category_id,
          {
            bounds: { north, south, east, west },
            limit: MAX_LIMIT * 2,
            tags: args.tags,
          },
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
    return listPlaces(inside, context, {
      openNow: args.open_now,
      limit: args.limit,
      origin,
    })
  },
}

/** The along-route search takes at most this many route points. */
const MAX_ROUTE_POINTS = 400

const searchAlongRoute: AskTool<{
  from?: PointArg
  to: PointArg
  stops?: PointArg[]
  mode: RerouteMode
  query?: string
  category_ids?: string[]
  limit?: number
}> = {
  name: 'search_along_route',
  description:
    'Places along the way between two points ("water stops on my ride", "a coffee on the drive"), nearest the start first, with how far along the route each is and the extra minutes the stop adds. Give category_ids (from find_categories, e.g. "amenity/drinking_water") or query.',
  parameters: {
    type: 'object',
    properties: {
      from: pointSchema('Start. Use "here" for the user\'s own location.'),
      to: pointSchema('Destination.'),
      stops: {
        type: 'array',
        items: pointSchema('A stop on the way.'),
        description: 'Places the route passes through, in order',
      },
      mode: { type: 'string', enum: Object.keys(MODE_COSTING) },
      query: { type: 'string' },
      category_ids: { type: 'array', items: { type: 'string' } },
      limit: { type: 'number', description: 'Max results, default 8, max 20' },
    },
    required: ['to', 'mode'],
  },
  label: () => 'Searching along the route',
  detail: ({ query, category_ids }) =>
    query ??
    category_ids
      ?.map((id) => id.split('/').pop()?.replaceAll('_', ' '))
      .join(' · '),
  async run(args, context) {
    if (!args.query && !args.category_ids?.length)
      throw new AskToolError('Give category_ids or query')
    const points = [
      await centre(args.from, context),
      ...(await Promise.all(
        (args.stops ?? []).map((stop) => centre(stop, context)),
      )),
      await centre(args.to, context),
    ]
    const locations: Location[] = points.map(({ lat, lng }) => ({
      type: 'coordinates',
      value: [lat, lng],
    }))
    const route = await routingService.getRoute(
      locations,
      MODE_COSTING[args.mode],
    )
    const geometry = route.routes[0]?.geometry
    if (!geometry?.length)
      throw new AskToolError(`No ${args.mode} route between those places`)
    const results = await searchAlongNavRoute({
      route: samplePoints(geometry, MAX_ROUTE_POINTS),
      mode: args.mode,
      query: args.query,
      categories: args.category_ids,
      limit: clamp(args.limit, 8, 20),
    })
    for (const { place } of results) context.seen.set(place.id, place)
    return {
      count: results.length,
      places: results.map(({ place, alongDistance, detourSeconds }) => ({
        ...summarizePlace(place, { now: context.now, units: context.units }),
        along_route: distanceText(alongDistance, context.units),
        ...(detourSeconds != null && {
          detour_minutes: Math.round(detourSeconds / 60),
        }),
      })),
    }
  },
}

export const askTools: AskTool[] = [
  findPlaces,
  findCategories,
  browseCategory,
  getPlace,
  locate,
  placesWithinReach,
  searchAlongRoute,
  ...tripTools,
  ...libraryTools,
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
          description:
            "A short answer, usually one sentence, without lists or markdown. Give trip times and lines when asked how to get somewhere; never repeat a place's distance or hours.",
        },
        places: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              reason: {
                type: 'string',
                description:
                  'What sets it apart for this question, under 10 words. Not its distance or hours.',
              },
            },
            required: ['id', 'reason'],
          },
        },
        follow_ups: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Up to 3 short questions the user might ask next, in their voice, under 8 words each.',
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
