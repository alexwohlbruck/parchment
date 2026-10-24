import { readFileSync } from 'node:fs'
import { afterEach, expect, test, vi } from 'vitest'
import { BakedBridgeLayer } from './baked-bridge-layer'
import { uploadMesh, deleteMesh, bindMesh } from '../mesh-program'
import { MATERIALS } from './mesh-file'
import type { DeckPalette } from '../deck.types'

vi.mock('../mesh-program', () => ({ programReady: () => true, linkMeshProgram: () => ({}), uploadMesh: vi.fn(() => ({ position: {}, count: 276 })), deleteMesh: vi.fn(), eyeOf: vi.fn(), bindMesh: vi.fn(() => ({ draw() {}, bias() {}, unbind() {} })) }))
vi.mock('../mesh-shadow', () => ({ MeshShadow: class { prepare() {} ready() { return true } set() {} delete() {} } }))
const bytes = readFileSync('src/lib/map-decks/baked/fixtures/arched-bridge.brm')
const palette = Object.fromEntries(MATERIALS.map(name => [name, [1, 1, 1]])) as DeckPalette
const file = `${'a'.repeat(64)}.brm`
const feature = { properties: { id: 'test', line: '-740000000,407000000;10000,0;10000,0', mesh: file } }
const frame = { defaultProjectionData: { mainMatrix: new Float32Array(16) } }
const isBundle = (url: unknown) => String(url).includes('/bridges/tiles/')
/** Fetches of single meshes, leaving out tile bundles. */
const meshCalls = () => vi.mocked(fetch).mock.calls.filter(([url]) => !isBundle(url))
/** The next single-mesh fetch answers with `respond`; bundles keep answering as before. */
function nextMesh(respond: (url: unknown, init?: RequestInit) => Promise<Response>) {
  const before = vi.mocked(fetch).getMockImplementation()!
  let used = false
  vi.mocked(fetch).mockImplementation((url, init) => {
    if (isBundle(url) || used) return before(url, init)
    used = true
    return respond(url, init)
  })
}

function setup(features = [feature], bundle?: (url: string) => Response) {
  vi.useFakeTimers()
  vi.stubEnv('VITE_BRIDGE_MESH_MANIFEST', '')
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => isBundle(url) ? bundle?.(String(url)) ?? new Response(null, { status: 404 }) : new Response(bytes)))
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
  vi.mocked(fetch).mockImplementation(async url => isBundle(url) ? new Response(null, { status: 404 }) : String(url).includes(margin.properties.mesh) ? new Promise<Response>(() => {}) : new Response(bytes))
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

test('a tile bundle brings the view\'s meshes without a fetch per deck, and draws them in the frame they land', async () => {
  const name = 'a'.repeat(64)
  const packed = new Uint8Array(8 + 36 + Math.ceil(bytes.length / 4) * 4)
  const view = new DataView(packed.buffer)
  view.setUint32(0, 0x31545242, true)
  view.setUint32(4, 1, true)
  packed.fill(0xaa, 8, 40)
  view.setUint32(40, bytes.length, true)
  packed.set(bytes, 44)
  const { layer, map, gl } = setup([feature], () => new Response(packed))
  await vi.runAllTimersAsync()
  layer.render(gl, frame)
  expect(vi.mocked(fetch).mock.calls.some(([url]) => isBundle(url))).toBe(true)
  expect(meshCalls()).toHaveLength(0)
  expect(uploadMesh).toHaveBeenCalledTimes(1)
  expect(layer.covered).toBe(true)
  expect(file).toBe(`${name}.brm`)
  layer.onRemove(map, gl)
})

