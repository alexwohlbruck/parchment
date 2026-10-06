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
 */
import { parseGlb, type GlbModel } from './glb.mjs'
import { footprintSamples, insideFootprint, parseLandmark, polygonRings, type Footprint, type Landmark } from './landmarks'
import { project } from './object-layer'

/** Where a landmark stands, in mercator units; see `project`. */
type Anchor = { x: number; y: number; z: number; perMetre: number }

/** Debounce for rebuilding the placement list; see `ObjectLayer.invalidate`. */
const SETTLE = 80

/**
 * Zoom levels below its minzoom that a landmark already on screen is kept
 * for. Without it, a pinch that wavers around the threshold swaps model and
 * building back and forth.
 */
const MINZOOM_HYSTERESIS = 0.3

/**
 * How long a landmark that has left keeps being drawn, at most, while the
 * buildings it hid are laid out again. A filter change re-parses the whole
 * building source in the worker, and dropping the model before that lands
 * leaves an empty lot for a few frames.
 */
const LINGER_MS = 1500

/**
 * Metres a landmark is set below the lowest ground sampled under it. The
 * terrain is sampled at nine points and drawn as a mesh between them, so it
 * can dip a little below every sample; a base that floats over that dip
 * shows daylight under the building, which is worse than burying a plinth.
 */
const GROUND_SINK = 0.5

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
 */
const DRAW_FS = `#version 300 es
  precision highp float;
  uniform vec3 u_color;
  /** 1 when the primitive's texture paints its surface rather than only cutting it. */
  uniform float u_painted;
  uniform vec3 u_tint;
  uniform vec3 u_lightpos;
  uniform float u_lightintensity;
  in vec3 v_normal;
  ${MASK}
  out vec4 fragColor;
  void main() {
    cut();
    // A painted texture carries the surface's colour, multiplied by the
    // material's — which is how a facade gets a grid of windows that
    // mipmaps to the right tone at a distance instead of shimmering.
    vec3 base = u_painted > 0.5 ? u_color * texture(u_mask, v_uv).rgb : u_color;
    vec3 n = normalize(v_normal);
    // A double-sided face seen from behind is lit as the side you can see.
    if (!gl_FrontFacing) n = -n;
    float value = dot(base, vec3(0.2126, 0.7152, 0.0722));
    float directional = clamp(dot(n, u_lightpos), 0.0, 1.0);
    directional = mix(1.0 - u_lightintensity, max(1.0 - value + u_lightintensity, 1.0), directional);
    float sky = mix(0.84, 1.05, n.z * 0.5 + 0.5);
    fragColor = vec4(clamp((base + 0.03) * directional * sky * u_tint, 0.0, 1.0), 1.0);
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
  /** Whether the texture paints colour (opaque), as opposed to only cutting with alpha. */
  painted: boolean
  cutoff: number
  doubleSided: boolean
}

type Model = {
  /** Parsed and decoded, waiting for the next frame to put it on the GPU. */
  pending: { glb: GlbModel; images: Array<ImageBitmap | null> } | null
  primitives: Primitive[] | null
  /** Plan extent in the model's own metres, once it has loaded. */
  footprint: Footprint | null
}

/** What a landmark stands in for: OSM refs, and basemap ids found by footprint. */
export type Replaced = { refs: string[]; featureIds: number[] }

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
      ['u_matrix', 'u_local', 'u_turn', 'u_color', 'u_painted', 'u_tint', 'u_lightpos', 'u_lightintensity', 'u_mask', 'u_cutoff'])
    this.shadow = program(gl, SHADOW_VS, SHADOW_FS,
      ['u_matrix', 'u_local', 'u_shear', 'u_lift', 'u_mask', 'u_cutoff'])

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
    for (const model of this.models.values())
      for (const p of model.primitives ?? []) {
        gl.deleteVertexArray(p.vao)
        for (const b of p.buffers) gl.deleteBuffer(b)
        if (p.texture) gl.deleteTexture(p.texture)
      }
    this.models.clear()
    gl.deleteProgram(this.draw.program)
    gl.deleteProgram(this.shadow.program)
    // Give the buildings back, and take the credits down with the models.
    if (this.replaced) this.options.onReplace({ refs: [], featureIds: [] })
    if (this.credited) this.options.onAttribution?.([])
    this.replaced = ''
    this.credited = ''
    this.map = null
  }

  /** What is being drawn, for the console. Dev only. */
  get drawn(): Array<{ id: string; model: string; ready: boolean }> {
    return this.placements.map(p => ({ id: p.id, model: p.model, ready: !!this.ready(p.model) }))
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
    const terrain = this.map.getTerrain?.() ? this.map : null
    const previous = new Map(this.placements.map(p => [p.id, p]))
    const minzoom = (l: Landmark) => l.minzoom - (previous.has(l.id) ? MINZOOM_HYSTERESIS : 0)
    const seen = new Set<string>()
    this.placements = []
    for (const feature of features) {
      const landmark = parseLandmark(feature)
      if (!landmark || seen.has(landmark.id) || zoom < minzoom(landmark)) continue
      seen.add(landmark.id)
      this.load(landmark.model)
      this.placements.push(this.place(landmark, terrain))
    }
    // A landmark whose tile is between loads is still there: mid-zoom the
    // old tiles go before the new ones arrive, and the query sees neither.
    const view = this.view()
    for (const p of previous.values()) {
      if (seen.has(p.id) || zoom < minzoom(p) || !view(p)) continue
      seen.add(p.id)
      // Placed again rather than kept: the terrain under it may have loaded,
      // or changed level of detail, since.
      this.placements.push(this.place(p, terrain))
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
   * The lowest terrain under a landmark's footprint, which its model is built
   * up from. Until the model has loaded its extent is unknown, so the anchor
   * stands in; the load invalidates and this runs again.
   */
  private lowestGround(terrain: any, landmark: Landmark): number {
    const footprint = this.models.get(landmark.model)?.footprint
    const points = footprint ? footprintSamples(landmark, footprint) : [[landmark.lng, landmark.lat]]
    const heights = points
      .map(point => terrain.queryTerrainElevation(point))
      .filter((h): h is number => typeof h === 'number' && Number.isFinite(h))
    // MapLibre answers 0 for a point whose elevation tile has not loaded, and
    // the lowest of the samples would take that 0 and bury the model. Real
    // ground at exactly 0 under one corner and not the others is not a thing,
    // so a 0 among non-zero samples is read as "not loaded yet"; the layer is
    // placed again when the tile arrives.
    const known = heights.some(h => h !== 0) ? heights.filter(h => h !== 0) : heights
    return known.length ? Math.min(...known) - GROUND_SINK : 0
  }

  /** A landmark positioned on the ground as the terrain stands now. */
  private place(landmark: Landmark, terrain: any): Placement {
    const ground = terrain ? this.lowestGround(terrain, landmark) : 0
    const placed: Anchor = { x: 0, y: 0, z: 0, perMetre: 0 }
    project(landmark.lng, landmark.lat, ground + landmark.elevation, placed)
    return { ...landmark, placed }
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

  private load(file: string) {
    if (this.models.has(file)) return
    const model: Model = { pending: null, primitives: null, footprint: null }
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
      model.footprint = { minX: glb.min[0], maxX: glb.max[0], minZ: glb.min[2], maxZ: glb.max[2] }
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
    const placements = this.drawable()
    if (!placements.length) return
    const { program, u } = this.shadow
    gl.useProgram(program)
    // Both faces: a shadow has no front.
    gl.disable(gl.CULL_FACE)
    for (const p of placements) {
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
    const placements = this.drawable()
    if (!placements.length) return this.restore()

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

    for (const p of placements) {
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
        gl.uniform1f(u.u_painted, primitive.painted ? 1 : 0)
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

