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
import { BANK, footprint, type Footprint } from '@/lib/map-terrain/carve'
import { TerrainCarver } from '@/lib/map-terrain/carver'
import { terrainSampler, type TerrainSampler } from '@/lib/map-decks/ground'
import { bindMesh, deleteMesh, linkMeshProgram, uploadMesh, type MeshBuffers } from '@/lib/map-decks/mesh-program'
import { groundBeneath, MeshShadow } from '@/lib/map-decks/mesh-shadow'
import { liveBuildingShade } from '@/lib/map/building-shade'
import type { SunFrame } from '@/lib/map/sun-shadow'
import type { DeckPalette } from '@/lib/map-decks/deck.types'
import { idle, queryFeatures } from '@/lib/map-decks/map-query'
import { TUNNEL_MIN_ZOOM, UNDERGROUND } from './flat-tunnels'
import { FINE_TERRAIN_MAXZOOM, TERRAIN_TILES } from '@/lib/map-style/terrain'
import type { FineTerrain } from '@/lib/map-style/fine-terrain'
import { BORE, COVER_AT, CUT_MAX, KERB, MARGIN, RIM, approach, emerge, faceWall, groupPortals, inside, splitAtFace, measureEdges, portalLine, portalMesh, solveCut, truncate, PROFILES, type Approach, type BoreKind, type Cut, type Opening } from './tunnels'

/** Widths by OpenMapTiles class, in metres, for a way with no surface to measure. */
const WIDTH: Record<string, number> = {
  motorway: 11, trunk: 10, primary: 9, secondary: 8, tertiary: 7, minor: 6, service: 4,
  path: 2, pedestrian: 4, rail: 5, transit: 5,
}
const CLASSES: Record<BoreKind, string[]> = {
  road: ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'],
  path: ['path', 'pedestrian'],
  rail: ['rail', 'transit'],
}
const kindOf = (cls: string): BoreKind => (CLASSES.path.includes(cls) ? 'path' : CLASSES.rail.includes(cls) ? 'rail' : 'road')

/** Object line kinds that may stand across a bore as its headwall. */
const HEADWALLS = ['wall', 'retaining_wall', 'city_wall']

/** Metres between samples along a cut, and how far down the approach its width is measured. */
const SAMPLE = 3
const MEASURE = 40
const REBASE = 1e-3
/** Milliseconds a rebuild waits after what it reads changes; for the roads and surfaces in view to finish loading; and then, if they have not, for the main thread to be idle. */
const SETTLE_MS = 50
const LOAD_WAIT_MS = 2000
const IDLE_WAIT_MS = 250
const CACHE = 400

export type TunnelSources = {
  /** The basemap source and its road layer. */
  basemap: string
  roads: string
  /** Barrelman's carriageways at their real width, which the cuts are fitted to. */
  surfaces?: { source: string; layer: string }
  /** Walls stood up from barrelman's object lines; one mapped across a bore is its headwall. */
  walls?: { source: string; layer: string }
  /** Where the style draws buildings, whose faces a covered portal opens at. */
  buildings: () => Array<{ source: string; sourceLayer: string }>
}

type Solved = { key: string; points: Point[]; at: number; edges: [number, number]; cut: Cut; kind: BoreKind; face?: Point; piers?: Array<[number, number]> }

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

/** MapLibre's elevation pixels for a loaded tile, read and written in metres. */
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
  private floors: FloorRange[] = []
  /** The floors over terrain too coarse to carve them, worked out again when the tiles or the carving change. */
  private exposed: FloorRange[] = []
  private exposedFor = ''
  private pending: (Built & { ground: Float32Array; exaggeration: number; complete: boolean }) | null = null
  /** Whether a cut in the last build waited on ground still loading. */
  private groundLoading = false
  private origin: Point = [0, 0]
  private scheduled = 0
  private waitingSince = 0
  /** Whether the cuts carved are those of the roads in view, built once they had all loaded. */
  private settled = false
  private cancelIdle?: () => void
  private onChange?: (event?: any) => void
  private onTerrain?: () => void
  private sampler: TerrainSampler | null = null
  /** Each portal's solved cut, keyed by its line and width. */
  private cuts = new Map<string, Solved>()
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
    const tiled = this.tiled()
    this.onChange = event => {
      if (event?.tile && event.sourceId === this.map.getTerrain?.()?.source) {
        // A tile arriving fills its neighbours' borders from its own uncarved ground.
        this.carver.recarveAround(event.tile)
        this.readAhead(event.tile)
        this.map.triggerRepaint()
      } else if (!event?.sourceId) {
        this.settled = false
        const c = MercatorCoordinate.fromLngLat(this.map.getCenter())
        if (Math.abs(c.x - this.origin[0]) >= REBASE || Math.abs(c.y - this.origin[1]) >= REBASE) this.invalidate()
        else this.invalidate(false)
      } else {
        if (!tiled.includes(event.sourceId)) return
        if (event.tile) this.settled = false
        if (event.isSourceLoaded) this.invalidate(false)
      }
    }
    this.onTerrain = () => this.invalidate()
    map.on('sourcedata', this.onChange)
    map.on('moveend', this.onChange)
    map.on('terrain', this.onTerrain)
    this.options.terrain?.hold(() => (this.settled ? [] : null))
    this.invalidate()
  }

  /** Read the ground under an elevation tile as it arrives, so the cuts over it can be solved as soon as the roads are in. */
  private readAhead(tile: any) {
    const { z, x, y } = tile.tileID.canonical
    if (z < TUNNEL_MIN_ZOOM || this.map.getZoom() < TUNNEL_MIN_ZOOM) return
    this.sampler = this.samplerFor()
    this.sampler?.ground.at([(x + 0.5) / 2 ** z, (y + 0.5) / 2 ** z])
  }

  private samplerFor(): TerrainSampler | null {
    const terrain = this.options.terrain
    const sampler = terrainSampler(this.map, this.sampler, () => this.invalidate(), template => terrain && template === TERRAIN_TILES ? (z, x, y) => terrain.heights(z, x, y) : undefined)
    if (sampler !== this.sampler) this.cuts.clear()
    return sampler
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
    this.cancelIdle?.()
    this.release(gl)
    this.shadow.delete(gl)
    gl.deleteProgram(this.program)
    this.carver.clear()
    this.map = null
  }

  private tiled(): string[] {
    return [this.sources.basemap, this.sources.surfaces?.source].filter((id): id is string => !!id)
  }

  /**
   * Rebuild between frames, a burst of tile events at once, as soon as the roads
   * and surfaces in view have loaded, or once the main thread is idle if they are slow to; unforced, only if what it reads has changed.
   */
  invalidate(force = true) {
    if (force) this.stale = true
    if (this.scheduled) return
    this.waitingSince ||= performance.now()
    this.scheduled = setTimeout(() => {
      if (!this.map) return
      const complete = this.tiled().every(id => loaded(this.map, id))
      if (!complete && performance.now() - this.waitingSince < LOAD_WAIT_MS) {
        this.scheduled = 0
        this.invalidate(false)
        return
      }
      this.waitingSince = 0
      if (complete) return this.rebuild(true)
      this.cancelIdle = idle(() => this.rebuild(false), IDLE_WAIT_MS)
    }, SETTLE_MS) as unknown as number
  }

  private rebuild(complete: boolean) {
    this.scheduled = 0
    if (!this.map) return
    this.groundLoading = false
    const mesh = this.build()
    if (!mesh) {
      if (complete && !this.groundLoading) this.settle()
      return
    }
    // On the ground as it was before the cut, which is what the walls rise out of.
    const exaggeration = this.map.getTerrain?.()?.exaggeration ?? 1
    const ground = groundBeneath(mesh.walls.position, mesh.walls.position.length / 3, this.origin, q => this.sampler?.ground.at(q) ?? null, exaggeration)
    this.pending = { ...mesh, ground, exaggeration, complete: complete && !this.groundLoading }
    this.map.triggerRepaint?.()
  }

  /** The cuts carved are final for the roads in view: finer terrain held back for them can now be served or turned away. */
  private settle() {
    this.settled = true
    this.options.terrain?.release()
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
          pieces.push({ points: run, layer: Number(props.layer ?? 0) || 0, width: WIDTH[props.class] ?? 6, kind: kindOf(props.class), zoom: f._z, tile: tile ?? undefined })
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
    // One tunnel's ways may step between layers; each portal reads its own way's layer.
    const layerAt = (q: Point, kind: BoreKind) => {
      let best = { layer: -1, apart: tolerance }
      for (const t of tunnels)
        for (const e of [t.points[0], t.points.at(-1)!]) {
          const apart = Math.hypot(e[0] - q[0], e[1] - q[1])
          if (t.kind === kind && apart < best.apart) best = { layer: t.layer, apart }
        }
      return best.layer
    }
    const bores = chains(tunnels.map(t => ({ ...t, layer: -1 })), p => !!loaded && onEdge(p, loaded, tolerance), tolerance)
    const portals = bores.flatMap(bore => [0, 1].filter(e => bore.grounded[e]).map(e => {
      const line = e ? [...bore.points].reverse() : bore.points
      // Where both ends open, each draws its bore halfway, so the two never overlap.
      const reach = bore.grounded[0] && bore.grounded[1] ? Math.min(BORE, along(line).at(-1)! / 2) : BORE
      return { line, reach, width: bore.width, kind: bore.kind, layer: layerAt(line[0], bore.kind), bounds: boundsOf([line[0]], CUT_MAX) }
    }))
    if (!portals.length) return empty
    const area = portals.slice(1).reduce((u, { bounds: b }) =>
      ({ minX: Math.min(u.minX, b.minX), minY: Math.min(u.minY, b.minY), maxX: Math.max(u.maxX, b.maxX), maxY: Math.max(u.maxY, b.maxY) }), portals[0].bounds)
    const kinds = [...new Set(portals.map(p => p.kind))]
    const atGrade = Object.fromEntries(kinds.map(k => [k, this.roads(null, [k]).map(p => p.points).filter(line => meets(boundsOf(line), area))]))
    const rings = this.surfaceRings(area)
    const footprints = this.footprints(area)
    const covered = (q: Point) => footprints.some(f => holds(f.bounds, q) && inside(q, f.rings))
    const walls = this.walls(area)

    const openings: Opening[] = []
    for (const { line, reach, width, kind, layer } of portals) {
      const found = approach(line[0], line[1], atGrade[kind], tolerance, PROFILES[kind].reach)
      // A headwall mapped across the bore is where it opens, and which way it faces.
      const face = faceWall(line, walls)
      const split = face ? splitAtFace(line, face) : { out: [line[0]], bore: line }
      const outward = [...split.out, ...found.points.slice(1)]
      const moved = outward.length > 1 ? emerge(outward, split.bore, covered) : null
      if (!moved || moved.out.length < 2) continue
      const out = { ...found, points: moved.out }
      // Measured running in, as the bore does, so its left is the bore's.
      const measured = kind === 'road' ? measureEdges(densify(truncate(out.points, MEASURE), SAMPLE).reverse(), rings) : null
      openings.push({ out, bore: truncate(moved.bore, reach), edges: measured ?? [width / 2, width / 2], kind, layer, face: moved.out === outward ? face?.along : undefined })
    }
    const solved: Solved[] = []
    for (const { out, bore, edges, kind, face, piers } of groupPortals(openings)) {
      const cut = this.solve(out, bore, edges, kind, face, piers)
      if (cut) solved.push(cut)
    }

    const exaggeration = this.map.getTerrain?.()?.exaggeration ?? 1
    const p = this.palette
    const floors: Record<BoreKind, number[]> = { road: p.surface, path: p.concrete, rail: p.concrete.map(c => c * 0.8) }
    const mesh = emptyBuilt()
    for (const s of solved) {
      const scaled = { ...s.cut, floor: s.cut.floor.map(z => z * exaggeration), walls: s.cut.walls.map(w => w.map(z => z * exaggeration)) as [number[], number[]], crown: s.cut.crown * exaggeration, headroom: s.cut.headroom * exaggeration, base: s.cut.base * exaggeration }
      const from = mesh.floor.position.length / 3
      portalMesh(s.points, s.at, s.edges, scaled, this.origin, { surface: floors[s.kind], concrete: p.concrete, parapet: p.parapet, bore: p.concrete }, mesh, s.face, s.piers)
      mesh.floors.push({ from, to: mesh.floor.position.length / 3, ends: [s.points[s.cut.open], s.points[s.at]] })
      carving(s).forEach((f, i) => mesh.footprints.set(`${s.key}|${i}`, f))
    }
    return mesh
  }

  /** A portal's cut, from the ground along it; kept once read, null while the ground loads. */
  private solve(out: Approach, bore: Point[], edges: [number, number], kind: BoreKind, face?: Point, piers?: Array<[number, number]>): Solved | null {
    const sampler = this.samplerFor()
    this.sampler = sampler
    if (!sampler) return null
    const key = `${kind}|${face?.map(v => v.toFixed(3))}|${piers?.flat().map(v => v.toFixed(1))}|${edges.map(e => e.toFixed(1))}|${out.junction}|${[...out.points, ...bore].map(q => `${Math.round(q[0] * 2 ** 26)},${Math.round(q[1] * 2 ** 26)}`).join(';')}`
    const known = this.cuts.get(key)
    if (known) return known
    const { points, at } = portalLine(out.points, bore, SAMPLE)
    const height = (q: Point) => sampler.ground.at(q)
    const centre = points.map(height)
    const sides = RIM.map(r => edgePoints({ points, edges: [edges[0] + KERB + r, edges[1] + KERB + r] } as any))
    const rims = [0, 1].map(k => points.map((_, i) => {
      const heights = sides.map(side => height(side[k][i]))
      if (heights.some(g => g === null)) {
        this.groundLoading = true
        return null
      }
      const known = (heights as number[]).filter(g => !Number.isNaN(g))
      return known.length ? Math.min(...known) : NaN
    }))
    const d = along(points)
    const cover = COVER_AT.map(m => {
      let i = at
      while (i < points.length - 1 && d[i] - d[at] < m) i++
      return height(points[i])
    })
    if ([...centre, ...rims.flat(), ...cover].some(g => g === null)) {
      this.groundLoading = true
      return null
    }
    const ground = centre as number[]
    if (ground.some(Number.isNaN)) return null
    const fill = (rim: Array<number | null>) => rim.map((g, i) => (Number.isFinite(g) ? (g as number) : ground[i]))
    const over = cover.filter(g => !Number.isNaN(g)) as number[]
    const cut = solveCut(d, at, ground, [fill(rims[0]), fill(rims[1])], over.length ? Math.max(...over) : ground[at], out.junction, PROFILES[kind])
    if (!cut || cut.open >= at) return null
    const solved = { key, points, at, edges, cut, kind, face, piers }
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

  /** Walls mapped around the portals, any of which may stand across a bore as its headwall. */
  private walls(area: Bounds): Point[][] {
    if (!this.sources.walls) return []
    const { source, layer } = this.sources.walls
    return this.query(source, layer, ['in', ['get', 'kind'], ['literal', HEADWALLS]])
      .flatMap(f => linesOf(f.geometry))
      .map(line => line.map(mercator))
      .filter(line => line.length > 1 && meets(boundsOf(line), area))
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
