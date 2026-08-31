/**
 * Where a BROWSER fetches Barrelman tiles, and the key it presents.
 *
 * A different question from where *this process* reaches Barrelman, and often a
 * different answer, in both halves:
 *
 *   - `host` may be an address only the server can resolve — a container name,
 *     a private port, or a `BARRELMAN_HOST` override pointing a preview at its
 *     own instance. `tileHost` overrides it with one a browser can reach.
 *   - `apiKey` is a secret and never leaves the server. `tileKey` is published
 *     on purpose: a map library cannot set an Authorization header, so the key
 *     rides the tile URL where anyone reading the page can see it. Scope it to
 *     `tiles` and origin-lock it in the Barrelman console — it is the browser's
 *     key, not the account's.
 *
 * Kept dependency-free (env and its argument, nothing else) so both the
 * integration definition and the Barrelman service can call it without either
 * importing the other.
 */

export interface BarrelmanTileConfig {
  /** Tile root, e.g. `https://api.barrelman.dev/tiles`. */
  base: string
  /** Public, tiles-scoped key. Absent is legal — Barrelman then refuses the
   *  tiles, which is a clearer failure than a URL that cannot resolve. */
  tileKey?: string
}

export interface BarrelmanTileSource {
  host?: string
  tileHost?: string
  tileKey?: string
}

/**
 * Resolve the browser-facing tile address, or undefined when no host is known.
 *
 * `BARRELMAN_TILE_HOST` wins over everything: a preview pointed at its own
 * Barrelman by `BARRELMAN_HOST` still needs a way to say that the browser
 * should go somewhere else, since the two are reached over different networks.
 */
export function resolveTileConfig(
  config?: BarrelmanTileSource,
): BarrelmanTileConfig | undefined {
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
