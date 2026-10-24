import type { DeckPalette, DeckSources } from '../deck.types'
import { bindMesh, deleteMesh, eyeOf, programReady, linkMeshProgram, uploadMesh, type MeshBuffers } from '../mesh-program'
import { MeshShadow } from '../mesh-shadow'
import { mercator, metresPerUnit, standing, TOUCHDOWN, BOX_MIN, underWay, runsWith, parseLine, boundsOf, meets, holds, deckMeshOut, linesOf, type Mesh, type Point, type Bounds } from '../decks'
import { translate } from '@/lib/map-objects/object-layer'
import { HD_FADE } from '@/lib/map-style/road-markings'
import { liveBuildingShade } from '@/lib/map/building-shade'
import type { SunFrame } from '@/lib/map/sun-shadow'
import { queryFeatures } from '../map-query'
import { routeOverlay } from './route-overlay'
import { BRIDGE_MESH_FILE, gpuBytes, MATERIALS, type BakedMesh } from './mesh-file'
import { INDEX_ZOOM, indexTiles, parseIndex } from './mesh-index'
import { decodeMesh } from './mesh-decoder'
import { deckCover } from './cover'
import { deckFootprints } from '../footprints'

const MIN_LINE_PX = 1
const RAILS_FROM = 17.5
const MAX_BYTES = 96 * 1024 * 1024
/** Meshes fetched at once: each waits on the main thread between its steps, so a deep queue keeps the network busy through long frames. */
const MAX_REQUESTS = 12
/** Bytes of decoded meshes kept for decks not yet wanted, and deck bounds kept from tile indexes. */
const MAX_DECODED = 48 * 1024 * 1024
const MAX_INDEXED = 20_000
/** Milliseconds of mesh uploads one frame may spend, so a burst of arrivals draws within a few frames without a long one. */
const UPLOAD_BUDGET_MS = 4
const LOAD_TIMEOUT_MS = 30_000
/** Milliseconds between view syncs while the camera moves, so meshes load before it stops. */
const MOVING_SYNC_MS = 250
const TILE_SYNC_MS = 100
const REBUILD_MS = 300

type Stand = NonNullable<ReturnType<typeof standing>>
type Part = { data: Pick<BakedMesh, 'origin' | 'ranges' | 'stands' | 'under' | 'tracks'>; buffers: MeshBuffers; shadow: MeshShadow; bytes: number; bounds: Bounds | null }

export class BakedBridgeLayer {
  readonly id = 'map-decks'
  readonly type = 'custom' as const
  readonly renderingMode = '3d' as const
  version = 0
  onBuilt?: () => void
  /** The decks stand in for the flat bridges: drawn, with the flat layers muted under them. */
  covered = false
  private pending = new Map<string, { data: BakedMesh; bytes: number }>()
  private routePending: { mesh: Mesh; origin: Point } | null = null
  private route: Part | null = null
  private routeDirty = true
  private routeSources: string[] = []
  private notifyPending = false
  private map: any
  private gl!: WebGL2RenderingContext
  private shadows = new MeshShadow()
  private program!: WebGLProgram
  private colors: Float32Array
  private parts = new Map<string, Part>()
  private wanted = new Set<string>()
  /** The wanted meshes inside the view itself rather than its margin: the decks cover once these are drawn. */
  private inView = new Set<string>()
  private requests = new Map<string, AbortController>()
  /** Meshes decoded before the detail tiles ask for them. */
  private decoded = new Map<string, { data: BakedMesh; bytes: number }>()
  private decodedBytes = 0
  /** Tile indexes by `x/y`: in flight, or read into `indexed`. */
  private indexes = new Map<string, AbortController | true>()
  private indexed = new Map<string, Bounds>()
  /** Meshes the indexes say the view will want, fetched while its detail tiles load: nearest first, those in view itself flagged. */
  private ahead: string[] = []
  private aheadInView = new Set<string>()
  private lastView: { view: Bounds; core: Bounds; center: Point } | null = null
  private failed = new Set<string>()
  private scheduled?: ReturnType<typeof setTimeout>
  private tileSync?: ReturnType<typeof setTimeout>
  private rebuildTimer?: ReturnType<typeof setTimeout>
  private sun: SunFrame | null = null
  private bytes = 0
  private bounds = new Map<string, Bounds>()
  private displayed = ''
  private missing = false
  private settled = false
  private lastSync = 0
  /** DEV only: meshes baked from a local fixture, drawn wherever they meet the view, whatever the tiles hold. */
  private preview: Array<{ url: string; bounds: Bounds }> | null = null

  constructor(private sources: DeckSources, palette: DeckPalette) {
    this.colors = new Float32Array(MATERIALS.flatMap(name => palette[name]))
  }
  setPalette(palette: DeckPalette) {
    this.colors = new Float32Array(MATERIALS.flatMap(name => palette[name]))
    this.map?.triggerRepaint()
  }
  get shadowVersion() { return this.version }
  receiveSun(frame: SunFrame) { this.sun = frame }
  drawShadow(gl: WebGL2RenderingContext, frame: { matrix: ArrayLike<number>; shear: [number, number] }) {
    if (this.covered) for (const [id, part] of this.parts) if (this.wanted.has(id)) part.shadow.drawShadow(gl, frame, this.exaggeration())
  }
  drawSunDepth(gl: WebGL2RenderingContext, frame: SunFrame) {
    if (this.covered) for (const [id, part] of this.parts) if (this.wanted.has(id)) part.shadow.drawSunDepth(gl, frame, this.exaggeration())
  }
  private exaggeration() { return this.map?.getTerrain?.()?.exaggeration ?? 1 }
  private routesChanged = () => {
    const sources = this.sources.routes()
    if (sources.join(',') === this.routeSources.join(',')) return
    this.routeSources = sources
    this.routeDirty = true
    this.syncRoute()
  }
  private changed = (event?: { sourceId?: string; isSourceLoaded?: boolean }) => {
    if (!event?.sourceId) this.failed.clear()
    // The ids as of the last styledata: listing them serialises the whole style, too slow for every tile.
    if (event?.sourceId && this.routeSources.includes(event.sourceId)) {
      this.routeDirty = true
      this.syncRoute()
      return
    }
    if (event?.sourceId && event.sourceId !== this.sources.profiles?.source) return
    // Each tile as it lands, at most every TILE_SYNC_MS: its decks' meshes are often decoded already.
    if (event?.sourceId && !event.isSourceLoaded) {
      this.tileSync ??= setTimeout(() => { this.tileSync = undefined; this.sync() }, TILE_SYNC_MS)
      return
    }
    clearTimeout(this.scheduled)
    this.scheduled = setTimeout(() => this.sync(), 0)
  }
  private moving = () => {
    if (performance.now() - this.lastSync < MOVING_SYNC_MS) return
    this.lastSync = performance.now()
    this.sync()
  }
  onAdd(map: any, gl: WebGL2RenderingContext) {
    this.map = map
    this.gl = gl
    this.program = linkMeshProgram(gl, true)
    this.shadows.prepare(gl)
    map.on('sourcedata', this.changed)
    map.on('moveend', this.changed)
    map.on('move', this.moving)
    map.on('terrain', this.changed)
    map.on('styledata', this.routesChanged)
    this.routeSources = this.sources.routes()
    if (import.meta.env.DEV && import.meta.env.VITE_BRIDGE_MESH_MANIFEST) {
      void fetch(import.meta.env.VITE_BRIDGE_MESH_MANIFEST).then(r => r.json()).then(manifest => { this.preview = manifest; this.changed() }).catch(error => console.warn('[bridge preview]', error))
    }
    this.changed()
  }
  onRemove(map: any, gl: WebGL2RenderingContext) {
    map.off('sourcedata', this.changed)
    map.off('moveend', this.changed)
    map.off('move', this.moving)
    map.off('terrain', this.changed)
    map.off('styledata', this.routesChanged)
    clearTimeout(this.scheduled)
    clearTimeout(this.tileSync)
    this.tileSync = undefined
    clearTimeout(this.rebuildTimer)
    this.rebuildTimer = undefined
    for (const request of this.requests.values()) request.abort()
    this.requests.clear()
    for (const index of this.indexes.values()) if (index !== true) index.abort()
    this.indexes.clear()
    this.indexed.clear()
    this.decoded.clear()
    this.decodedBytes = 0
    this.pending.clear()
    this.routePending = null
    for (const id of this.parts.keys()) this.remove(id)
    if (this.route) deleteMesh(gl, this.route.buffers)
    this.shadows.delete(gl)
    gl.deleteProgram(this.program)
    this.map = null
  }
  private remove(id: string) {
    const part = this.parts.get(id)
    if (!part) return
    deleteMesh(this.gl, part.buffers)
    part.shadow.delete(this.gl)
    this.bytes -= part.bytes
    this.parts.delete(id)
  }
  private sync() {
    if (!this.map || !this.sources.profiles) return
    const { source, layer } = this.sources.profiles
    const b = this.map.getBounds(), c = this.map.getCenter()
    const nw = mercator([b.getWest(), b.getNorth()]), se = mercator([b.getEast(), b.getSouth()]), center = mercator([c.lng, c.lat])
    const reach = 2500 / metresPerUnit(center[1])
    const pad = Math.max(se[0] - nw[0], se[1] - nw[1]) * 0.25
    const clamp = (pad: number): Bounds => ({ minX: Math.max(nw[0] - pad, center[0] - reach), minY: Math.max(nw[1] - pad, center[1] - reach), maxX: Math.min(se[0] + pad, center[0] + reach), maxY: Math.min(se[1] + pad, center[1] + reach) })
    const view = clamp(pad), core = clamp(0)
    const near = new Map<string, number>()
    const inside = new Set<string>()
    const place = (file: string | undefined, bounds: Bounds) => {
      if (!file) return
      near.set(file, Math.min(near.get(file) ?? Infinity, distanceOutside(bounds, center)))
      if (meets(bounds, core)) inside.add(file)
    }
    const features = this.preview ? [] : queryFeatures(this.map, source, layer).filter(f => {
      const key = `${f.properties?.id}|${f.properties?.mesh ?? f.properties?.line}`
      let bounds = this.bounds.get(key)
      if (!bounds) {
        const points = parseLine(f.properties?.line).map(mercator)
        if (!points.length) return false
        bounds = boundsOf(points, 100)
        if (this.bounds.size >= 2000) this.bounds.clear()
        this.bounds.set(key, bounds)
      }
      if (!meets(bounds, view)) return false
      place(f.properties?.mesh, bounds)
      return true
    })
    const decks = new Map<string, { file: string; zoom: number }>()
    for (const feature of features) {
      const id = String(feature.properties?.id ?? '')
      const file = feature.properties?.mesh
      const zoom = feature._z ?? 0
      if (id && (!decks.has(id) || zoom >= decks.get(id)!.zoom)) decks.set(id, { file: file ?? '', zoom })
    }
    for (const { url, bounds } of this.preview ?? []) if (meets(bounds, view)) {
      const file = url.split('/').at(-1)!
      decks.set(url, { file, zoom: 0 })
      place(file, bounds)
    }
    this.missing = [...decks.values()].some(d => !BRIDGE_MESH_FILE.test(d.file))
    this.settled = !!this.preview || (!!this.map.getSource(source) && !!this.map.isSourceLoaded?.(source))
    const files = [...new Set([...decks.values()].flatMap(d => BRIDGE_MESH_FILE.test(d.file) ? [d.file] : []))]
    this.wanted = new Set(files.sort((a, b) => Number(inside.has(b)) - Number(inside.has(a)) || (near.get(a) ?? 0) - (near.get(b) ?? 0)))
    this.inView = new Set(files.filter(file => inside.has(file)))
    this.lastView = { view, core, center }
    this.fetchIndexes(view, center)
    this.planAhead()
    for (const [id, entry] of this.pending) if (!this.wanted.has(id)) { this.pending.delete(id); this.keep(id, entry) }
    for (const [id, request] of this.requests) if (!this.wanted.has(id) && !this.aheadInView.has(id) && !this.ahead.includes(id)) { request.abort(); this.requests.delete(id) }
    for (const id of this.parts.keys()) if (!this.wanted.has(id) && this.bytes > MAX_BYTES) this.remove(id)
    this.updateCover()
    this.pump()
  }
  private updateCover() {
    const covered = deckCover(this.covered, { missing: this.missing, failed: [...this.wanted].some(id => this.failed.has(id)), wanted: this.inView.size, resident: [...this.inView].filter(id => this.parts.has(id)).length, settled: this.settled })
    // Objects, routes and shadows rebuild on each change, so a deck set that shifts mid-move waits for moveend.
    if (covered === this.covered && this.map?.isMoving?.()) return
    const flipped = covered !== this.covered
    this.covered = covered
    // Meshes arriving under decks already drawn are taken in together: each rebuild re-stands every object.
    if (flipped) this.rebuild()
    else this.rebuildTimer ??= setTimeout(() => { this.rebuildTimer = undefined; if (!this.map?.isMoving?.()) this.rebuild() }, REBUILD_MS)
  }
  private rebuild() {
    clearTimeout(this.rebuildTimer)
    this.rebuildTimer = undefined
    if (!this.map) return
    const resident = this.covered ? [...this.wanted].filter(id => this.parts.has(id)) : []
    const displayed = this.covered ? `${resident.sort().join(',')}|${this.exaggeration()}` : ''
    if (displayed === this.displayed) return
    this.displayed = displayed
    this.routeDirty = true
    this.syncRoute()
    this.version++
    if (!this.notifyPending) {
      this.notifyPending = true
      queueMicrotask(() => {
        this.notifyPending = false
        if (this.map) this.onBuilt?.()
      })
    }
    this.map.triggerRepaint()
  }

  private pump() {
    if (!this.map) return
    const template = this.map.getSource(this.sources.profiles?.source)?.tiles?.[0] as string | undefined
    if (!template || !template.includes('/detail/')) return
    for (const id of this.wanted) {
      const ready = this.decoded.get(id)
      if (!ready || this.parts.has(id) || this.pending.has(id)) continue
      this.decoded.delete(id)
      this.decodedBytes -= ready.bytes
      this.pending.set(id, ready)
      this.map.triggerRepaint()
    }
    for (const id of [...this.wanted, ...this.ahead]) {
      if (this.requests.size >= MAX_REQUESTS) break
      if (this.parts.has(id) || this.pending.has(id) || this.decoded.has(id) || this.requests.has(id) || this.failed.has(id)) continue
      const controller = new AbortController()
      this.requests.set(id, controller)
      const url = this.preview?.find(p => p.url.endsWith(id))?.url ?? template.replace(/\/detail\/[^?]+/, `/bridges/models/${id}`)
      void this.load(id, url, controller, this.inView.has(id) || this.aheadInView.has(id) ? 'high' : 'low')
    }
  }
  private async load(id: string, url: string, controller: AbortController, priority: RequestPriority) {
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, LOAD_TIMEOUT_MS)
    try {
      const response = await fetch(url, { signal: controller.signal, credentials: 'include', priority })
      if (!response.ok) throw new Error(`Bridge mesh: ${response.status}`)
      const mesh = await decodeMesh(await response.arrayBuffer())
      if (!this.map || controller.signal.aborted) return
      this.accept(id, mesh)
    } catch (error) {
      if (timedOut || !controller.signal.aborted) {
        this.failed.add(id)
        this.updateCover()
        console.warn('[bridges]', error)
      }
    } finally {
      clearTimeout(timer)
      if (this.requests.get(id) === controller) this.requests.delete(id)
      this.pump()
    }
  }
  /** Fetches the indexes of the tiles the view meets, and drops those it has left. */
  private fetchIndexes(view: Bounds, [cx, cy]: Point) {
    const template = this.map.getSource(this.sources.profiles?.source)?.tiles?.[0] as string | undefined
    if (this.preview || !template?.includes('/detail/')) return
    const n = 2 ** INDEX_ZOOM
    const tiles = this.map.getZoom() >= INDEX_ZOOM ? indexTiles(view) : []
    for (const [tile, index] of this.indexes) if (index !== true && !tiles.includes(tile)) { index.abort(); this.indexes.delete(tile) }
    const [x, y] = [Math.floor(cx * n), Math.floor(cy * n)]
    for (const tile of tiles) {
      if (this.indexes.has(tile)) continue
      const controller = new AbortController()
      this.indexes.set(tile, controller)
      const [tx, ty] = tile.split('/').map(Number)
      void this.loadIndex(tile, template.replace(/\/detail\/[^?]+/, `/bridges/index/${INDEX_ZOOM}/${tile}`), controller, Math.abs(tx - x) + Math.abs(ty - y) <= 1 ? 'high' : 'low')
    }
  }
  private async loadIndex(tile: string, url: string, controller: AbortController, priority: RequestPriority) {
    try {
      const response = await fetch(url, { signal: controller.signal, credentials: 'include', priority })
      if (!response.ok) throw new Error(`Bridge deck index: ${response.status}`)
      const decks = parseIndex(await response.json())
      if (!this.map || controller.signal.aborted) return
      if (this.indexed.size + decks.length > MAX_INDEXED) this.indexed.clear()
      for (const { file, bounds } of decks) this.indexed.set(file, bounds)
      this.indexes.set(tile, true)
      this.planAhead()
      this.pump()
    } catch (error) {
      // Without an index the view's meshes still load, once its detail tiles do.
      if (!controller.signal.aborted) {
        this.indexes.set(tile, true)
        console.warn('[bridges]', error)
      }
    }
  }
  /** The indexed meshes the view will want that are not loaded yet: those in view itself first, then the nearest. */
  private planAhead() {
    if (!this.lastView) return
    const { view, core, center } = this.lastView
    const ahead: Array<[string, number]> = []
    this.aheadInView = new Set()
    for (const [file, bounds] of this.indexed) {
      if (!meets(bounds, view) || this.wanted.has(file) || this.parts.has(file) || this.pending.has(file) || this.decoded.has(file)) continue
      const inView = meets(bounds, core)
      if (inView) this.aheadInView.add(file)
      ahead.push([file, (inView ? 0 : 1) + distanceOutside(bounds, center)])
    }
    this.ahead = ahead.sort((a, b) => a[1] - b[1]).map(([file]) => file)
  }
  /** A decoded mesh: uploaded next frame when its deck is wanted, else kept for when it is. */
  private accept(id: string, data: BakedMesh) {
    this.failed.delete(id)
    if (this.parts.has(id) || this.pending.has(id)) return
    const bytes = gpuBytes(data)
    if (!this.wanted.has(id)) return this.keep(id, { data, bytes })
    for (const old of this.parts.keys()) if (!this.wanted.has(old) && this.bytes + bytes > MAX_BYTES) this.remove(old)
    this.pending.set(id, { data, bytes })
    this.map.triggerRepaint()
  }
  private keep(id: string, entry: { data: BakedMesh; bytes: number }) {
    if (this.decoded.has(id)) return
    this.decoded.set(id, entry)
    this.decodedBytes += entry.bytes
    for (const [old, { bytes }] of this.decoded) {
      if (this.decodedBytes <= MAX_DECODED) break
      this.decoded.delete(old)
      this.decodedBytes -= bytes
    }
  }
  private syncRoute() {
    if (!this.map || !this.covered || !this.routeDirty) return
    this.routeDirty = false
    if (this.route) deleteMesh(this.gl, this.route.buffers)
    this.route = null
    this.routePending = null
    const parts = [...this.parts].filter(([id]) => this.wanted.has(id)).map(([, part]) => part)
    if (!parts.length) return
    const lines = this.routeSources.flatMap(id => queryFeatures(this.map, id).flatMap(f => linesOf(f.geometry).map(line => line.map(mercator))))
    if (!lines.length) return
    const origin = parts[0].data.origin
    const mesh = { ...deckMeshOut(), lift: [] as number[] }
    routeOverlay(mesh, lines, parts.flatMap(p => p.data.stands.map(s => s.surface)), origin)
    this.routePending = { mesh, origin }
    this.map.triggerRepaint()
  }
  surfaceAt(lng: number, lat: number): number | null {
    if (!this.covered) return null
    const point = mercator([lng, lat])
    let best: Stand | null = null
    for (const [id, part] of this.parts) {
      if (!this.wanted.has(id) || (part.bounds && !holds(part.bounds, point))) continue
      const hit = standing(part.data.stands, point)
      if (hit && (!best || hit.z > best.z)) best = hit
    }
    return best && this.drawnAt(best)
  }
  /** The ground under the decks drawn, or null while they are not. */
  footprints(): GeoJSON.MultiPolygon | null {
    if (!this.covered) return null
    return deckFootprints([...this.parts].flatMap(([id, part]) => (this.wanted.has(id) ? part.data.stands.map(s => s.chain) : [])))
  }
  standOn(lng: number, lat: number, along?: [number, number]): number | null {
    if (!this.covered) return null
    const point = mercator([lng, lat])
    let best: Stand | null = null
    for (const [id, part] of this.parts) {
      if (!this.wanted.has(id) || (part.bounds && !holds(part.bounds, point))) continue
      const hit = standing(part.data.stands, point, along)
      if (!hit) continue
      if (!(along && runsWith(part.data.tracks, point, along, 1)) && hit.height < BOX_MIN && underWay(part.data.under, point, along)) continue
      if (!best || hit.z > best.z) best = hit
    }
    return best && this.drawnAt(best)
  }
  /** Metres up a surface is drawn: its true height over the exaggerated ground. */
  private drawnAt(hit: Stand): number {
    return hit.z + (this.exaggeration() - 1) * hit.lift
  }
  render(gl: WebGL2RenderingContext, args: any) {
    if (!programReady(gl, this.program) || !this.shadows.ready(gl)) { this.map.triggerRepaint(); return }
    if (this.pending.size) {
      const started = performance.now()
      for (const [id, { data, bytes }] of this.pending) {
        // Until the decks cover, the view's own meshes go up together: the first frame drawn has them all.
        if (performance.now() - started > UPLOAD_BUDGET_MS && (this.covered || !this.inView.has(id))) continue
        this.pending.delete(id)
        const buffers = uploadMesh(gl, data)
        const shadow = new MeshShadow()
        shadow.set(gl, buffers.position, data.ranges.paintFrom, data.ground, data.origin, 1, buffers.indices, buffers.lift)
        this.parts.set(id, { data: { origin: data.origin, ranges: data.ranges, stands: data.stands, under: data.under, tracks: data.tracks }, buffers, shadow, bytes, bounds: standBounds(data.stands) })
        this.bytes += bytes
      }
      this.updateCover()
      if (this.pending.size) this.map.triggerRepaint()
    }
    if (this.routePending) {
      const { mesh, origin } = this.routePending
      this.routePending = null
      this.route = { data: { origin, ranges: { paintFrom: 0, railsFrom: 0, routesFrom: 0 }, stands: [], under: [], tracks: [] }, buffers: uploadMesh(gl, mesh), shadow: new MeshShadow(), bytes: 0, bounds: null }
    }
    if (!this.covered) return
    for (const [id, part] of this.parts) if (this.wanted.has(id)) this.drawPart(gl, args, part)
    if (this.route) this.drawPart(gl, args, this.route)
    this.sun = null
  }
  private drawPart(gl: WebGL2RenderingContext, args: any, part: Part) {
    const projection = args?.defaultProjectionData?.mainMatrix ?? args?.modelViewProjectionMatrix ?? args
    const matrix = translate(projection, [part.data.origin[0], part.data.origin[1], 0])
    const light = this.map.style?.light?.getCartesianPosition?.() ?? [0.4, -0.6, 0.7]
    const [from, to] = HD_FADE
    const hd = this.sources.hd?.() === false ? 0 : Math.max(0, Math.min(1, (this.map.getZoom() - from) / (to - from)))
    const eye = eyeOf(projection)
    const relative: [number, number, number] | null = eye && [eye[0] - part.data.origin[0], eye[1] - part.data.origin[1], eye[2]]
    const exaggeration = this.map.getTerrain?.()?.exaggeration ?? 1
    // The sun's map is this frame's only: a frame the buildings skip leaves none.
    const sun = this.sun

    const shade = liveBuildingShade()
    const mesh = bindMesh(gl, this.program, part.buffers, matrix, light, { hd, palette: this.colors, elevationScale: exaggeration, eye: relative, perMetre: (part.buffers.lift ? 1 : exaggeration) / metresPerUnit(part.data.origin[1]), minLinePx: MIN_LINE_PX, pixelRatio: this.map.getPixelRatio?.() ?? 1,
      sun: { frame: sun, origin: part.data.origin, alpha: shade ? shade.shadowAlpha * shade.groundOpacity() : 0, ground: shade?.groundShadow() ?? null, gradeBias: TOUCHDOWN.bias },
    })
    const { paintFrom, railsFrom, routesFrom } = part.data.ranges
    const draw = (writeDepth: boolean) => {
      mesh.draw(0, paintFrom)
      // Paint and routes sit a few centimetres over the asphalt; the offset keeps them in front of it at any distance.
      gl.enable(gl.POLYGON_OFFSET_FILL)
      gl.polygonOffset(-2, -2)
      // Paint is a decal: each mark tested against the deck but not the marks laid before it, so the later one shows where two meet.
      gl.depthMask(false)
      if (hd > 0) mesh.draw(paintFrom, railsFrom)
      gl.depthMask(writeDepth)
      if (this.map.getZoom() >= RAILS_FROM) mesh.draw(railsFrom, routesFrom)
      mesh.draw(routesFrom)
      gl.disable(gl.POLYGON_OFFSET_FILL)
    }
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.disable(gl.CULL_FACE)
    gl.disable(gl.BLEND)
    // Colour first, drawn toward the eye where a deck lies on the ground and so
    // over terrain a little too high; then the true depth, which is what anything drawn later meets.
    mesh.bias(true)
    gl.depthMask(false)
    draw(false)
    mesh.bias(false)
    gl.depthMask(true)
    draw(true)
    mesh.unbind()
  }
}

/** The bounds of every surface a mesh's decks stand on, or null where one has none and so cannot be skipped. */
function standBounds(stands: BakedMesh['stands']): Bounds | null {
  if (!stands.length || stands.some(s => !s.surface.bounds)) return stands.length ? null : { minX: 1, minY: 1, maxX: 0, maxY: 0 }
  const all = stands.map(s => s.surface.bounds!)
  return { minX: Math.min(...all.map(b => b.minX)), minY: Math.min(...all.map(b => b.minY)), maxX: Math.max(...all.map(b => b.maxX)), maxY: Math.max(...all.map(b => b.maxY)) }
}

/** How far a point lies outside bounds, in mercator units: zero inside. */
const distanceOutside = (b: Bounds, [x, y]: Point) => Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minY - y, 0, y - b.maxY))
