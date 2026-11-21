import { afterEach, describe, test, expect, vi } from 'vitest'
import { gzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadGlobeTile } from './globe-tiles'
import { globeTilePath } from './globe-layers'

/** Field 3 (layers), length-delimited: the first byte of any vector tile. */
const VECTOR_LAYER_TAG = 0x1a
const tile = new Uint8Array([VECTOR_LAYER_TAG, 0x05, 0x0a, 0x03, 0x66, 0x6f, 0x6f])

function serve(body: Uint8Array) {
  const fetch = vi.fn(async (_url: string) => new Response(body as BodyInit))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('globe tiles', () => {
  afterEach(() => vi.unstubAllGlobals())

  test('reads the gzipped file for the requested tile and inflates it', async () => {
    const fetch = serve(gzipSync(tile))
    const data = await loadGlobeTile('globe://3/2/5', new AbortController().signal)
    expect(fetch.mock.calls[0][0]).toBe('/globe/v2/vector/3/2/5.pbf.gz')
    expect(new Uint8Array(data)).toEqual(tile)
  })

  test('passes a tile through when the host already inflated it', async () => {
    serve(tile)
    expect(new Uint8Array(await loadGlobeTile('globe://0/0/0', new AbortController().signal))).toEqual(tile)
  })

  test('a bundled tile, served as-is by a static host, inflates to a vector tile', async () => {
    serve(readFileSync(join(process.cwd(), 'public', globeTilePath(0, 0, 0))))
    const data = new Uint8Array(await loadGlobeTile('globe://0/0/0', new AbortController().signal))
    expect(data[0]).toBe(VECTOR_LAYER_TAG)
  })

  test('an empty tile stays empty', async () => {
    serve(gzipSync(new Uint8Array()))
    expect((await loadGlobeTile('globe://5/0/0', new AbortController().signal)).byteLength).toBe(0)
  })
})
