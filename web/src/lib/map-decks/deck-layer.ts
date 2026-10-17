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
  absorbTracks,
  jointAreas,
  wayEnds,
  grownRing,
  inside,
  deckMeshOut,
  endsMade,
  landedOn,
  placedPiers,
  sideAt,
  smoothstep,
  standing,
  standKey,
  underWay,
  runsWith,
  touchdown,
  unprojected,
  TOUCHDOWN,
  type UnderWay,
  UNDER_SLACK,
  besideGround,
  dedupe,
  densify,
  edgePoints,
  joinNeighbours,
  coveredSides,
  innerSides,
  mouthSides,
  smooth,
  steady,
  rounded,
  beside,
  BOX_MIN,
  meets,
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
  type Sides,
  type DeckSurface,
  type Top,
  type Mesh,
  type Piece,
  type Point,
  linesOf,
  polygonsOf,
  mercator,
  tileBounds,
} from './decks'
import { terrainSampler, type GroundSampler, type TerrainSampler } from './ground'
import { abutmentMesh } from './abutments'
import { closedAreas } from './closing'
import { AT_GRADE, joinedLines, layPaint, layRoute, layWays, paintOf, type Paint } from './paint'
import { idle, queryFeatures } from './map-query'
import { bindMesh, deleteMesh, eyeOf, linkMeshProgram, uploadMesh, type MeshBuffers } from './mesh-program'
import { groundBeneath, MeshShadow } from './mesh-shadow'
import { HD_FADE } from '@/lib/map-style/road-markings'
import { liveBuildingShade } from '@/lib/map/building-shade'
import type { SunFrame } from '@/lib/map/sun-shadow'

/** Deck widths by OpenMapTiles class, in metres, for a bridge with no paint to measure. */
const WIDTH: Record<string, number> = {
  motorway: 12, trunk: 11, primary: 10, secondary: 9, tertiary: 8, minor: 7,
  service: 5, track: 4, path: 3, rail: 5, transit: 5,
}

type Rgb = [number, number, number]

export type DeckPalette = {
  surface: Rgb
  concrete: Rgb
  parapet: Rgb
  /** A rail deck's surface. */
  track: Rgb
  /** The top of a road deck that has its carriageway laid on it: beside the carriageway the colour of the ground's paths, as its sidewalks are. */
  deck: Rgb
  /** Below street zoom, a deck's surface: the basemap's colour for its minor, major and highway roads, and paths. */
  lowRoad: Rgb
  lowMajor: Rgb
  lowHighway: Rgb
  lowPath: Rgb
  /** A sidewalk or footpath laid on a deck, and a rail. */
  walkway: Rgb
  rail: Rgb
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
  /** Whether the lane-level roads are drawn: without them a deck keeps the basemap's road colours at every zoom. */
  hd?: () => boolean
}

/** Where each deck lies on the ground, as boxes: what the road paints there is drawn over the deck. */
function touchdowns(surfaces: DeckSurface[]): Bounds[] {
  return surfaces.flatMap(s => {
    const total = s.d[s.d.length - 1]
    const low = (i: number) => Math.min(s.d[i], total - s.d[i]) <= AT_GRADE.reach
    const n = s.points.length
    let [head, tail] = [0, n - 1]
    while (head < n && low(head)) head++
    while (tail >= head && low(tail)) tail--
    return [s.points.slice(0, head), s.points.slice(tail + 1)].flatMap(run => (run.length ? [boundsOf(run, s.width / 2 + COVER)] : []))
  })
}


/** Metres a bridge carriageway laid on a deck is grown by: enough to close the hairline where it meets the road beyond, too little to show as a kerb step. */
const SURFACE_OVERLAP = 0.08

/** A basemap road's class, `_link` for a slip road, as decks are told apart by. */
const roadClass = (props: Record<string, any>) => (props.class ? `${props.class}${Number(props.ramp) === 1 ? '_link' : ''}` : undefined)

/** Zoom from which a deck's rails are drawn: thinner than a pixel before it. */
const RAILS_FROM = 17.5

/** Metres from a deck's end within which a way on the ground is the road carrying on from it, and the room an abutment keeps from any other. */
const OWN_ROAD = 2
const ABUTMENT_ROOM = 1

/** The share of a road deck's length that must lie in carriageway outlines for it to be drawn concrete. */
const PAVED = 0.8
/** The least width a line on a deck is drawn at, in CSS pixels: a whole pixel, since unlike the flat roads' it is not antialiased. */
const MIN_LINE_PX = 1
/** How far past a bridge's end its paint may run on the ground, in metres: Barrelman gives it the street's first 15. */
const PAST_END = 18
/** Coloured lanes joined across a bridge's ends, and how far apart two corners may lie and be one lane's, in metres. */
const LANE_COLORS = ['green', 'red']
const LANE_JOIN = 2.5
/** Road classes whose decks are paved edge to edge, as the road beyond. */
const HIGHWAY = /^(motorway|trunk)$|_link$/

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
  /** Where the mesh's paint, rails and routes begin. */
  private ranges: Ranges = { paintFrom: 0, railsFrom: 0, routesFrom: 0 }
  private origin: [number, number] = [0, 0]
  private scheduled = 0
  private onChange?: (event?: { sourceId?: string }) => void
  private pending: { mesh: Mesh; ranges: Ranges; ground: Float32Array; exaggeration: number } | null = null
  /** The buildings' sun shadow map this frame, which the decks lie in as the ground does; see `building-shade.ts`. */
  private sun: SunFrame | null = null
  /** The decks' structure, piers and parapets casting on the ground and into the sun's map. */
  private shadow = new MeshShadow()
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
  /** Runs after a build that moved the decks, for anything standing on them. */
  onBuilt?: () => void
  private stood = ''
  /** The last build's decks, for `standOn`, and the ground ways passing under them, worked out when first asked. */
  private stands: Array<{ chain: Chain; surface: DeckSurface }> = []
  private under: UnderWay[] | null = null
  /** The bridges' own tracks. */
  private tracks: UnderWay[] = []

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
    this.shadow.delete(gl)
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
        const built = this.build()
        if (!built) return
        // On the fixed-zoom ground the decks were solved on: the drawn terrain is a hundred times slower to ask.
        const sampler = this.groundSampler()
        const exaggeration = this.map.getTerrain?.()?.exaggeration ?? 1
        const ground = groundBeneath(built.mesh.position, built.ranges.paintFrom, this.origin, q => sampler?.at(q) ?? null, exaggeration)
        this.pending = { ...built, ground, exaggeration }
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

  private build(): { mesh: Mesh; ranges: Ranges } | null {
    if (this.awaitingServed()) return null
    const pieces: Piece[] = []
    const tiles: Bounds[] = []
    const bridges = this.query(this.sources.basemap, this.sources.roads, ['==', ['get', 'brunnel'], 'bridge'])
    const paint = this.paint()
    const kerbs = this.kerbs()
    const served = this.served()
    const center = MercatorCoordinate.fromLngLat(this.map.getCenter())
    // The roads on the ground are laid over deck ends too, so their tiles arriving rebuilds.
    const surfaceTiles = this.sources.surfaces ? this.query(this.sources.surfaces.source, this.sources.surfaces.layer).map(f => `${f._z}/${f._x}/${f._y}`) : []
    const read = [...new Set([...bridges.map(f => `${f._z}/${f._x}/${f._y}`), ...surfaceTiles])].sort().join(' ') + `|${paint.length}|${kerbs.length}|${served.map(d => d.id).join(',')}`
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
          pieces.push({ points: run, layer: Math.max(1, Number(props.layer) || 1), width: WIDTH[props.class] ?? 6, kind, zoom: f._z, tile: tile ?? undefined, road: roadClass(props) })
    }
    // Pieces are cut to their own tiles, so each stretch of a way is drawn once.
    const deduped = dedupe(pieces)
    const ways = deduped.flatMap(({ kind, points }) => (kind === 'road' ? [] : [{ kind, points }]))
    const roads = deduped.flatMap(piece => (piece.kind === 'road' && piece.road ? [{ piece, bounds: boundsOf(piece.points, MAX_REACH) }] : []))
    const placed = served.flatMap(d => this.place({ ...d, chain: { ...d.chain, road: classUnder(d.chain, roads) } }))
    // Where each deck's way meets the road on the ground, before its ends are carried on as road.
    const joints = placed.flatMap(({ chain }) => wayEnds(chain))
    if (!near) this.origin = [center.x, center.y]
    const tolerance = 1.5 / metresPerUnit(center.y)
    // A cut where a tile meets another loaded one joins back up; one at the
    // edge of everything loaded is the only kind left.
    const loaded = tiles.reduce<Bounds | null>((u, t) => u
      ? { minX: Math.min(u.minX, t.minX), minY: Math.min(u.minY, t.minY), maxX: Math.max(u.maxX, t.maxX), maxY: Math.max(u.maxY, t.maxY) }
      : { ...t }, null)
    const servedBounds = served.map(({ chain }) => ({ chain, bounds: boundsOf(chain.points, Math.max(...chain.edges) + COVER) }))
    const own = deduped.filter(piece => !covered(piece, servedBounds))
    const decks = absorbTracks(absorbPaths(fitted(chains(own, p => !!loaded && onEdge(p, loaded, tolerance), tolerance), kerbs)))
      .map(chain => ({ ...chain, points: densify(chain.points, SAMPLE) }))
    const solved: Array<{ chain: Chain; groundAt: number[]; z: number[]; piers?: number[]; fixed?: boolean; wayEnds?: [Point, Point] }> = decks.flatMap(chain => {
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
          const [z] = onDeck([p], others, 0, k)
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
    for (const s of solved.slice(local)) {
      const sampler = this.groundSampler()
      s.z = landedOn(s.chain, s.z, q => sampler?.at(q) ?? null)
      s.wayEnds = [s.chain.points[0], s.chain.points[s.chain.points.length - 1]]
      const { shift, ...made } = endsMade(s.chain, s.z, s.groundAt, q => sampler?.at(q) ?? null)
      Object.assign(s, made, s.piers ? { piers: s.piers.map(at => at + shift) } : {})
    }
    const open = joinNeighbours(solved)
    const bridgeAreas = bridges.filter(f => f.properties?.class === 'bridge').flatMap(f => polygonsOf(f.geometry).map(rings => rings.map(ring => ring.map(mercator)))).map(rings => ({ rings, bounds: boundsOf(rings[0]) }))
    const inner = innerSides(solved, bridgeAreas)
    const mouths = mouthSides(solved)
    const onDecks = coveredSides(solved).map((sides, k) => sides.map((side, s) => side.map((c, i) => c || inner[k][s][i] || mouths[k][s][i])) as Sides)
    // Decks built here stand their piers clear of the roads, railways and paths beneath.
    const unplaced = solved.filter(s => !s.piers)
    if (unplaced.length) {
      const beneath = this.carriageways(false, unplaced.map(({ chain }) => boundsOf(chain.points, Math.max(...chain.edges))))
        .flatMap(c => c.areas.map(rings => ({ rings, bounds: boundsOf(rings[0]) })))
      const ways = this.waysNear(unplaced.map(({ chain }) => boundsOf(chain.points, Math.max(...chain.edges))))
      for (const s of unplaced) s.piers = placedPiers(s.chain, s.z, s.groundAt, at => this.bentClear(s.chain, at, ways, beneath))
    }
    // Solved in true metres; drawn over terrain that is stretched.
    const exaggeration = this.map.getTerrain?.()?.exaggeration ?? 1
    for (const s of solved) {
      s.z = s.z.map(z => z * exaggeration)
      s.groundAt = s.groundAt.map(g => g * exaggeration)
    }
    // A deck's end is biased toward the eye against the ground as drawn, which may stand higher than the ground it was solved on.
    const biasGround = solved.map(({ chain, z, groundAt }) => {
      const d = along(chain.points)
      return groundAt.map((g, i) => {
        const w = smoothstep(Math.max(0, 1 - Math.min(chain.grounded[0] ? d[i] : Infinity, chain.grounded[1] ? d[d.length - 1] - d[i] : Infinity) / AT_GRADE.reach))
        const drawn = w > 0 ? this.drawnGround(chain.points[i]) : null
        return drawn === null ? g : g + (Math.max(g, Math.min(drawn, z[i])) - g) * w
      })
    })

    const p = this.palette
    const mesh = deckMeshOut()
    // A road deck carrying a carriageway outline is concrete, the carriageway laid on it in asphalt at its own width.
    const paved = this.carriageways()
    const outlines = paved.flatMap(c => c.areas.map(rings => ({ rings, bounds: boundsOf(rings[0]) })))
    // Concrete only on a street deck whose carriageway runs its length; a highway deck, or any other, is the road itself, in asphalt.
    const concrete = (chain: Chain) => chain.kind === 'road' && !HIGHWAY.test(chain.road ?? '') &&
      chain.points.filter(q => outlines.some(o => holds(o.bounds, q) && inside(q, o.rings))).length >= chain.points.length * PAVED
    const concreteAt = new Map(solved.map(({ chain }) => [chain, concrete(chain)]))
    const colors = (chain: Chain) =>
      chain.kind === 'rail' ? { surface: p.track, low: p.track } : chain.kind === 'path' ? { surface: p.walkway, low: p.lowPath }
      : { surface: concreteAt.get(chain) ? p.deck : p.surface, low: lowRoad(p, chain.road) }
    const tops = solved.map(() => [] as Top[])
    for (const [k, { chain, groundAt, z, piers }] of solved.entries())
      deckMesh(chain, z, groundAt, this.origin, { ...colors(chain), concrete: p.concrete, parapet: p.parapet }, mesh, open[k], piers, tops[k], biasGround[k], onDecks[k])

    const surfaces: DeckSurface[] = solved.map(({ chain, z, groundAt }, k) => {
      const width = 2 * Math.max(...chain.edges) + 1
      return {
        points: chain.points, z, d: along(chain.points), width, bounds: boundsOf(chain.points, width),
        bias: z.map((h, i) => touchdown(h - biasGround[k][i])), low: colors(chain).low, ground: groundAt, kind: chain.kind, edges: edgePoints(chain), tops: tops[k], sidewalks: !!concreteAt.get(chain),
      }
    })
    this.stands = solved.map(({ chain }, k) => ({ chain, surface: surfaces[k] }))
    this.tracks = ways.flatMap(w => (w.kind === 'rail' ? [{ points: w.points, half: 1, bounds: boundsOf(w.points, 3) }] : []))
    this.under = null
    const grounded = solved.filter(({ chain }) => chain.kind === 'road' && (chain.grounded[0] || chain.grounded[1]))
    const onGround = this.carriageways(false, grounded.map(({ chain }) => boundsOf(chain.points)))
      .flatMap(c => c.areas.map(rings => ({ rings, bounds: boundsOf(rings[0]) })))
    const frame = { origin: this.origin, color: p.concrete, out: mesh }
    for (const { chain, z, groundAt, wayEnds } of grounded) {
      const clear = ([0, 1] as const).map(end => this.abutmentClear(wayEnds?.[end] ?? chain.points[end ? chain.points.length - 1 : 0], onGround))
      abutmentMesh(chain, z, groundAt, frame, (end, footprint) => clear[end](footprint), exaggeration)
    }
    const ranges = { paintFrom: mesh.position.length / 3, railsFrom: 0, routesFrom: 0 }
    const tar = { ...p, asphalt: p.surface }
    const ends = touchdowns(surfaces)
    // On the ground as the map draws it, so what lies there sits on the drawn terrain, not the DEM read for the decks.
    const ground = { at: (q: Point) => this.drawnGround(q), near: ends, low: p.lowRoad }
    // A bridge's paint runs on past its ends onto the ground, where the deck draws it in the ground's place.
    const pastEnds = solved.flatMap(({ chain }) => chain.kind !== 'road' ? [] : wayEnds(chain).map(end => ({ ...end, reach: PAST_END, half: end.half + COVER })))
    const past = pastEnds.map(({ p: at, out, half }) => {
      const scale = metresPerUnit(at[1])
      return boundsOf([at, [at[0] + (out[0] * PAST_END) / scale, at[1] + (out[1] * PAST_END) / scale]], half)
    })
    const onward = { ...ground, near: [...ends, ...past] }
    layPaint(mesh, paved, surfaces, tar, this.origin, { ground })
    const atGrade = this.carriageways(false, ends)
    // Laid as one area, less the bridge's own, so pieces mapped apart leave no bars or notches on a deck's end.
    const joined = closedAreas(atGrade.flatMap(c => c.areas), paved.flatMap(c => c.areas), ends)
    layPaint(mesh, [{ props: { kind: 'surface', pattern: 'fill', color: 'asphalt' }, runs: [], areas: joined }], surfaces, tar, this.origin, { atGrade: true })
    // The road on the ground and the bridge's own each end square to their own way; where those bend at the bridge node a wedge opens between them.
    const meeting = [...joints, ...solved.slice(0, local).flatMap(({ chain }) => wayEnds(chain))]
    const outers = (list: Paint[]) => list.flatMap(c => c.areas.map(rings => rings[0]))
    const wedges = jointAreas(meeting, outers([...paved, ...atGrade]))
    layPaint(mesh, [{ props: { kind: 'surface', pattern: 'fill', color: 'asphalt' }, runs: [], areas: wedges.map(w => [w]) }], surfaces, tar, this.origin, { ground })
    layWays(mesh, ways.filter(w => w.kind === 'path'), surfaces, p, this.origin)
    const { bridge: bridgePaint, ground: beyond } = joinedLines(paint, this.paintAtGrade(ends))
    // Paint is drawn as a decal, last on top: coloured lanes, then white areas, then lines.
    const coloured = (f: Paint) => LANE_COLORS.includes(f.props.color)
    for (const tier of [coloured, (f: Paint) => !coloured(f)]) {
      layPaint(mesh, bridgePaint.filter(tier), surfaces, p, this.origin, { ground: onward, past: pastEnds, parts: 'areas' })
      layPaint(mesh, beyond.filter(tier), surfaces, p, this.origin, { atGrade: true, parts: 'areas' })
      if (tier !== coloured) continue
      // Coloured lanes on the bridge and on the ground meet at the joint the same way: each lane's own wedge, in its colour.
      for (const color of LANE_COLORS) {
        const joins = jointAreas(meeting, outers([...paint, ...beyond].filter(f => f.props.color === color && f.areas.length)), LANE_JOIN)
        if (joins.length) layPaint(mesh, [{ props: { kind: 'lane', pattern: 'fill', color }, runs: [], areas: joins.map(w => [w]) }], surfaces, p, this.origin, { ground })
      }
    }
    layPaint(mesh, bridgePaint, surfaces, p, this.origin, { ground: onward, past: pastEnds, parts: 'lines' })
    layPaint(mesh, beyond, surfaces, p, this.origin, { atGrade: true, parts: 'lines' })
    ranges.railsFrom = mesh.position.length / 3
    layWays(mesh, ways.filter(w => w.kind === 'rail'), surfaces, p, this.origin)
    ranges.routesFrom = mesh.position.length / 3
    for (const id of this.sources.routes())
      for (const f of this.query(id)) layRoute(mesh, linesOf(f.geometry).map(line => line.map(mercator)), surfaces, p, this.origin)
    this.version++
    const stood = standKey(this.stands)
    if (stood !== this.stood) this.onBuilt?.()
    this.stood = stood
    return { mesh, ranges }
  }

  /**
   * The deck surface an object at a point stands on, in the terrain's metres,
   * or null for the ground. A linear object (`along`, east and south) must run
   * with the deck; a point object stands on one unless a way passing under the
   * deck runs beside it.
   */
  standOn(lng: number, lat: number, along?: [number, number]): number | null {
    const p = mercator([lng, lat])
    const stand = standing(this.stands, p, along)
    if (!stand) return null
    // A wire over its own bridge track is the track's, whatever runs beneath.
    if (along && runsWith(this.tracks, p, along, 1)) return stand.z
    if (stand.height >= BOX_MIN && this.passesUnder(p, along)) return null
    return stand.z
  }

  /** The surface of a deck over a point, in the terrain's metres, whatever passes beneath it; null where there is none. */
  surfaceAt(lng: number, lat: number): number | null {
    return standing(this.stands, mercator([lng, lat]))?.z ?? null
  }

  /** Whether an object belongs to a way on the ground passing under a deck: see `underWay`. */
  private passesUnder(p: Point, along?: [number, number]): boolean {
    return underWay(this.groundWays(), p, along)
  }

  /** The ways on the ground near the decks, with half their widths. */
  private groundWays(): UnderWay[] {
    this.under ??= this.waysNear(this.stands.flatMap(s => (s.surface.bounds ? [s.surface.bounds] : [])))
    return this.under
  }

  /** The ways on the ground meeting these boxes. */
  private waysNear(boxes: Bounds[]): UnderWay[] {
    const ground = this.query(this.sources.basemap, this.sources.roads, ['!', ['in', ['get', 'brunnel'], ['literal', ['bridge', 'tunnel']]]])
    return ground.flatMap(f => linesOf(f.geometry).flatMap(line => {
      const points = line.map(mercator)
      if (points.length < 2) return []
      const half = (WIDTH[f.properties?.class] ?? 6) / 2
      const bounds = boundsOf(points, half + UNDER_SLACK)
      return boxes.some(d => meets(d, bounds)) ? [{ points, half, bounds }] : []
    }))
  }

  /** The terrain as drawn at a point; where none is drawn yet, the fixed-zoom ground stretched as the terrain is. */
  private drawnGround(q: Point): number | null {
    const g = this.map.queryTerrainElevation?.(unprojected(q))
    if (typeof g === 'number' && g !== 0) return g
    const read = this.groundSampler()?.at(q)
    return read == null || Number.isNaN(read) ? null : read * (this.map.getTerrain?.()?.exaggeration ?? 1)
  }

  /** Whether a pier's bent `at` metres along a deck, edge to edge, keeps off the ways and carriageways on the ground. */
  private bentClear(chain: Chain, at: number, ways: UnderWay[], beneath: Array<{ rings: Point[][]; bounds: Bounds }>): boolean {
    const d = along(chain.points)
    let k = 1
    while (k < chain.points.length - 1 && d[k] < at) k++
    const t = Math.max(0, Math.min(1, (at - d[k - 1]) / (d[k] - d[k - 1] || 1)))
    const [a, b] = [chain.points[k - 1], chain.points[k]]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const scale = 1 / metresPerUnit(a[1])
    const [l, r] = [sideAt(chain, 0, k - 1, t), sideAt(chain, 1, k - 1, t)]
    const bent: Point[] = []
    for (let across = -r; across <= l; across += 1)
      bent.push([a[0] + (b[0] - a[0]) * t - ((b[1] - a[1]) / len) * across * scale, a[1] + (b[1] - a[1]) * t + ((b[0] - a[0]) / len) * across * scale])
    return !bent.some(q =>
      ways.some(w => holds(w.bounds, q) && beside(w.points, q).distance < w.half + ABUTMENT_ROOM) ||
      beneath.some(r => holds(r.bounds, q) && inside(q, r.rings)))
  }

  /** Whether an abutment's footprint keeps off the ways and carriageways on the ground, but for the road carrying on from its way's end. */
  private abutmentClear(end: Point, rings: Array<{ rings: Point[][]; bounds: Bounds }>): (footprint: Point[]) => boolean {
    const scale = metresPerUnit(end[1])
    const touches = (q: Point) => Math.hypot(q[0] - end[0], q[1] - end[1]) * scale < OWN_ROAD
    const ways = this.groundWays().filter(w => !touches(w.points[0]) && !touches(w.points[w.points.length - 1]))
    const surfaces = rings.filter(r => !(holds(r.bounds, end) && inside(end, r.rings)))
    return footprint => !footprint.some(q =>
      ways.some(w => holds(w.bounds, q) && beside(w.points, q).distance < w.half + ABUTMENT_ROOM) ||
      surfaces.some(r => holds(r.bounds, q) && inside(q, r.rings)))
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

  /** The road's own paint where it runs on over the ends of decks lying on the ground, which would hide it. */
  private paintAtGrade(ends: Bounds[]): Paint[] {
    if (!this.sources.paint || !ends.length) return []
    return this.query(this.sources.paint.source, this.sources.paint.layer, ['!=', ['get', 'bridge'], true])
      .filter(f => this.meetsAny(f, ends))
      .map(paintOf)
  }

  /** Carriageways as asphalt to lay: the bridges' own, or the roads on the ground over the given boxes, where decks end on them. */
  private carriageways(bridge = true, over: Bounds[] = []): Paint[] {
    if (!this.sources.surfaces || (!bridge && !over.length)) return []
    const { source, layer } = this.sources.surfaces
    return this.query(source, layer, ['all', ['==', ['coalesce', ['get', 'bridge'], false], bridge], ['!=', ['get', 'kind'], 'island']])
      .filter(f => bridge || this.meetsAny(f, over))
      .map(f => paintOf({ geometry: f.geometry, _x: f._x, _y: f._y, _z: f._z, properties: { kind: 'surface', pattern: 'fill', color: 'asphalt' } }))
      // Grown a little, so a bridge's carriageway and the road beyond overlap where they meet rather than leave a crack.
      .map(c => ({ ...c, areas: c.areas.map(rings => [grownRing(rings[0], SURFACE_OVERLAP), ...rings.slice(1)]) }))
  }

  /** Whether a feature's geometry meets one of the boxes, its tile tested first. */
  private meetsAny(f: any, boxes: Bounds[]): boolean {
    const tile = tileBounds(f)
    if (tile && !boxes.some(b => meets(b, tile))) return false
    const coords = [...linesOf(f.geometry), ...polygonsOf(f.geometry).flat()].flat().map(mercator)
    return coords.length > 0 && boxes.some(b => meets(b, boundsOf(coords)))
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
      this.buffers = uploadMesh(gl, this.pending.mesh)
      this.ranges = this.pending.ranges
      this.shadow.set(gl, this.buffers.position, this.ranges.paintFrom, this.pending.ground, this.origin, this.pending.exaggeration)
      this.pending = null
      // The shade layer drew this frame's shadows before the decks changed.
      this.map.triggerRepaint()
    }
    if (!this.buffers?.count) return

    const projection = args?.defaultProjectionData?.mainMatrix ?? args?.modelViewProjectionMatrix ?? args
    const matrix = translate(projection, [this.origin[0], this.origin[1], 0])
    const light = this.map.style?.light?.getCartesianPosition?.() ?? [0.4, -0.6, 0.7]
    const [from, to] = HD_FADE
    const hd = this.sources.hd?.() === false ? 0 : Math.max(0, Math.min(1, (this.map.getZoom() - from) / (to - from)))
    const eye = eyeOf(projection)
    const relative: [number, number, number] | null = eye && [eye[0] - this.origin[0], eye[1] - this.origin[1], eye[2]]
    const exaggeration = this.map.getTerrain?.()?.exaggeration ?? 1
    // The sun's map is this frame's only: a frame the buildings skip leaves none.
    const sun = this.sun
    this.sun = null
    const shade = liveBuildingShade()
    const mesh = bindMesh(gl, this.program, this.buffers, matrix, light, { hd, eye: relative, perMetre: exaggeration / metresPerUnit(this.origin[1]), minLinePx: MIN_LINE_PX, pixelRatio: this.map.getPixelRatio?.() ?? 1,
      sun: { frame: sun, origin: this.origin, alpha: shade ? shade.shadowAlpha * shade.groundOpacity() : 0, ground: shade?.groundShadow() ?? null, gradeBias: TOUCHDOWN.bias },
    })
    const { paintFrom, railsFrom, routesFrom } = this.ranges
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

type Served = { id: string; chain: Chain; z: number[]; groundAt: number[]; piers: number[] }

/** Where a built mesh's paint, rails and routes begin, in vertices. */
type Ranges = { paintFrom: number; railsFrom: number; routesFrom: number }

/** The basemap's colour below street zoom for a road deck of a class. */
function lowRoad(p: DeckPalette, road?: string): Rgb {
  const base = road?.replace(/_link$/, '')
  return base === 'motorway' ? p.lowHighway : base === 'trunk' || base === 'primary' ? p.lowMajor : p.lowRoad
}

/** The class of the basemap road a served deck carries: the nearest road piece to its middle, within MAX_REACH. */
function classUnder(chain: Chain, roads: Array<{ piece: Piece; bounds: Bounds }>): string | undefined {
  if (chain.kind !== 'road') return undefined
  const middle = chain.points[chain.points.length >> 1]
  let best: { road?: string; distance: number } = { distance: Math.min(MAX_REACH, Math.max(...chain.edges) + COVER) }
  for (const { piece, bounds } of roads) {
    if (!holds(bounds, middle)) continue
    const { distance } = beside(piece.points, middle)
    if (distance < best.distance) best = { road: piece.road, distance }
  }
  return best.road
}

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

/** Longitude and latitude of a mercator point. */
