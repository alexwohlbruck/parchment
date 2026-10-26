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
import { along, holds, type Mesh, type Point } from '@/lib/map-decks/decks'
import { BANK, footprint, type Footprint } from '@/lib/map-terrain/carve'
import { TerrainCarver } from '@/lib/map-terrain/carver'
import { terrainSampler, type TerrainSampler } from '@/lib/map-decks/ground'
import { bindMesh, deleteMesh, linkMeshProgram, uploadMesh, type MeshBuffers } from '@/lib/map-decks/mesh-program'
import { groundBeneath, MeshShadow } from '@/lib/map-decks/mesh-shadow'
import { liveBuildingShade } from '@/lib/map/building-shade'
import type { SunFrame } from '@/lib/map/sun-shadow'
import type { DeckPalette } from '@/lib/map-decks/deck.types'
import { hasLayer, queryFeatures } from '@/lib/map-decks/map-query'
import { TUNNEL_MIN_ZOOM } from './flat-tunnels'
import { FINE_TERRAIN_MAXZOOM, TERRAIN_TILES } from '@/lib/map-style/terrain'
import type { FineTerrain } from '@/lib/map-style/fine-terrain'
import { KERB, MARGIN, parseCut, portalMesh, truncate, type BoreKind, type ServedCut } from './tunnels'

const REBASE = 1e-3
/** Milliseconds a rebuild waits after a tile event, so a burst of them is read at once. */
const SETTLE_MS = 16
const CACHE = 400

/** The detail source and its layer of cuts, solved by barrelman and served whole in every tile they reach. */
export type TunnelSources = { source: string; layer: string }

/** Whether a source's tiles in view have all loaded; a source not in the style has nothing to wait for. */
function loaded(map: any, id: string): boolean {
  try {
    return map.isSourceLoaded(id)
  } catch {
    return true
  }
}

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
  /** Whether the cuts carved are those of the roads in view, built once they had all loaded. */
  private settled = false
  /** The sources read for the cuts that have finished loading since the camera last came to rest. */
  private loadedSince = new Set<string>()
  private onChange?: (event?: any) => void
  private onTerrain?: () => void
  /** The ground the walls rise out of, for their shadows. */
  private sampler: TerrainSampler | null = null
  /** Each served cut, parsed once, by id. */
  private cuts = new Map<string, ServedCut>()
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
        this.loadedSince.clear()
        const c = MercatorCoordinate.fromLngLat(this.map.getCenter())
        if (Math.abs(c.x - this.origin[0]) >= REBASE || Math.abs(c.y - this.origin[1]) >= REBASE) this.invalidate()
        else this.invalidate(false)
      } else if (event.sourceId === this.sources.source) {
        if (event.tile) this.settled = false
        if (event.isSourceLoaded) this.loadedSince.add(event.sourceId)
        // A tile bringing cuts is read at once, so they carve in the frame that first draws it.
        if (event.tile?.state === 'loaded' && hasLayer(event.tile.latestRawTileData, this.sources.layer)) this.rebuildNow()
        else if (event.tile || event.isSourceLoaded) this.invalidate(false)
      }
    }
    this.onTerrain = () => this.invalidate()
    map.on('sourcedata', this.onChange)
    map.on('moveend', this.onChange)
    map.on('terrain', this.onTerrain)
    this.options.terrain?.hold(() => (this.settled ? [] : null))
    this.invalidate()
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
    const complete = this.loadedSince.has(this.sources.source) || loaded(this.map, this.sources.source)
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

  /** The cuts served in the loaded tiles, one copy each. */
  private served(): ServedCut[] {
    const found = new Map<string, ServedCut>()
    for (const f of queryFeatures(this.map, this.sources.source, this.sources.layer)) {
      const id = f.properties?.id
      if (id === undefined || found.has(id)) continue
      let cut = this.cuts.get(id)
      if (!cut) {
        const parsed = parseCut(f.properties)
        if (!parsed) continue
        if (this.cuts.size >= CACHE) this.cuts.delete(this.cuts.keys().next().value!)
        this.cuts.set(id, (cut = parsed))
      }
      found.set(id, cut)
    }
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
