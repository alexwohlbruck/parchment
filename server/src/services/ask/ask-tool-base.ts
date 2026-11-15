import { toolCacheKey } from '../../lib/ask/tool-cache-key'
import { MemoCache } from '../../lib/memo-cache'
import type { Language } from '../../lib/i18n/i18n.types'
import type { Place } from '../../types/place.types'
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

export const latLngSchema = {
  type: 'object',
  properties: { lat: { type: 'number' }, lng: { type: 'number' } },
  required: ['lat', 'lng'],
  description: "Centre of the search. Defaults to the user's map position when one is known.",
}

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

export function centre(near: LatLng | undefined, context: AskContext): LatLng {
  const target = near ?? context.origin
  if (!target) throw new AskToolError('No location: call locate first, or ask the user where')
  return target
}

export function clamp(value: number | undefined, fallback: number, max: number): number {
  return Math.min(Math.max(1, Math.round(value ?? fallback)), max)
}
