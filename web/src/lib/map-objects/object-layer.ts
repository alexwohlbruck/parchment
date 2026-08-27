/**
 * Repeated 3D objects — trees today, benches and bins on the same rails later.
 *
 * The shape of the problem is instancing. A city block holds hundreds of street
 * trees and a viewport can hold thousands, so one draw call per tree is out;
 * what works is one model, uploaded once, drawn `N` times from a buffer of
 * per-object transforms (`ANGLE_instanced_arrays`, core in WebGL2). That is the
 * standard answer for scattered repeated geometry and it is what this does:
 * two attribute buffers per object — where it stands, and how it is shaped —
 * and one `drawElementsInstanced` per material.
 *
 * The alternative, three.js behind MapLibre's `CustomLayerInterface`, is the
 * more commonly written one and would have cost ~150KB gzipped to draw a
 * cylinder and a cone. `glb.ts` reads the model instead.
 *
 * Precision is why positions are stored relative to an origin. Mercator world
 * coordinates run 0–1 across the planet, and float32 holds about seven digits,
 * which lands at roughly four metres of quantisation — visible as trees
 * snapping between positions as you pan. Subtracting a per-refresh origin and
 * folding it back into the matrix keeps the numbers small and the error under a
 * millimetre.
 *
 * Objects are read from the same vector source their flat form is drawn from,
 * so the two cannot disagree about what exists: turning 3D objects on hides the
 * circles and shows the models, and nothing else is loaded.
 */
import { MercatorCoordinate } from 'maplibre-gl'
import type { GlbModel } from './glb'

const VS = `
  uniform mat4 u_matrix;
  uniform vec3 u_light;
  uniform float u_ambient;
  uniform vec4 u_color;

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

    // Half-lambert: a plain dot product leaves every face turned away from the
    // sun flat black, which at this size reads as a hole rather than as shade.
    float lit = dot(normalize(n), u_light) * 0.5 + 0.5;
    v_color = u_color.rgb * a_shade * mix(u_ambient, 1.0, lit);

    gl_Position = u_matrix * vec4(world, 1.0);
  }`

const FS = `
  precision mediump float;
  varying vec3 v_color;
  void main() { gl_FragColor = vec4(v_color, 1.0); }`

const LOC = { a_position: 0, a_normal: 1, a_offset: 2, a_shape: 3, a_shade: 4 }

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
  /** Turns one source feature into an instance, or null to skip it. */
  toInstance: (feature: any, lng: number, lat: number) => ObjectInstance | null
}

type ModelBuffers = {
  primitives: Array<{
    position: WebGLBuffer
    normal: WebGLBuffer
    index: WebGLBuffer
    count: number
    indexType: number
    color: [number, number, number, number]
  }>
}

type Batch = {
  model: string
  offset: Float32Array
  shape: Float32Array
  shade: Float32Array
  count: number
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    console.error('[objects]', gl.getShaderInfoLog(shader))
  return shader
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
  private gl!: WebGL2RenderingContext
  private program!: WebGLProgram
  private uniforms: Record<string, WebGLUniformLocation | null> = {}
  private models = new Map<string, ModelBuffers>()
  private instanceBuffers: { offset: WebGLBuffer; shape: WebGLBuffer; shade: WebGLBuffer } | null = null
  private batches: Batch[] = []
  private origin: [number, number, number] = [0, 0, 0]
  private dirty = true
  private onSourceData?: () => void

  enabled = true

  constructor(
    private spec: ObjectSourceSpec,
    private sources: Record<string, GlbModel>,
    options: { id?: string } = {},
  ) {
    this.id = options.id ?? 'map-objects'
  }

  onAdd(map: any, gl: WebGL2RenderingContext) {
    this.map = map
    this.gl = gl

    this.program = gl.createProgram()!
    gl.attachShader(this.program, compile(gl, gl.VERTEX_SHADER, VS))
    gl.attachShader(this.program, compile(gl, gl.FRAGMENT_SHADER, FS))
    for (const [name, loc] of Object.entries(LOC)) gl.bindAttribLocation(this.program, loc, name)
    gl.linkProgram(this.program)
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS))
      console.error('[objects] link:', gl.getProgramInfoLog(this.program))

    for (const name of ['u_matrix', 'u_light', 'u_ambient', 'u_color'])
      this.uniforms[name] = gl.getUniformLocation(this.program, name)

    for (const [name, model] of Object.entries(this.sources)) {
      this.models.set(name, {
        primitives: model.primitives.map(p => ({
          position: this.upload(gl, gl.ARRAY_BUFFER, p.position),
          normal: this.upload(gl, gl.ARRAY_BUFFER, p.normal),
          index: this.upload(gl, gl.ELEMENT_ARRAY_BUFFER, p.index),
          count: p.index.length,
          indexType: p.index.BYTES_PER_ELEMENT === 4 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
          color: p.color,
        })),
      })
    }

    this.instanceBuffers = {
      offset: gl.createBuffer()!,
      shape: gl.createBuffer()!,
      shade: gl.createBuffer()!,
    }

    // The source arrives asynchronously and changes as you pan, so the instance
    // list is rebuilt rather than collected once.
    this.onSourceData = () => {
      this.dirty = true
    }
    map.on('sourcedata', this.onSourceData)
    map.on('moveend', this.onSourceData)
  }

  private upload(gl: WebGL2RenderingContext, target: number, data: ArrayBufferView) {
    const buffer = gl.createBuffer()!
    gl.bindBuffer(target, buffer)
    gl.bufferData(target, data, gl.STATIC_DRAW)
    return buffer
  }

  onRemove(map: any, gl: WebGL2RenderingContext) {
    if (this.onSourceData) {
      map.off('sourcedata', this.onSourceData)
      map.off('moveend', this.onSourceData)
    }
    gl.deleteProgram(this.program)
    for (const model of this.models.values())
      for (const p of model.primitives) {
        gl.deleteBuffer(p.position)
        gl.deleteBuffer(p.normal)
        gl.deleteBuffer(p.index)
      }
    if (this.instanceBuffers) for (const b of Object.values(this.instanceBuffers)) gl.deleteBuffer(b)
  }

  /**
   * Rebuild the instance buffers from whatever the source currently holds.
   *
   * `querySourceFeatures` returns each feature once per tile it appears in, so
   * a tree on a tile boundary would otherwise be drawn twice — hence the id
   * set. Objects with no id are kept: a duplicate is better than a hole.
   */
  private collect() {
    this.dirty = false
    this.batches = []

    const zoom = this.map.getZoom()
    if (zoom < this.spec.minzoom) return

    let features: any[] = []
    try {
      features = this.map.querySourceFeatures(this.spec.source, {
        sourceLayer: this.spec.sourceLayer,
      })
    } catch {
      return
    }
    if (!features.length) return

    const terrain = this.map.getTerrain?.() ? this.map : null
    const seen = new Set<string | number>()
    const byModel = new Map<string, ObjectInstance[]>()

    for (const feature of features) {
      const coords = feature.geometry?.coordinates
      if (!coords) continue
      const key = feature.id ?? feature.properties?.id
      if (key !== undefined) {
        if (seen.has(key)) continue
        seen.add(key)
      }
      const instance = this.spec.toInstance(feature, coords[0], coords[1])
      if (!instance) continue
      const list = byModel.get(instance.model)
      if (list) list.push(instance)
      else byModel.set(instance.model, [instance])
    }

    // The origin every position is measured from. The map centre, so the error
    // float32 introduces is smallest where the eye is.
    const centre = this.map.getCenter()
    const origin = MercatorCoordinate.fromLngLat(centre, 0)
    this.origin = [origin.x, origin.y, 0]

    for (const [model, instances] of byModel) {
      if (!this.models.has(model)) continue
      const offset = new Float32Array(instances.length * 3)
      const shape = new Float32Array(instances.length * 3)
      const shade = new Float32Array(instances.length)
      for (let i = 0; i < instances.length; i++) {
        const o = instances[i]
        const elevation = terrain ? (terrain.queryTerrainElevation([o.lng, o.lat]) ?? 0) : 0
        const mc = MercatorCoordinate.fromLngLat([o.lng, o.lat], elevation)
        const perMetre = mc.meterInMercatorCoordinateUnits()
        offset[i * 3] = mc.x - this.origin[0]
        offset[i * 3 + 1] = mc.y - this.origin[1]
        offset[i * 3 + 2] = mc.z
        shape[i * 3] = o.height * perMetre
        shape[i * 3 + 1] = o.spread * perMetre
        shape[i * 3 + 2] = o.heading
        shade[i] = o.shade
      }
      this.batches.push({ model, offset, shape, shade, count: instances.length })
    }
  }

  render(gl: WebGL2RenderingContext, args: any) {
    if (!this.enabled) return
    if (this.dirty) this.collect()
    if (!this.batches.length || !this.instanceBuffers) return

    // The matrix maps mercator world coordinates to clip space. Shifting it by
    // the origin is what lets the instance offsets stay small.
    const matrix = args?.defaultProjectionData?.mainMatrix ?? args?.modelViewProjectionMatrix ?? args
    const shifted = translate(matrix as ArrayLike<number>, this.origin)

    gl.useProgram(this.program)
    gl.uniformMatrix4fv(this.uniforms.u_matrix, false, shifted)

    const light = this.lightDirection()
    gl.uniform3fv(this.uniforms.u_light, light)
    gl.uniform1f(this.uniforms.u_ambient, 0.55)

    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.depthMask(true)
    const range = this.map.painter?.depthRangeFor3D
    if (range) gl.depthRange(range[0], range[1])
    gl.disable(gl.BLEND)
    gl.disable(gl.STENCIL_TEST)
    // Both faces: the canopy is a closed hull but a cone's base is not, and a
    // gap in a tree reads far worse than the cost of drawing 30 more triangles.
    gl.disable(gl.CULL_FACE)

    for (const batch of this.batches) {
      const model = this.models.get(batch.model)
      if (!model) continue

      this.bindInstances(gl, batch)
      for (const primitive of model.primitives) {
        gl.uniform4fv(this.uniforms.u_color, primitive.color)
        bindVec3(gl, LOC.a_position, primitive.position, 0)
        bindVec3(gl, LOC.a_normal, primitive.normal, 0)
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, primitive.index)
        gl.drawElementsInstanced(
          gl.TRIANGLES,
          primitive.count,
          primitive.indexType,
          0,
          batch.count,
        )
      }
    }

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

  private bindInstances(gl: WebGL2RenderingContext, batch: Batch) {
    const b = this.instanceBuffers!
    const attach = (buffer: WebGLBuffer, data: Float32Array, loc: number, size: number) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW)
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0)
      gl.vertexAttribDivisor(loc, 1)
    }
    attach(b.offset, batch.offset, LOC.a_offset, 3)
    attach(b.shape, batch.shape, LOC.a_shape, 3)
    attach(b.shade, batch.shade, LOC.a_shade, 1)
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

function bindVec3(gl: WebGL2RenderingContext, loc: number, buffer: WebGLBuffer, offset: number) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, offset)
  gl.vertexAttribDivisor(loc, 0)
}
