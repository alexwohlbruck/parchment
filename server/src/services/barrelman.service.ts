/**
 * Barrelman client.
 *
 * Barrelman is the geospatial engine behind transit, GBFS and isochrone data.
 * Every one of those controllers needs the same three things — resolve the
 * integration config, attach the API key server-side, and turn upstream
 * failures into clean JSON — so that lives here rather than being repeated per
 * module.
 *
 * This is not a tile proxy. Tiles go through `proxy.controller.ts`, which
 * exists so MapLibre sources (which can't attach our auth header) can still
 * reach third-party tile servers. These are ordinary authenticated data calls
 * that happen to be served by another service.
 */

import { integrationManager } from './integrations'
import { IntegrationId } from '../types/integration.types'

/** Upstream timeout for everything but isochrones. */
export const DEFAULT_BARRELMAN_TIMEOUT_MS = 10_000

export interface BarrelmanRequestOptions {
  /** Cache-Control on the response we return. Default 'no-cache'. */
  cacheControl?: string
  /** Upstream timeout. Default 10s. */
  timeoutMs?: number
  /**
   * Forward the upstream JSON error body instead of replacing it with a
   * generic message. Only for endpoints whose 4xx bodies say something the
   * client can act on — isochrone's validation messages name the offending
   * parameter and its limit, which is worth surfacing.
   */
  forwardErrorBody?: boolean
}

/**
 * Call a Barrelman endpoint and return its JSON response.
 *
 * Handles integration config lookup, the auth header, error response wrapping
 * and the upstream timeout. The API key never reaches the client.
 */
export async function requestBarrelman(
  path: string,
  query: Record<string, unknown>,
  options: BarrelmanRequestOptions = {},
): Promise<Response> {
  const {
    cacheControl = 'no-cache',
    timeoutMs = DEFAULT_BARRELMAN_TIMEOUT_MS,
    forwardErrorBody = false,
  } = options

  const systemIntegration = integrationManager
    .getConfiguredIntegrations()
    .find((i) => i.integrationId === IntegrationId.BARRELMAN)

  const config = systemIntegration?.config as
    | { host?: string; apiKey?: string }
    | undefined
  if (!config?.host) {
    return new Response(JSON.stringify({ error: 'Barrelman not configured' }), {
      status: 501,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v !== '') params.set(k, String(v))
  }

  const headers: Record<string, string> = {}
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`
  }

  const response = await fetch(
    `${config.host}${path}?${params}`,
    { headers, signal: AbortSignal.timeout(timeoutMs) },
  )

  if (!response.ok) {
    // Return a clean JSON error instead of forwarding upstream HTML. Opting
    // in to forwardErrorBody passes a JSON body straight through; anything
    // else upstream sends (an HTML error page, say) still gets replaced.
    const body = forwardErrorBody ? await safeJson(response) : null
    return new Response(
      JSON.stringify(body ?? { error: `Upstream error: ${response.status}` }),
      { status: response.status, headers: { 'Content-Type': 'application/json' } },
    )
  }

  return new Response(await response.arrayBuffer(), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cacheControl,
    },
  })
}

/** Parse a response body as JSON, or null when it isn't JSON at all. */
async function safeJson(response: Response): Promise<unknown | null> {
  try {
    const body = await response.json()
    return body && typeof body === 'object' ? body : null
  } catch {
    return null
  }
}
