/**
 * Repeated 3D objects: trees, and the street furniture beside them.
 *
 * The shape of the problem is instancing. A city block holds hundreds of street
 * trees and a viewport can hold thousands, so one draw call per tree is out;
 * what works is one model, uploaded once, drawn `N` times from a buffer of
 * per-object transforms (`drawElementsInstanced`, core in WebGL2). That is the
 * standard answer for scattered repeated geometry, and everything else here
 * follows from keeping it to a handful of draws:
 *
 *   roles      A primitive carries a role (`bark`, `foliage`, `metal`, …)
 *              rather than a colour, and the role is resolved to a colour by
 *              flavor at draw time. So the night map is a uniform change, not
 *              a second set of models.
 *   LOD        Every model has a cheap far variant. Objects beyond a screen
 *              distance are drawn with it, which is what lets the layer keep
 *              drawing trees out to the horizon instead of culling them.
 * The alternative, three.js behind MapLibre's `CustomLayerInterface`, is the
 * more commonly written one and would have cost ~150KB gzipped. It would also
 * have been a dead end for the native apps: MapLibre Native has no 3D model
 * support and its custom drawable layers are C++, so nothing written against a
 * JS scene graph ports. What does port is everything in this file that is not
 * GL — the models, the roles, and the tag rules that shape an instance.
 *
 * Precision is why positions are stored relative to an origin. Mercator world
 * coordinates run 0–1 across the planet, and float32 holds about seven digits,
 * which lands at roughly four metres of quantisation — visible as objects
 * snapping between positions as you pan. Subtracting a per-refresh origin and
 * folding it back into the matrix keeps the numbers small.
 *
 * Objects are read from the same vector source their flat form is drawn from,
 * so the two cannot disagree about what exists.
 */
import { MercatorCoordinate } from 'maplibre-gl'
import type { GlbModel } from './glb.mjs'

/** The suffix `build-3d-objects.mjs` puts on every cheap variant. */
export const FAR_SUFFIX = '-far'

/**
 * How far from the centre of the view an object may be, in ground pixels,
 * before it is drawn with its far model.
 *
 * Ground pixels rather than metres so the rule holds at every zoom: this is
 * roughly "past the first screenful", which at any tilt is where a tree stops
 * resolving into a trunk and a canopy.
 */
const NEAR_PIXELS = 850

/**
 * How long a burst of source events has to go quiet before the scene is
 * rebuilt, and the longest a continuous burst may hold that off. Milliseconds.
 */
const SETTLE = 80
const AT_MOST = 300

/** Mercator units per CSS pixel at a given zoom — MapLibre's 512px tile grid. */
const mercatorPerPixel = (zoom: number) => 1 / (512 * 2 ** zoom)

/** The sphere MapLibre projects onto, in metres. */
const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6371008.8

/**
 * Project one object, without allocating.
 *
 * The same numbers `MercatorCoordinate.fromLngLat` and
 * `meterInMercatorCoordinateUnits` produce, and `map-objects.test.ts` holds
 * them to that — this exists only to avoid the two objects and the round trip
 * back through `latFromMercatorY` that the pair costs per call. That is
 * nothing once, and a measurable share of a rebuild across a few thousand
 * trees, which is work done while somebody is panning.
 */
export function project(lng: number, lat: number, elevation: number, out: Placed) {
  const perMetre = 1 / (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180))
  out.x = (180 + lng) / 360
  out.y = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360
  out.z = elevation * perMetre
  out.perMetre = perMetre
}

const VS = `
  uniform mat4 u_matrix;
  uniform vec3 u_light;
  uniform float u_ambient;
  uniform vec3 u_color;

  attribute vec3 a_position;
  attribute vec3 a_normal;
  /** Instance: mercator position, relative to the layer's current origin. */
  attribute vec3 a_offset;
  /** Instance: height and lateral scale in mercator units, plus a heading. */
  attribute vec3 a_shape;
  /** Instance: a per-object brightness, so a stand of trees is not one colour. */
  attribute float a_shade;

  varying vec3 v_color;

  void main() {
    float c = cos(a_shape.z);
    float s = sin(a_shape.z);

    // glTF is Y-up and the map is Z-up. The asset keeps the standard
    // orientation so it opens correctly in any viewer; the swap happens here.
    vec3 p = vec3(a_position.x, -a_position.z, a_position.y);
    vec3 n = vec3(a_normal.x, -a_normal.z, a_normal.y);

    p = vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
    n = vec3(n.x * c - n.y * s, n.x * s + n.y * c, n.z);

    vec3 world = a_offset + vec3(p.xy * a_shape.y, p.z * a_shape.x);

    vec3 unit = normalize(n);
    // Half-lambert: a plain dot product leaves every face turned away from the
    // sun flat black, which at this size reads as a hole rather than as shade.
    float sun = dot(unit, u_light) * 0.5 + 0.5;
    // Sky light. The top of a crown sees the whole sky and its underside sees
    // the ground, so up is bright and down is dark whatever the sun is doing.
    //
    // Weighted over the sun, not added to it, and that is the point: with the
    // sun alone the shading followed its azimuth, so a low sun put the dark
    // side of every crown at the top of the screen and a map full of trees read
    // as inside-out from above. Sky light does not have an azimuth, so it
    // cannot. The sun still sets which flank is brighter — it just no longer
    // decides whether the top or the bottom of a tree is lit.
    float sky = unit.z * 0.5 + 0.5;
    float lit = mix(sun, sky, 0.65);
    v_color = u_color * a_shade * mix(u_ambient, 1.0, lit);

    gl_Position = u_matrix * vec4(world, 1.0);
  }`

const FS = `
  precision mediump float;
  varying vec3 v_color;
  void main() { gl_FragColor = vec4(v_color, 1.0); }`

const LOC = { a_position: 0, a_normal: 1, a_offset: 2, a_shape: 3, a_shade: 4 }

/** What a primitive is made of, which is how it gets its colour. */
export type ObjectRole = 'bark' | 'foliage' | 'metal' | 'wood' | 'paint'

export type ObjectPalette = Record<string, [number, number, number]>

/** One object read out of the source, in the units the shader wants. */
export type ObjectInstance = {
  lng: number
  lat: number
  /** Metres. */
  height: number
  /** Metres, across. */
  spread: number
  /** Radians. */
  heading: number
  /** Multiplier on the model's own colours. */
  shade: number
  /** Which model to draw it with. */
  model: string
}

export type ObjectSourceSpec = {
  source: string
  sourceLayer: string
  /** Below this the objects are too small to be worth the draw. */
  minzoom: number
  /**
   * Where a feature puts its objects. Points give one; lines are walked, which
   * is how a `tree_row` becomes a row of trees.
   */
  positions?: (feature: any) => Array<[number, number]>
  /** Turns one position into an instance, or null to skip it. */
  toInstance: (feature: any, lng: number, lat: number, index: number) => ObjectInstance | null
}

type ModelBuffers = {
  primitives: Array<{
    position: WebGLBuffer
    normal: WebGLBuffer
    index: WebGLBuffer
    count: number
    indexType: number
    role: string
    color: [number, number, number]
  }>
}

type Batch = {
  model: string
  offset: Float32Array
  shape: Float32Array
  shade: Float32Array
  count: number
  /**
   * Uploaded on the first frame that draws this batch, and not again.
   *
   * The GPU buffers are created here rather than shared across batches because
   * a shared buffer has to be refilled before every batch, which meant a
   * `bufferData` per batch per frame for data that only changes when the view
   * does. GL is touched only inside `render`, so the arrays are built off the
   * render path and handed over here.
   */
  buffers: { offset: WebGLBuffer; shape: WebGLBuffer; shade: WebGLBuffer } | null
}

/**
 * One object, with everything that does not depend on where the camera is
 * already worked out.
 *
 * Mercator position and the metres-to-mercator scale are held here because
 * they are the expensive part — `MercatorCoordinate.fromLngLat` twice per
 * object, plus the tag parsing and hashing behind `toInstance` — and none of it
 * changes when you pan. Only the near/far choice does.
 */
export type Placed = {
  instance: ObjectInstance
  x: number
  y: number
  /** Ground height in mercator units, which is how an object stands on terrain. */
  z: number
  perMetre: number
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    console.error('[objects]', gl.getShaderInfoLog(shader))
  return shader
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const program = gl.createProgram()!
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vs))
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fs))
  for (const [name, loc] of Object.entries(LOC)) gl.bindAttribLocation(program, loc, name)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    console.error('[objects] link:', gl.getProgramInfoLog(program))
  return program
}

function uniformsOf(gl: WebGL2RenderingContext, program: WebGLProgram, names: string[]) {
  return Object.fromEntries(names.map(n => [n, gl.getUniformLocation(program, n)]))
}

/** Default positions: a point feature stands where it is. */
function pointPositions(feature: any): Array<[number, number]> {
  const coords = feature.geometry?.coordinates
  return coords && typeof coords[0] === 'number' ? [[coords[0], coords[1]]] : []
}

/**
 * A MapLibre custom layer drawing one model per object, instanced.
 *
 * `renderingMode` is '3d' because these are solids that have to interleave with
 * the buildings in the depth buffer — a tree in front of a tower hides part of
 * it, and a tree behind one is hidden.
 */
export class ObjectLayer {
  id: string
  type = 'custom' as const
  renderingMode = '3d' as const

  private map: any
  private program!: WebGLProgram
  private uniforms: Record<string, WebGLUniformLocation | null> = {}
  private models = new Map<string, ModelBuffers>()
  private batches: Batch[] = []
  private retired: Array<{ offset: WebGLBuffer; shape: WebGLBuffer; shade: WebGLBuffer }> = []
  private placed: Placed[] = []
  private origin: [number, number, number] = [0, 0, 0]
  /** Zoom the current `placed` was gathered at; a change re-runs the gate. */
  private gatheredZoom = NaN
  private needsGather = true
  private needsArrange = true
  private scheduled = 0
  private pendingSince = 0
  private onSourceData?: (event: { sourceId?: string }) => void
  private onMoveEnd?: () => void

  constructor(
    private specs: ObjectSourceSpec[],
    private sources: Record<string, GlbModel>,
    private palette: ObjectPalette,
    options: { id?: string } = {},
  ) {
    this.id = options.id ?? 'map-objects'
  }

  /**
   * Retint every role for the flavor, without touching a vertex.
   *
   * An object standing on the night map has to read as part of it: the same
   * green that looks like a tree against pale ground looks like a hole cut in a
   * dark one. Because colour lives in a uniform rather than in the model, this
   * is a single call and takes effect on the next frame.
   */
  setFlavor(palette: ObjectPalette) {
    this.palette = palette
    for (const model of this.models.values())
      for (const p of model.primitives) p.color = palette[p.role] ?? p.color
    this.map?.triggerRepaint?.()
  }

  onAdd(map: any, gl: WebGL2RenderingContext) {
    this.map = map

    this.program = link(gl, VS, FS)
    this.uniforms = uniformsOf(gl, this.program, ['u_matrix', 'u_light', 'u_ambient', 'u_color'])

    for (const [name, model] of Object.entries(this.sources)) {
      this.models.set(name, {
        primitives: model.primitives.map(p => ({
          position: this.upload(gl, gl.ARRAY_BUFFER, p.position),
          normal: this.upload(gl, gl.ARRAY_BUFFER, p.normal),
          index: this.upload(gl, gl.ELEMENT_ARRAY_BUFFER, p.index),
          count: p.index.length,
          indexType: p.index.BYTES_PER_ELEMENT === 4 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
          role: p.material,
          color: this.palette[p.material] ?? [p.color[0], p.color[1], p.color[2]],
        })),
      })
    }

    // The source arrives asynchronously and changes as you pan, so the instance
    // list is rebuilt rather than collected once.
    //
    // Only our own sources count. `sourcedata` fires for every tile of every
    // source in the style — basemap, terrain, transit — and the basemap alone
    // streams an order of magnitude more tiles than these three do, so an
    // unfiltered handler rebuilt the whole scene several times a second for
    // events that could not possibly have changed a tree.
    const ours = new Set(this.specs.map(s => s.source))
    this.onSourceData = event => {
      if (!event?.sourceId || ours.has(event.sourceId)) this.invalidate(true)
    }
    // Panning does not change which objects exist, only which of them are far
    // enough away to draw cheaply — so it asks for the cheap half of the work.
    this.onMoveEnd = () => this.invalidate(this.map.getZoom() !== this.gatheredZoom)
    map.on('sourcedata', this.onSourceData)
    map.on('moveend', this.onMoveEnd)
    // The tiles are usually already loaded when the layer is added — turning
    // the setting on mid-session is the common case — and neither event would
    // fire again on their own.
    this.invalidate(true)
  }

  /**
   * Queue a rebuild, coalescing the burst of events that caused it.
   *
   * Two things happen here, and both were needed to stop the map stuttering.
   *
   * It runs between frames rather than inside `render`. Gathering costs a few
   * milliseconds with a few thousand trees in view, and spending that inside
   * the render pass turns every tile that arrives during a pan into a dropped
   * frame. Deferred, the pending frame draws the previous scene and nothing
   * stalls; the objects are then a moment stale, which at a tree's size nobody
   * can see.
   *
   * And it waits for the burst to end. A source fires `sourcedata` twice per
   * tile, so panning across a city asked for about a hundred rebuilds where two
   * or three would have drawn exactly the same thing. `SETTLE` collapses those;
   * `AT_MOST` caps how long that can go on, so a long continuous pan keeps
   * planting trees as it goes rather than leaving them all until you stop.
   */
  private invalidate(gather: boolean) {
    this.needsGather ||= gather
    this.needsArrange = true
    const now = performance.now()
    if (!this.scheduled) this.pendingSince = now
    else clearTimeout(this.scheduled)
    const wait = Math.max(0, Math.min(SETTLE, AT_MOST - (now - this.pendingSince)))
    this.scheduled = setTimeout(() => {
      this.scheduled = 0
      if (!this.map) return
      if (this.needsGather) this.gather()
      if (this.needsArrange) this.arrange()
      this.map.triggerRepaint?.()
    }, wait) as unknown as number
  }

  private upload(gl: WebGL2RenderingContext, target: number, data: ArrayBufferView) {
    const buffer = gl.createBuffer()!
    gl.bindBuffer(target, buffer)
    gl.bufferData(target, data, gl.STATIC_DRAW)
    return buffer
  }

  onRemove(map: any, gl: WebGL2RenderingContext) {
    if (this.onSourceData) map.off('sourcedata', this.onSourceData)
    if (this.onMoveEnd) map.off('moveend', this.onMoveEnd)
    if (this.scheduled) clearTimeout(this.scheduled)
    this.scheduled = 0
    this.map = null
    gl.deleteProgram(this.program)
    for (const model of this.models.values())
      for (const p of model.primitives) {
        gl.deleteBuffer(p.position)
        gl.deleteBuffer(p.normal)
        gl.deleteBuffer(p.index)
      }
    for (const batch of this.batches) if (batch.buffers) this.retired.push(batch.buffers)
    for (const buffers of this.retired)
      for (const buffer of Object.values(buffers)) gl.deleteBuffer(buffer)
    this.batches = []
    this.retired = []
  }

  /**
   * Read every object the sources currently hold, and place it.
   *
   * The expensive half, and the one that only depends on the data: reading the
   * features, turning each into an instance — which parses OSM tags and hashes
   * an id — and projecting it. Panning cannot change any of it, so this runs
   * when a tile arrives or the zoom crosses a source's `minzoom`, and `arrange`
   * does the rest.
   *
   * `querySourceFeatures` returns each feature once per tile it appears in, so
   * an object on a tile boundary would otherwise be drawn twice — hence the id
   * set. Objects with no id are kept: a duplicate is better than a hole.
   */
  private gather() {
    this.needsGather = false
    const zoom = this.map.getZoom()
    this.gatheredZoom = zoom
    this.placed = []

    const terrain = this.map.getTerrain?.() ? this.map : null
    const seen = new Set<string>()

    for (const spec of this.specs) {
      if (zoom < spec.minzoom) continue
      let features: any[] = []
      try {
        features = this.map.querySourceFeatures(spec.source, { sourceLayer: spec.sourceLayer })
      } catch {
        continue
      }
      const positions = spec.positions ?? pointPositions
      for (const feature of features) {
        const key = feature.id ?? feature.properties?.id
        if (key !== undefined) {
          const scoped = `${spec.sourceLayer}:${key}`
          if (seen.has(scoped)) continue
          seen.add(scoped)
        }
        const places = positions(feature)
        for (let i = 0; i < places.length; i++) {
          const [lng, lat] = places[i]
          const instance = spec.toInstance(feature, lng, lat, i)
          if (!instance) continue
          const elevation = terrain ? (terrain.queryTerrainElevation([lng, lat]) ?? 0) : 0
          const placed: Placed = { instance, x: 0, y: 0, z: 0, perMetre: 0 }
          project(lng, lat, elevation, placed)
          this.placed.push(placed)
        }
      }
    }
  }

  /**
   * Sort the placed objects into per-model batches around the current view.
   *
   * The cheap half: one pass with no allocation per object beyond the typed
   * arrays themselves. Objects past `NEAR_PIXELS` are moved onto the model's
   * far variant, which is what lets the layer keep drawing out to the horizon —
   * both halves share a buffer layout, so it costs one more draw call rather
   * than a second code path.
   *
   */
  private arrange() {
    this.needsArrange = false
    const zoom = this.map.getZoom()
    const origin = MercatorCoordinate.fromLngLat(this.map.getCenter(), 0)
    this.origin = [origin.x, origin.y, 0]

    const nearLimit = NEAR_PIXELS * mercatorPerPixel(zoom)
    const nearLimitSquared = nearLimit * nearLimit

    const buckets = new Map<string, Placed[]>()
    for (const p of this.placed) {
      const model = p.instance.model
      const far = `${model}${FAR_SUFFIX}`
      const dx = p.x - origin.x
      const dy = p.y - origin.y
      const which =
        this.models.has(far) && dx * dx + dy * dy > nearLimitSquared ? far : model
      const list = buckets.get(which)
      if (list) list.push(p)
      else buckets.set(which, [p])
    }

    for (const batch of this.batches) if (batch.buffers) this.retired.push(batch.buffers)

    this.batches = []
    for (const [model, group] of buckets) {
      if (!this.models.has(model)) continue
      const offset = new Float32Array(group.length * 3)
      const shape = new Float32Array(group.length * 3)
      const shade = new Float32Array(group.length)
      for (let i = 0; i < group.length; i++) {
        const { instance, x, y, z, perMetre } = group[i]
        offset[i * 3] = x - origin.x
        offset[i * 3 + 1] = y - origin.y
        offset[i * 3 + 2] = z
        shape[i * 3] = instance.height * perMetre
        shape[i * 3 + 1] = instance.spread * perMetre
        shape[i * 3 + 2] = instance.heading
        shade[i] = instance.shade
      }
      this.batches.push({ model, offset, shape, shade, count: group.length, buffers: null })
    }
  }

  /** How many objects are drawn right now, and with which model. Dev only. */
  get drawn(): Array<{ model: string; count: number }> {
    return this.batches.map(b => ({ model: b.model, count: b.count }))
  }

  render(gl: WebGL2RenderingContext, args: any) {
    // Buffers a rebuild replaced. Freed here rather than where they are
    // retired, because `arrange` runs between frames and deleting a bound
    // buffer there would unbind it under MapLibre's cached GL state.
    for (const buffers of this.retired)
      for (const buffer of Object.values(buffers)) gl.deleteBuffer(buffer)
    this.retired.length = 0
    if (!this.batches.length) return

    // The matrix maps mercator world coordinates to clip space. Shifting it by
    // the origin is what lets the instance offsets stay small.
    const matrix = args?.defaultProjectionData?.mainMatrix ?? args?.modelViewProjectionMatrix ?? args
    const shifted = translate(matrix as ArrayLike<number>, this.origin)
    const range = this.map.painter?.depthRangeFor3D

    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    if (range) gl.depthRange(range[0], range[1])
    gl.disable(gl.STENCIL_TEST)
    // Back faces are culled, and that is a correctness fix rather than a saving.
    //
    // Drawing both faces is fine while the depth buffer can tell the front of a
    // crown from its back. In the plan view it cannot: the camera retreats to
    // fake an orthographic projection (see `updateCameraProjection`), which
    // takes the far-to-near ratio from ~84 to ~5800, and a tree is a couple of
    // metres thick against a depth range of tens of kilometres. Front and back
    // quantise to the same value, `LEQUAL` lets whichever came later in the
    // index buffer win, and since a back face is lit by the opposite normal the
    // crown shatters into light and dark wedges that crawl as the camera moves.
    // Culling removes the losing half of the argument entirely.
    //
    // Winding survives the trip: the glTF-to-map frame swap in the shader is a
    // rotation, and both instance scales are positive, so a model authored
    // counter-clockwise still faces out.
    gl.enable(gl.CULL_FACE)
    gl.cullFace(gl.BACK)
    gl.frontFace(gl.CCW)

    this.drawObjects(gl, shifted)

    for (const loc of Object.values(LOC)) {
      gl.vertexAttribDivisor(loc, 0)
      gl.disableVertexAttribArray(loc)
    }

    // MapLibre's painter caches GL state; invalidate what we touched.
    const context = this.map.painter?.context
    if (context)
      for (const key of ['program', 'bindVertexBuffer', 'bindElementBuffer', 'bindVertexArray',
        'depthMask', 'depthFunc', 'depthRange', 'blend', 'cullFace'])
        if (context[key]) context[key].dirty = true
  }

  private drawObjects(gl: WebGL2RenderingContext, matrix: Float32Array) {
    gl.useProgram(this.program)
    gl.uniformMatrix4fv(this.uniforms.u_matrix, false, matrix)
    gl.uniform3fv(this.uniforms.u_light, this.lightDirection())
    gl.uniform1f(this.uniforms.u_ambient, 0.58)

    gl.depthMask(true)
    gl.disable(gl.BLEND)

    for (const batch of this.batches) {
      const model = this.models.get(batch.model)
      if (!model) continue
      this.bindInstances(gl, batch)
      for (const primitive of model.primitives) {
        gl.uniform3fv(this.uniforms.u_color, primitive.color)
        bindVec3(gl, LOC.a_position, primitive.position)
        bindVec3(gl, LOC.a_normal, primitive.normal)
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, primitive.index)
        gl.drawElementsInstanced(gl.TRIANGLES, primitive.count, primitive.indexType, 0, batch.count)
      }
    }
  }

  /**
   * Point the instance attributes at this batch, uploading it the first time.
   *
   * The upload used to happen here on every frame for every batch, since one
   * set of buffers was shared by all of them and had to be refilled before each
   * draw. The data only changes when `arrange` runs, so it is uploaded once and
   * every later frame is three `bindBuffer` calls.
   */
  private bindInstances(gl: WebGL2RenderingContext, batch: Batch) {
    const fresh = !batch.buffers
    batch.buffers ??= {
      offset: gl.createBuffer()!,
      shape: gl.createBuffer()!,
      shade: gl.createBuffer()!,
    }
    const attach = (buffer: WebGLBuffer, data: Float32Array, loc: number, size: number) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      if (fresh) gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0)
      gl.vertexAttribDivisor(loc, 1)
    }
    attach(batch.buffers.offset, batch.offset, LOC.a_offset, 3)
    attach(batch.buffers.shape, batch.shape, LOC.a_shape, 3)
    attach(batch.buffers.shade, batch.shade, LOC.a_shade, 1)
  }

  /** The style's own light, so objects agree with the buildings beside them. */
  private lightDirection(): [number, number, number] {
    const light = this.map.style?.light
    const position = light?.getCartesianPosition?.() ?? light?.properties?.get?.('position')
    const [x, y, z] = Array.isArray(position) ? position : [0.4, -0.6, 0.7]
    const length = Math.hypot(x, y, z) || 1
    return [x / length, y / length, z / length]
  }
}

/** `matrix * translate(origin)`, without pulling in a matrix library. */
function translate(matrix: ArrayLike<number>, origin: [number, number, number]): Float32Array {
  const out = new Float32Array(16)
  for (let i = 0; i < 16; i++) out[i] = matrix[i]
  const [x, y, z] = origin
  for (let i = 0; i < 4; i++) {
    out[12 + i] = matrix[i] * x + matrix[4 + i] * y + matrix[8 + i] * z + matrix[12 + i]
  }
  return out
}

function bindVec3(gl: WebGL2RenderingContext, loc: number, buffer: WebGLBuffer) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0)
  gl.vertexAttribDivisor(loc, 0)
}
