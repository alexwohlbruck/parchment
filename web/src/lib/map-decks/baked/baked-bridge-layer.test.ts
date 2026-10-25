import { readFileSync } from 'node:fs'
import { afterEach, expect, test, vi } from 'vitest'
import { BakedBridgeLayer } from './baked-bridge-layer'
import { uploadMesh, deleteMesh, bindMesh } from '../mesh-program'
import { MATERIALS } from './mesh-file'
import type { DeckPalette } from '../deck.types'
import { deckTile, vectorTile } from './fixtures/deck-tiles'

vi.mock('../mesh-program', () => ({ programReady: () => true, linkMeshProgram: () => ({}), uploadMesh: vi.fn(() => ({ position: {}, count: 276 })), deleteMesh: vi.fn(), eyeOf: vi.fn(), bindMesh: vi.fn(() => ({ draw() {}, bias() {}, unbind() {} })) }))
vi.mock('../mesh-shadow', () => ({ MeshShadow: class { prepare() {} ready() { return true } set() {} delete() {} } }))
const bytes = readFileSync('src/lib/map-decks/baked/fixtures/arched-bridge.brm')
const palette = Object.fromEntries(MATERIALS.map(name => [name, [1, 1, 1]])) as DeckPalette
const file = `${'a'.repeat(64)}.brm`
const feature = { properties: { id: 'test', line: '-740000000,407000000;10000,0;10000,0', mesh: file } }
const frame = { defaultProjectionData: { mainMatrix: new Float32Array(16) } }
const isIndex = (url: unknown) => String(url).includes('/bridges/index/')
/** Fetches of meshes, leaving out tile indexes. */
const meshCalls = () => vi.mocked(fetch).mock.calls.filter(([url]) => !isIndex(url))
/** The next mesh fetch answers with `respond`; indexes keep answering as before. */
function nextMesh(respond: (url: unknown, init?: RequestInit) => Promise<Response>) {
  const before = vi.mocked(fetch).getMockImplementation()!
  let used = false
  vi.mocked(fetch).mockImplementation((url, init) => {
    if (isIndex(url) || used) return before(url, init)
    used = true
    return respond(url, init)
  })
}

function setup(features = [feature], index?: (url: string) => Response) {
  vi.useFakeTimers()
  vi.stubEnv('VITE_BRIDGE_MESH_MANIFEST', '')
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => isIndex(url) ? index?.(String(url)) ?? new Response(null, { status: 404 }) : new Response(bytes)))
  const handlers = new Map<string, (event?: any) => void>()
  const map = { on: (name: string, handler: (event?: any) => void) => handlers.set(name, handler), off: vi.fn(),
    getSource: () => ({ tiles: ['https://example.test/tiles/detail/{z}/{x}/{y}'] }),
    getBounds: () => ({ getWest: () => -74.01, getEast: () => -73.99, getNorth: () => 40.71, getSouth: () => 40.69 }),
    getCenter: () => ({ lng: -74, lat: 40.7 }), querySourceFeatures: () => features, isSourceLoaded: () => true, getZoom: () => 17.6, getTerrain: () => ({ exaggeration: 1.2 }), triggerRepaint: vi.fn(),
  }
  const gl = new Proxy({ deleteProgram: vi.fn() } as Record<string, any>, { get: (target, name: string) => target[name] ?? (target[name] = vi.fn()) }) as unknown as WebGL2RenderingContext
  const layer = new BakedBridgeLayer({ profiles: { source: 'detail', layer: 'bridge_decks' }, routes: () => [] }, palette)
  layer.onAdd(map, gl)
  return { layer, map, gl, handlers }
}

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })

test('panning over the same bridges reuses downloaded meshes and GPU buffers', async () => {
  const { layer, map, gl, handlers } = setup()
  await vi.runAllTimersAsync()
  expect(uploadMesh).not.toHaveBeenCalled()
  layer.render(gl, frame)
  expect(layer.covered).toBe(true)
  expect(uploadMesh).toHaveBeenCalledTimes(1)
  const version = layer.version
  handlers.get('moveend')!()
  await vi.runAllTimersAsync()
  expect(meshCalls()).toHaveLength(1)
  expect(uploadMesh).toHaveBeenCalledTimes(1)
  expect(layer.version).toBe(version)
  layer.onRemove(map, gl)
  expect(deleteMesh).toHaveBeenCalledTimes(1)
  for (const [name, handler] of handlers) expect(map.off).toHaveBeenCalledWith(name, handler)
})

test('removal aborts in-flight downloads and never uploads their stale results', async () => {
  const { layer, map, gl } = setup()
  let resolve!: (response: Response) => void
  nextMesh(() => new Promise(r => { resolve = r }))
  await vi.advanceTimersByTimeAsync(100)
  const signal = meshCalls()[0][1]?.signal
  layer.onRemove(map, gl)
  expect(signal?.aborted).toBe(true)
  resolve(new Response(bytes))
  await vi.runAllTimersAsync()
  expect(uploadMesh).not.toHaveBeenCalled()
})

test('notifies style changes after the render callback has finished', async () => {
  const { layer, map, gl } = setup()
  const built = vi.fn()
  layer.onBuilt = built
  await vi.runAllTimersAsync()
  layer.render(gl, frame)
  expect(built).not.toHaveBeenCalled()
  await Promise.resolve()
  expect(built).toHaveBeenCalledTimes(1)
  layer.onRemove(map, gl)
})

test('a deck stands its true height over exaggerated terrain, as buildings and landmarks do', async () => {
  const { layer, map, gl } = setup()
  await vi.runAllTimersAsync()
  layer.render(gl, frame)
  // The fixture's crest is 8 m over sea-level ground; exaggerated 1.2 as a whole it would be drawn 9.6 m up.
  expect(layer.surfaceAt(-73.999, 40.7)).toBeCloseTo(8, 1)
  layer.onRemove(map, gl)
})

test('a deck coming into view keeps the loaded ones drawn and the flat bridges muted while it loads', async () => {
  const features = [feature]
  const { layer, map, gl, handlers } = setup(features)
  await vi.runAllTimersAsync()
  layer.render(gl, frame)
  expect(layer.covered).toBe(true)
  nextMesh(() => new Promise(() => {}))
  features.push({ properties: { ...feature.properties, id: 'next', mesh: `${'b'.repeat(64)}.brm` } })
  handlers.get('moveend')!()
  await vi.runAllTimersAsync()
  vi.mocked(bindMesh).mockClear()
  layer.render(gl, frame)
  expect(layer.covered).toBe(true)
  expect(bindMesh).toHaveBeenCalledTimes(1)
  layer.onRemove(map, gl)
})

test('a deck without a baked mesh hands every bridge back to the flat layers', async () => {
  const features = [feature]
  const { layer, map, gl, handlers } = setup(features)
  await vi.runAllTimersAsync()
  layer.render(gl, frame)
  features.push({ properties: { ...feature.properties, id: 'unbaked', mesh: undefined as any } })
  handlers.get('moveend')!()
  await vi.runAllTimersAsync()
  expect(layer.covered).toBe(false)
  layer.onRemove(map, gl)
})

test('a mesh that never arrives hands the view back to the flat bridges', async () => {
  const features = [feature]
  const { layer, map, gl, handlers } = setup(features)
  await vi.runAllTimersAsync()
  layer.render(gl, frame)
  nextMesh((_, init) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))))
  features.push({ properties: { ...feature.properties, id: 'next', mesh: `${'b'.repeat(64)}.brm` } })
  handlers.get('moveend')!()
  await vi.advanceTimersByTimeAsync(1000)
  expect(layer.covered).toBe(true)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(layer.covered).toBe(false)
  layer.onRemove(map, gl)
})

test('the decks cover once the view is drawn, without waiting on meshes fetched for its margin', async () => {
  const margin = { properties: { id: 'margin', line: '-739880000,407000000;10000,0', mesh: `${'c'.repeat(64)}.brm` } }
  const { layer, map, gl } = setup([feature, margin])
  vi.mocked(fetch).mockImplementation(async url => isIndex(url) ? new Response(null, { status: 404 }) : String(url).includes(margin.properties.mesh) ? new Promise<Response>(() => {}) : new Response(bytes))
  await vi.runAllTimersAsync()
  layer.render(gl, frame)
  expect(meshCalls()).toHaveLength(2)
  expect(meshCalls().map(([, init]) => init?.priority)).toEqual(['high', 'low'])
  expect(layer.covered).toBe(true)
  layer.onRemove(map, gl)
})

test('meshes that arrive together are drawn in the same frame', async () => {
  const { layer, map, gl } = setup([feature, { properties: { ...feature.properties, id: 'twin', mesh: `${'b'.repeat(64)}.brm` } }])
  await vi.runAllTimersAsync()
  layer.render(gl, frame)
  expect(uploadMesh).toHaveBeenCalledTimes(2)
  expect(layer.covered).toBe(true)
  layer.onRemove(map, gl)
})

test('a tile index starts the view\'s meshes before its detail tiles list them, so they draw in the frame the tiles land', async () => {
  const features: typeof feature[] = []
  const { layer, map, gl, handlers } = setup(features, () => Response.json({ decks: [[file, -74.0, 40.7, -73.99, 40.7]] }))
  await vi.runAllTimersAsync()
  expect(meshCalls()).toHaveLength(1)
  expect(meshCalls()[0][1]?.priority).toBe('high')
  expect(uploadMesh).not.toHaveBeenCalled()
  features.push(feature)
  handlers.get('sourcedata')!({ sourceId: 'detail', isSourceLoaded: true })
  await vi.runAllTimersAsync()
  layer.render(gl, frame)
  expect(meshCalls()).toHaveLength(1)
  expect(uploadMesh).toHaveBeenCalledTimes(1)
  expect(layer.covered).toBe(true)
  layer.onRemove(map, gl)
})

function tileMode(payload: Uint8Array) {
  const env = setup()
  const [z, x, y] = [16, Math.floor(((-74 + 180) / 360) * 2 ** 16), Math.floor((0.5 - Math.log(Math.tan(Math.PI / 4 + (40.7 * Math.PI) / 360)) / (2 * Math.PI)) * 2 ** 16)]
  const tile = { state: 'loaded', tileID: { canonical: { z, x, y } }, latestRawTileData: vectorTile(payload) }
  Object.assign(env.map, {
    getSource: () => ({ tiles: ['https://example.test/tiles/detail/{z}/{x}/{y}?v=1&decks=1'] }),
    style: { tileManagers: { detail: { getRenderableIds: () => ['t'], getTileByID: () => tile } } },
  })
  vi.mocked(fetch).mockClear()
  return { ...env, tile }
}

test('draws the deck pieces a detail tile carries on the frame after it loads, fetching no meshes', async () => {
  const { layer, map, gl, handlers, tile } = tileMode(deckTile([new Uint8Array(bytes)]))
  handlers.get('sourcedata')!({ sourceId: 'detail', tile })
  await vi.runAllTimersAsync()
  layer.render(gl, frame)
  expect(uploadMesh).toHaveBeenCalledTimes(1)
  expect(layer.covered).toBe(true)
  expect(fetch).not.toHaveBeenCalled()
  layer.onRemove(map, gl)
})

test('keeps the flat bridges where barrelman could not read a deck of the tile', async () => {
  const { layer, map, gl, handlers, tile } = tileMode(deckTile([new Uint8Array(bytes)], ['b'.repeat(64) + '.brm']))
  handlers.get('sourcedata')!({ sourceId: 'detail', tile })
  await vi.advanceTimersByTimeAsync(1000)
  layer.render(gl, frame)
  expect(layer.covered).toBe(false)
  layer.onRemove(map, gl)
})

test('reads a tile again once its pieces have been evicted', async () => {
  const { layer, map, gl, handlers, tile } = tileMode(deckTile([new Uint8Array(bytes)]))
  handlers.get('sourcedata')!({ sourceId: 'detail', tile })
  await vi.runAllTimersAsync()
  layer.render(gl, frame)
  const [id] = (layer as any).parts.keys()
  ;(layer as any).remove(id)
  handlers.get('moveend')!()
  await vi.runAllTimersAsync()
  layer.render(gl, frame)
  expect(uploadMesh).toHaveBeenCalledTimes(2)
  expect(layer.covered).toBe(true)
  layer.onRemove(map, gl)
})

test('fetches a failed tile afresh once its retry is due, and draws its decks', async () => {
  const { layer, map, gl, handlers, tile } = tileMode(deckTile([new Uint8Array(bytes)], ['b'.repeat(64) + '.brm']))
  handlers.get('sourcedata')!({ sourceId: 'detail', tile })
  await vi.advanceTimersByTimeAsync(1000)
  vi.mocked(fetch).mockImplementation(async () => new Response(vectorTile(deckTile([new Uint8Array(bytes)]))))
  await vi.advanceTimersByTimeAsync(11_000)
  layer.render(gl, frame)
  expect(vi.mocked(fetch).mock.calls.at(-1)?.[1]).toMatchObject({ cache: 'reload' })
  expect(layer.covered).toBe(true)
  layer.onRemove(map, gl)
})

test('reads the zoom-16 tile a deeper one is cut from as soon as that one starts loading', async () => {
  const { layer, map, gl, handlers, tile } = tileMode(deckTile([new Uint8Array(bytes)]))
  vi.mocked(fetch).mockImplementation(async () => new Response(vectorTile(deckTile([new Uint8Array(bytes)]))))
  const { z, x, y } = tile.tileID.canonical
  handlers.get('sourcedataloading')!({ sourceId: 'detail', tile: { tileID: { canonical: { z: z + 2, x: 4 * x + 1, y: 4 * y + 3 } } } })
  expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(`https://example.test/tiles/detail/${z}/${x}/${y}?v=1&decks=1`)
  await vi.advanceTimersByTimeAsync(10)
  expect((layer as any).tilePieces.get(`${z}/${x}/${y}`)).toHaveLength(1)
  layer.onRemove(map, gl)
})

test('keeps a tile\'s decks drawn after MapLibre swaps it for children whose pieces are not ready', async () => {
  const { layer, map, gl, handlers, tile } = tileMode(deckTile([new Uint8Array(bytes)]))
  const { x, y } = tile.tileID.canonical
  const parent = { state: 'loaded', tileID: { canonical: { z: 15, x: x >> 1, y: y >> 1 } }, latestRawTileData: vectorTile(deckTile([new Uint8Array(bytes)])) }
  let renderable: any[] = [parent]
  Object.assign((map as any).style.tileManagers.detail, { getRenderableIds: () => renderable.map((_, i) => String(i)), getTileByID: (i: string) => renderable[Number(i)] })
  handlers.get('sourcedata')!({ sourceId: 'detail', tile: parent })
  await vi.advanceTimersByTimeAsync(500)
  layer.render(gl, frame)
  const parentPiece = `15/${x >> 1}/${y >> 1}|${'a'.repeat(64)}.brm`
  expect((layer as any).wanted.has(parentPiece)).toBe(true)
  // Children loaded, with no deck pieces read yet.
  renderable = [0, 1].flatMap(i => [0, 1].map(j => ({ state: 'loaded', tileID: { canonical: { z: 16, x: 2 * (x >> 1) + i, y: 2 * (y >> 1) + j } } })))
  handlers.get('moveend')!()
  await vi.advanceTimersByTimeAsync(500)
  expect((layer as any).wanted.has(parentPiece)).toBe(true)
  layer.onRemove(map, gl)
})

test('draws a tile\'s decks before the view covers, but not where a deck in view has no mesh and the flat bridges stay', async () => {
  const { layer, map, gl, handlers, tile } = tileMode(deckTile([new Uint8Array(bytes)]))
  handlers.get('sourcedata')!({ sourceId: 'detail', tile })
  await vi.advanceTimersByTimeAsync(10)
  vi.mocked(bindMesh).mockClear()
  layer.render(gl, frame)
  expect(bindMesh).toHaveBeenCalled()
  ;(map as any).querySourceFeatures = () => [{ properties: { id: 'other', line: feature.properties.line } }]
  handlers.get('moveend')!()
  await vi.advanceTimersByTimeAsync(500)
  vi.mocked(bindMesh).mockClear()
  layer.render(gl, frame)
  expect(layer.covered).toBe(false)
  expect(bindMesh).not.toHaveBeenCalled()
  layer.onRemove(map, gl)
})

test('reads a deck-zoom tile\'s pieces as it starts loading, and not again when it lands', async () => {
  const { layer, map, gl, handlers, tile } = tileMode(deckTile([new Uint8Array(bytes)]))
  vi.mocked(fetch).mockImplementation(async () => new Response(vectorTile(deckTile([new Uint8Array(bytes)]))))
  handlers.get('sourcedataloading')!({ sourceId: 'detail', tile })
  await vi.advanceTimersByTimeAsync(10)
  expect(fetch).toHaveBeenCalledTimes(1)
  handlers.get('sourcedata')!({ sourceId: 'detail', tile })
  await vi.advanceTimersByTimeAsync(10)
  layer.render(gl, frame)
  expect(uploadMesh).toHaveBeenCalledTimes(1)
  layer.onRemove(map, gl)
})
