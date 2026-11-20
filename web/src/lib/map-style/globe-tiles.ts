import { GLOBE_PROTOCOL, globeTilePath } from './globe-layers'

const GZIP_MAGIC = [0x1f, 0x8b]

/**
 * One globe vector tile, inflated in the browser. A host that adds its own
 * `Content-Encoding` hands the bytes over already inflated, so only gzip is unpacked.
 */
export async function loadGlobeTile(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const [z, x, y] = url.slice(GLOBE_PROTOCOL.length + 3).split('/').map(Number)
  const response = await fetch(globeTilePath(z, x, y), { signal })
  if (!response.ok) throw new Error(`Globe tile ${z}/${x}/${y}: ${response.status}`)
  const data = await response.arrayBuffer()
  const head = new Uint8Array(data, 0, Math.min(2, data.byteLength))
  if (head[0] !== GZIP_MAGIC[0] || head[1] !== GZIP_MAGIC[1]) return data
  return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
}
