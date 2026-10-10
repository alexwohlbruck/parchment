/**
 * Road tunnels drawn in 3D: under the terrain, and opening out of it.
 *
 * A MapLibre custom layer. The terrain is opaque and draws first, so a bore
 * placed under it is hidden as it would be in life; what shows is each portal.
 * The terrain cannot be cut, so the layer masks a hole in what it drew: the
 * lid of each cut is marked in the stencil where the ground in front does not
 * hide it, the depth there is reset to the far plane, and the cut is drawn
 * inside the mark — walls, ramp, lane paint, headwall and the bore going dark.
 *
 * Only drawn with the terrain on, from street zoom; the flat tunnels below it.
 */
import { MercatorCoordinate } from 'maplibre-gl'
import { translate } from '@/lib/map-objects/object-layer'
import { along, boundsOf, chains, clip, dedupe, densify, edgePoints, holds, linesOf, meets, mercator, metresPerUnit, onEdge, polygonsOf, tileBounds, type Bounds, type Mesh, type Piece, type Point } from '@/lib/map-decks/decks'
import { terrainSampler, type TerrainSampler } from '@/lib/map-decks/ground'
import { layPaint, paintOf, strip, type Surface } from '@/lib/map-decks/paint'
import { bindMesh, deleteMesh, linkMeshProgram, uploadMesh, type MeshBuffers } from '@/lib/map-decks/mesh-program'
import type { DeckPalette } from '@/lib/map-decks/deck-layer'
import { idle, queryFeatures } from '@/lib/map-decks/map-query'
import { TUNNEL_MIN_ZOOM, UNDERGROUND } from './flat-tunnels'
import { BORE, COVER_AT, CUT_MAX, KERB, RIM, approach, emerge, inside, measureEdges, portalLine, portalMesh, solveCut, truncate, type Approach, type Cut } from './tunnels'

/** Carriageway widths by OpenMapTiles class, in metres, for a road with no surface to measure. */
const WIDTH: Record<string, number> = { motorway: 11, trunk: 10, primary: 9, secondary: 8, tertiary: 7, minor: 6, service: 4 }
const ROAD_CLASSES = Object.keys(WIDTH)

/** Metres between samples along a cut, and how far down the approach its width is measured. */
const SAMPLE = 3
const MEASURE = 40
const REBASE = 1e-3
const CACHE = 400

export type TunnelSources = {
  /** The basemap source and its road layer. */
  basemap: string
  roads: string
  /** Barrelman's lane paint, laid on the floor of each cut; optional. */
  paint?: { source: string; layer: string }
  /** Barrelman's carriageways at their real width, which the cuts are fitted to. */
  surfaces?: { source: string; layer: string }
  /** Source ids whose lines are routes to lay through the cuts. */
  routes: () => string[]
  /** Where the style draws buildings, whose faces a covered portal opens at. */
  buildings: () => Array<{ source: string; sourceLayer: string }>
}

type Solved = { points: Point[]; at: number; edges: [number, number]; cut: Cut }

const emptyMesh = (): Mesh => ({ position: [], normal: [], color: [] })

type Built = { inside: Mesh; lid: Mesh; outside: Mesh; earth: Mesh; paintFrom: number }

const emptyBuilt = (): Built => ({ inside: emptyMesh(), lid: emptyMesh(), outside: emptyMesh(), earth: emptyMesh(), paintFrom: 0 })

export class TunnelLayer {
  id: string
  type = 'custom' as const
  renderingMode = '3d' as const

  private map: any
  private program!: WebGLProgram
  private buffers: { inside: MeshBuffers; lid: MeshBuffers; outside: MeshBuffers; earth: MeshBuffers; paintFrom: number } | null = null
  private pending: Built | null = null
  private origin: Point = [0, 0]
  private scheduled = 0
  private cancelIdle?: () => void
  private onChange?: (event?: any) => void
  private onTerrain?: () => void
  private sampler: TerrainSampler | null = null
  /** Each portal's solved cut, keyed by its line and width. */
  private cuts = new Map<string, Solved>()
  /** The ground's colour behind each portal, once read off the map. */
  private earth = new Map<string, number[]>()
  private built = ''
  private stale = true

  constructor(private sources: TunnelSources, private palette: DeckPalette, options: { id?: string } = {}) {
    this.id = options.id ?? 'map-tunnels'
  }

  setPalette(palette: DeckPalette) {
    this.palette = palette
    this.invalidate()
  }

  onAdd(map: any, gl: WebGL2RenderingContext) {
    this.map = map
    this.program = linkMeshProgram(gl)
    const tiled = new Set([this.sources.basemap, this.sources.paint?.source, this.sources.surfaces?.source])
    this.onChange = event => {
      if (!event?.sourceId) {
        const c = MercatorCoordinate.fromLngLat(this.map.getCenter())
        if (Math.abs(c.x - this.origin[0]) >= REBASE || Math.abs(c.y - this.origin[1]) >= REBASE) this.invalidate()
        else this.invalidate(false)
      } else if (!event.isSourceLoaded) return
      else if (tiled.has(event.sourceId)) this.invalidate(false)
      else if (this.sources.routes().includes(event.sourceId)) this.invalidate()
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


  /** Basemap roads of the drawn classes as lines clipped to their tiles, one copy each. */
  private roads(brunnel: 'tunnel' | null): Piece[] {
    const filter = ['all', ['in', ['get', 'class'], ['literal', ROAD_CLASSES]],
      ...(brunnel ? [['==', ['get', 'brunnel'], brunnel], UNDERGROUND] : [['!', ['has', 'brunnel']]])]
    const pieces: Piece[] = []
    for (const f of this.query(this.sources.basemap, this.sources.roads, filter)) {
      const props = f.properties ?? {}
      const tile = tileBounds(f)
      for (const line of linesOf(f.geometry))
        for (const run of tile ? clip(line.map(mercator), tile) : [line.map(mercator)])
          pieces.push({ points: run, layer: 1, width: WIDTH[props.class] ?? 6, kind: 'road', zoom: f._z, tile: tile ?? undefined })
    }
    return dedupe(pieces)
  }

  private build(): Built | null {
    const center = MercatorCoordinate.fromLngLat(this.map.getCenter())
    const zoom = this.map.getZoom()
    const tunnels = zoom >= TUNNEL_MIN_ZOOM ? this.roads('tunnel') : []
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
      return { line, width: bore.width, bounds: boundsOf([line[0]], CUT_MAX) }
    }))
    if (!portals.length) return empty
    const area = portals.slice(1).reduce((u, { bounds: b }) =>
      ({ minX: Math.min(u.minX, b.minX), minY: Math.min(u.minY, b.minY), maxX: Math.max(u.maxX, b.maxX), maxY: Math.max(u.maxY, b.maxY) }), portals[0].bounds)
    const roads = this.roads(null).map(p => p.points).filter(line => meets(boundsOf(line), area))
    const rings = this.surfaceRings(area)
    const footprints = this.footprints(area)
    const covered = (q: Point) => footprints.some(f => holds(f.bounds, q) && inside(q, f.rings))

    const solved: Solved[] = []
    for (const { line, width } of portals) {
      const found = approach(line[0], line[1], roads, tolerance)
      const moved = found.points.length > 1 ? emerge(found.points, line, covered) : null
      if (!moved || moved.out.length < 2) continue
      const out = { ...found, points: moved.out }
      const edges = measureEdges(densify(truncate(out.points, MEASURE), SAMPLE), rings) ?? [width / 2, width / 2]
      const cut = this.solve(out, truncate(moved.bore, BORE), edges)
      if (cut) solved.push(cut)
    }

    const exaggeration = this.map.getTerrain?.()?.exaggeration ?? 1
    const p = this.palette
    const colors = { surface: p.surface, concrete: p.concrete, parapet: p.parapet, bore: p.concrete, ground: p.parapet }
    const mesh = emptyBuilt()
    const surfaces: Surface[] = []
    for (const s of solved) {
      const scaled = { ...s.cut, floor: s.cut.floor.map(z => z * exaggeration), walls: s.cut.walls.map(w => w.map(z => z * exaggeration)) as [number[], number[]] }
      portalMesh(s.points, s.at, s.edges, scaled, this.origin, { ...colors, ground: this.groundColor(s.points[s.cut.roof]) ?? colors.ground }, mesh)
      const points = s.points.slice(s.cut.open, s.at + 1)
      const width = 2 * Math.max(...s.edges)
      if (points.length > 1) surfaces.push({ points, z: scaled.floor.slice(s.cut.open, s.at + 1), d: along(points), width, bounds: boundsOf(points, width) })
    }
    mesh.paintFrom = mesh.inside.position.length / 3
    layPaint(mesh.inside, this.paint(surfaces), surfaces, p, this.origin)
    for (const id of this.sources.routes())
      for (const f of this.query(id))
        for (const line of linesOf(f.geometry)) {
          const points = line.map(mercator)
          strip(mesh.inside, points, surfaces, 4.4, p.routeCasing, 0.06, 0, false, this.origin)
          strip(mesh.inside, points, surfaces, 3, p.route, 0.08, 0, false, this.origin)
        }
    return mesh
  }

  /** A portal's cut, from the ground along it; kept once read, null while the ground loads. */
  private solve(out: Approach, bore: Point[], edges: [number, number]): Solved | null {
    const sampler = terrainSampler(this.map, this.sampler, () => this.invalidate())
    if (sampler !== this.sampler) this.cuts.clear()
    this.sampler = sampler
    if (!sampler) return null
    const key = `${edges.map(e => e.toFixed(1))}|${out.junction}|${[...out.points, ...bore].map(q => `${Math.round(q[0] * 2 ** 26)},${Math.round(q[1] * 2 ** 26)}`).join(';')}`
    const known = this.cuts.get(key)
    if (known) return known
    const { points, at } = portalLine(out.points, bore, SAMPLE)
    const height = (q: Point) => sampler.ground.at(q)
    const centre = points.map(height)
    const sides = RIM.map(r => edgePoints({ points, edges: [edges[0] + KERB + r, edges[1] + KERB + r] } as any))
    const rims = [0, 1].map(k => points.map((_, i) => {
      const heights = sides.map(side => height(side[k][i]))
      if (heights.some(g => g === null)) return null
      const known = (heights as number[]).filter(g => !Number.isNaN(g)).sort((a, b) => a - b)
      return known.length ? known[Math.floor(known.length / 2)] : NaN
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
    const cut = solveCut(d, at, ground, [fill(rims[0]), fill(rims[1])], over.length ? Math.max(...over) : ground[at], out.junction)
    if (!cut || cut.open >= at) return null
    const solved = { points, at, edges, cut }
    if (this.cuts.size >= CACHE) this.cuts.delete(this.cuts.keys().next().value!)
    this.cuts.set(key, solved)
    return solved
  }

  /**
   * The colour the map draws at a point — its background, under whatever
   * fills it shows there — brightened to undo the shading this layer gives an
   * upward face, so earth drawn there matches the unlit ground around it.
   * Kept once read on screen; until then, the background alone.
   */
  private groundColor(q: Point): number[] | null {
    const key = `${q[0].toFixed(8)},${q[1].toFixed(8)}`
    const known = this.earth.get(key)
    if (known) return known
    const style = this.map.style
    const background = (this.map.getStyle()?.layers ?? []).find((l: any) => l.type === 'background')
    const base = background ? style?._layers?.[background.id]?.paint?.get?.('background-color') : null
    if (!base) return null
    let color = [base.r, base.g, base.b]
    const lngLat = new MercatorCoordinate(q[0], q[1]).toLngLat()
    const { x, y } = this.map.project(lngLat)
    const canvas = this.map.getCanvas()
    const seen = x >= 0 && y >= 0 && x <= canvas.clientWidth && y <= canvas.clientHeight
    if (seen)
      for (const f of this.map.queryRenderedFeatures([x, y]).filter((f: any) => f.layer.type === 'fill').reverse()) {
        const fill = f.layer.paint?.['fill-color']
        if (!fill || typeof fill !== 'object') continue
        const alpha = (f.layer.paint?.['fill-opacity'] ?? 1) * (fill.a ?? 1)
        const rgb = fill.a ? [fill.r / fill.a, fill.g / fill.a, fill.b / fill.a] : [fill.r, fill.g, fill.b]
        color = color.map((c, k) => c * (1 - alpha) + rgb[k] * alpha)
      }
    const light = style?.light?.getCartesianPosition?.() ?? [0.4, -0.6, 0.7]
    const sun = (light[2] / (Math.hypot(light[0], light[1], light[2]) || 1)) * 0.5 + 0.5
    const shade = 0.62 + 0.38 * (sun * 0.4 + 0.6)
    const ground = color.map(c => Math.min(1, c / shade))
    if (seen) this.earth.set(key, ground)
    return ground
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

  /** The markings on the roads at grade that run down into a cut. */
  private paint(surfaces: Surface[]) {
    if (!this.sources.paint || !surfaces.length) return []
    const { source, layer } = this.sources.paint
    return this.query(source, layer, ['!=', ['get', 'bridge'], true])
      .filter(f => linesOf(f.geometry).concat(polygonsOf(f.geometry).flat()).some(line =>
        surfaces.some(s => meets(boundsOf(line.map(mercator)), s.bounds!))))
      .map(paintOf)
  }

  private release(gl: WebGL2RenderingContext) {
    if (!this.buffers) return
    deleteMesh(gl, this.buffers.inside)
    deleteMesh(gl, this.buffers.lid)
    deleteMesh(gl, this.buffers.outside)
    deleteMesh(gl, this.buffers.earth)
    this.buffers = null
  }

  render(gl: WebGL2RenderingContext, args: any) {
    if (this.pending) {
      this.release(gl)
      const { inside, lid, outside, earth, paintFrom } = this.pending
      this.buffers = { inside: uploadMesh(gl, inside), lid: uploadMesh(gl, lid), outside: uploadMesh(gl, outside), earth: uploadMesh(gl, earth), paintFrom }
      this.pending = null
    }
    if (!this.buffers?.lid.count) return

    const projection = args?.defaultProjectionData?.mainMatrix ?? args?.modelViewProjectionMatrix ?? args
    const matrix = translate(projection, [this.origin[0], this.origin[1], 0])
    const light = this.map.style?.light?.getCartesianPosition?.() ?? [0.4, -0.6, 0.7]
    const [near, far] = gl.getParameter(gl.DEPTH_RANGE) as Float32Array
    gl.enable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.disable(gl.BLEND)
    gl.enable(gl.STENCIL_TEST)
    gl.stencilMask(0xff)
    gl.clearStencil(0)
    gl.clear(gl.STENCIL_BUFFER_BIT)

    // Mark the lid wherever nothing drawn so far stands in front of it…
    const lid = bindMesh(gl, this.program, this.buffers.lid, matrix, light)
    gl.colorMask(false, false, false, false)
    gl.depthMask(false)
    gl.depthFunc(gl.LEQUAL)
    gl.stencilFunc(gl.ALWAYS, 1, 0xff)
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE)
    lid.draw()
    // …and clear the depth there, so the cut can be drawn below the ground.
    gl.depthMask(true)
    gl.depthFunc(gl.ALWAYS)
    gl.depthRange(far, far)
    gl.stencilFunc(gl.EQUAL, 1, 0xff)
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP)
    lid.draw()
    lid.unbind()
    gl.depthRange(near, far)
    gl.colorMask(true, true, true, true)
    gl.depthFunc(gl.LEQUAL)

    const inside = bindMesh(gl, this.program, this.buffers.inside, matrix, light)
    inside.draw(0, this.buffers.paintFrom)
    gl.enable(gl.POLYGON_OFFSET_FILL)
    gl.polygonOffset(-2, -2)
    inside.draw(this.buffers.paintFrom)
    gl.disable(gl.POLYGON_OFFSET_FILL)
    inside.unbind()

    if (this.buffers.earth.count) {
      gl.stencilFunc(gl.NOTEQUAL, 1, 0xff)
      const earth = bindMesh(gl, this.program, this.buffers.earth, matrix, light)
      earth.draw()
      earth.unbind()
    }
    gl.clear(gl.STENCIL_BUFFER_BIT)
    gl.disable(gl.STENCIL_TEST)
    if (this.buffers.outside.count) {
      const outside = bindMesh(gl, this.program, this.buffers.outside, matrix, light)
      outside.draw()
      outside.unbind()
    }
  }
}
