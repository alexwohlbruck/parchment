/**
 * Barrelman client.
 *
 * Barrelman is the geospatial engine behind transit, GBFS and isochrone data.
 * Every one of those controllers needs the same three things — resolve the
 * integration config, attach the API key server-side, and turn upstream
 * failures into clean JSON — so that lives here rather than being repeated per
 * module.
 *
 * Tiles do not come through here, and no longer come through the server at
 * all: Barrelman serves them CORS-open and authenticates map libraries with a
 * key on the URL, so the browser fetches them directly. What this module owns
 * for tiles is only `resolveBarrelmanTileConfig` — the address and public key
 * a client needs to do that.
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
 * Where Barrelman lives, and the key to reach it with.
 *
 * Normally the integration record, configured through Settings. `BARRELMAN_HOST`
 * overrides it so a branch can be pointed at its own Barrelman without editing
 * the database an instance shares — a preview clones the integration config
 * along with everything else, so without this every preview inherits whichever
 * Barrelman the source instance was using.
 */
export function resolveBarrelmanConfig(): { host?: string; apiKey?: string } | undefined {
  const systemIntegration = integrationManager
    .getConfiguredIntegrations()
    .find((i) => i.integrationId === IntegrationId.BARRELMAN)

  const config = systemIntegration?.config as
    | { host?: string; apiKey?: string }
    | undefined

  const host = process.env.BARRELMAN_HOST
  if (!host) return config

  return {
    host,
    // A host override usually comes with its own key; fall back to the
    // configured one so pointing at a local instance needs one variable.
    apiKey: process.env.BARRELMAN_API_KEY || config?.apiKey,
  }
}

/**
 * Where a BROWSER fetches Barrelman tiles, and the key it presents.
 *
 * Deliberately separate from `resolveBarrelmanConfig`, which answers the same
 * question for this process. The two answers differ in both halves:
 *
 *   - `host` may be an address only the server can resolve (a container name,
 *     a private port). `tileHost` overrides it with one a browser can reach,
 *     and is the only field that needs setting in that layout.
 *   - `apiKey` is a secret and must never leave the server. `tileKey` is
 *     published on purpose — a map library cannot set an Authorization header,
 *     so the key rides the tile URL where anyone reading the page can see it.
 *     Give it the `tiles` scope and an origin allowlist in the Barrelman
 *     console; it is the browser's key, not the account's.
 *
 * Undefined when Barrelman isn't configured — callers treat tiles as absent
 * rather than emitting URLs that cannot resolve.
 */
export function resolveBarrelmanTileConfig():
  | { base: string; tileKey?: string }
  | undefined {
  const systemIntegration = integrationManager
    .getConfiguredIntegrations()
    .find((i) => i.integrationId === IntegrationId.BARRELMAN)

  const config = systemIntegration?.config as
    | { host?: string; tileHost?: string; tileKey?: string }
    | undefined

  const host =
    process.env.BARRELMAN_TILE_HOST ||
    config?.tileHost ||
    process.env.BARRELMAN_HOST ||
    config?.host
  if (!host) return undefined

  return {
    base: `${host.replace(/\/+$/, '')}/tiles`,
    tileKey: process.env.BARRELMAN_TILE_KEY || config?.tileKey,
  }
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

  const config = resolveBarrelmanConfig()
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
