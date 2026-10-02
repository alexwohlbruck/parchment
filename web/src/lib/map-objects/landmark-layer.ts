/**
 * 3D landmarks, drawn in place of the buildings they replace.
 *
 * The opposite problem to `ObjectLayer`. That one draws thousands of copies of
 * a few tiny models, so it is built around instancing and colour roles; this
 * one draws a handful of large, unique models, each placed once, with real
 * materials — a lattice tower is a few quads with holes cut by an alpha mask,
 * and without the mask it is a brown pyramid. So: one draw per primitive per
 * landmark, a texture where the model has one, and nothing instanced.
 *
 * Three things make a landmark read as part of the map rather than pasted on:
 *
 *   lighting  The same formula MapLibre's fill-extrusion shader uses, against
 *             the same style light, so a landmark's wall and the office block
 *             beside it are exactly as bright as each other.
 *   shadows   Cast into the building shade layer's own shadow mask (see
 *             `shadowCasters` in `vendor/ao-shadow.mjs`), so a landmark's
 *             shadow has the buildings' direction, length, softness and
 *             darkness — and where the two overlap, it does not double up.
 *   replacing The layer reports the OSM refs it is drawing models for, and the
 *             caller filters them out of the building layers. Only refs whose
 *             model has loaded are reported, so the building stays until the
 *             landmark can take its place.
 *
 * Placement is a position, a bearing and a scale and nothing else, which is
 * the model frame Barrelman documents: +Y up, -Z north, +X east, metres,
 * origin at the anchor on the ground.
 */
import { parseGlb, type GlbModel } from './glb.mjs'
import { parseLandmark, type Landmark } from './landmarks'
import { project } from './object-layer'

/** Where a landmark stands, in mercator units; see `project`. */
type Anchor = { x: number; y: number; z: number; perMetre: number }

/** Debounce for rebuilding the placement list; see `ObjectLayer.invalidate`. */
const SETTLE = 80

/** Locations shared by both programs, so one VAO serves the draw and the shadow. */
const LOC = { a_position: 0, a_normal: 1, a_uv: 2 }

const ATTRIBUTES = `
  layout(location = 0) in vec3 a_position;
  layout(location = 1) in vec3 a_normal;
  layout(location = 2) in vec2 a_uv;`

/**
 * Model space → the map's frame, in metres around the anchor: east, south,
 * up. `u_local` carries the axis swap, the bearing and the scale; `u_matrix`
 * the anchor's position and the camera, composed in double precision on the
 * CPU so a model is not quantised to the four-metre float32 grid mercator
 * coordinates land on.
 */
const DRAW_VS = `#version 300 es
  uniform mat4 u_matrix;
  uniform mat3 u_local;
  uniform mat3 u_turn;
  ${ATTRIBUTES}
  out vec3 v_normal;
  out vec2 v_uv;
  void main() {
    v_normal = u_turn * a_normal;
    v_uv = a_uv;
    gl_Position = u_matrix * vec4(u_local * a_position, 1.0);
  }`

/**
 * The mask, kept legible at a distance.
 *
 * An alpha-tested lattice has thin strokes, and the mip chain averages a thin
 * stroke into its transparent neighbours — by the time a tower is a few
 * hundred pixels tall every texel is under the cutoff and the ironwork
 * dissolves. Scaling alpha up with the mip level being sampled (Ben Golus's
 * correction for alpha-tested foliage) keeps the coverage roughly constant.
 */
const MASK = `
  uniform sampler2D u_mask;
  uniform float u_cutoff;
  in vec2 v_uv;
  void cut() {
    if (u_cutoff < 0.0) return;
    float a = texture(u_mask, v_uv).a;
    vec2 texels = v_uv * vec2(textureSize(u_mask, 0));
    vec2 d = max(abs(dFdx(texels)), abs(dFdy(texels)));
    a *= 1.0 + max(0.0, log2(max(d.x, d.y))) * 0.3;
    if (a < u_cutoff) discard;
  }`

/**
 * MapLibre's fill-extrusion lighting, verbatim: a clamped dot against the
 * style light, remapped through its intensity and lifted for dark colours.
 * Any other model would put a landmark in a different light from its street.
 */
const DRAW_FS = `#version 300 es
  precision highp float;
  uniform vec3 u_color;
  uniform vec3 u_tint;
  uniform vec3 u_lightpos;
  uniform float u_lightintensity;
  in vec3 v_normal;
  ${MASK}
  out vec4 fragColor;
  void main() {
    cut();
    vec3 n = normalize(v_normal);
    // A double-sided face seen from behind is lit as the side you can see.
    if (!gl_FrontFacing) n = -n;
    float value = dot(u_color, vec3(0.2126, 0.7152, 0.0722));
    float directional = clamp(dot(n, u_lightpos), 0.0, 1.0);
    directional = mix(1.0 - u_lightintensity, max(1.0 - value + u_lightintensity, 1.0), directional);
    fragColor = vec4(clamp((u_color + 0.03) * directional * u_tint, 0.0, 1.0), 1.0);
  }`

/**
 * The building shade layer's ground shadow, for a model: every vertex is
 * sheared along the sun by its height and flattened onto the ground. The
 * buildings' shadow is made the same way from their walls, which is what
 * keeps the two in agreement.
 */
const SHADOW_VS = `#version 300 es
  uniform mat4 u_matrix;
  uniform mat3 u_local;
  uniform vec2 u_shear;
  /** Metres the origin sits above the ground. */
  uniform float u_lift;
  ${ATTRIBUTES}
  out vec2 v_uv;
  void main() {
    vec3 q = u_local * a_position;
    float h = q.z + u_lift;
    gl_Position = u_matrix * vec4(q.xy + u_shear * h, -u_lift, 1.0);
    v_uv = a_uv;
  }`

const SHADOW_FS = `#version 300 es
  precision highp float;
  ${MASK}
  out vec4 fragColor;
  void main() {
    cut();
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
  }`

/** What the shade layer hands a caster for one frame of its shadow pass. */
export type ShadowFrame = {
  /** Clip ← mercator, the same matrix the layer's own draw gets. */
  matrix: ArrayLike<number>
  /** Mercator units of ground shift per metre of height, x east and y south. */
  shear: [number, number]
}

type Primitive = {
  vao: WebGLVertexArrayObject
  buffers: WebGLBuffer[]
  count: number
  indexType: number
  /** sRGB, to match what the rest of the pipeline writes straight out. */
  color: [number, number, number]
  texture: WebGLTexture | null
  cutoff: number
  doubleSided: boolean
}

type Model = {
  /** Parsed and decoded, waiting for the next frame to put it on the GPU. */
  pending: { glb: GlbModel; images: Array<ImageBitmap | null> } | null
  primitives: Primitive[] | null
}

type Placement = Landmark & { placed: Anchor }

export class LandmarkLayer {
  id: string
  type = 'custom' as const
  renderingMode = '3d' as const

  private map: any
  private draw!: { program: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }
  private shadow!: { program: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }
  private models = new Map<string, Model>()
  private placements: Placement[] = []
  private replaced = ''
  private scheduled = 0
  private listeners: Array<[string, (...args: any[]) => void]> = []

  constructor(
    private options: {
      id: string
      source: string
      sourceLayer: string
      /** Where a model file name is fetched from. */
      modelUrl: (file: string) => string
      /** Called with the refs being drawn as landmarks whenever that set changes. */
      onReplace: (refs: string[]) => void
      /** Multiplied into every colour; how a landmark joins the night map. */
      tint: [number, number, number]
    },
  ) {
    this.id = options.id
  }

  setTint(tint: [number, number, number]) {
    this.options.tint = tint
    this.map?.triggerRepaint?.()
  }

  onAdd(map: any, gl: WebGL2RenderingContext) {
    this.map = map
    this.draw = program(gl, DRAW_VS, DRAW_FS,
      ['u_matrix', 'u_local', 'u_turn', 'u_color', 'u_tint', 'u_lightpos', 'u_lightintensity', 'u_mask', 'u_cutoff'])
    this.shadow = program(gl, SHADOW_VS, SHADOW_FS,
      ['u_matrix', 'u_local', 'u_shear', 'u_lift', 'u_mask', 'u_cutoff'])

    const listen = (event: string, fn: (...args: any[]) => void) => {
      map.on(event, fn)
      this.listeners.push([event, fn])
    }
    listen('sourcedata', (e: { sourceId?: string }) => {
      if (e?.sourceId === this.options.source) this.invalidate()
    })
    // A landmark's minzoom is crossed by zooming, which no tile event reports.
    listen('zoomend', () => this.invalidate())
    // Terrain changes the ground every landmark stands on.
    listen('terrain', () => this.invalidate())
    this.invalidate()
  }

  onRemove(map: any, gl: WebGL2RenderingContext) {
    for (const [event, fn] of this.listeners) map.off(event, fn)
    this.listeners = []
    if (this.scheduled) clearTimeout(this.scheduled)
    this.scheduled = 0
    for (const model of this.models.values())
      for (const p of model.primitives ?? []) {
        gl.deleteVertexArray(p.vao)
        for (const b of p.buffers) gl.deleteBuffer(b)
        if (p.texture) gl.deleteTexture(p.texture)
      }
    this.models.clear()
    gl.deleteProgram(this.draw.program)
    gl.deleteProgram(this.shadow.program)
    // Give the buildings back.
    if (this.replaced) this.options.onReplace([])
    this.replaced = ''
    this.map = null
  }

  /** What is being drawn, for the console. Dev only. */
  get drawn(): Array<{ id: string; model: string; ready: boolean }> {
    return this.placements.map(p => ({ id: p.id, model: p.model, ready: !!this.ready(p.model) }))
  }

  private invalidate() {
    if (this.scheduled) clearTimeout(this.scheduled)
    this.scheduled = setTimeout(() => {
      this.scheduled = 0
      if (!this.map) return
      this.gather()
      this.map.triggerRepaint?.()
    }, SETTLE) as unknown as number
  }

  /**
   * Read the placements the visible tiles hold, start fetching any model not
   * yet asked for, and report which buildings are now replaced.
   *
   * A landmark is sent to every tile its model overhangs, so the same one
   * arrives several times; the id de-duplicates it.
   */
  private gather() {
    const zoom = this.map.getZoom()
    let features: any[] = []
    try {
      features = this.map.querySourceFeatures(this.options.source, { sourceLayer: this.options.sourceLayer })
    } catch {
      features = []
    }
    const terrain = this.map.getTerrain?.() ? this.map : null
    const seen = new Set<string>()
    this.placements = []
    for (const feature of features) {
      const landmark = parseLandmark(feature)
      if (!landmark || seen.has(landmark.id) || zoom < landmark.minzoom) continue
      seen.add(landmark.id)
      this.load(landmark.model)
      const ground = terrain ? (terrain.queryTerrainElevation([landmark.lng, landmark.lat]) ?? 0) : 0
      const placed: Anchor = { x: 0, y: 0, z: 0, perMetre: 0 }
      project(landmark.lng, landmark.lat, ground + landmark.elevation, placed)
      this.placements.push({ ...landmark, placed })
    }
    this.report()
  }

  /** Hand the caller the refs of every landmark that can actually be drawn. */
  private report() {
    const refs = [...new Set(
      this.placements.filter(p => this.ready(p.model)).flatMap(p => p.replaces),
    )].sort()
    const key = refs.join(' ')
    if (key === this.replaced) return
    this.replaced = key
    this.options.onReplace(refs)
  }

  private ready(file: string) {
    const model = this.models.get(file)
    return !!(model?.primitives || model?.pending)
  }

  private load(file: string) {
    if (this.models.has(file)) return
    const model: Model = { pending: null, primitives: null }
    this.models.set(file, model)
    void (async () => {
      const response = await fetch(this.options.modelUrl(file))
      if (!response.ok) throw new Error(`${file}: ${response.status}`)
      const glb = parseGlb(await response.arrayBuffer())
      const images = await Promise.all(glb.primitives.map(p => p.image
        ? createImageBitmap(new Blob([p.image.bytes as BlobPart], { type: p.image.mimeType }), {
          premultiplyAlpha: 'none',
          colorSpaceConversion: 'none',
        })
        : null))
      model.pending = { glb, images }
      this.report()
      this.map?.triggerRepaint?.()
    })().catch(error => {
      // A model that will not load leaves its building standing, which is a
      // complete map. Not retried: the name is content-addressed, so the
      // same request would get the same answer.
      console.error('[landmarks]', error)
    })
  }

  /** Move decoded models onto the GPU. Only ever called inside a frame. */
  private upload(gl: WebGL2RenderingContext) {
    for (const model of this.models.values()) {
      if (!model.pending) continue
      const { glb, images } = model.pending
      model.primitives = glb.primitives.map((p, i) => {
        const vao = gl.createVertexArray()!
        gl.bindVertexArray(vao)
        const buffers: WebGLBuffer[] = []
        const attribute = (loc: number, data: Float32Array, size: number) => {
          const buffer = gl.createBuffer()!
          buffers.push(buffer)
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
          gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
          gl.enableVertexAttribArray(loc)
          gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0)
        }
        attribute(LOC.a_position, p.position, 3)
        attribute(LOC.a_normal, p.normal, 3)
        if (p.uv) attribute(LOC.a_uv, p.uv, 2)
        const index = gl.createBuffer()!
        buffers.push(index)
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index)
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, p.index, gl.STATIC_DRAW)
        gl.bindVertexArray(null)

        const image = images[i]
        let texture: WebGLTexture | null = null
        if (image && p.uv) {
          texture = gl.createTexture()
          gl.bindTexture(gl.TEXTURE_2D, texture)
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
          gl.generateMipmap(gl.TEXTURE_2D)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
          image.close()
        }

        // glTF colours are linear and this pipeline writes colour straight to
        // the screen (see `OBJECT_PALETTE`), so convert back to what the
        // model's author picked.
        const srgb = (c: number) => Math.pow(c, 1 / 2.2)
        return {
          vao,
          buffers,
          count: p.index.length,
          indexType: p.index.BYTES_PER_ELEMENT === 4 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
          color: [srgb(p.color[0]), srgb(p.color[1]), srgb(p.color[2])],
          texture,
          cutoff: texture && p.alphaMode === 'MASK' ? p.alphaCutoff : -1,
          doubleSided: p.doubleSided,
        }
      })
      model.pending = null
    }
  }

  /**
   * Draw every landmark's shadow into the building shade layer's mask. Called
   * by that layer, mid-pass, with its framebuffer and stencil already set up.
   */
  drawShadow(gl: WebGL2RenderingContext, frame: ShadowFrame) {
    this.upload(gl)
    if (!this.placements.length) return
    const { program, u } = this.shadow
    gl.useProgram(program)
    // Both faces: a shadow has no front.
    gl.disable(gl.CULL_FACE)
    for (const p of this.placements) {
      const model = this.models.get(p.model)
      if (!model?.primitives) continue
      const { perMetre } = p.placed
      gl.uniformMatrix4fv(u.u_matrix, false, anchorMatrix(frame.matrix, p.placed))
      gl.uniformMatrix3fv(u.u_local, false, localMatrix(p.bearing, p.scale))
      gl.uniform2f(u.u_shear, frame.shear[0] / perMetre, frame.shear[1] / perMetre)
      gl.uniform1f(u.u_lift, p.elevation)
      this.drawPrimitives(gl, model.primitives, u, false)
    }
    gl.bindVertexArray(null)
  }

  render(gl: WebGL2RenderingContext, args: any) {
    this.upload(gl)
    if (!this.placements.length) return this.restore()

    const matrix = args?.defaultProjectionData?.mainMatrix ?? args?.modelViewProjectionMatrix ?? args
    const range = this.map.painter?.depthRangeFor3D
    const light = this.light()
    const { program, u } = this.draw

    gl.useProgram(program)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.depthMask(true)
    if (range) gl.depthRange(range[0], range[1])
    gl.disable(gl.BLEND)
    gl.disable(gl.STENCIL_TEST)
    gl.cullFace(gl.BACK)
    // Counter-clockwise, unlike `ObjectLayer`. That layer mirrors its models
    // north-south on the way into the map (harmless for a tree) and so has to
    // flip the winding back; this one places a model the way it really
    // stands, which is what a tower with a front and a back needs, and the
    // authored winding survives. See `localMatrix` and its test.
    gl.frontFace(gl.CCW)

    gl.uniform3fv(u.u_lightpos, light.position)
    gl.uniform1f(u.u_lightintensity, light.intensity)
    gl.uniform3fv(u.u_tint, this.options.tint)

    for (const p of this.placements) {
      const model = this.models.get(p.model)
      if (!model?.primitives) continue
      gl.uniformMatrix4fv(u.u_matrix, false, anchorMatrix(matrix, p.placed))
      gl.uniformMatrix3fv(u.u_local, false, localMatrix(p.bearing, p.scale))
      gl.uniformMatrix3fv(u.u_turn, false, localMatrix(p.bearing, 1))
      this.drawPrimitives(gl, model.primitives, u, true)
    }
    gl.bindVertexArray(null)
    this.restore()
  }

  private drawPrimitives(
    gl: WebGL2RenderingContext,
    primitives: Primitive[],
    u: Record<string, WebGLUniformLocation | null>,
    shaded: boolean,
  ) {
    for (const primitive of primitives) {
      if (shaded) {
        if (primitive.doubleSided) gl.disable(gl.CULL_FACE)
        else gl.enable(gl.CULL_FACE)
        gl.uniform3fv(u.u_color, primitive.color)
      }
      gl.uniform1f(u.u_cutoff, primitive.cutoff)
      if (primitive.texture) {
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, primitive.texture)
        gl.uniform1i(u.u_mask, 0)
      }
      gl.bindVertexArray(primitive.vao)
      gl.drawElements(gl.TRIANGLES, primitive.count, primitive.indexType, 0)
    }
  }

  /** MapLibre caches GL state; tell it what we touched. See `ObjectLayer.render`. */
  private restore() {
    const context = this.map?.painter?.context
    if (!context) return
    for (const key of ['program', 'bindVertexBuffer', 'bindElementBuffer', 'bindVertexArray',
      'depthMask', 'depthFunc', 'depthRange', 'blend', 'cullFace', 'cullFaceSide', 'frontFace',
      'activeTexture', 'bindTexture', 'stencilTest'])
      if (context[key]) context[key].dirty = true
  }

  /**
   * The style light as the building shader sees it: cartesian, in the tile
   * frame, turned with the camera when it is anchored to the viewport.
   */
  private light(): { position: [number, number, number]; intensity: number } {
    const light = this.map.style?.light
    const p = light?.getCartesianPosition?.() ?? light?.properties?.get?.('position')
    let [x, y, z] = Array.isArray(p) ? p : p ? [p.x, p.y, p.z] : [0.5, -0.6, 0.62]
    if (light?.properties?.get?.('anchor') === 'viewport') {
      const th = (this.map.getBearing() * Math.PI) / 180
      ;[x, y] = [x * Math.cos(th) - y * Math.sin(th), x * Math.sin(th) + y * Math.cos(th)]
    }
    return { position: [x, y, z], intensity: light?.properties?.get?.('intensity') ?? 0.5 }
  }
}

/**
 * Clip ← anchor-local metres: the camera matrix, moved to the anchor and
 * scaled from mercator units to metres. Composed in float64 and only then
 * narrowed, which is what keeps a model steady at street zoom.
 */
export function anchorMatrix(camera: ArrayLike<number>, at: Anchor): Float32Array {
  const out = new Float32Array(16)
  const k = at.perMetre
  for (let r = 0; r < 4; r++) {
    out[r] = camera[r] * k
    out[4 + r] = camera[4 + r] * k
    out[8 + r] = camera[8 + r] * k
    out[12 + r] = camera[r] * at.x + camera[4 + r] * at.y + camera[8 + r] * at.z + camera[12 + r]
  }
  return out
}

/**
 * Model → anchor-local metres (east, south, up), column-major.
 *
 * glTF's (X east, Y up, Z south) goes to (X, Z, Y), then turns clockwise by
 * `bearing` as seen from above: model north, -Z, ends up pointing at the
 * bearing — (sin b, -cos b) in a frame whose y runs south.
 */
export function localMatrix(bearingDeg: number, scale: number): Float32Array {
  const b = (bearingDeg * Math.PI) / 180
  const c = Math.cos(b) * scale
  const s = Math.sin(b) * scale
  return new Float32Array([
    c, s, 0, // X
    0, 0, scale, // Y
    -s, c, 0, // Z
  ])
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string, uniforms: string[]) {
  const compile = (type: number, src: string) => {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, src)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      console.error('[landmarks]', gl.getShaderInfoLog(shader))
    return shader
  }
  const p = gl.createProgram()!
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs))
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error('[landmarks] link:', gl.getProgramInfoLog(p))
  return { program: p, u: Object.fromEntries(uniforms.map(n => [n, gl.getUniformLocation(p, n)])) }
}

