/**
 * Road tunnels drawn in 3D: under the terrain, and opening out of it.
 *
 * A MapLibre custom layer over the cuts barrelman serves in the detail tiles,
 * each drawn as its tile arrives. Each cut is carved into the terrain's elevation
 * tiles, so the map drapes its own ground, paths and paint down the ramp; the
 * layer stands the retaining walls and headwall in it. The bore runs under
 * the terrain, so it is drawn through its mouth alone: the mouth is marked in
 * the stencil where nothing stands in front of it, the depth there is reset to
 * the far plane, and the bore is drawn inside the mark.
 *
 * Only drawn with the terrain on, from street zoom; the flat tunnels below it.
 */
import { MercatorCoordinate } from 'maplibre-gl'
import { translate } from '@/lib/map-objects/object-layer'
import { along, boundsOf, holds, meets, type Bounds, type Mesh, type Point } from '@/lib/map-decks/decks'
import { BANK, footprint, type Footprint } from '@/lib/map-terrain/carve'
import { TerrainCarver } from '@/lib/map-terrain/carver'
import { terrainSampler, type TerrainSampler } from '@/lib/map-decks/ground'
import { bindMesh, deleteMesh, linkMeshProgram, uploadMesh, type MeshBuffers } from '@/lib/map-decks/mesh-program'
import { groundBeneath, MeshShadow } from '@/lib/map-decks/mesh-shadow'
import { liveBuildingShade } from '@/lib/map/building-shade'
import type { SunFrame } from '@/lib/map/sun-shadow'
import type { DeckPalette } from '@/lib/map-decks/deck.types'
import { TUNNEL_MIN_ZOOM } from './flat-tunnels'
import { FINE_TERRAIN_MAXZOOM, TERRAIN_TILES } from '@/lib/map-style/terrain'
import type { FineTerrain } from '@/lib/map-style/fine-terrain'
import { readCutTile } from './cut-tile'
import { KERB, MARGIN, portalMesh, truncate, type BoreKind, type ServedCut } from './tunnels'

const REBASE = 1e-3
/** Milliseconds a rebuild waits after a tile event, so a burst of them is read at once. */
const SETTLE_MS = 16
const CACHE = 400

/** Barrelman's `tunnel_cuts` tile url, `{z}/{x}/{y}` filled in; read at `CUT_ZOOM`, a few kilobytes for 2 km of street. */
export type TunnelSources = { tiles: string }

const CUT_ZOOM = 14
/** How far past the view the cuts are read, in tiles at `CUT_ZOOM`, so a cut reaching into it from beside is known. */
const CUT_PAD = 0.15
/** Cut tiles kept once read. */
const CUT_TILES = 64
/** Metres past its line a cut's walls and carving reach. */
const CUT_REACH = 30

const emptyMesh = (): Mesh => ({ position: [], normal: [], color: [] })

/** Each cut's vertices in the floor mesh, and its ends, to show it wherever the terrain there is too coarse to carve. */
type FloorRange = { from: number; to: number; ends: Point[] }

type Built = { walls: Mesh; mouth: Mesh; lid: Mesh; floor: Mesh; bore: Mesh; floors: FloorRange[]; footprints: Map<string, Footprint> }

const emptyBuilt = (): Built => ({ walls: emptyMesh(), mouth: emptyMesh(), lid: emptyMesh(), floor: emptyMesh(), bore: emptyMesh(), floors: [], footprints: new Map() })

/** The coarsest elevation tile a cut carves into cleanly; coarser, the floor blurs into a ramp across the mouth. */
const CARVED_ZOOM = FINE_TERRAIN_MAXZOOM - 1

/** How far past its wall the ground is carved to a cut's floor, and how far out it banks up to meet the ground, in metres. */
const CARVE = [0.5, 4]
/** How far behind a headwall's face the floor is carved, so the ground rises inside it rather than in front. */
const SILL = 0.5

/** How far back over a bore the ground is filled to its headwall's top, in metres, before it falls away. */
const BACKFILL = [1.5, 6]

/**
 * The ground carved for a cut: down to the floor between its walls, out to
 * just behind the headwall's face, and to each wall's top beside them,
 * banking up past its coping; and filled over the bore behind the headwall.
 */
function carving({ points, at, edges, cut }: ServedCut): Footprint[] {
  const sill = truncate(points.slice(at), SILL).at(-1)!
  const wall = edges.map(e => e + KERB)
  const out = (m: number) => wall.map(w => w + m) as [number, number]
  const lane = cut.floor.slice(cut.open, at + 1)
  const tops = cut.walls.map(w => [...w.slice(cut.open, at + 1), w[at]]) as [number[], number[]]
  const over = [sill, ...truncate(points.slice(at), BACKFILL[1]).slice(1)]
  const crown = along(over).map(m => cut.crown - Math.max(0, m + SILL - BACKFILL[0]) * BANK)
  return [
    footprint([...points.slice(cut.open, at + 1), sill], [...lane, lane.at(-1)!], tops, out(CARVE[0]), out(MARGIN), out(CARVE[1])),
    // The ground over the bore, filled up to meet the headwall's top from behind.
    footprint(over, crown, [crown, crown], out(MARGIN), out(MARGIN), out(MARGIN + BACKFILL[1]), true),
  ]
}

export class TunnelLayer {
  id: string
  type = 'custom' as const
  renderingMode = '3d' as const

  private map: any
  private program!: WebGLProgram
  private buffers: Record<'walls' | 'mouth' | 'lid' | 'floor' | 'bore', MeshBuffers> | null = null
  private floors: FloorRange[] = []
  /** The floors over terrain too coarse to carve them, worked out again when the tiles or the carving change. */
  private exposed: FloorRange[] = []
  private exposedFor = ''
  private pending: (Built & { ground: Float32Array; exaggeration: number; complete: boolean }) | null = null
  private origin: Point = [0, 0]
  private scheduled = 0
  /** Whether the cuts carved are those of every cut tile in view. */
  private settled = false
  /** Cut tiles read, by `z/x/y`, most recent last; and those being read. */
  private cutTiles = new Map<string, ServedCut[]>()
  private reading = new Map<string, AbortController>()
  private onChange?: (event?: any) => void
  private onTerrain?: () => void
  /** The ground the walls rise out of, for their shadows. */
  private sampler: TerrainSampler | null = null
  private built = ''
  /** The floors carved into the terrain, keyed by their cut. */
  private carver: TerrainCarver
  private stale = true
  /** The walls standing out of the ground cast as the buildings do; see `building-shade.ts`. */
  private shadow = new MeshShadow()
  private sun: SunFrame | null = null
  get shadowVersion() {
    return this.shadow.version
  }
  drawShadow(gl: WebGL2RenderingContext, frame: { matrix: ArrayLike<number>; shear: [number, number] }) {
    this.shadow.drawShadow(gl, frame)
  }
  drawSunDepth(gl: WebGL2RenderingContext, frame: SunFrame) {
    this.shadow.drawSunDepth(gl, frame)
  }
  receiveSun(frame: SunFrame) {
    this.sun = frame
  }

  /**
   * `terrain` serves finer elevation where cuts are carved, holding it back
   * until the cuts in view are known, so it arrives finer the first time.
   */
  constructor(private sources: TunnelSources, private palette: DeckPalette, private options: { id?: string; terrain?: FineTerrain } = {}) {
    this.id = options.id ?? 'map-tunnels'
    this.carver = new TerrainCarver(() => this.map, options.terrain && (areas => options.terrain!.focus(areas)))
  }

  setPalette(palette: DeckPalette) {
    this.palette = palette
    this.invalidate()
  }

  onAdd(map: any, gl: WebGL2RenderingContext) {
    this.map = map
    this.program = linkMeshProgram(gl)
    this.onChange = event => {
      if (event?.tile && event.sourceId === this.map.getTerrain?.()?.source) {
        // A tile arriving fills its neighbours' borders from its own uncarved ground.
        this.carver.recarveAround(event.tile)
        this.map.triggerRepaint()
      } else if (!event?.sourceId) {
        this.settled = false
        this.readCuts()
        const c = MercatorCoordinate.fromLngLat(this.map.getCenter())
        if (Math.abs(c.x - this.origin[0]) >= REBASE || Math.abs(c.y - this.origin[1]) >= REBASE) this.invalidate()
        else this.invalidate(false)
      }
    }
    this.onTerrain = () => this.invalidate()
    map.on('sourcedata', this.onChange)
    map.on('moveend', this.onChange)
    map.on('terrain', this.onTerrain)
    this.options.terrain?.hold(() => (this.settled ? [] : null))
    this.readCuts()
    this.invalidate()
  }

  /** The view in mercator units. */
  private view(): Bounds {
    const b = this.map.getBounds()
    const [nw, se] = [MercatorCoordinate.fromLngLat(b.getNorthWest()), MercatorCoordinate.fromLngLat(b.getSouthEast())]
    return { minX: nw.x, minY: nw.y, maxX: se.x, maxY: se.y }
  }

  /** The cut tiles the view reaches into, by `z/x/y`; none below street zoom. */
  private cutTilesInView(): string[] {
    if (!this.sources.tiles || this.map.getZoom() < TUNNEL_MIN_ZOOM) return []
    const n = 2 ** CUT_ZOOM
    const v = this.view()
    const span = (lo: number, hi: number) => [Math.floor(lo * n - CUT_PAD), Math.floor(hi * n + CUT_PAD)]
    const [[x0, x1], [y0, y1]] = [span(v.minX, v.maxX), span(v.minY, v.maxY)]
    const keys: string[] = []
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) keys.push(`${CUT_ZOOM}/${x}/${y}`)
    return keys
  }

  /** Fetch the view's cut tiles not yet read, off the map's tile worker so they land ahead of the heavy tiles; each is drawn as it lands. */
  private readCuts() {
    const wanted = this.cutTilesInView()
    for (const [key, request] of this.reading) if (!wanted.includes(key)) { request.abort(); this.reading.delete(key) }
    for (const key of wanted) {
      if (this.cutTiles.has(key) || this.reading.has(key)) continue
      const request = new AbortController()
      this.reading.set(key, request)
      const [z, x, y] = key.split('/')
      fetch(this.sources.tiles.replace('{z}', z).replace('{x}', x).replace('{y}', y), { signal: request.signal })
        .then(res => (res.ok ? res.arrayBuffer() : res.status === 404 || res.status === 204 ? null : Promise.reject(new Error(`Tunnel cuts ${res.status}`))))
        .then(raw => {
          this.cutTiles.set(key, raw ? readCutTile(raw) : [])
          for (const old of this.cutTiles.keys()) if (this.cutTiles.size > CUT_TILES) this.cutTiles.delete(old)
          if (this.reading.get(key) === request) this.reading.delete(key)
          if (this.map) this.rebuildNow()
        })
        .catch(() => {
          if (this.reading.get(key) === request) this.reading.delete(key)
        })
    }
  }

  private samplerFor(): TerrainSampler | null {
    const terrain = this.options.terrain
    return terrainSampler(this.map, this.sampler, () => this.invalidate(), template => terrain && template === TERRAIN_TILES ? (z, x, y) => terrain.heights(z, x, y) : undefined)
  }

  onRemove(map: any, gl: WebGL2RenderingContext) {
    if (this.onChange) {
      map.off('sourcedata', this.onChange)
      map.off('moveend', this.onChange)
    }
    if (this.onTerrain) map.off('terrain', this.onTerrain)
    this.options.terrain?.hold(null)
    for (const request of this.reading.values()) request.abort()
    this.reading.clear()
    clearTimeout(this.scheduled)
    this.scheduled = 0
    this.release(gl)
    this.shadow.delete(gl)
    gl.deleteProgram(this.program)
    this.carver.clear()
    this.map = null
  }

  /** Rebuild between frames, a burst of tile events at once; unforced, only if what it reads has changed. */
  invalidate(force = true) {
    if (force) this.stale = true
    if (this.scheduled) return
    this.scheduled = setTimeout(() => this.rebuild(), SETTLE_MS) as unknown as number
  }

  private rebuildNow() {
    clearTimeout(this.scheduled)
    this.rebuild()
  }

  private rebuild() {
    this.scheduled = 0
    if (!this.map) return
    const complete = this.cutTilesInView().every(key => this.cutTiles.has(key))
    const mesh = this.build()
    if (!mesh) {
      if (complete) this.settle()
      return
    }
    // On the ground as it was before the cut, which is what the walls rise out of.
    const exaggeration = this.map.getTerrain?.()?.exaggeration ?? 1
    this.sampler = this.samplerFor()
    const ground = groundBeneath(mesh.walls.position, mesh.walls.position.length / 3, this.origin, q => this.sampler?.ground.at(q) ?? null, exaggeration)
    this.pending = { ...mesh, ground, exaggeration, complete }
    this.map.triggerRepaint?.()
  }

  /** The cuts carved are final for the roads in view: finer terrain held back for them can now be served or turned away. */
  private settle() {
    this.settled = true
    this.options.terrain?.release()
  }

  /** The cuts in the cut tiles read for the view, one copy each. */
  private served(): ServedCut[] {
    // Past the view by a quarter of it, so a pan does not drop and re-carve the cuts at its edges.
    const v = this.view()
    const [dx, dy] = [(v.maxX - v.minX) / 4, (v.maxY - v.minY) / 4]
    const view = { minX: v.minX - dx, minY: v.minY - dy, maxX: v.maxX + dx, maxY: v.maxY + dy }
    const found = new Map<string, ServedCut>()
    for (const key of this.cutTilesInView())
      for (const cut of this.cutTiles.get(key) ?? []) if (meets(boundsOf(cut.points, CUT_REACH), view)) found.set(cut.key, cut)
    return [...found.values()]
  }

  private build(): Built | null {
    const center = MercatorCoordinate.fromLngLat(this.map.getCenter())
    const cuts = this.map.getZoom() >= TUNNEL_MIN_ZOOM ? this.served() : []
    const read = cuts.map(c => c.key).sort().join(' ')
    const close = Math.abs(center.x - this.origin[0]) < REBASE && Math.abs(center.y - this.origin[1]) < REBASE
    if (!this.stale && close && read === this.built) return null
    this.stale = false
    this.built = read
    if (!close) this.origin = [center.x, center.y]
    const mesh = emptyBuilt()
    if (!cuts.length) return mesh

    const exaggeration = this.map.getTerrain?.()?.exaggeration ?? 1
    const p = this.palette
    const floors: Record<BoreKind, number[]> = { road: p.surface, path: p.concrete, rail: p.concrete.map(c => c * 0.8) }
    for (const s of cuts) {
      const scaled = { ...s.cut, floor: s.cut.floor.map(z => z * exaggeration), walls: s.cut.walls.map(w => w.map(z => z * exaggeration)) as [number[], number[]], crown: s.cut.crown * exaggeration, headroom: s.cut.headroom * exaggeration, base: s.cut.base * exaggeration }
      const from = mesh.floor.position.length / 3
      portalMesh(s.points, s.at, s.edges, scaled, this.origin, { surface: floors[s.kind], concrete: p.concrete, parapet: p.parapet, bore: p.concrete }, mesh, s.face, s.piers)
      mesh.floors.push({ from, to: mesh.floor.position.length / 3, ends: [s.points[s.cut.open], s.points[s.at]] })
      carving(s).forEach((f, i) => mesh.footprints.set(`${s.key}|${i}`, f))
    }
    return mesh
  }

  private release(gl: WebGL2RenderingContext) {
    this.floors = []
    this.exposed = []
    this.exposedFor = ''
    if (!this.buffers) return
    for (const buffers of Object.values(this.buffers)) deleteMesh(gl, buffers)
    this.buffers = null
  }

  /** The floors with an end on no elevation tile both fine enough and carved this round. */
  private exposedFloors(): FloorRange[] {
    const tiles = this.carver.tiles().filter(t => t.dem && t.tileID.canonical.z >= CARVED_ZOOM && this.carver.current(t.dem))
    const key = `${this.carver.round}|${tiles.map(t => t.tileID.key).join()}`
    if (key === this.exposedFor) return this.exposed
    const bounds = tiles.map(t => {
      const { z, x, y } = t.tileID.canonical
      const n = 2 ** z
      return { minX: x / n, minY: y / n, maxX: (x + 1) / n, maxY: (y + 1) / n }
    })
    this.exposedFor = key
    this.exposed = this.floors.filter(f => !f.ends.every(p => bounds.some(b => holds(b, p))))
    return this.exposed
  }

  render(gl: WebGL2RenderingContext, args: any) {
    if (this.pending) {
      this.release(gl)
      const { walls, mouth, lid, floor, floors, bore, footprints } = this.pending
      this.buffers = { walls: uploadMesh(gl, walls), mouth: uploadMesh(gl, mouth), lid: uploadMesh(gl, lid), floor: uploadMesh(gl, floor), bore: uploadMesh(gl, bore) }
      this.floors = floors
      this.carver.set(footprints)
      if (this.pending.complete) this.settle()
      this.shadow.set(gl, this.buffers.walls.position, this.buffers.walls.count, this.pending.ground, this.origin, this.pending.exaggeration)
      this.pending = null
      // The shade layer drew this frame's shadows before the walls changed.
      this.map.triggerRepaint()
    }
    this.carver.carveTiles()
    if (!this.buffers?.walls.count) return

    const projection = args?.defaultProjectionData?.mainMatrix ?? args?.modelViewProjectionMatrix ?? args
    const matrix = translate(projection, [this.origin[0], this.origin[1], 0])
    const light = this.map.style?.light?.getCartesianPosition?.() ?? [0.4, -0.6, 0.7]
    // MapLibre's own range for 3D layers; asking the context for it would stall on the GPU.
    const [near, far] = this.map.painter?.renderContext?.depthRangeFor3D ?? [0, 1]
    gl.enable(gl.DEPTH_TEST)
    gl.depthMask(true)
    gl.depthFunc(gl.LEQUAL)
    gl.disable(gl.CULL_FACE)
    gl.disable(gl.BLEND)
    const sun = this.sun
    this.sun = null
    const shade = liveBuildingShade()
    const shading = { frame: sun, origin: this.origin, alpha: shade ? shade.shadowAlpha * shade.groundOpacity() : 0, ground: null, gradeBias: 0 }
    const draw = (name: keyof NonNullable<typeof this.buffers>, ranges?: FloorRange[]) => {
      const mesh = bindMesh(gl, this.program, this.buffers![name], matrix, light, { sun: shading })
      if (ranges) for (const { from, to } of ranges) mesh.draw(from, to)
      else mesh.draw()
      mesh.unbind()
    }
    draw('walls')

    gl.enable(gl.STENCIL_TEST)
    gl.stencilMask(0xff)
    gl.clearStencil(0)
    gl.clear(gl.STENCIL_BUFFER_BIT)
    // Mark each cut's lid and each mouth wherever nothing drawn so far stands in front of them…
    gl.colorMask(false, false, false, false)
    gl.depthMask(false)
    gl.stencilFunc(gl.ALWAYS, 1, 0xff)
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE)
    draw('lid')
    draw('mouth')
    // …clear the depth there, and set the cut's floor back into it…
    gl.depthMask(true)
    gl.depthFunc(gl.ALWAYS)
    gl.depthRange(far, far)
    gl.stencilFunc(gl.EQUAL, 1, 0xff)
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP)
    draw('lid')
    draw('mouth')
    gl.depthRange(near, far)
    gl.depthFunc(gl.LEQUAL)
    draw('floor')
    // …then stand the walls on it, and draw the bore under the ground.
    gl.colorMask(true, true, true, true)
    draw('walls')
    draw('bore')
    // Where the terrain could not take the carving, the floor shows instead of the ground blurred over it.
    const exposed = this.exposedFloors()
    if (exposed.length) draw('floor', exposed)
    gl.clear(gl.STENCIL_BUFFER_BIT)
    gl.disable(gl.STENCIL_TEST)
  }
}
