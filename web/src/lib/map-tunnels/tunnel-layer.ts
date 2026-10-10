/**
 * Road tunnels drawn in 3D: under the terrain, and opening out of it.
 *
 * A MapLibre custom layer. Each cut is carved into the terrain's elevation
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
import { along, boundsOf, chains, clip, dedupe, densify, edgePoints, holds, linesOf, meets, mercator, metresPerUnit, onEdge, polygonsOf, tileBounds, type Bounds, type Mesh, type Piece, type Point } from '@/lib/map-decks/decks'
import { BANK, carveTile, footprint, type Elevation, type Footprint } from './carve'
import { terrainSampler, type TerrainSampler } from '@/lib/map-decks/ground'
import { bindMesh, deleteMesh, linkMeshProgram, uploadMesh, type MeshBuffers } from '@/lib/map-decks/mesh-program'
import type { DeckPalette } from '@/lib/map-decks/deck-layer'
import { idle, queryFeatures } from '@/lib/map-decks/map-query'
import { TUNNEL_MIN_ZOOM, UNDERGROUND } from './flat-tunnels'
import { BORE, COVER_AT, CUT_MAX, KERB, MARGIN, RIM, approach, emerge, inside, measureEdges, mergeTwins, portalLine, portalMesh, solveCut, truncate, PROFILES, type Approach, type BoreKind, type Cut, type Opening } from './tunnels'

/** Widths by OpenMapTiles class, in metres, for a way with no surface to measure. */
const WIDTH: Record<string, number> = {
  motorway: 11, trunk: 10, primary: 9, secondary: 8, tertiary: 7, minor: 6, service: 4,
  path: 3, pedestrian: 4, rail: 5, transit: 5,
}
const CLASSES: Record<BoreKind, string[]> = {
  road: ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'],
  path: ['path', 'pedestrian'],
  rail: ['rail', 'transit'],
}
const kindOf = (cls: string): BoreKind => (CLASSES.path.includes(cls) ? 'path' : CLASSES.rail.includes(cls) ? 'rail' : 'road')

/** Metres between samples along a cut, and how far down the approach its width is measured. */
const SAMPLE = 3
const MEASURE = 40
const REBASE = 1e-3
const CACHE = 400

export type TunnelSources = {
  /** The basemap source and its road layer. */
  basemap: string
  roads: string
  /** Barrelman's carriageways at their real width, which the cuts are fitted to. */
  surfaces?: { source: string; layer: string }
  /** Where the style draws buildings, whose faces a covered portal opens at. */
  buildings: () => Array<{ source: string; sourceLayer: string }>
}

type Solved = { key: string; points: Point[]; at: number; edges: [number, number]; cut: Cut; kind: BoreKind }

const emptyMesh = (): Mesh => ({ position: [], normal: [], color: [] })

type Built = { walls: Mesh; mouth: Mesh; lid: Mesh; floor: Mesh; bore: Mesh; footprints: Map<string, Footprint> }

const emptyBuilt = (): Built => ({ walls: emptyMesh(), mouth: emptyMesh(), lid: emptyMesh(), floor: emptyMesh(), bore: emptyMesh(), footprints: new Map() })

/** MapLibre's elevation pixels for a loaded tile, read and written in metres. */
function elevation(dem: any): Elevation {
  const bytes = new Uint8Array(dem.data.buffer, dem.data.byteOffset, dem.data.byteLength)
  return {
    dim: dem.dim,
    border: 2,
    get: (x, y) => dem.get(x, y),
    set: (x, y, metres) => {
      const { r, g, b } = dem.pack(metres)
      const i = dem._idx(x, y) * 4
      bytes[i] = r
      bytes[i + 1] = g
      bytes[i + 2] = b
      dem.min = Math.min(dem.min, metres)
    },
  }
}

/** How far past its wall the ground is carved to a cut's floor, and how far out it banks up to meet the ground, in metres. */
const CARVE = [0.5, 4]
/** Milliseconds a frame may spend carving tiles. */
const CARVE_BUDGET = 6
/** How far behind a headwall's face the floor is carved, so the ground rises inside it rather than in front. */
const SILL = 0.5

/** How far back over a bore the ground is filled to its headwall's top, in metres, before it falls away. */
const BACKFILL = [1.5, 6]

/**
 * The ground carved for a cut: down to the floor between its walls, out to
 * just behind the headwall's face, and to each wall's top beside them,
 * banking up past its coping; and filled over the bore behind the headwall.
 */
function carving({ points, at, edges, cut }: Solved): Footprint[] {
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
  private pending: Built | null = null
  private origin: Point = [0, 0]
  private scheduled = 0
  private cancelIdle?: () => void
  private onChange?: (event?: any) => void
  private onTerrain?: () => void
  private sampler: TerrainSampler | null = null
  /** Each portal's solved cut, keyed by its line and width. */
  private cuts = new Map<string, Solved>()
  private built = ''
  /** The floors carved into the terrain, keyed by their cut. */
  private carving = new Map<string, Footprint>()
  /** The round of carving each elevation tile has had; a tile behind the current round is carved again. */
  private carved = new WeakMap<object, number>()
  private round = 0
  /** Where finer terrain has been asked for. */
  private focused: Bounds[] = []
  private stale = true

  /**
   * `focusTerrain` is told where cuts are carved, so finer terrain is served
   * there; the terrain is reloaded when that reaches somewhere new.
   */
  constructor(private sources: TunnelSources, private palette: DeckPalette, private options: { id?: string; focusTerrain?: (areas: Bounds[]) => void } = {}) {
    this.id = options.id ?? 'map-tunnels'
  }

  setPalette(palette: DeckPalette) {
    this.palette = palette
    this.invalidate()
  }

  onAdd(map: any, gl: WebGL2RenderingContext) {
    this.map = map
    this.program = linkMeshProgram(gl)
    const tiled = new Set([this.sources.basemap, this.sources.surfaces?.source])
    this.onChange = event => {
      if (event?.tile && event.sourceId === this.map.getTerrain?.()?.source) {
        // A tile arriving fills its neighbours' borders from its own uncarved ground.
        this.recarveAround(event.tile)
        this.map.triggerRepaint()
      } else if (!event?.sourceId) {
        const c = MercatorCoordinate.fromLngLat(this.map.getCenter())
        if (Math.abs(c.x - this.origin[0]) >= REBASE || Math.abs(c.y - this.origin[1]) >= REBASE) this.invalidate()
        else this.invalidate(false)
      } else if (!event.isSourceLoaded) return
      else if (tiled.has(event.sourceId)) this.invalidate(false)
    }
    this.onTerrain = () => this.invalidate()
    map.on('sourcedata', this.onChange)
    map.on('moveend', this.onChange)
    map.on('terrain', this.onTerrain)
    this.invalidate()
  }

  onRemove(map: any, gl: WebGL2RenderingContext) {
    if (this.onChange) {
      map.off('sourcedata', this.onChange)
      map.off('moveend', this.onChange)
    }
    if (this.onTerrain) map.off('terrain', this.onTerrain)
    clearTimeout(this.scheduled)
    this.cancelIdle?.()
    this.release(gl)
    gl.deleteProgram(this.program)
    this.options.focusTerrain?.([])
    if (this.carving.size) map.terrain?.tileManager?.tileManager?.reload(true)
    this.map = null
  }

  /** Rebuild between frames, once a burst of tile events settles; unforced, only if what it reads has changed. */
  invalidate(force = true) {
    if (force) this.stale = true
    clearTimeout(this.scheduled)
    this.cancelIdle?.()
    this.scheduled = setTimeout(() => {
      this.cancelIdle = idle(() => {
        if (!this.map) return
        const mesh = this.build()
        if (!mesh) return
        this.pending = mesh
        this.map.triggerRepaint?.()
      })
    }, 200) as unknown as number
  }

  private query(source: string, sourceLayer?: string, filter?: any[]): any[] {
    return queryFeatures(this.map, source, sourceLayer, filter)
  }


  /** Basemap ways of the given kinds as lines clipped to their tiles, one copy each. */
  private roads(brunnel: 'tunnel' | null, kinds: BoreKind[]): Piece[] {
    const filter = ['all', ['in', ['get', 'class'], ['literal', kinds.flatMap(k => CLASSES[k])]],
      ...(brunnel ? [['==', ['get', 'brunnel'], brunnel], UNDERGROUND] : [['!', ['has', 'brunnel']]])]
    const pieces: Piece[] = []
    for (const f of this.query(this.sources.basemap, this.sources.roads, filter)) {
      const props = f.properties ?? {}
      const tile = tileBounds(f)
      for (const line of linesOf(f.geometry))
        for (const run of tile ? clip(line.map(mercator), tile) : [line.map(mercator)])
          pieces.push({ points: run, layer: 1, width: WIDTH[props.class] ?? 6, kind: kindOf(props.class), zoom: f._z, tile: tile ?? undefined })
    }
    return dedupe(pieces)
  }

  private build(): Built | null {
    const center = MercatorCoordinate.fromLngLat(this.map.getCenter())
    const zoom = this.map.getZoom()
    const tunnels = zoom >= TUNNEL_MIN_ZOOM ? this.roads('tunnel', ['road', 'path', 'rail']) : []
    const read = `${tunnels.map(t => `${t.zoom}:${t.points[0]}`).sort().join(' ')}|${zoom >= TUNNEL_MIN_ZOOM}`
    const close = Math.abs(center.x - this.origin[0]) < REBASE && Math.abs(center.y - this.origin[1]) < REBASE
    if (!this.stale && close && read === this.built) return null
    this.stale = false
    this.built = read
    if (!close) this.origin = [center.x, center.y]
    const empty = emptyBuilt()
    if (!tunnels.length) return empty

    const tolerance = 1.5 / metresPerUnit(center.y)
    const loaded = tunnels.reduce<Bounds | null>((u, { tile: t }) => !t ? u : u
      ? { minX: Math.min(u.minX, t.minX), minY: Math.min(u.minY, t.minY), maxX: Math.max(u.maxX, t.maxX), maxY: Math.max(u.maxY, t.maxY) }
      : { ...t }, null)
    const bores = chains(tunnels, p => !!loaded && onEdge(p, loaded, tolerance), tolerance)
    const portals = bores.flatMap(bore => [0, 1].filter(e => bore.grounded[e]).map(e => {
      const line = e ? [...bore.points].reverse() : bore.points
      // Where both ends open, each draws its bore halfway, so the two never overlap.
      const reach = bore.grounded[0] && bore.grounded[1] ? Math.min(BORE, along(line).at(-1)! / 2) : BORE
      return { line, reach, width: bore.width, kind: bore.kind, bounds: boundsOf([line[0]], CUT_MAX) }
    }))
    if (!portals.length) return empty
    const area = portals.slice(1).reduce((u, { bounds: b }) =>
      ({ minX: Math.min(u.minX, b.minX), minY: Math.min(u.minY, b.minY), maxX: Math.max(u.maxX, b.maxX), maxY: Math.max(u.maxY, b.maxY) }), portals[0].bounds)
    const kinds = [...new Set(portals.map(p => p.kind))]
    const atGrade = Object.fromEntries(kinds.map(k => [k, this.roads(null, [k]).map(p => p.points).filter(line => meets(boundsOf(line), area))]))
    const rings = this.surfaceRings(area)
    const footprints = this.footprints(area)
    const covered = (q: Point) => footprints.some(f => holds(f.bounds, q) && inside(q, f.rings))

    const openings: Opening[] = []
    for (const { line, reach, width, kind } of portals) {
      const found = approach(line[0], line[1], atGrade[kind], tolerance, PROFILES[kind].reach)
      const moved = found.points.length > 1 ? emerge(found.points, line, covered) : null
      if (!moved || moved.out.length < 2) continue
      const out = { ...found, points: moved.out }
      const measured = kind === 'road' ? measureEdges(densify(truncate(out.points, MEASURE), SAMPLE), rings) : null
      openings.push({ out, bore: truncate(moved.bore, reach), edges: measured ?? [width / 2, width / 2], kind })
    }
    const solved: Solved[] = []
    for (const { out, bore, edges, kind } of mergeTwins(openings)) {
      const cut = this.solve(out, bore, edges, kind)
      if (cut) solved.push(cut)
    }

    const exaggeration = this.map.getTerrain?.()?.exaggeration ?? 1
    const p = this.palette
    const floors: Record<BoreKind, number[]> = { road: p.surface, path: p.concrete, rail: p.concrete.map(c => c * 0.8) }
    const mesh = emptyBuilt()
    for (const s of solved) {
      const scaled = { ...s.cut, floor: s.cut.floor.map(z => z * exaggeration), walls: s.cut.walls.map(w => w.map(z => z * exaggeration)) as [number[], number[]], crown: s.cut.crown * exaggeration, headroom: s.cut.headroom * exaggeration }
      portalMesh(s.points, s.at, s.edges, scaled, this.origin, { surface: floors[s.kind], concrete: p.concrete, parapet: p.parapet, bore: p.concrete }, mesh)
      carving(s).forEach((f, i) => mesh.footprints.set(`${s.key}|${i}`, f))
    }
    return mesh
  }

  /** A portal's cut, from the ground along it; kept once read, null while the ground loads. */
  private solve(out: Approach, bore: Point[], edges: [number, number], kind: BoreKind): Solved | null {
    const sampler = terrainSampler(this.map, this.sampler, () => this.invalidate())
    if (sampler !== this.sampler) this.cuts.clear()
    this.sampler = sampler
    if (!sampler) return null
    const key = `${kind}|${edges.map(e => e.toFixed(1))}|${out.junction}|${[...out.points, ...bore].map(q => `${Math.round(q[0] * 2 ** 26)},${Math.round(q[1] * 2 ** 26)}`).join(';')}`
    const known = this.cuts.get(key)
    if (known) return known
    const { points, at } = portalLine(out.points, bore, SAMPLE)
    const height = (q: Point) => sampler.ground.at(q)
    const centre = points.map(height)
    const sides = RIM.map(r => edgePoints({ points, edges: [edges[0] + KERB + r, edges[1] + KERB + r] } as any))
    const rims = [0, 1].map(k => points.map((_, i) => {
      const heights = sides.map(side => height(side[k][i]))
      if (heights.some(g => g === null)) return null
      const known = (heights as number[]).filter(g => !Number.isNaN(g))
      return known.length ? Math.min(...known) : NaN
    }))
    const d = along(points)
    const cover = COVER_AT.map(m => {
      let i = at
      while (i < points.length - 1 && d[i] - d[at] < m) i++
      return height(points[i])
    })
    if ([...centre, ...rims.flat(), ...cover].some(g => g === null)) return null
    const ground = centre as number[]
    if (ground.some(Number.isNaN)) return null
    const fill = (rim: Array<number | null>) => rim.map((g, i) => (Number.isFinite(g) ? (g as number) : ground[i]))
    const over = cover.filter(g => !Number.isNaN(g)) as number[]
    const cut = solveCut(d, at, ground, [fill(rims[0]), fill(rims[1])], over.length ? Math.max(...over) : ground[at], out.junction, PROFILES[kind])
    if (!cut || cut.open >= at) return null
    const solved = { key, points, at, edges, cut, kind }
    if (this.cuts.size >= CACHE) this.cuts.delete(this.cuts.keys().next().value!)
    this.cuts.set(key, solved)
    return solved
  }

  /** Building footprints around the portals. */
  private footprints(area: Bounds): Array<{ rings: Point[][]; bounds: Bounds }> {
    return this.sources.buildings()
      .flatMap(({ source, sourceLayer }) => this.query(source, sourceLayer))
      .flatMap(f => polygonsOf(f.geometry))
      .map(polygon => polygon.map(ring => ring.map(mercator)))
      .map(rings => ({ rings, bounds: boundsOf(rings[0]) }))
      .filter(({ bounds }) => meets(bounds, area))
  }

  /** Outlines of the carriageways at grade around the portals. */
  private surfaceRings(area: Bounds): Point[][] {
    if (!this.sources.surfaces) return []
    const { source, layer } = this.sources.surfaces
    return this.query(source, layer, ['!=', ['get', 'bridge'], true])
      .flatMap(f => polygonsOf(f.geometry).flat())
      .map(ring => ring.map(mercator))
      .filter(ring => ring.length > 1 && meets(boundsOf(ring), area))
  }

  private release(gl: WebGL2RenderingContext) {
    if (!this.buffers) return
    for (const buffers of Object.values(this.buffers)) deleteMesh(gl, buffers)
    this.buffers = null
  }

  /** Take on a new set of floors: carved over what is there, or, where one has gone, into freshly loaded ground. */
  private carve(next: Map<string, Footprint>) {
    const removed = [...this.carving.keys()].some(key => !next.has(key))
    const areas = [...next.values()].map(f => f.bounds)
    const reached = areas.some(a => !this.focused.some(b => b.minX <= a.minX && b.minY <= a.minY && b.maxX >= a.maxX && b.maxY >= a.maxY))
    this.carving = next
    this.focused = areas
    this.options.focusTerrain?.(areas)
    this.round++
    if (removed || reached) this.map.terrain?.tileManager?.tileManager?.reload(true)
  }

  /** Mark a tile and the loaded tiles beside it to be carved again. */
  private recarveAround(loaded: any) {
    const { z, x, y } = loaded.tileID.canonical
    for (const tile of this.demTiles()) {
      const c = tile.tileID.canonical
      if (tile.dem && c.z === z && Math.abs(c.x - x) <= 1 && Math.abs(c.y - y) <= 1) this.carved.delete(tile.dem)
    }
  }

  private demTiles(): any[] {
    return this.map?.terrain?.tileManager?.tileManager?._inViewTiles?.getAllTiles?.() ?? []
  }

  /** Carve the floors into each loaded elevation tile not yet carved this round. */
  private carveTiles() {
    if (!this.carving.size) return
    const tiles = this.demTiles()
    const floors = [...this.carving.values()]
    const start = performance.now()
    let changed = false
    for (const tile of tiles) {
      if (!tile.dem || this.carved.get(tile.dem) === this.round) continue
      // A few tiles a frame, so a burst of them arriving does not stall one.
      if (performance.now() - start > CARVE_BUDGET) {
        this.map.triggerRepaint()
        break
      }
      this.carved.set(tile.dem, this.round)
      const { z, x, y } = tile.tileID.canonical
      if (!carveTile(elevation(tile.dem), [z, x, y], floors)) continue
      tile.needsTerrainPrepare = true
      tile.needsHillshadePrepare = true
      changed = true
    }
    if (changed) this.map.triggerRepaint()
  }

  render(gl: WebGL2RenderingContext, args: any) {
    if (this.pending) {
      this.release(gl)
      const { walls, mouth, lid, floor, bore, footprints } = this.pending
      this.buffers = { walls: uploadMesh(gl, walls), mouth: uploadMesh(gl, mouth), lid: uploadMesh(gl, lid), floor: uploadMesh(gl, floor), bore: uploadMesh(gl, bore) }
      this.carve(footprints)
      this.pending = null
    }
    this.carveTiles()
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
    const draw = (name: keyof NonNullable<typeof this.buffers>) => {
      const mesh = bindMesh(gl, this.program, this.buffers![name], matrix, light)
      mesh.draw()
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
    gl.clear(gl.STENCIL_BUFFER_BIT)
    gl.disable(gl.STENCIL_TEST)
  }
}
