/** Cache Storage bucket holding saved regions. Shared with the service worker. */
export const OFFLINE_CACHE = 'offline-regions'

export const SIZE_HEADER = 'x-offline-size'

/** Statuses replayed offline exactly as the server sent them; empty tiles included. */
const STORABLE = new Set([200, 204, 404])

/** Session tokens never belong in a cache key, or a tile is stored once per login. */
export function offlineCacheKey(url: string): string {
  const parsed = new URL(url)
  parsed.searchParams.delete('token')
  return parsed.href
}

/** The copy to keep of a response, or null when it isn't worth replaying. */
export async function toSavedResponse(res: Response): Promise<Response | null> {
  if (!STORABLE.has(res.status)) return null
  const body = res.status === 204 ? null : await res.arrayBuffer()
  // The body is already decoded, so encoding and length headers would lie.
  const headers = new Headers({ [SIZE_HEADER]: String(body?.byteLength ?? 0) })
  const type = res.headers.get('content-type')
  if (type) headers.set('content-type', type)
  return new Response(body, { status: res.status, headers })
}

export const savedSize = (res: Response) => Number(res.headers.get(SIZE_HEADER) ?? 0)
