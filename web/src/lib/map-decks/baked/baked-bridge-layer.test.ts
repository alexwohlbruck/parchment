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

function setup(features = [feature]) {
  vi.useFakeTimers()
  vi.stubEnv('VITE_BRIDGE_MESH_MANIFEST', '')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)))
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
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(uploadMesh).toHaveBeenCalledTimes(1)
  expect(layer.version).toBe(version)
  layer.onRemove(map, gl)
  expect(deleteMesh).toHaveBeenCalledTimes(1)
  for (const [name, handler] of handlers) expect(map.off).toHaveBeenCalledWith(name, handler)
})

test('removal aborts in-flight downloads and never uploads their stale results', async () => {
  const { layer, map, gl } = setup()
  let resolve!: (response: Response) => void
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(r => { resolve = r }))
  await vi.advanceTimersByTimeAsync(100)
  const signal = vi.mocked(fetch).mock.calls[0][1]?.signal
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
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {}))
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
  vi.mocked(fetch).mockImplementationOnce((_, init) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))))
  features.push({ properties: { ...feature.properties, id: 'next', mesh: `${'b'.repeat(64)}.brm` } })
  handlers.get('moveend')!()
  await vi.advanceTimersByTimeAsync(1000)
  expect(layer.covered).toBe(true)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(layer.covered).toBe(false)
  layer.onRemove(map, gl)
})
