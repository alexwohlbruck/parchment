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
 * origin at the anchor, at the lowest ground under the footprint.
 *
 * A few landmarks move: a Ferris wheel turns. Such a model carries a standard
 * glTF clip of rigid node motion (see `poseGlb`), and its moving parts are
 * drawn through their node's matrix each frame, shadow included. The layer
 * asks for frames only while a moving landmark is on screen, so a map with
 * none in view stays idle, and it holds them at rest for anyone who prefers
 * reduced motion.
 */
import { parseGlb, poseGlb, type GlbAnimation, type GlbModel } from './glb.mjs'
import {
  ENTRANCE_GLOW, GROUND_GRID, groundGrid, insideFootprint, isWindow, materialLight, MAX_ENTRANCES, parseLandmark, polygonRings,
  type Footprint, type Landmark, type LandmarkFlavor,
} from './landmarks'
import { project } from './object-layer'

/** Where a landmark stands, in mercator units; see `project`. */
type Anchor = { x: number; y: number; z: number; perMetre: number }

/** Debounce for rebuilding the placement list; see `ObjectLayer.invalidate`. */
const SETTLE = 80

/**
 * Zoom levels below its minzoom that a landmark already on screen is kept
 * for, and below its detail zoom that the detail model is. Without it, a
 * pinch that wavers around the threshold swaps one for the other back and
 * forth.
 */
const MINZOOM_HYSTERESIS = 0.3

/**
 * How long a model no placement wants stays on the GPU. Long enough that
 * zooming out and back in again does not refetch it; short enough that
 * touring a city full of landmarks does not keep every one of them.
 */
const EVICT_AFTER_MS = 60_000

/** How often to look for models to evict. */
const EVICT_EVERY_MS = 5_000

/**
 * How long a landmark that has left keeps being drawn, at most, while the
 * buildings it hid are laid out again. A filter change re-parses the whole
 * building source in the worker, and dropping the model before that lands
 * leaves an empty lot for a few frames.
 */
const LINGER_MS = 1500

/**
 * Metres a landmark is set below the ground sampled under it. The terrain is
 * read on a coarse grid and drawn as a finer mesh, so it can dip a little
 * between samples; a base that floats over the dip shows daylight under the
 * building, which is worse than burying a plinth.
 */
const GROUND_SINK = 0.5

/**
 * Model metres over which a landmark goes from following the ground to
 * standing rigid. Below it every vertex is lifted by the terrain under it, so
 * a stadium's street side sits on the street and its field side on the
 * field; above it the model takes the footprint's mean ground, so roofs stay
 * level and towers straight. Walls stay vertical either way: a vertex only
 * ever moves up or down.
 */
const GROUND_BLEND = 25

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

/** Locations shared by both programs, so one VAO serves the draw and the shadow. */
const LOC = { a_position: 0, a_normal: 1, a_uv: 2 }

/**
 * The terrain under a landmark, as a GROUND_GRID² grid of model-metre lifts
 * over its plan extent (`u_bounds`: minX, minZ, maxX, maxZ), and how a vertex
 * follows it — see GROUND_BLEND. All zero with the terrain off.
 */
const GROUND = `
  uniform float u_ground[${GROUND_GRID * GROUND_GRID}];
  uniform float u_ground_mean;
  uniform vec4 u_bounds;
  uniform float u_blend;
  float groundAt(int i, int j) { return u_ground[j * ${GROUND_GRID} + i]; }
  /** The ground's rise at a plan point in model metres, held at the grid's edge beyond it. */
  float groundUnder(vec2 xz) {
    vec2 span = max(u_bounds.zw - u_bounds.xy, vec2(1e-3));
    vec2 g = clamp((xz - u_bounds.xy) / span, 0.0, 1.0) * float(${GROUND_GRID - 1});
    ivec2 c = min(ivec2(floor(g)), ivec2(${GROUND_GRID - 2}));
    vec2 f = g - vec2(c);
    return mix(
      mix(groundAt(c.x, c.y), groundAt(c.x + 1, c.y), f.x),
      mix(groundAt(c.x, c.y + 1), groundAt(c.x + 1, c.y + 1), f.x),
      f.y);
  }
  vec3 onGround(vec3 p) {
    float follow = 1.0 - clamp(p.y / u_blend, 0.0, 1.0);
    return p + vec3(0.0, mix(u_ground_mean, groundUnder(p.xz), follow), 0.0);
  }`

const ATTRIBUTES = `
  layout(location = 0) in vec3 a_position;
  layout(location = 1) in vec3 a_normal;
  layout(location = 2) in vec2 a_uv;`

/**
 * Where a moving part stands this frame, in model space: its node's matrix
 * from `poseGlb`, rigid, so its upper 3×3 turns normals too. The identity for
 * everything that does not move.
 */
const NODE = `
  uniform mat4 u_node;`

/**
 * Model space → the map's frame, in metres around the anchor: east, south,
 * up. `u_node` moves a turning part within the model; `u_local` carries the
 * axis swap, the bearing and the scale; `u_matrix` the anchor's position and
 * the camera, composed in double precision on the CPU so a model is not
 * quantised to the four-metre float32 grid mercator coordinates land on.
 *
 * The ground is applied after the node, so a part follows the terrain under
 * where it is now, not where it started.
 */
const DRAW_VS = `#version 300 es
  uniform mat4 u_matrix;
  uniform mat3 u_local;
  uniform mat3 u_turn;
  ${NODE}
  ${GROUND}
  ${ATTRIBUTES}
  out vec3 v_normal;
  out vec2 v_uv;
  void main() {
    v_normal = u_turn * (mat3(u_node) * a_normal);
    v_uv = a_uv;
    vec3 p = (u_node * vec4(a_position, 1.0)).xyz;
    gl_Position = u_matrix * vec4(u_local * onGround(p), 1.0);
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
 * MapLibre's fill-extrusion lighting, so a landmark stands in the same light
 * as its street: a clamped dot against the style light, remapped through its
 * intensity and lifted for dark colours.
 *
 * Plus a sky term, which buildings do not need and sculpture does. The
 * extrusion formula only ever lights walls and flat roofs; on a figure it
 * leaves every face turned from the sun at one flat value, and a statue
 * reads as a cut-out. Letting faces that look up catch a little more light
 * and faces that look down a little less gives the folds and the arm their
 * shape, without moving the brightness of a wall away from its neighbours.
 *
 * Then emission, for windows and doors lit from inside (see
 * `materialLight`). It is added after the tint, so a lit window is not
 * cooled with the night, and in linear light, which is how Open Landmarks'
 * three.js renderer adds an emissive — so a pane glows the colour it does
 * there rather than a washed-out one.
 */
const DRAW_FS = `#version 300 es
  precision highp float;
  uniform vec3 u_color;
  /** 1 when the primitive's texture paints its surface rather than only cutting it. */
  uniform float u_painted;
  uniform vec3 u_tint;
  uniform vec3 u_lightpos;
  uniform float u_lightintensity;
  /** Emitted colour, linear, already scaled by its intensity. */
  uniform vec3 u_emission;
  /** 1 when a painted texture's alpha says where the panes are: 0 glass, 1 wall. */
  uniform float u_panes;
  in vec3 v_normal;
  ${MASK}
  out vec4 fragColor;
  void main() {
    cut();
    // A painted texture carries the surface's colour, multiplied by the
    // material's — which is how a facade gets a grid of windows that
    // mipmaps to the right tone at a distance instead of shimmering.
    vec4 paint = u_painted > 0.5 ? texture(u_mask, v_uv) : vec4(1.0);
    vec3 base = u_color * paint.rgb;
    vec3 n = normalize(v_normal);
    // A double-sided face seen from behind is lit as the side you can see.
    if (!gl_FrontFacing) n = -n;
    float value = dot(base, vec3(0.2126, 0.7152, 0.0722));
    float directional = clamp(dot(n, u_lightpos), 0.0, 1.0);
    directional = mix(1.0 - u_lightintensity, max(1.0 - value + u_lightintensity, 1.0), directional);
    float sky = mix(0.84, 1.05, n.z * 0.5 + 0.5);
    vec3 shaded = clamp((base + 0.03) * directional * sky * u_tint, 0.0, 1.0);
    if (u_emission != vec3(0.0)) {
      // The mask's mip chain averages panes and wall, so a facade too far
      // off to show single windows still glows by the share that is glass.
      float glass = u_panes > 0.5 ? 1.0 - paint.a : 1.0;
      vec3 lit = pow(shaded, vec3(2.2)) + u_emission * glass;
      shaded = pow(clamp(lit, 0.0, 1.0), vec3(1.0 / 2.2));
    }
    fragColor = vec4(shaded, 1.0);
  }`

/**
 * A lit doorway's glow: a soft disc that always faces the camera, added onto
 * whatever is behind it. One quad per entrance, its centre read from a
 * uniform array by instance, so a landmark's doors are one draw with no
 * buffers of their own.
 *
 * The camera's right and up come from the matrix's first two rows, which in
 * this frame (metres, uniform scale) are those axes up to scale. The disc is
 * then pulled toward the camera by its radius: a door sits in a wall and on
 * the ground, and a disc centred there would lose half of itself to each.
 */
const GLOW_VS = `#version 300 es
  uniform mat4 u_matrix;
  uniform mat3 u_local;
  uniform vec3 u_points[${MAX_ENTRANCES}];
  uniform float u_radius;
  ${GROUND}
  layout(location = 0) in vec2 a_corner;
  out vec2 v_corner;
  void main() {
    vec3 centre = u_local * onGround(u_points[gl_InstanceID]);
    mat4 m = u_matrix;
    vec3 right = normalize(vec3(m[0][0], m[1][0], m[2][0]));
    vec3 up = normalize(vec3(m[0][1], m[1][1], m[2][1]));
    vec3 away = normalize(vec3(m[0][3], m[1][3], m[2][3]));
    vec3 p = centre + (right * a_corner.x + up * a_corner.y - away) * u_radius;
    v_corner = a_corner;
    gl_Position = u_matrix * vec4(p, 1.0);
  }`

const GLOW_FS = `#version 300 es
  precision highp float;
  uniform vec3 u_glow;
  uniform float u_opacity;
  in vec2 v_corner;
  out vec4 fragColor;
  void main() {
    float fall = 1.0 - clamp(length(v_corner), 0.0, 1.0);
    fragColor = vec4(u_glow, u_opacity * fall * fall);
  }`

/** Metres from a door's glow's centre to where it fades out. */
const GLOW_RADIUS = 2.5

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
  /** Metres the origin sits above the lowest ground under the model. */
  uniform float u_lift;
  /** cos and sin of the bearing, and the scale: map metres back to model plan. */
  uniform vec3 u_plan;
  ${NODE}
  ${GROUND}
  ${ATTRIBUTES}
  out vec2 v_uv;
  /** The ground's rise above the lowest point, in map metres, at a map point. */
  float riseAt(vec2 m) {
    vec2 xz = vec2(u_plan.x * m.x + u_plan.y * m.y, -u_plan.y * m.x + u_plan.x * m.y) / u_plan.z;
    return groundUnder(xz) * u_plan.z;
  }
  void main() {
    vec3 m = (u_node * vec4(a_position, 1.0)).xyz;
    vec3 q = u_local * onGround(m);
    // The shadow lands on the slope, not on a plane at the model's lowest
    // point — otherwise, on a hill, it slides off its own base. Find where
    // the vertex's shadow falls using the ground under the vertex, then read
    // the ground there and shear by the height above it. One step is enough:
    // the grid is coarse and a slope's change over a shadow's length small.
    float below = q.z + u_lift - riseAt(q.xy);
    vec2 land = q.xy + u_shear * max(below, 0.0);
    float rise = riseAt(land);
    float h = max(q.z + u_lift - rise, 0.0);
    gl_Position = u_matrix * vec4(q.xy + u_shear * h, rise - u_lift, 1.0);
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
  /** Whether the texture paints colour (opaque), as opposed to only cutting with alpha. */
  painted: boolean
  cutoff: number
  doubleSided: boolean
  /** The glTF material's name, which is how windows and doors are found. */
  material: string
  /** The moving node it is drawn with, or -1; see `poseGlb`. */
  node: number
}

type Model = {
  /** Parsed and decoded, waiting for the next frame to put it on the GPU. */
  pending: { glb: GlbModel; images: Array<ImageBitmap | null> } | null
  primitives: Primitive[] | null
  /** Plan extent in the model's own metres, once it has loaded. */
  footprint: Footprint | null
  /** When a placement last wanted it; see EVICT_AFTER_MS. */
  used: number
  /** Its clip, for a model with parts that move. */
  animation: GlbAnimation | null
  /** The moving nodes' matrices, and the clip time they are for. */
  pose: { at: number; nodes: Map<number, Float32Array> } | null
  /** Metres from its origin that it reaches, sideways or up, once loaded. */
  reach: number
}

/** What a landmark stands in for: OSM refs, and basemap ids found by footprint. */
export type Replaced = { refs: string[]; featureIds: number[] }

type Placement = Landmark & {
  placed: Anchor
  /** Lifts off the base, per grid point, in model metres; see GROUND. */
  ground: Float32Array
  groundMean: number
  /** Metres the base was sunk below the lowest ground; 0 with terrain off. */
  sink: number
  /** Whether it is close enough for its detail model; see `drawnModel`. */
  detailed: boolean
  /** `entrances`, flattened for the glow's uniform array. */
  doors: Float32Array
}

export class LandmarkLayer {
  id: string
  type = 'custom' as const
  renderingMode = '3d' as const

  private map: any
  private draw!: { program: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }
  private shadow!: { program: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }
  private glow!: { program: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }
  private quad: { vao: WebGLVertexArrayObject; buffer: WebGLBuffer } | null = null
  private evicted = 0
  private models = new Map<string, Model>()
  private placements: Placement[] = []
  /** Landmarks that have left, still drawn until their buildings are back. */
  private leaving: Placement[] = []
  private lingering = 0
  /**
   * Building keys hidden, and the landmark each is hidden for. Kept between
   * gathers: the tiles that proved a building lies inside a landmark come
   * and go as the map zooms, and forgetting it with them flips the filter —
   * and so re-lays out every building — on every zoom step.
   */
  private hiddenFor = new Map<string | number, string>()
  /** Buildings found inside a drawn landmark's footprint, by the last gather. */
  private contained: Replaced = { refs: [], featureIds: [] }
  private replaced = ''
  private credited = ''
  private scheduled = 0
  private listeners: Array<[string, (...args: any[]) => void]> = []
  /** `prefers-reduced-motion`; when it matches, moving parts hold still at t = 0. */
  private stillness: MediaQueryList | null = null

  constructor(
    private options: {
      id: string
      source: string
      sourceLayer: string
      /** Where a model file name is fetched from. */
      modelUrl: (file: string) => string
      /** Called with what is being drawn as landmarks whenever that changes. */
      onReplace: (replaced: Replaced) => void
      /**
       * The layers' building sources, searched for buildings that sit wholly
       * inside a landmark's footprint — see `insideFootprint`.
       */
      buildings?: Array<{ source: string; sourceLayer: string }>
      /** Called with the credits of the models being drawn whenever they change. */
      onAttribution?: (credits: string[]) => void
      /** How a landmark joins the map's flavor: its tint, and whether it is night. */
      flavor: LandmarkFlavor
    },
  ) {
    this.id = options.id
  }

  setFlavor(flavor: LandmarkFlavor) {
    this.options.flavor = flavor
    this.map?.triggerRepaint?.()
  }

  onAdd(map: any, gl: WebGL2RenderingContext) {
    this.map = map
    this.draw = program(gl, DRAW_VS, DRAW_FS,
      ['u_matrix', 'u_local', 'u_turn', 'u_color', 'u_painted', 'u_tint', 'u_lightpos', 'u_lightintensity', 'u_mask', 'u_cutoff',
        'u_emission', 'u_panes', 'u_ground', 'u_ground_mean', 'u_bounds', 'u_blend', 'u_node'])
    this.shadow = program(gl, SHADOW_VS, SHADOW_FS,
      ['u_matrix', 'u_local', 'u_shear', 'u_lift', 'u_mask', 'u_cutoff', 'u_node', 'u_plan',
        'u_ground', 'u_ground_mean', 'u_bounds', 'u_blend'])
    this.stillness = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
    this.glow = program(gl, GLOW_VS, GLOW_FS,
      ['u_matrix', 'u_local', 'u_points', 'u_radius', 'u_glow', 'u_opacity', 'u_ground', 'u_ground_mean', 'u_bounds', 'u_blend'])
    const vao = gl.createVertexArray()!
    const buffer = gl.createBuffer()!
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
    this.quad = { vao, buffer }

    const listen = (event: string, fn: (...args: any[]) => void) => {
      map.on(event, fn)
      this.listeners.push([event, fn])
    }
    // Building tiles count too: they can arrive after the landmark's, and
    // the footprint search has to see them.
    const watched = new Set([this.options.source, ...(this.options.buildings ?? []).map(b => b.source)])
    listen('sourcedata', (e: { sourceId?: string }) => {
      if (!e?.sourceId) return
      // Elevation tiles too: a landmark placed before the ground under it
      // loaded was placed at 0.
      if (watched.has(e.sourceId) || e.sourceId === map.getTerrain?.()?.source) this.invalidate()
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
    this.lingering++
    this.leaving = []
    this.hiddenFor.clear()
    for (const model of this.models.values()) release(gl, model)
    this.models.clear()
    gl.deleteProgram(this.draw.program)
    gl.deleteProgram(this.shadow.program)
    gl.deleteProgram(this.glow.program)
    if (this.quad) {
      gl.deleteVertexArray(this.quad.vao)
      gl.deleteBuffer(this.quad.buffer)
      this.quad = null
    }
    // Give the buildings back, and take the credits down with the models.
    if (this.replaced) this.options.onReplace({ refs: [], featureIds: [] })
    if (this.credited) this.options.onAttribution?.([])
    this.replaced = ''
    this.credited = ''
    this.map = null
  }

  /** What is being drawn, for the console. Dev only. */
  get drawn(): Array<{ id: string; model: string; ready: boolean }> {
    return this.placements.map(p => {
      const drawn = this.drawnModel(p)
      const model = drawn && p.detail && drawn === this.models.get(p.detail.model) ? p.detail.model : p.model
      return { id: p.id, model, ready: this.ready(p.model) }
    })
  }

  /** What the last report hid. Dev only. */
  get hidden(): string {
    return this.replaced
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
    const terrain = this.groundSampler()
    const previous = new Map(this.placements.map(p => [p.id, p]))
    const minzoom = (l: Landmark) => l.minzoom - (previous.has(l.id) ? MINZOOM_HYSTERESIS : 0)
    const detailed = (l: Landmark) =>
      !!l.detail && zoom >= l.detail.zoom - (previous.get(l.id)?.detailed ? MINZOOM_HYSTERESIS : 0)
    const seen = new Set<string>()
    this.placements = []
    for (const feature of features) {
      const landmark = parseLandmark(feature)
      if (!landmark || seen.has(landmark.id) || zoom < minzoom(landmark)) continue
      seen.add(landmark.id)
      this.placements.push(this.place(landmark, terrain, detailed(landmark)))
    }
    // A landmark whose tile is between loads is still there: mid-zoom the
    // old tiles go before the new ones arrive, and the query sees neither.
    const view = this.view()
    for (const p of previous.values()) {
      if (seen.has(p.id) || zoom < minzoom(p) || !view(p)) continue
      seen.add(p.id)
      // Placed again rather than kept: the terrain under it may have loaded,
      // or changed level of detail, since.
      this.placements.push(this.place(p, terrain, detailed(p)))
    }
    // The low model is always wanted, detailed or not: it is what stands in
    // until the detail model arrives, and its footprint is what hides the
    // buildings and samples the ground.
    const now = performance.now()
    for (const p of [...this.placements, ...this.leaving]) {
      this.load(p.model, now)
      if (p.detailed) this.load(p.detail!.model, now)
    }
    this.leave([...previous.values()].filter(p => !seen.has(p.id) && this.ready(p.model)), seen)
    this.contained = this.findContained()
    this.report()
  }

  /** Whether a point is on screen or near it, with half a screen to spare. */
  private view(): (at: { lng: number; lat: number }) => boolean {
    const bounds = this.map.getBounds?.()
    if (!bounds) return () => true
    const [w, s, e, n] = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]
    const [dx, dy] = [(e - w) / 2, (n - s) / 2]
    return at => at.lng >= w - dx && at.lng <= e + dx && at.lat >= s - dy && at.lat <= n + dy
  }

  /**
   * Keep drawing landmarks that have just left until the buildings they hid
   * have been laid out again, so the swap back has no gap.
   */
  private leave(gone: Placement[], present: Set<string>) {
    this.leaving = [...this.leaving.filter(p => !present.has(p.id) && !gone.some(g => g.id === p.id)), ...gone]
    if (!gone.length) return
    const token = ++this.lingering
    const started = performance.now()
    const check = () => {
      if (token !== this.lingering || !this.map) return
      const sources = (this.options.buildings ?? []).map(b => b.source)
      const loaded = sources.every(id => {
        try {
          return this.map.isSourceLoaded(id)
        } catch {
          return true
        }
      })
      if (loaded || performance.now() - started > LINGER_MS) {
        this.leaving = []
        this.map.triggerRepaint?.()
      } else setTimeout(check, 100)
    }
    // Give the filter change a moment to start the reload it waits on.
    setTimeout(check, 150)
  }

  /**
   * Reads the terrain's height at a point, or null with the terrain off.
   *
   * Straight from the DEM at one zoom rather than `queryTerrainElevation`,
   * which works out the covering tiles on every call — this runs 49 times a
   * landmark. MapLibre answers 0 where the tile at that zoom has not loaded,
   * so it steps down the levels until one has.
   */
  private groundSampler(): ((point: [number, number]) => number) | null {
    if (!this.map.getTerrain?.()) return null
    const terrain = this.map.terrain
    if (!terrain?.getElevationForLngLatZoom) return point => this.map.queryTerrainElevation(point) ?? 0
    const top = Math.min(Math.floor(this.map.getZoom()), terrain.tileManager?.maxzoom ?? 15)
    return ([lng, lat]) => {
      const at = { lng, lat, wrap: () => at }
      for (let z = top; z >= Math.max(0, top - 6); z--) {
        const h = terrain.getElevationForLngLatZoom(at, z)
        if (h) return h
      }
      return 0
    }
  }

  /**
   * A landmark set on the terrain as it stands now: its base at the lowest
   * ground under its footprint, and the rise of the ground above that, per
   * grid point, for the vertex shader. Until the model has loaded its extent
   * is unknown, so the anchor stands in; the load invalidates and this runs
   * again.
   */
  private place(
    landmark: Landmark,
    sample: ((point: [number, number]) => number) | null,
    detailed: boolean,
  ): Placement {
    const footprint = this.models.get(landmark.model)?.footprint
    const ground = new Float32Array(GROUND_GRID * GROUND_GRID)
    let base = 0, groundMean = 0, sink = 0
    if (sample) {
      const heights = (footprint ? groundGrid(landmark, footprint) : [[landmark.lng, landmark.lat] as [number, number]]).map(sample)
      // A 0 among real heights is a tile that has not loaded, not the sea:
      // read it as the lowest ground rather than burying the model to 0.
      const loaded = heights.some(h => h !== 0)
      const known = loaded ? heights.filter(h => h !== 0) : heights
      const lowest = Math.min(...known)
      base = lowest - GROUND_SINK
      sink = GROUND_SINK
      if (footprint) {
        heights.forEach((h, i) => { ground[i] = (loaded && h === 0 ? 0 : h - lowest) / landmark.scale })
        groundMean = ground.reduce((a, b) => a + b, 0) / ground.length
      }
    }
    const placed: Anchor = { x: 0, y: 0, z: 0, perMetre: 0 }
    project(landmark.lng, landmark.lat, base + landmark.elevation, placed)
    const doors = new Float32Array(landmark.entrances.flat())
    return { ...landmark, placed, ground, groundMean, sink, detailed, doors }
  }

  /**
   * The model to draw a placement with: its detail model when it is close
   * enough and that has loaded, else its low one — so a landmark crossing the
   * detail zoom keeps its old model on screen until the new one can replace
   * it. Nothing until the low model is in, since that is what decides which
   * buildings make way.
   */
  private drawnModel(p: Placement): Model | null {
    const low = this.models.get(p.model)
    if (!low?.primitives) return null
    const detail = p.detailed ? this.models.get(p.detail!.model) : undefined
    return detail?.primitives ? detail : low
  }


  /**
   * Buildings lying wholly inside the footprint of a landmark that can be
   * drawn.
   *
   * Judged per id across every loaded tile, not per piece: one building can
   * arrive cut into several tiles, and on the basemap one id can stand for
   * many buildings — Planetiler merges every building of the same height in
   * a z14 tile into a single multipolygon. A piece that happens to be clipped
   * down to just the landmark's building says nothing about the rest of that
   * id, and the filter would hide all of it. So an id qualifies only if no
   * loaded piece of it lies outside a landmark.
   */
  private findContained(): Replaced {
    const drawn = this.placements
      .map(p => ({ p, footprint: this.models.get(p.model)?.footprint }))
      .filter((d): d is { p: Placement; footprint: Footprint } => !!d.footprint)
    if (!drawn.length) {
      this.hiddenFor.clear()
      return { refs: [], featureIds: [] }
    }
    const verdict = new Map<string | number, string | false>()
    for (const { source, sourceLayer } of this.options.buildings ?? []) {
      let features: any[] = []
      try {
        features = this.map.querySourceFeatures(source, { sourceLayer })
      } catch {
        continue
      }
      for (const feature of features) {
        const key = sourceLayer === 'building' ? feature.id : feature.properties?.id
        if (key === undefined || key === null || verdict.get(key) === false) continue
        const rings = polygonRings(feature.geometry)
        const first = rings[0]?.[0]
        // The first vertex rules almost every building out without the full
        // test, which matters on a Manhattan tile with thousands of them.
        const inside = !!first && drawn.find(({ p, footprint }) => {
          const reach = Math.max(-footprint.minX, footprint.maxX, -footprint.minZ, footprint.maxZ) * p.scale * 1.5
          const k = Math.cos((p.lat * Math.PI) / 180) * 111320
          if (Math.abs(first[0] - p.lng) * k > reach || Math.abs(first[1] - p.lat) * 110574 > reach) return false
          return insideFootprint(p, footprint, rings)
        })
        verdict.set(key, inside ? inside.p.id : false)
      }
    }
    // A key goes back on show only on evidence: a loaded piece of it outside
    // every landmark, or its landmark gone. One no tile holds right now stays
    // hidden — there is nothing of it to draw, and it will be back.
    const placed = new Set(drawn.map(d => d.p.id))
    for (const [key, landmark] of verdict) {
      if (landmark) this.hiddenFor.set(key, landmark)
      else this.hiddenFor.delete(key)
    }
    for (const [key, landmark] of this.hiddenFor) if (!placed.has(landmark)) this.hiddenFor.delete(key)
    const refs: string[] = []
    const featureIds: number[] = []
    for (const key of this.hiddenFor.keys()) {
      if (typeof key === 'number') featureIds.push(key)
      else refs.push(key)
    }
    return { refs, featureIds }
  }

  /**
   * Hand the caller the refs of every landmark that can actually be drawn,
   * and the credits its models carry — a CC-BY model has to be credited on
   * the map, but only while it is the one on screen.
   */
  private report() {
    const drawn = this.placements.filter(p => this.ready(p.model))
    const refs = [...new Set([...drawn.flatMap(p => p.replaces), ...this.contained.refs])].sort()
    const featureIds = [...new Set(this.contained.featureIds)].sort((a, b) => a - b)
    const key = `${refs.join(' ')}|${featureIds.join(' ')}`
    if (key !== this.replaced) {
      this.replaced = key
      this.options.onReplace({ refs, featureIds })
    }
    const credits = [...new Set(drawn.flatMap(p => (p.attribution ? [p.attribution] : [])))].sort()
    const credited = credits.join('\n')
    if (credited !== this.credited) {
      this.credited = credited
      this.options.onAttribution?.(credits)
    }
  }

  /** What to draw this frame: the placed landmarks and any still leaving. */
  private drawable(): Placement[] {
    return this.leaving.length ? [...this.placements, ...this.leaving] : this.placements
  }

  private ready(file: string) {
    const model = this.models.get(file)
    return !!(model?.primitives || model?.pending)
  }

  private load(file: string, now: number) {
    const known = this.models.get(file)
    if (known) {
      known.used = now
      return
    }
    const model: Model = { pending: null, primitives: null, footprint: null, used: now, animation: null, pose: null, reach: 0 }
    this.models.set(file, model)
    void (async () => {
      const response = await fetch(this.options.modelUrl(file))
      if (!response.ok) throw new Error(`${file}: ${response.status}`)
      const glb = parseGlb(await response.arrayBuffer(), { animation: true })
      // Unpremultiplied: a painted window texture is alpha 0 on its panes,
      // and premultiplying would turn every window black by day.
      const images = await Promise.all(glb.primitives.map(p => p.image
        ? createImageBitmap(new Blob([p.image.bytes as BlobPart], { type: p.image.mimeType }), {
          premultiplyAlpha: 'none',
          colorSpaceConversion: 'none',
        })
        : null))
      model.pending = { glb, images }
      // At rest, for a model that moves: the footprint decides which
      // buildings it hides, and the ground is sampled under it, so it is
      // what the model covers as it stands rather than all it sweeps.
      model.footprint = { minX: glb.min[0], maxX: glb.max[0], minZ: glb.min[2], maxZ: glb.max[2] }
      model.animation = glb.animation
      model.reach = Math.max(-glb.min[0], glb.max[0], -glb.min[2], glb.max[2], glb.max[1])
      // Its footprint can now be searched, which the last gather could not.
      this.invalidate()
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
    this.evict(gl)
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
          // A facade is almost always seen at a grazing angle on a pitched map,
          // where plain trilinear filtering blurs a window grid to mush long
          // before it is small. Anisotropic filtering keeps it crisp.
          const aniso = gl.getExtension('EXT_texture_filter_anisotropic')
          if (aniso) {
            const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)
            gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max))
          }
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
          painted: !!texture && p.alphaMode !== 'MASK',
          // A painted texture is drawn opaque whatever its alpha says: on a
          // facade the alpha is the window mask, not coverage.
          cutoff: texture && p.alphaMode === 'MASK' ? p.alphaCutoff : -1,
          doubleSided: p.doubleSided,
          material: p.material,
          node: p.node,
        }
      })
      model.pending = null
    }
  }

  /**
   * Free the GPU copies of models no placement has wanted for a while. Only
   * uploaded ones: one still downloading is about to be wanted, and one that
   * failed is kept as a marker so it is not asked for again.
   */
  private evict(gl: WebGL2RenderingContext) {
    const now = performance.now()
    if (now - this.evicted < EVICT_EVERY_MS) return
    this.evicted = now
    // Whatever a placement still refers to stays, however long since it was
    // drawn: a detailed landmark leaves its low model idle, but that is the
    // one its footprint and its fallback come from.
    const wanted = new Set(this.drawable().flatMap(p => p.detailed ? [p.model, p.detail!.model] : [p.model]))
    for (const [file, model] of this.models) {
      if (!model.primitives || wanted.has(file) || now - model.used < EVICT_AFTER_MS) continue
      release(gl, model)
      // Forgotten rather than kept empty, so a return fetches it again —
      // from the HTTP cache, the name being content-addressed.
      this.models.delete(file)
    }
  }

  /**
   * Draw every landmark's shadow into the building shade layer's mask. Called
   * by that layer, mid-pass, with its framebuffer and stencil already set up.
   */
  drawShadow(gl: WebGL2RenderingContext, frame: ShadowFrame) {
    this.upload(gl)
    const placements = this.drawable()
    if (!placements.length) return
    const { program, u } = this.shadow
    gl.useProgram(program)
    // Both faces: a shadow has no front.
    gl.disable(gl.CULL_FACE)
    for (const p of placements) {
      const model = this.drawnModel(p)
      if (!model?.primitives) continue
      const { perMetre } = p.placed
      gl.uniformMatrix4fv(u.u_matrix, false, anchorMatrix(frame.matrix, p.placed))
      gl.uniformMatrix3fv(u.u_local, false, localMatrix(p.bearing, p.scale))
      gl.uniform2f(u.u_shear, frame.shear[0] / perMetre, frame.shear[1] / perMetre)
      // The origin sits GROUND_SINK below the lowest ground when terrain is on.
      gl.uniform1f(u.u_lift, p.elevation - p.sink)
      const b = (p.bearing * Math.PI) / 180
      gl.uniform3f(u.u_plan, Math.cos(b), Math.sin(b), p.scale)
      this.groundUniforms(gl, u, p)
      this.drawPrimitives(gl, model.primitives, u, false, this.poseOf(model))
    }
    gl.bindVertexArray(null)
  }

  render(gl: WebGL2RenderingContext, args: any) {
    this.upload(gl)
    const placements = this.drawable()
    if (!placements.length) return this.restore()

    const matrix = args?.defaultProjectionData?.mainMatrix ?? args?.modelViewProjectionMatrix ?? args
    const painter = this.map.painter
    const range = painter?.renderContext?.depthRangeFor3D ?? painter?.depthRangeFor3D
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
    gl.uniform3fv(u.u_tint, this.options.flavor.tint)

    const now = performance.now()
    let moving = false
    let onScreen: ((p: Placement, reach: number) => boolean) | null = null
    for (const p of placements) {
      const model = this.drawnModel(p)
      if (!model?.primitives) continue
      model.used = now
      gl.uniformMatrix4fv(u.u_matrix, false, anchorMatrix(matrix, p.placed))
      gl.uniformMatrix3fv(u.u_local, false, localMatrix(p.bearing, p.scale))
      gl.uniformMatrix3fv(u.u_turn, false, localMatrix(p.bearing, 1))
      this.groundUniforms(gl, u, p)
      const pose = this.poseOf(model, now)
      this.drawPrimitives(gl, model.primitives, u, true, pose)
      if (pose && !moving && !this.stillness?.matches) moving = (onScreen ??= this.onScreen())(p, model.reach)
    }
    if (this.options.flavor.night) this.drawEntrances(gl, matrix, placements)
    gl.bindVertexArray(null)
    this.restore()
    // Something on screen is moving, so ask for the next frame. Only then:
    // a map with nothing turning in view stays idle between gestures.
    if (moving) this.map.triggerRepaint?.()
  }

  /**
   * A model's moving parts as they stand now, looping, or held at t = 0 for
   * someone who has asked for less motion. Shared by every placement of the
   * model, and by its shadow, within a frame.
   */
  private poseOf(model: Model, now = performance.now()): Map<number, Float32Array> | null {
    if (!model.animation) return null
    const at = this.stillness?.matches ? 0 : now / 1000
    if (model.pose?.at !== at) model.pose = { at, nodes: poseGlb(model, at) ?? new Map() }
    return model.pose.nodes
  }

  /**
   * Whether a placement can be seen, with its model's reach to spare —
   * sideways, and up, which on a pitched map can bring a tall model's top
   * into view while its anchor is below the bottom edge.
   */
  private onScreen(): (p: Placement, reach: number) => boolean {
    const bounds = this.map.getBounds?.()
    if (!bounds) return () => true
    const [w, s, e, n] = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]
    return (p, reach) => {
      const metres = reach * p.scale
      const dLat = metres / 110574
      const dLng = metres / (111320 * Math.max(0.01, Math.cos((p.lat * Math.PI) / 180)))
      return p.lng >= w - dLng && p.lng <= e + dLng && p.lat >= s - dLat && p.lat <= n + dLat
    }
  }

  /**
   * The terrain under a placement, for GROUND. Always over the low model's
   * footprint, whichever model is drawn: the two share a frame and bounds,
   * and the ground was sampled over that one.
   */
  private groundUniforms(gl: WebGL2RenderingContext, u: Record<string, WebGLUniformLocation | null>, p: Placement) {
    const f = this.models.get(p.model)?.footprint
    gl.uniform1fv(u.u_ground, p.ground)
    gl.uniform1f(u.u_ground_mean, p.groundMean)
    gl.uniform4f(u.u_bounds, f?.minX ?? 0, f?.minZ ?? 0, f?.maxX ?? 1, f?.maxZ ?? 1)
    gl.uniform1f(u.u_blend, GROUND_BLEND / p.scale)
  }

  /**
   * The glow pooled in front of every lit doorway, after the models so it
   * is hidden by whatever stands in front of it. Additive and without depth
   * writes, so glows overlap without sorting and never hide anything.
   */
  private drawEntrances(gl: WebGL2RenderingContext, matrix: ArrayLike<number>, placements: Placement[]) {
    const lit = placements.filter(p => p.doors.length && this.drawnModel(p))
    if (!lit.length || !this.quad) return
    const { program, u } = this.glow
    gl.useProgram(program)
    gl.disable(gl.CULL_FACE)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
    gl.depthMask(false)
    gl.uniform3fv(u.u_glow, ENTRANCE_GLOW.color)
    gl.uniform1f(u.u_opacity, ENTRANCE_GLOW.opacity)
    gl.uniform1f(u.u_radius, GLOW_RADIUS)
    gl.bindVertexArray(this.quad.vao)
    for (const p of lit) {
      gl.uniformMatrix4fv(u.u_matrix, false, anchorMatrix(matrix, p.placed))
      gl.uniformMatrix3fv(u.u_local, false, localMatrix(p.bearing, p.scale))
      this.groundUniforms(gl, u, p)
      gl.uniform3fv(u.u_points, p.doors)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, p.doors.length / 3)
    }
    gl.depthMask(true)
    gl.disable(gl.BLEND)
  }

  private drawPrimitives(
    gl: WebGL2RenderingContext,
    primitives: Primitive[],
    u: Record<string, WebGLUniformLocation | null>,
    shaded: boolean,
    pose: Map<number, Float32Array> | null,
  ) {
    let node: Float32Array | null = null
    for (const primitive of primitives) {
      // Set only when it changes: a static model sets the identity once.
      const at = (primitive.node >= 0 && pose?.get(primitive.node)) || IDENTITY
      if (at !== node) gl.uniformMatrix4fv(u.u_node, false, (node = at))
      if (shaded) {
        if (primitive.doubleSided) gl.disable(gl.CULL_FACE)
        else gl.enable(gl.CULL_FACE)
        const light = materialLight(primitive.material, this.options.flavor.night, primitive.painted)
        gl.uniform3fv(u.u_color, light?.base ?? primitive.color)
        gl.uniform1f(u.u_painted, primitive.painted ? 1 : 0)
        // Linear, to be added in linear light; see DRAW_FS.
        const glow = light?.glow ?? [0, 0, 0]
        const k = light?.intensity ?? 0
        gl.uniform3f(u.u_emission, Math.pow(glow[0], 2.2) * k, Math.pow(glow[1], 2.2) * k, Math.pow(glow[2], 2.2) * k)
        // Only a painted window knows where its panes are; any other window
        // is glass all over.
        gl.uniform1f(u.u_panes, primitive.painted && isWindow(primitive.material) ? 1 : 0)
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
      'depthMask', 'depthFunc', 'depthRange', 'blend', 'blendFunc', 'cullFace', 'cullFaceSide', 'frontFace',
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

/** Hand a model's buffers and textures back to the GPU. */
function release(gl: WebGL2RenderingContext, model: Model) {
  for (const p of model.primitives ?? []) {
    gl.deleteVertexArray(p.vao)
    for (const b of p.buffers) gl.deleteBuffer(b)
    if (p.texture) gl.deleteTexture(p.texture)
  }
  model.primitives = null
  for (const image of model.pending?.images ?? []) image?.close()
  model.pending = null
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

