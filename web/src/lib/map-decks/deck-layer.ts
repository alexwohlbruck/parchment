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
 * clears what runs underneath.
 */
import { MercatorCoordinate } from 'maplibre-gl'
import { translate } from '@/lib/map-objects/object-layer'
import {
  absorbPaths,
  beside,
  chains,
  fitEdges,
  clip,
  onEdge,
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
} from './decks'

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
  /** Source ids whose lines are routes to lay over decks. */
  routes: () => string[]
}

const VS = `
  uniform mat4 u_matrix;
  uniform vec3 u_light;
  attribute vec3 a_position;
  attribute vec3 a_normal;
  attribute vec3 a_color;
  varying vec3 v_color;
  void main() {
    float sun = dot(normalize(a_normal), u_light) * 0.5 + 0.5;
    float sky = normalize(a_normal).z * 0.5 + 0.5;
    v_color = a_color * mix(0.62, 1.0, mix(sun, sky, 0.6));
    gl_Position = u_matrix * vec4(a_position, 1.0);
  }`

const FS = `
  precision mediump float;
  varying vec3 v_color;
  void main() { gl_FragColor = vec4(v_color, 1.0); }`

/** Paint widths in metres, and the dash for a dashed line. */
const PAINT_WIDTH: Record<string, number> = { centre: 0.12, lane: 0.12, edge: 0.15, bike: 0.15, stop: 0.45 }
const DASH = { on: 3, off: 9 }

const tileBounds = (feature: any): Bounds | null => {
  const { _x: x, _y: y, _z: z } = feature
  if (typeof x !== 'number' || typeof z !== 'number') return null
  const n = 2 ** z
  return { minX: x / n, minY: y / n, maxX: (x + 1) / n, maxY: (y + 1) / n }
}

const mercator = ([lng, lat]: number[]): Point => {
  const s = Math.sin((lat * Math.PI) / 180)
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)]
}

const linesOf = (geometry: any): number[][][] =>
  geometry?.type === 'LineString' ? [geometry.coordinates]
  : geometry?.type === 'MultiLineString' ? geometry.coordinates
  : []

export class DeckLayer {
  id: string
  type = 'custom' as const
  renderingMode = '3d' as const

  private map: any
  private program!: WebGLProgram
  private buffers: { position: WebGLBuffer; normal: WebGLBuffer; color: WebGLBuffer } | null = null
  private count = 0
  private paintFrom = 0
  private origin: [number, number] = [0, 0]
  private scheduled = 0
  private onChange?: (event?: { sourceId?: string }) => void
  private pending: Mesh | null = null
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
    this.program = link(gl, VS, FS)
    const ours = () => new Set([this.sources.basemap, this.sources.paint?.source, this.map?.getTerrain?.()?.source, ...this.sources.routes()])
    // A build reads every loaded tile, so it waits for a source to finish
    // loading rather than running once per tile as they stream in.
    this.onChange = event => {
      if (!event?.sourceId || (ours().has(event.sourceId) && (event as any).isSourceLoaded)) this.invalidate()
    }
    map.on('sourcedata', this.onChange)
    map.on('moveend', this.onChange)
    this.invalidate()
  }

  onRemove(map: any, gl: WebGL2RenderingContext) {
    if (this.onChange) {
      map.off('sourcedata', this.onChange)
      map.off('moveend', this.onChange)
    }
    clearTimeout(this.scheduled)
    if (this.buffers) for (const b of Object.values(this.buffers)) gl.deleteBuffer(b)
    gl.deleteProgram(this.program)
    this.map = null
  }

  /** Rebuild between frames, once a burst of tile events settles. */
  invalidate() {
    clearTimeout(this.scheduled)
    this.scheduled = setTimeout(() => {
      if (!this.map) return
      this.pending = this.build()
      this.map.triggerRepaint?.()
    }, 200) as unknown as number
  }

  /**
   * The ground sampler the object layers use: zero with the terrain off, NaN
   * where no elevation tile has loaded yet, so a deck is not dropped to sea level.
   */
  private ground(): (p: Point) => number {
    const terrain = this.map.terrain
    if (!this.map.getTerrain?.() || !terrain?.getElevationForLngLatZoom) return () => 0
    const top = Math.min(Math.floor(this.map.getZoom()), terrain.tileManager?.maxzoom ?? 15)
    return ([x, y]) => {
      const { lng, lat } = new MercatorCoordinate(x, y).toLngLat()
      const at = { lng, lat, wrap: () => at }
      for (let z = top; z >= Math.max(0, top - 6); z--) {
        const h = terrain.getElevationForLngLatZoom(at, z)
        if (h) return h
      }
      return NaN
    }
  }

  private query(source: string, sourceLayer?: string, filter?: any[]): any[] {
    try {
      return this.map.querySourceFeatures(source, { ...(sourceLayer ? { sourceLayer } : {}), ...(filter ? { filter } : {}) })
    } catch {
      return []
    }
  }

  private build(): Mesh {
    const pieces: Piece[] = []
    const tiles: Bounds[] = []
    const bridges = this.query(this.sources.basemap, this.sources.roads, ['==', ['get', 'brunnel'], 'bridge'])
    for (const f of bridges) {
      const props = f.properties ?? {}
      const tile = tileBounds(f)
      if (tile) tiles.push(tile)
      const kind = props.class === 'rail' || props.class === 'transit' ? 'rail' : props.class === 'path' ? 'path' : 'road'
      for (const line of linesOf(f.geometry))
        for (const run of tile ? clip(line.map(mercator), tile) : [line.map(mercator)])
          pieces.push({ points: run, layer: Math.max(1, Number(props.layer) || 1), width: WIDTH[props.class] ?? 6, kind })
    }
    const center = MercatorCoordinate.fromLngLat(this.map.getCenter())
    this.origin = [center.x, center.y]
    const tolerance = 1.5 / metresPerUnit(center.y)
    // A cut where a tile meets another loaded one joins back up; one at the
    // edge of everything loaded is the only kind left.
    const loaded = tiles.reduce<Bounds | null>((u, t) => u
      ? { minX: Math.min(u.minX, t.minX), minY: Math.min(u.minY, t.minY), maxX: Math.max(u.maxX, t.maxX), maxY: Math.max(u.maxY, t.maxY) }
      : { ...t }, null)
    const paint = this.paint()
    const decks = absorbPaths(fitted(chains(pieces, p => !!loaded && onEdge(p, loaded, tolerance), tolerance), this.kerbs()))
    const ground = this.ground()
    const solved = decks.flatMap(chain => {
      const groundAt = filled(chain.points.map(ground))
      return groundAt ? [{ chain, groundAt, z: solve(chain, groundAt) }] : []
    })
    // An end left in the air because it meets another deck takes that deck's
    // height there, so a ramp lands on the road it joins. Twice, so a height
    // carries through a ramp joining a ramp.
    for (let pass = 0; pass < 2; pass++) {
      const others = solved.map(({ chain, z }) => ({ points: chain.points, z, d: along(chain.points), width: chain.width }))
      for (const [k, s] of solved.entries()) {
        const ends = [s.chain.points[0], s.chain.points[s.chain.points.length - 1]]
        const resting = ends.map((p, i) => {
          if (s.chain.grounded[i]) return null
          const [z] = onDeck([p], others.filter((_, j) => j !== k), 0)
          return z
        }) as [number | null, number | null]
        if (resting[0] !== null || resting[1] !== null) s.z = solve(s.chain, s.groundAt, resting)
      }
    }

    const p = this.palette
    const mesh: Mesh = { position: [], normal: [], color: [] }
    for (const { chain, groundAt, z } of solved)
      deckMesh(chain, z, groundAt, this.origin, { surface: p.surface, concrete: p.concrete, parapet: p.parapet }, mesh)

    const surfaces = solved.map(({ chain, z }) => ({ points: chain.points, z, d: along(chain.points), width: 2 * Math.max(...chain.edges) + 1 }))
    this.paintFrom = mesh.position.length / 3
    for (const { props, runs } of paint) {
      const color = props.color === 'yellow' ? p.yellow : p.white
      const width = PAINT_WIDTH[props.kind] ?? 0.12
      for (const run of runs)
        for (const offset of props.pattern === 'double' ? [-0.15, 0.15] : [0])
          this.strip(mesh, run, surfaces, width, color, 0.04, offset, props.pattern === 'dashed')
    }
    for (const id of this.sources.routes())
      for (const f of this.query(id))
        for (const line of linesOf(f.geometry)) {
          const points = line.map(mercator)
          this.strip(mesh, points, surfaces, 4.4, p.routeCasing, 0.06, 0, false)
          this.strip(mesh, points, surfaces, 3, p.route, 0.08, 0, false)
        }
    this.version++
    return mesh
  }

  /** The bridges' own lane paint, as runs clipped to their tiles. */
  private paint(): Paint[] {
    if (!this.sources.paint) return []
    return this.query(this.sources.paint.source, this.sources.paint.layer, ['==', ['get', 'bridge'], true]).flatMap(f => {
      const props = f.properties ?? {}
      if (!props.bridge || props.kind === 'crosswalk') return []
      const tile = tileBounds(f)
      const runs = linesOf(f.geometry).flatMap(line => (tile ? clip(line.map(mercator), tile) : [line.map(mercator)]))
      return [{ props, runs }]
    })
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

  /** Paint along a line, lifted onto the decks under it, as flat quads. */
  private strip(mesh: Mesh, points: Point[], decks: any[], width: number, color: number[], lift: number, offset: number, dashed: boolean) {
    const z = onDeck(points, decks, lift)
    let travelled = 0
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1], points[i]]
      const scale = 1 / metresPerUnit(a[1])
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1])
      const metres = seg / scale
      const za = z[i - 1]
      const zb = z[i]
      if (za === null || zb === null || seg === 0) {
        travelled += metres
        continue
      }
      const ux = (b[0] - a[0]) / seg
      const uy = (b[1] - a[1]) / seg
      const nx = -uy * scale
      const ny = ux * scale
      const pieces: Array<[number, number]> = []
      if (dashed) {
        const period = DASH.on + DASH.off
        for (let s = -(travelled % period); s < metres; s += period) pieces.push([Math.max(0, s), Math.min(metres, s + DASH.on)])
      } else pieces.push([0, metres])
      for (const [s0, s1] of pieces) {
        if (s1 <= s0) continue
        const at = (s: number, side: number) => {
          const t = s / metres
          return [
            a[0] + (b[0] - a[0]) * t + nx * (offset + side * width / 2) - this.origin[0],
            a[1] + (b[1] - a[1]) * t + ny * (offset + side * width / 2) - this.origin[1],
            (za + (zb - za) * t) * scale,
          ]
        }
        const corners = [at(s0, 1), at(s0, -1), at(s1, -1), at(s1, 1)]
        for (const tri of [[0, 1, 2], [0, 2, 3]])
          for (const k of tri) {
            mesh.position.push(...corners[k])
            mesh.normal.push(0, 0, 1)
            mesh.color.push(color[0], color[1], color[2])
          }
      }
      travelled += metres
    }
  }

  render(gl: WebGL2RenderingContext, args: any) {
    if (this.pending) {
      if (this.buffers) for (const b of Object.values(this.buffers)) gl.deleteBuffer(b)
      const upload = (data: number[]) => {
        const buffer = gl.createBuffer()!
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW)
        return buffer
      }
      this.buffers = { position: upload(this.pending.position), normal: upload(this.pending.normal), color: upload(this.pending.color) }
      this.count = this.pending.position.length / 3
      this.pending = null
    }
    if (!this.buffers || !this.count) return

    const matrix = args?.defaultProjectionData?.mainMatrix ?? args?.modelViewProjectionMatrix ?? args
    const shifted = translate(matrix, [this.origin[0], this.origin[1], 0])
    gl.useProgram(this.program)
    gl.uniformMatrix4fv(gl.getUniformLocation(this.program, 'u_matrix'), false, shifted)
    const light = this.map.style?.light?.getCartesianPosition?.() ?? [0.4, -0.6, 0.7]
    const l = Math.hypot(light[0], light[1], light[2]) || 1
    gl.uniform3f(gl.getUniformLocation(this.program, 'u_light'), light[0] / l, light[1] / l, light[2] / l)
    gl.bindVertexArray(null)
    const attach = (name: string, buffer: WebGLBuffer) => {
      const loc = gl.getAttribLocation(this.program, name)
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0)
      return loc
    }
    const locs = [
      attach('a_position', this.buffers.position),
      attach('a_normal', this.buffers.normal),
      attach('a_color', this.buffers.color),
    ]
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.depthMask(true)
    gl.disable(gl.CULL_FACE)
    gl.disable(gl.BLEND)
    gl.drawArrays(gl.TRIANGLES, 0, this.paintFrom)
    // Paint and routes sit a few centimetres over the asphalt; the offset keeps
    // them in front of it at any distance.
    gl.enable(gl.POLYGON_OFFSET_FILL)
    gl.polygonOffset(-2, -2)
    gl.drawArrays(gl.TRIANGLES, this.paintFrom, this.count - this.paintFrom)
    gl.disable(gl.POLYGON_OFFSET_FILL)
    for (const loc of locs) gl.disableVertexAttribArray(loc)
  }
}

type Paint = { props: Record<string, any>; runs: Point[][] }

/** Each road deck fitted to the kerbs nearest it, so a deck and its twin do not take each other's. */
function fitted(decks: Chain[], kerbs: Point[]): Chain[] {
  const roads = decks.filter(d => d.kind === 'road')
  const owned = new Map<Chain, Point[]>()
  for (const q of kerbs) {
    let nearest: Chain | null = null
    let distance = Infinity
    for (const road of roads) {
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

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram()!
  for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    gl.attachShader(program, shader)
  }
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) console.error('[decks] link:', gl.getProgramInfoLog(program))
  return program
}
