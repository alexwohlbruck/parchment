import { readFileSync } from 'node:fs'
import { afterEach, expect, test, vi } from 'vitest'
import { BakedBridgeLayer } from './baked-bridge-layer'
import { uploadMesh, deleteMesh } from '../mesh-program'
import { MATERIALS } from './mesh-file'
import type { DeckPalette } from '../deck.types'

vi.mock('../mesh-program', () => ({ programReady: () => true, linkMeshProgram: () => ({}), uploadMesh: vi.fn(() => ({ position: {}, count: 276 })), deleteMesh: vi.fn(), eyeOf: vi.fn(), bindMesh: vi.fn(() => ({ draw() {}, bias() {}, unbind() {} })) }))
vi.mock('../mesh-shadow', () => ({ MeshShadow: class { prepare() {} ready() { return true } set() {} delete() {} } }))
const bytes = readFileSync('src/lib/map-decks/baked/fixtures/arched-bridge.brm')
const palette = Object.fromEntries(MATERIALS.map(name => [name, [1, 1, 1]])) as DeckPalette
const file = `${'a'.repeat(64)}.brm`
const feature = { properties: { id: 'test', line: '-740000000,407000000;10000,0;10000,0', mesh: file } }

function setup() {
  vi.useFakeTimers()
  vi.stubEnv('VITE_BRIDGE_MESH_MANIFEST', '')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)))
  const handlers = new Map<string, (event?: any) => void>()
  const map = { on: (name: string, handler: (event?: any) => void) => handlers.set(name, handler), off: vi.fn(),
    getSource: () => ({ tiles: ['https://example.test/tiles/detail/{z}/{x}/{y}'] }),
    getBounds: () => ({ getWest: () => -74.01, getEast: () => -73.99, getNorth: () => 40.71, getSouth: () => 40.69 }),
    getCenter: () => ({ lng: -74, lat: 40.7 }), querySourceFeatures: () => [feature], getZoom: () => 17.6, getTerrain: () => ({ exaggeration: 1.2 }), triggerRepaint: vi.fn(),
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
  layer.render(gl, { defaultProjectionData: { mainMatrix: new Float32Array(16) } })
  expect(layer.ready).toBe(true)
  expect(uploadMesh).toHaveBeenCalledTimes(1)
  const version = layer.version
  handlers.get('moveend')!()
  await vi.runAllTimersAsync()
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(uploadMesh).toHaveBeenCalledTimes(1)
  expect(layer.version).toBe(version)
  layer.onRemove(map, gl)
  expect(deleteMesh).toHaveBeenCalledTimes(1)
  expect(map.off).toHaveBeenCalledTimes(4)
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
  layer.render(gl, { defaultProjectionData: { mainMatrix: new Float32Array(16) } })
  expect(built).not.toHaveBeenCalled()
  await Promise.resolve()
  expect(built).toHaveBeenCalledTimes(1)
  layer.onRemove(map, gl)
})

test('a deck stands its true height over exaggerated terrain, as buildings and landmarks do', async () => {
  const { layer, map, gl } = setup()
  await vi.runAllTimersAsync()
  layer.render(gl, { defaultProjectionData: { mainMatrix: new Float32Array(16) } })
  // The fixture's crest is 8 m over sea-level ground; exaggerated 1.2 as a whole it would be drawn 9.6 m up.
  expect(layer.surfaceAt(-73.999, 40.7)).toBeCloseTo(8, 1)
  layer.onRemove(map, gl)
})
