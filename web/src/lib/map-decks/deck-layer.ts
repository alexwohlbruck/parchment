/**
 * Bridges and elevated roads drawn in 3D, over the terrain.
 *
 * A MapLibre custom layer, because a style layer cannot leave the ground: lines
 * and fills are draped onto the terrain. This one builds each bridge as a solid
 * deck at a solved height (see `decks.ts`), lays the bridge's own lane paint and
 * any route over it on top, and leaves the flat copies to be muted by its owner.
 *
 * Only drawn with the terrain on. The heights come from the ground at each end:
 * lidar terrain carries a road's embankments, so a deck that spans between them
 * clears what runs underneath. The ground is read once per deck from the
 * terrain's tiles at a fixed zoom (see `ground.ts`), so a deck holds still as
 * the map pans.
 */
import { MercatorCoordinate } from 'maplibre-gl'
import { translate } from '@/lib/map-objects/object-layer'
import {
  absorbPaths,
  besideGround,
  dedupe,
  densify,
  edgePoints,
  joinNeighbours,
  smooth,
  steady,
  rounded,
  beside,
  boundsOf,
  chains,
  COVER,
  holds,
  MAX_REACH,
  fitEdges,
  clip,
  covered,
  onEdge,
  parseLine,
  parseProfile,
  parseShape,
  deckMesh,
  onDeck,
  solve,
  along,
  metresPerUnit,
  type Bounds,
  type Chain,
  type Mesh,
  type Piece,
  type Point,
  linesOf,
  mercator,
  tileBounds,
} from './decks'
import { terrainSampler, type GroundSampler, type TerrainSampler } from './ground'
import { layPaint, paintOf, strip, type Paint } from './paint'
import { idle, queryFeatures } from './map-query'
import { bindMesh, deleteMesh, linkMeshProgram, uploadMesh, type MeshBuffers } from './mesh-program'

/** Deck widths by OpenMapTiles class, in metres, for a bridge with no paint to measure. */
const WIDTH: Record<string, number> = {
  motorway: 12, trunk: 11, primary: 10, secondary: 9, tertiary: 8, minor: 7,
  service: 5, track: 4, path: 3, rail: 5, transit: 5,
}

export type DeckPalette = {
  surface: [number, number, number]
  concrete: [number, number, number]
  parapet: [number, number, number]
  white: [number, number, number]
  yellow: [number, number, number]
  green: [number, number, number]
  red: [number, number, number]
  route: [number, number, number]
  routeCasing: [number, number, number]
}

export type DeckSources = {
  /** The basemap source and its road layer. */
  basemap: string
  roads: string
  /** Barrelman's lane paint, where it is served; optional. */
  paint?: { source: string; layer: string }
  /** Barrelman's carriageways at their real width, which the decks are fitted to. */
  surfaces?: { source: string; layer: string }
  /** Barrelman's solved decks, drawn as served; bridges it has none for are solved here. */
  profiles?: { source: string; layer: string }
  /** Source ids whose lines are routes to lay over decks. */
  routes: () => string[]
}

/** Metres between height samples along a deck. */
const SAMPLE = 6
/** Decks whose ground is kept, and how far the map may pan before vertices are re-based (mercator units). */
const PROFILE_CACHE = 4000
const REBASE = 1e-3

export class DeckLayer {
  id: string
  type = 'custom' as const
  renderingMode = '3d' as const

  private map: any
  private program!: WebGLProgram
  private buffers: MeshBuffers | null = null
  private paintFrom = 0
  private origin: [number, number] = [0, 0]
  private scheduled = 0
  private onChange?: (event?: { sourceId?: string }) => void
  private pending: Mesh | null = null
  private sampler: TerrainSampler | null = null
  /** Each served deck's datum offset at its ends, by id. */
  private offsets = new Map<string, [number, number]>()
  /** Each deck's ground in true metres, keyed by its outline. */
  private grounds = new Map<string, number[]>()
  /** The tiles the last build read, and whether something besides them has changed since. */
  private built = ''
  private stale = true
  /** Bumped when the decks change, for anything that caches what they cover. */
  version = 0

  constructor(private sources: DeckSources, private palette: DeckPalette, options: { id?: string } = {}) {
    this.id = options.id ?? 'map-decks'
  }

  setPalette(palette: DeckPalette) {
    this.palette = palette
    this.invalidate()
  }

  onAdd(map: any, gl: WebGL2RenderingContext) {
    this.map = map
    this.program = linkMeshProgram(gl)
    const tiled = () => new Set([this.sources.basemap, this.sources.paint?.source, this.sources.surfaces?.source, this.sources.profiles?.source])
    // A build reads every loaded tile, so it waits for a source to finish
    // loading rather than running once per tile as they stream in. A pan
    // that loads nothing new leaves the decks as they are.
    this.onChange = event => {
      if (!event?.sourceId) {
        // A pan rebuilds nothing unless it has gone far enough to re-base the vertices.
        const c = MercatorCoordinate.fromLngLat(this.map.getCenter())
        if (Math.abs(c.x - this.origin[0]) >= REBASE || Math.abs(c.y - this.origin[1]) >= REBASE) this.invalidate()
      } else if (!(event as any).isSourceLoaded) return
      else if (tiled().has(event.sourceId)) this.invalidate(false)
      else if (this.sources.routes().includes(event.sourceId)) this.invalidate()
    }
    this.onTerrain = () => this.invalidate()
    map.on('sourcedata', this.onChange)
    map.on('moveend', this.onChange)
    map.on('terrain', this.onTerrain)
    this.invalidate()
  }

  private onTerrain?: () => void

  onRemove(map: any, gl: WebGL2RenderingContext) {
    if (this.onChange) {
      map.off('sourcedata', this.onChange)
      map.off('moveend', this.onChange)
    }
    if (this.onTerrain) map.off('terrain', this.onTerrain)
    clearTimeout(this.scheduled)
    this.cancelIdle?.()
    deleteMesh(gl, this.buffers)
    gl.deleteProgram(this.program)
    this.map = null
  }

  /**
   * Rebuild between frames, once a burst of tile events settles. Unforced, the
   * build is skipped when it would read the same tiles as the last one.
   */
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

  private cancelIdle?: () => void

  /** The terrain source's elevation tiles, read at its most detailed zoom. */
  private groundSampler(): GroundSampler | null {
    const sampler = terrainSampler(this.map, this.sampler, () => this.invalidate())
    if (sampler !== this.sampler) {
      this.grounds.clear()
      this.offsets.clear()
    }
    this.sampler = sampler
    return sampler?.ground ?? null
  }

  /**
   * A deck's ground in true metres: under its centreline, or its edges where
   * they stand higher. Read once and kept; null while a tile it needs loads.
   */
  private groundOf(chain: Chain): number[] | null {
    const key = `${chain.edges.map(e => e.toFixed(1))}|${chain.points.map(p => `${Math.round(p[0] * 2 ** 26)},${Math.round(p[1] * 2 ** 26)}`).join(';')}`
    const known = this.grounds.get(key)
    if (known) return known
    const sampler = this.groundSampler()
    if (!sampler) return null
    const [left, right] = edgePoints(chain)
    const read = (points: Point[]) => points.map(p => sampler.at(p))
    const samples = [read(chain.points), read(left), read(right)]
    if (samples.some(s => s.includes(null))) return null
    const [centre, l, r] = samples as number[][]
    const ground = filled(besideGround(centre, l, r, along(chain.points)))
    if (!ground) return null
    if (this.grounds.size >= PROFILE_CACHE) this.grounds.delete(this.grounds.keys().next().value!)
    this.grounds.set(key, ground)
    return ground
  }

  private query(source: string, sourceLayer?: string, filter?: any[]): any[] {
    return queryFeatures(this.map, source, sourceLayer, filter)
  }


  /** Whether the served decks for this view are still on their way, so solving bridges here would be wasted. */
  private awaitingServed(): boolean {
    const id = this.sources.profiles?.source
    const source = id ? this.map.getSource(id) : null
    if (!source || this.map.getZoom() < (source.minzoom ?? 0)) return false
    try {
      return !this.map.isSourceLoaded(id)
    } catch {
      return false
    }
  }

  private build(): Mesh | null {
    if (this.awaitingServed()) return null
    const pieces: Piece[] = []
    const tiles: Bounds[] = []
    const bridges = this.query(this.sources.basemap, this.sources.roads, ['==', ['get', 'brunnel'], 'bridge'])
    const paint = this.paint()
    const kerbs = this.kerbs()
    const served = this.served()
    const center = MercatorCoordinate.fromLngLat(this.map.getCenter())
    const read = [...new Set(bridges.map(f => `${f._z}/${f._x}/${f._y}`))].sort().join(' ') + `|${paint.length}|${kerbs.length}|${served.map(d => d.id).join(',')}`
    const near = Math.abs(center.x - this.origin[0]) < REBASE && Math.abs(center.y - this.origin[1]) < REBASE
    if (!this.stale && near && read === this.built) return null
    this.stale = false
    this.built = read
    for (const f of bridges) {
      const props = f.properties ?? {}
      const tile = tileBounds(f)
      if (tile) tiles.push(tile)
      const kind = props.class === 'rail' || props.class === 'transit' ? 'rail' : props.class === 'path' ? 'path' : 'road'
      for (const line of linesOf(f.geometry))
        for (const run of tile ? clip(line.map(mercator), tile) : [line.map(mercator)])
          pieces.push({ points: run, layer: Math.max(1, Number(props.layer) || 1), width: WIDTH[props.class] ?? 6, kind, zoom: f._z, tile: tile ?? undefined })
    }
    const placed = served.flatMap(d => this.place(d))
    if (!near) this.origin = [center.x, center.y]
    const tolerance = 1.5 / metresPerUnit(center.y)
    // A cut where a tile meets another loaded one joins back up; one at the
    // edge of everything loaded is the only kind left.
    const loaded = tiles.reduce<Bounds | null>((u, t) => u
      ? { minX: Math.min(u.minX, t.minX), minY: Math.min(u.minY, t.minY), maxX: Math.max(u.maxX, t.maxX), maxY: Math.max(u.maxY, t.maxY) }
      : { ...t }, null)
    const servedBounds = served.map(({ chain }) => ({ chain, bounds: boundsOf(chain.points, Math.max(...chain.edges) + COVER) }))
    const own = dedupe(pieces).filter(piece => !covered(piece, servedBounds))
    const decks = absorbPaths(fitted(chains(own, p => !!loaded && onEdge(p, loaded, tolerance), tolerance), kerbs))
      .map(chain => ({ ...chain, points: densify(chain.points, SAMPLE) }))
    const solved: Array<{ chain: Chain; groundAt: number[]; z: number[]; piers?: number[]; fixed?: boolean }> = decks.flatMap(chain => {
      const groundAt = this.groundOf(chain)
      return groundAt ? [{ chain, groundAt, z: solve(chain, groundAt) }] : []
    })
    const local = solved.length
    solved.push(...placed)
    // An end left in the air because it meets another deck takes that deck's
    // height there, so a ramp lands on the road it joins. Twice, so a height
    // carries through a ramp joining a ramp.
    for (let pass = 0; pass < 2; pass++) {
      const others = solved.map(({ chain, z }) => ({ points: chain.points, z, d: along(chain.points), width: 2 * Math.max(...chain.edges) }))
      for (const [k, s] of solved.slice(0, local).entries()) {
        const ends = [s.chain.points[0], s.chain.points[s.chain.points.length - 1]]
        const resting = ends.map((p, i) => {
          if (s.chain.grounded[i]) return null
          const [z] = onDeck([p], others.filter((_, j) => j !== k), 0)
          return z
        }) as [number | null, number | null]
        if (resting[0] !== null || resting[1] !== null) s.z = solve(s.chain, s.groundAt, resting)
      }
    }
    for (const s of solved.slice(0, local)) {
      const d = along(s.chain.points)
      s.z = smooth(s.z, d, steady(s.groundAt, d))
    }
    // Curves filled in before anything is laid along them.
    for (const s of solved) Object.assign(s, rounded(s.chain, s.z, s.groundAt))
    const open = joinNeighbours(solved)
    // Solved in true metres; drawn over terrain that is stretched.
    const exaggeration = this.map.getTerrain?.()?.exaggeration ?? 1
    for (const s of solved) {
      s.z = s.z.map(z => z * exaggeration)
      s.groundAt = s.groundAt.map(g => g * exaggeration)
    }

    const p = this.palette
    const mesh: Mesh = { position: [], normal: [], color: [] }
    for (const [k, { chain, groundAt, z, piers }] of solved.entries())
      deckMesh(chain, z, groundAt, this.origin, { surface: p.surface, concrete: p.concrete, parapet: p.parapet }, mesh, open[k], piers)

    const surfaces = solved.map(({ chain, z }) => {
      const width = 2 * Math.max(...chain.edges) + 1
      return { points: chain.points, z, d: along(chain.points), width, bounds: boundsOf(chain.points, width) }
    })
    this.paintFrom = mesh.position.length / 3
    layPaint(mesh, paint, surfaces, p, this.origin)
    for (const id of this.sources.routes())
      for (const f of this.query(id))
        for (const line of linesOf(f.geometry)) {
          const points = line.map(mercator)
          strip(mesh, points, surfaces, 4.4, p.routeCasing, 0.06, 0, false, this.origin)
          strip(mesh, points, surfaces, 3, p.route, 0.08, 0, false, this.origin)
        }
    this.version++
    return mesh
  }

  /** Barrelman's decks in view, one copy each: every tile a deck crosses carries all of it, exactly. */
  private served(): Served[] {
    if (!this.sources.profiles) return []
    const { source, layer } = this.sources.profiles
    const best = new Map<string, any>()
    for (const f of this.query(source, layer)) {
      const id = f.properties?.id
      if (id && (f._z ?? 0) >= (best.get(id)?._z ?? -1)) best.set(id, f)
    }
    return [...best.values()].flatMap(f => {
      const props = f.properties
      const points = parseLine(props.line).map(mercator)
      const [z, groundAt] = [parseProfile(props.heights), parseProfile(props.ground)]
      if (points.length < 2 || z.length !== points.length || groundAt.length !== points.length) return []
      const kind = props.kind === 'rail' || props.kind === 'path' ? props.kind : 'road'
      const edges: [number, number] = [Number(props.left_edge) || 3, Number(props.right_edge) || 3]
      const chain: Chain = { points, kind, layer: Math.max(1, Number(props.layer) || 1), width: edges[0] + edges[1], edges,
        grounded: [props.start_grounded !== false, props.end_grounded !== false], ...parseShape(props, points.length) }
      return [{ id: String(props.id), chain, z, groundAt, piers: parseProfile(props.piers) }]
    })
  }

  /**
   * A served deck moved onto the terrain drawn here. Heights are above EGM96;
   * the difference between its ground and ours at each end, spread along it,
   * takes up the datum and any other source. Null while our ground loads.
   */
  private place(deck: Served): Array<{ chain: Chain; groundAt: number[]; z: number[]; piers?: number[]; fixed: boolean }> {
    let offset = this.offsets.get(deck.id)
    if (!offset) {
      const sampler = this.groundSampler()
      const { points } = deck.chain
      const ends = [points[0], points[points.length - 1]].map(p => (sampler ? sampler.at(p) : NaN))
      if (ends.some(g => g === null)) return []
      offset = ends.map((g, i) => (Number.isNaN(g) ? 0 : g! - deck.groundAt[i ? deck.groundAt.length - 1 : 0])) as [number, number]
      this.offsets.set(deck.id, offset)
    }
    const d = along(deck.chain.points)
    const total = d[d.length - 1] || 1
    const shift = d.map(s => offset[0] + ((offset[1] - offset[0]) * s) / total)
    return [{ chain: deck.chain, z: deck.z.map((z, i) => z + shift[i]), groundAt: deck.groundAt.map((g, i) => g + shift[i]), piers: deck.piers, fixed: true }]
  }

  /** The bridges' own lane paint, as runs clipped to their tiles. */
  private paint(): Paint[] {
    if (!this.sources.paint) return []
    return this.query(this.sources.paint.source, this.sources.paint.layer, ['==', ['get', 'bridge'], true]).map(paintOf)
  }

  /** The outlines of the bridges' own carriageways. */
  private kerbs(): Point[] {
    if (!this.sources.surfaces) return []
    const { source, layer } = this.sources.surfaces
    return this.query(source, layer, ['==', ['get', 'bridge'], true]).flatMap(f => {
      const g = f.geometry
      const polygons = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : []
      return polygons.flat(2).map(mercator)
    })
  }

  render(gl: WebGL2RenderingContext, args: any) {
    if (this.pending) {
      deleteMesh(gl, this.buffers)
      this.buffers = uploadMesh(gl, this.pending)
      this.pending = null
    }
    if (!this.buffers?.count) return

    const matrix = args?.defaultProjectionData?.mainMatrix ?? args?.modelViewProjectionMatrix ?? args
    const light = this.map.style?.light?.getCartesianPosition?.() ?? [0.4, -0.6, 0.7]
    const mesh = bindMesh(gl, this.program, this.buffers, translate(matrix, [this.origin[0], this.origin[1], 0]), light)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.depthMask(true)
    gl.disable(gl.CULL_FACE)
    gl.disable(gl.BLEND)
    mesh.draw(0, this.paintFrom)
    // Paint and routes sit a few centimetres over the asphalt; the offset keeps
    // them in front of it at any distance.
    gl.enable(gl.POLYGON_OFFSET_FILL)
    gl.polygonOffset(-2, -2)
    mesh.draw(this.paintFrom)
    gl.disable(gl.POLYGON_OFFSET_FILL)
    mesh.unbind()
  }
}

type Served = { id: string; chain: Chain; z: number[]; groundAt: number[]; piers: number[] }

/** Each road deck fitted to the kerbs nearest it, so a deck and its twin do not take each other's. */
function fitted(decks: Chain[], kerbs: Point[]): Chain[] {
  const roads = decks.filter(d => d.kind === 'road').map(road => ({ road, bounds: boundsOf(road.points, MAX_REACH) }))
  const owned = new Map<Chain, Point[]>()
  for (const q of kerbs) {
    let nearest: Chain | null = null
    let distance = Infinity
    for (const { road, bounds } of roads) {
      if (!holds(bounds, q)) continue
      const d = beside(road.points, q).distance
      if (d < distance) [nearest, distance] = [road, d]
    }
    if (nearest) owned.set(nearest, [...(owned.get(nearest) ?? []), q])
  }
  return decks.map(d => (owned.has(d) ? { ...d, edges: fitEdges(d, owned.get(d)!) } : d))
}

/** Gaps in a ground profile filled from the nearest sampled point; null if there are none. */
function filled(ground: number[]): number[] | null {
  const known = ground.map((g, i) => [g, i]).filter(([g]) => !Number.isNaN(g))
  if (!known.length) return null
  return ground.map((g, i) =>
    Number.isNaN(g) ? known.reduce((best, k) => (Math.abs(k[1] - i) < Math.abs(best[1] - i) ? k : best))[0] : g,
  )
}
