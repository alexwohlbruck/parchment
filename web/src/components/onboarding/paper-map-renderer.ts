import logoSvg from '@/assets/parchment.svg?raw'
import { coverPanel, foldPanel, planFolds, type FoldPlan } from '@/lib/onboarding/paper-fold'

export interface PaperRect {
  left: number
  top: number
  width: number
  height: number
}

interface Beat {
  crease: number
  start: number
  end: number
}

const THICKNESS = 0.15
const BEND = 0.55
const INTRO = 380
const LOGO = 88
const SETTLE = 450
const OVERLAP = 0.18
const INK = '#6b4f2a'

const VERTEX = `#version 300 es
in vec3 a_position;
in vec3 a_normal;
in vec2 a_flat;
uniform vec2 u_viewport;
uniform float u_distance;
out vec2 v_flat;
out vec3 v_normal;
out vec3 v_world;
void main() {
  vec2 center = u_viewport * 0.5;
  float depth = u_distance - a_position.z;
  vec2 screen = center + (a_position.xy - center) * u_distance / depth;
  vec2 ndc = vec2(screen.x / u_viewport.x * 2.0 - 1.0, 1.0 - screen.y / u_viewport.y * 2.0);
  gl_Position = vec4(ndc * depth, -a_position.z / 4000.0 * depth, depth);
  v_flat = a_flat;
  v_normal = a_normal;
  v_world = a_position;
}`

const FRAGMENT = `#version 300 es
precision highp float;
#define MAX_LINES 32
#define PATTERN_STEP 120.0
in vec2 v_flat;
in vec3 v_normal;
in vec3 v_world;
uniform sampler2D u_map;
uniform sampler2D u_cover;
uniform vec2 u_size;
uniform sampler2D u_pattern;
uniform float u_xLines[MAX_LINES];
uniform float u_yLines[MAX_LINES];
uniform int u_xCount;
uniform int u_yCount;
uniform vec4 u_coverRect;
uniform vec2 u_viewport;
uniform float u_distance;
uniform float u_ink;
uniform float u_finish;
uniform float u_light;
out vec4 color;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

void main() {
  vec3 eye = normalize(vec3(u_viewport * 0.5, u_distance) - v_world);
  vec3 n = normalize(v_normal);
  bool front = dot(n, eye) > 0.0;
  if (!front) n = -n;

  float grain = noise(v_flat * 0.35) * 0.6 + noise(v_flat * 1.7) * 0.4;
  float fibre = noise(vec2(v_flat.x * 0.08, v_flat.y * 2.2));
  vec3 paper = vec3(0.957, 0.925, 0.86) * (0.95 + 0.05 * grain) * (0.985 + 0.015 * fibre);

  float crease = 1e6;
  for (int i = 1; i < MAX_LINES; i++) {
    if (i < u_xCount - 1) crease = min(crease, abs(v_flat.x - u_xLines[i]));
    if (i < u_yCount - 1) crease = min(crease, abs(v_flat.y - u_yLines[i]));
  }
  float creaseShade = 1.0 - 0.1 * (1.0 - smoothstep(0.0, 2.5, crease));

  vec3 light = normalize(vec3(-0.45, -0.6, 0.66));
  float lambert = max(dot(n, light), 0.0) / light.z;
  float sheen = pow(max(dot(reflect(-light, n), eye), 0.0), 24.0) * 0.06;
  float shade = mix(1.0, mix(0.62, 1.0, lambert) * creaseShade, u_light);
  sheen *= u_light;

  vec3 surface;
  if (front) {
    vec3 map = texture(u_map, v_flat / u_size).rgb;
    float tone = dot(map, vec3(0.299, 0.587, 0.114));
    vec3 printed = mix(map, paper * mix(vec3(0.42, 0.33, 0.22), vec3(1.0), tone), 0.55) * (0.96 + 0.04 * grain);
    surface = mix(map, printed, u_ink);
    color = vec4(mix(surface * shade + sheen, map, u_finish), 1.0);
    return;
  }

  vec2 diagonal = mat2(0.7071, -0.7071, 0.7071, 0.7071) * v_flat / PATTERN_STEP;
  diagonal.x += mod(floor(diagonal.y), 2.0) * 0.5;
  float mark = texture(u_pattern, fract(diagonal)).a;
  surface = mix(paper, vec3(0.42, 0.31, 0.17), mark * 0.13);
  vec2 local = (v_flat - u_coverRect.xy) / u_coverRect.zw;
  if (all(greaterThanEqual(local, vec2(0.0))) && all(lessThanEqual(local, vec2(1.0)))) {
    vec4 art = texture(u_cover, local);
    surface = surface * (1.0 - art.a) + art.rgb;
  }
  color = vec4(surface * shade + sheen, 1.0);
}`

const SHADOW_VERTEX = `#version 300 es
in vec2 a_corner;
uniform vec4 u_box;
uniform vec2 u_viewport;
uniform float u_blur;
out vec2 v_pos;
void main() {
  v_pos = mix(u_box.xy - u_blur, u_box.zw + u_blur, a_corner);
  gl_Position = vec4(v_pos.x / u_viewport.x * 2.0 - 1.0, 1.0 - v_pos.y / u_viewport.y * 2.0, 0.999, 1.0);
}`

const SHADOW_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_pos;
uniform vec4 u_box;
uniform float u_blur;
uniform float u_alpha;
out vec4 color;
void main() {
  vec2 half_ = (u_box.zw - u_box.xy) * 0.5;
  vec2 d = abs(v_pos - (u_box.xy + half_)) - half_;
  float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  float a = (1.0 - smoothstep(-u_blur * 0.5, u_blur, dist)) * u_alpha;
  color = vec4(vec3(0.12, 0.08, 0.04) * a, a);
}`

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
const snapOpen = (t: number) => easeInOut(Math.min(1, t / 0.75)) + (t > 0.6 ? 0.06 * Math.sin((Math.PI * (t - 0.6)) / 0.4) : 0)

function compile(gl: WebGL2RenderingContext, vertex: string, fragment: string) {
  const program = gl.createProgram()!
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader')
    gl.attachShader(program, shader)
  }
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link')
  return program
}

function texture(gl: WebGL2RenderingContext, source: TexImageSource) {
  const tex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return tex
}

type Mirror = { x: boolean; y: boolean }

function drawFace(face: HTMLCanvasElement, mirror: Mirror) {
  const canvas = document.createElement('canvas')
  canvas.width = face.width
  canvas.height = face.height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = `hsl(${getComputedStyle(document.documentElement).getPropertyValue('--background').trim()})`
  ctx.fillRect(0, 0, face.width, face.height)
  ctx.translate(face.width / 2, face.height / 2)
  ctx.scale(mirror.x ? -1 : 1, mirror.y ? -1 : 1)
  ctx.drawImage(face, -face.width / 2, -face.height / 2)
  return canvas
}

async function loadLogo() {
  const logo = new Image()
  logo.src = URL.createObjectURL(new Blob([logoSvg.replace(/currentColor/g, INK)], { type: 'image/svg+xml' }))
  await logo.decode().catch(() => {})
  URL.revokeObjectURL(logo.src)
  return logo.naturalWidth ? logo : null
}

function drawCover(logo: HTMLImageElement | null, width: number, height: number, mirror: Mirror) {
  const scale = Math.min(window.devicePixelRatio || 1, 2)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d')!
  if (!logo) return canvas
  ctx.scale(scale, scale)
  ctx.translate(width / 2, height / 2)
  ctx.scale(mirror.x ? -1 : 1, mirror.y ? -1 : 1)
  ctx.drawImage(logo, -LOGO / 2, -LOGO / 2, LOGO, LOGO)
  return canvas
}

/** One tile of the logo print on the paper's back, pre-mirrored to read right once a flap turns over. */
function drawPattern(logo: HTMLImageElement | null) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')!
  if (!logo) return canvas
  ctx.translate(64, 64)
  ctx.rotate(Math.PI / 4)
  ctx.scale(-1, 1)
  ctx.drawImage(logo, -18, -18, 36, 36)
  return canvas
}

export class PaperMapRenderer {
  readonly duration: number
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private shadow: WebGLProgram
  private plan: FoldPlan
  private beats: Beat[]
  private panels: Float32Array[]
  private positions: Float32Array
  private normals: Float32Array
  private positionBuffer: WebGLBuffer
  private normalBuffer: WebGLBuffer
  private indexCount: number
  private segments: number
  private panelRects: { x: number; y: number; width: number; height: number }[]
  private frame = 0
  private vao: WebGLVertexArrayObject | null
  private shadowBuffer: WebGLBuffer | null = null
  private viewport: { width: number; height: number }

  private constructor(private canvas: HTMLCanvasElement, map: TexImageSource, cover: HTMLCanvasElement, pattern: HTMLCanvasElement, private rect: PaperRect, private origin: PaperRect, plan: FoldPlan, private dark: boolean) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: true, alpha: true })
    if (!gl) throw new Error('webgl2 unavailable')
    this.gl = gl
    this.plan = plan
    this.viewport = { width: window.innerWidth, height: window.innerHeight }
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(this.viewport.width * dpr)
    canvas.height = Math.round(this.viewport.height * dpr)

    this.program = compile(gl, VERTEX, FRAGMENT)
    this.shadow = compile(gl, SHADOW_VERTEX, SHADOW_FRAGMENT)

    let t = INTRO
    this.beats = plan.creases.map((_, i) => plan.creases.length - 1 - i).map((crease, order) => {
      const length = 1360 + order * 140
      const beat = { crease, start: t, end: t + length }
      t = beat.end - length * OVERLAP
      return beat
    })
    t = this.beats[this.beats.length - 1].end
    this.duration = t + SETTLE

    const { x: xs, y: ys } = plan.lines
    const cells = (xs.length - 1) * (ys.length - 1)
    this.segments = Math.max(2, Math.min(14, Math.round(Math.sqrt(18000 / cells))))
    const side = this.segments + 1
    const perPanel = side * side
    const flat = new Float32Array(cells * perPanel * 2)
    const indices: number[] = []
    this.panels = []
    this.panelRects = []
    for (let row = 0; row < ys.length - 1; row++) {
      for (let col = 0; col < xs.length - 1; col++) {
        const rect = { x: xs[col], y: ys[row], width: xs[col + 1] - xs[col], height: ys[row + 1] - ys[row] }
        const base = this.panels.length * perPanel
        for (let j = 0; j < side; j++) {
          for (let i = 0; i < side; i++) {
            const v = j * side + i
            flat.set([rect.x + (i / this.segments) * rect.width, rect.y + (j / this.segments) * rect.height], (base + v) * 2)
            if (i < this.segments && j < this.segments) {
              const a = base + v
              indices.push(a, a + 1, a + side, a + 1, a + side + 1, a + side)
            }
          }
        }
        this.panels.push(new Float32Array((perPanel + 1) * 3))
        this.panelRects.push(rect)
      }
    }
    this.indexCount = indices.length
    this.positions = new Float32Array(cells * perPanel * 3)
    this.normals = new Float32Array(cells * perPanel * 3)

    gl.useProgram(this.program)
    const attribute = (name: string, data: Float32Array, size: number, usage: number) => {
      const buffer = gl.createBuffer()!
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, data, usage)
      const location = gl.getAttribLocation(this.program, name)
      gl.enableVertexAttribArray(location)
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0)
      return buffer
    }
    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    attribute('a_flat', flat, 2, gl.STATIC_DRAW)
    this.positionBuffer = attribute('a_position', this.positions, 3, gl.DYNAMIC_DRAW)
    this.normalBuffer = attribute('a_normal', this.normals, 3, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW)

    const coverRect = coverPanel(plan)
    gl.activeTexture(gl.TEXTURE0)
    texture(gl, map)
    gl.activeTexture(gl.TEXTURE1)
    texture(gl, cover)
    gl.activeTexture(gl.TEXTURE2)
    const patternTexture = texture(gl, pattern)
    gl.bindTexture(gl.TEXTURE_2D, patternTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
    const uniform = (name: string) => gl.getUniformLocation(this.program, name)
    gl.uniform1i(uniform('u_map'), 0)
    gl.uniform1i(uniform('u_cover'), 1)
    gl.uniform2f(uniform('u_size'), plan.width, plan.height)
    gl.uniform1i(uniform('u_pattern'), 2)
    gl.uniform1fv(uniform('u_xLines'), new Float32Array(32).fill(-1e6).map((v, i) => xs[i] ?? v))
    gl.uniform1fv(uniform('u_yLines'), new Float32Array(32).fill(-1e6).map((v, i) => ys[i] ?? v))
    gl.uniform1i(uniform('u_xCount'), Math.min(xs.length, 32))
    gl.uniform1i(uniform('u_yCount'), Math.min(ys.length, 32))
    gl.uniform4f(uniform('u_coverRect'), coverRect.x, coverRect.y, coverRect.width, coverRect.height)
    gl.bindVertexArray(null)
    this.vao = vao
  }

  /** When the final fold lands flat. */
  get landAt() {
    return this.beats[this.beats.length - 1].end
  }

  /** When the final fold begins: the app around the paper can show from here. */
  get revealAt() {
    return this.beats[this.beats.length - 1].start
  }

  /** Unfolds `map` to `rect`, starting as a folded packet that exactly covers `origin`, showing `face` on top. */
  static async create(canvas: HTMLCanvasElement, map: TexImageSource, rect: PaperRect, origin: PaperRect, face: HTMLCanvasElement | null, dark: boolean) {
    const plan = planFolds(rect.width, rect.height, origin.width, origin.height, THICKNESS)
    const cover = coverPanel(plan)
    const logo = await loadLogo()
    const front = face ? drawFace(face, cover.mirror) : drawCover(logo, cover.width, cover.height, cover.mirror)
    return new PaperMapRenderer(canvas, map, front, drawPattern(logo), rect, origin, plan, dark)
  }

  play() {
    this.render(0)
    const start = performance.now()
    const tick = (now: number) => {
      const t = now - start
      this.render(Math.min(t, this.duration))
      if (t < this.duration) this.frame = requestAnimationFrame(tick)
    }
    this.frame = requestAnimationFrame(tick)
  }

  destroy() {
    cancelAnimationFrame(this.frame)
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }

  private angles(t: number) {
    const angles = this.plan.creases.map(() => Math.PI)
    for (const beat of this.beats) {
      angles[beat.crease] = Math.PI * (1 - snapOpen(clamp01((t - beat.start) / (beat.end - beat.start))))
    }
    return angles
  }

  private packetCenter(angles: number[]) {
    let w = this.plan.width
    let h = this.plan.height
    this.plan.creases.forEach((crease, i) => {
      if (angles[i] <= 0) return
      const extent = crease.at + (crease.extent - crease.at) * (1 - angles[i] / Math.PI)
      if (crease.axis === 'x') w = Math.min(w, extent)
      else h = Math.min(h, extent)
    })
    return { x: w / 2, y: h / 2 }
  }

  private render(t: number) {
    const { gl, plan, viewport } = this
    const angles = this.angles(t)
    const foldsEnd = this.beats[this.beats.length - 1].end
    const grow = easeInOut(clamp01(t / foldsEnd))
    const lifted = Math.sin(Math.PI * clamp01(t / foldsEnd)) ** 0.7
    let tilt = 0.3 * lifted
    let spin = -0.1 * lifted
    let lift = 70 * lifted
    this.beats.forEach((beat, order) => {
      const bump = Math.sin(Math.PI * clamp01((t - beat.start) / (beat.end - beat.start))) * lifted
      lift += 14 * bump
      spin += (order % 2 ? 0.035 : -0.035) * bump
      tilt += 0.04 * bump
    })
    const cell = plan.packet
    const covers = (this.origin.width * this.origin.height) / (plan.width * plan.height) > 0.6
    const dip = covers ? 1 - 0.38 * Math.sin(Math.PI * clamp01(t / foldsEnd)) ** 0.8 : 1
    const sx = (1 + (this.origin.width / cell.width - 1) * (1 - grow)) * dip
    const sy = (1 + (this.origin.height / cell.height - 1) * (1 - grow)) * dip
    const center = this.packetCenter(angles)
    const target = {
      x: this.rect.left + plan.width / 2 + (this.origin.left + this.origin.width / 2 - this.rect.left - plan.width / 2) * (1 - grow),
      y: this.rect.top + plan.height / 2 + (this.origin.top + this.origin.height / 2 - this.rect.top - plan.height / 2) * (1 - grow),
    }
    const [ct, st, cs, ss] = [Math.cos(tilt), Math.sin(tilt), Math.cos(spin), Math.sin(spin)]

    const side = this.segments + 1
    let out = 0
    const pose3 = (p: Float32Array, i: number) => {
      const x = (p[i] - center.x) * sx
      const y = (p[i + 1] - center.y) * sy
      const z = p[i + 2]
      const y1 = y * ct - z * st
      const z1 = y * st + z * ct
      this.positions[out++] = target.x + x * cs - y1 * ss
      this.positions[out++] = target.y + x * ss + y1 * cs
      this.positions[out++] = z1 + lift
    }

    for (let c = 0; c < this.panels.length; c++) {
      const panel = this.panels[c]
      const rect = this.panelRects[c]
      panel[0] = rect.x + rect.width / 2
      panel[1] = rect.y + rect.height / 2
      panel[2] = 0
      for (let j = 0; j < side; j++) {
        for (let i = 0; i < side; i++) {
          const p = (1 + j * side + i) * 3
          panel[p] = rect.x + (i / this.segments) * rect.width
          panel[p + 1] = rect.y + (j / this.segments) * rect.height
          panel[p + 2] = 0
        }
      }
      foldPanel(panel, plan.creases, angles, BEND)
      const first = out
      for (let v = 3; v < panel.length; v += 3) pose3(panel, v)
      this.panelNormals(first, side)
    }

    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    const distance = Math.max(1600, 1.5 * Math.max(viewport.width, viewport.height))

    this.drawShadow(lift, distance)

    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.positions)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.normals)
    const uniform = (name: string) => gl.getUniformLocation(this.program, name)
    gl.uniform2f(uniform('u_viewport'), viewport.width, viewport.height)
    gl.uniform1f(uniform('u_distance'), distance)
    const lastStart = this.beats[this.beats.length - 1].start
    gl.uniform1f(uniform('u_ink'), 1 - easeInOut(clamp01((t - lastStart) / (this.duration - lastStart))))
    gl.uniform1f(uniform('u_light'), lifted)
    gl.uniform1f(uniform('u_finish'), easeInOut(clamp01((t - foldsEnd) / SETTLE)))
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0)
    gl.disable(gl.DEPTH_TEST)
    gl.bindVertexArray(null)
  }

  private panelNormals(first: number, side: number) {
    const p = this.positions
    const at = (i: number, j: number) => first + (Math.min(j, side - 1) * side + Math.min(i, side - 1)) * 3
    for (let j = 0; j < side; j++) {
      for (let i = 0; i < side; i++) {
        const a = at(Math.max(i - 1, 0), j)
        const b = at(i + 1, j)
        const c = at(i, Math.max(j - 1, 0))
        const d = at(i, j + 1)
        const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
        const vx = p[d] - p[c], vy = p[d + 1] - p[c + 1], vz = p[d + 2] - p[c + 2]
        const nx = uy * vz - uz * vy
        const ny = uz * vx - ux * vz
        const nz = ux * vy - uy * vx
        const len = Math.hypot(nx, ny, nz) || 1
        const o = at(i, j)
        this.normals[o] = nx / len
        this.normals[o + 1] = ny / len
        this.normals[o + 2] = nz / len
      }
    }
  }

  private drawShadow(lift: number, distance: number) {
    const { gl } = this
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let i = 0; i < this.positions.length; i += 3) {
      minX = Math.min(minX, this.positions[i]); maxX = Math.max(maxX, this.positions[i])
      minY = Math.min(minY, this.positions[i + 1]); maxY = Math.max(maxY, this.positions[i + 1])
    }
    const height = Math.min(1, lift / 70)
    const offset = 2 + lift * 0.25
    const blur = 16 + lift * 0.3
    const strength = (this.dark ? 0.08 : 0.05) + (this.dark ? 0.35 : 0.18) * height * (distance / (distance - lift * 0.2))
    gl.useProgram(this.shadow)
    const uniform = (name: string) => gl.getUniformLocation(this.shadow, name)
    gl.uniform4f(uniform('u_box'), minX + offset * 0.4, minY + offset, maxX + offset * 0.4, maxY + offset)
    gl.uniform2f(uniform('u_viewport'), this.viewport.width, this.viewport.height)
    gl.uniform1f(uniform('u_blur'), blur)
    gl.uniform1f(uniform('u_alpha'), Math.min(strength, 0.6))
    if (!this.shadowBuffer) {
      this.shadowBuffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, this.shadowBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.shadowBuffer)
    const location = gl.getAttribLocation(this.shadow, 'a_corner')
    gl.enableVertexAttribArray(location)
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.disable(gl.BLEND)
  }
}
