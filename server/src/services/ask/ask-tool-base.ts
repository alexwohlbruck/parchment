import { toolCacheKey } from '../../lib/ask/tool-cache-key'
import { distance } from '@turf/turf'
import { MemoCache } from '../../lib/memo-cache'
import { HERE, parsePointText } from '../../lib/ask/known-places'
import { nearbyFirst } from '../../lib/ask/nearby-match'
import { forwardGeocode } from '../geocoding.service'
import type { Language } from '../../lib/i18n/i18n.types'
import type { Place } from '../../types/place.types'
import type { Vehicle } from '../../types/trip.types'
import type { LanguageModelCapability } from '../../types/language-model.types'
import type {
  AskEndpoint,
  AskEvent,
  AskSource,
  AskUnits,
  LatLng,
} from '../../types/ask.types'

/** A failure worth showing the model or an MCP client; anything else is reported generically. */
export class AskToolError extends Error {}

/** What a caller may see of a tool failure, without upstream hosts or stack details. */
export function toolErrorMessage(error: unknown): string {
  return error instanceof AskToolError
    ? error.message
    : 'This search failed. Try another approach.'
}

export interface AskContext {
  userId: string
  language: Language
  /** The map's centre: where a search looks when no point is given. */
  origin?: LatLng
  /** Points the model may name instead of giving coordinates, keyed by lower-case name ("here", "home"). */
  places: Map<string, AskEndpoint>
  units: AskUnits
  /** The user's vehicles, so trips match what Directions plans. */
  vehicles: Vehicle[]
  now: Date
  signal?: AbortSignal
  /** Every place a tool has returned, by id. The answer may only cite these. */
  seen: Map<string, Place>
  /** Answers web searches; absent where the caller has its own (MCP). */
  model?: LanguageModelCapability
  /** Web pages a search read, by url. */
  sources: Map<string, AskSource>
  /** The trip plan_trip proposed, so a canvas can draw it. */
  trip?: { name: string; path: LatLng[] }
  emit(event: AskEvent): void
}

export interface AskTool<Args = any> {
  name: string
  description: string
  parameters: Record<string, unknown>
  label(args: Args): string
  /** What the step looked for, shown beside its label. */
  detail?(args: Args, context: AskContext): string | undefined
  run(args: Args, context: AskContext): Promise<unknown>
}

/** Coordinates, or the name of a known place like "here" or "home". */
export type PointArg = AskEndpoint | string

export function pointSchema(description: string) {
  return {
    description: `${description} Coordinates, or a known place's name like "here" or "home".`,
    anyOf: [
      {
        type: 'object',
        properties: {
          lat: { type: 'number' },
          lng: { type: 'number' },
          name: {
            type: 'string',
            description: 'What to call it, e.g. the name locate returned',
          },
        },
        required: ['lat', 'lng'],
      },
      { type: 'string' },
    ],
  }
}

export const nearSchema = pointSchema(
  "Centre of the search. Defaults to the map's centre.",
)

const toolCache = new MemoCache<unknown>({ max: 500, ttlMs: 5 * 60_000 })

/** Shares lookups across steps and follow-ups, so a repeated question doesn't refetch. */
export function cached<T>(
  tool: string,
  args: Record<string, unknown>,
  scope: { language: string; userId?: string },
  load: () => Promise<T>,
): Promise<T> {
  return toolCache.get(toolCacheKey(tool, args, scope), load) as Promise<T>
}

/** A point from coordinates, a known place's name, coordinates written as text, or else a place name looked up near the user. */
export async function endpoint(
  value: PointArg | undefined,
  context: AskContext,
): Promise<AskEndpoint> {
  if (typeof value === 'string') {
    const text = value.trim()
    const known =
      context.places.get(text.toLowerCase()) ?? seenPlace(text, context)
    if (known) return known
    const written = parsePointText(text)
    return written ? named(written, context) : geocode(text, context)
  }
  const target = value ?? context.origin
  if (!target)
    throw new AskToolError(
      'No location: call locate first, or ask the user where',
    )
  return named(target, context)
}

const SAME_PLACE_M = 30

/** Coordinates the model copied from a place a tool returned, named after that place. */
function named(point: AskEndpoint, context: AskContext): AskEndpoint {
  if (point.name) return point
  for (const [id, place] of context.seen) {
    const center = place.geometry?.value?.center
    if (
      center &&
      distance([point.lng, point.lat], [center.lng, center.lat], {
        units: 'meters',
      }) < SAME_PLACE_M
    ) {
      return {
        ...point,
        placeId: id,
        ...(placeName(place) && { name: placeName(place) }),
      }
    }
  }
  return point
}

/** A place's name, or what it is when it has none ("Drinking water"). */
function placeName(place: Place): string | undefined {
  return place.name.value ?? place.placeType?.value ?? undefined
}

/** A place id an earlier tool returned, as the point it stands for. */
function seenPlace(id: string, context: AskContext): AskEndpoint | undefined {
  const place = context.seen.get(id)
  const center = place?.geometry?.value?.center
  return (
    center && {
      lat: center.lat,
      lng: center.lng,
      placeId: id,
      ...(place.name.value && { name: place.name.value }),
    }
  )
}

/** What a point is called, for a step's detail; coordinates have no name worth showing. */
export function pointLabel(
  value: PointArg | undefined,
  context: AskContext,
): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return value.name
  const text = value.trim()
  if (context.places.has(text.toLowerCase())) return text
  const known = seenPlace(text, context) ?? parsePointText(text)
  return known ? known.name : text
}

/** Where a trip starts: the given point, else the user's own position, else the map's centre. */
export function start(
  value: PointArg | undefined,
  context: AskContext,
): Promise<AskEndpoint> {
  return endpoint(value ?? (context.places.has(HERE) ? HERE : undefined), context)
}

export async function centre(
  value: PointArg | undefined,
  context: AskContext,
): Promise<LatLng> {
  const { lat, lng } = await endpoint(value, context)
  return { lat, lng }
}

export async function geocodeResults(query: string, context: AskContext) {
  const near = context.places.get(HERE) ?? context.origin
  const { results } = await cached(
    'locate',
    { query, origin: near },
    { language: context.language },
    () => forwardGeocode(query, near?.lat, near?.lng),
  )
  return nearbyFirst(results, query, near)
}

async function geocode(
  query: string,
  context: AskContext,
): Promise<AskEndpoint> {
  const [top] = await geocodeResults(query, context)
  if (!top)
    throw new AskToolError(
      `Couldn't find "${query}". Try locate with a fuller address.`,
    )
  return {
    name: top.name.value ?? query,
    placeId: top.id,
    ...top.geometry.value.center,
  }
}

export function clamp(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  return Math.min(Math.max(1, Math.round(value ?? fallback)), max)
}
