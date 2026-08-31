/**
 * Where the browser fetches Barrelman tiles.
 *
 * Tiles do not go through the parchment server. Barrelman serves them
 * CORS-open and takes its key on the URL — a map library cannot set an
 * Authorization header — so the request goes straight from here. Proxying
 * them bought nothing (the key involved is public by design) and cost
 * something real: every user's map traffic reached Barrelman from the
 * server's one address, which is where its per-address rate limit bites.
 *
 * The key is meant to be visible. Give it the `tiles` scope and an origin
 * allowlist in the Barrelman console and it is worth nothing anywhere else;
 * `apiKey` — the account key — stays on the server and never comes here.
 */
import { useIntegrationsStore } from '@/stores/integrations.store'
import { IntegrationId } from '@server/types/integration.types'

/** Tile root, e.g. `https://api.barrelman.dev/tiles`, or null when Barrelman
 *  isn't configured — callers then treat its tiles as absent.
 *
 *  Resolved by the server and published as `tileBase`, not assembled here: the
 *  address a browser should use may differ from the one the server uses, and
 *  only the server can see the env overrides that decide it. */
export function barrelmanTileBase(): string | null {
  const integrations = useIntegrationsStore()
  return (
    (integrations.getIntegrationConfigValue(
      IntegrationId.BARRELMAN,
      'tileBase',
    ) as string | undefined) ?? null
  )
}

/** The public tiles key, if one is configured. */
export function barrelmanTileKey(): string | undefined {
  const integrations = useIntegrationsStore()
  return integrations.getIntegrationConfigValue(
    IntegrationId.BARRELMAN,
    'tileKey',
  ) as string | undefined
}

/**
 * Append the tile key to a Barrelman URL, preserving any query it already has.
 * A URL with no key is still returned — Barrelman answers 401 and the caller's
 * own fallback handles it, which is a clearer failure than emitting nothing.
 */
export function withTileKey(url: string, key = barrelmanTileKey()): string {
  if (!key) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}api_key=${encodeURIComponent(key)}`
}
