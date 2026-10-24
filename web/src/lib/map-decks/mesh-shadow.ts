/**
 * A built mesh — decks, tunnel walls — as a shadow caster beside the
 * buildings: sheared along the light onto the ground beneath it, into the
 * building shade's ground mask, and drawn into the sun's shadow map. See
 * `ShadowCaster` in `building-shade.ts`.
 */
import { programReady } from './mesh-program'
import { lightAbout, type SunFrame } from '@/lib/map/sun-shadow'
import { translate } from '@/lib/map-objects/object-layer'
import { metresPerUnit, type Point } from './decks'

// `u_shear` is per metre of height and `u_metres` metres per mercator unit of it.
const MASK_VS = `#version 300 es
  uniform mat4 u_matrix;
  uniform float u_elevation_scale;
  uniform vec2 u_shear;
  uniform float u_metres;
  in vec3 a_position;
  in float a_ground;
  out float v_height;
  void main() {
    v_height = (a_position.z - a_ground) * u_metres;
    gl_Position = u_matrix * vec4(a_position.xy + u_shear * max(v_height, 0.0), a_ground * u_elevation_scale, 1.0);
  }`

// Lower than this a surface lies in its own shadow: a deck end on the ground, a wall down a cut.
const MASK_FS = `#version 300 es
  precision mediump float;
  uniform float u_min;
  in float v_height;
  out vec4 color;
  void main() {
    if (v_height < u_min) discard;
    color = vec4(0.0, 0.0, 0.0, 1.0);
  }`

const DEPTH_VS = `#version 300 es
  uniform mat4 u_matrix;
  uniform float u_elevation_scale;
  uniform bool u_lifted;
  in vec3 a_position;
  in float a_lift;
  void main() { gl_Position = u_matrix * vec4(a_position.xy, u_lifted ? a_position.z + (u_elevation_scale - 1.0) * a_lift : a_position.z * u_elevation_scale, 1.0); }`

const DEPTH_FS = `#version 300 es
  precision mediump float;
  out vec4 color;
  void main() { color = vec4(0.0); }`

/** Metres above the ground below which a surface casts nothing on it. */
const MIN_HEIGHT = 0.5

type Program = { uniforms: string[]; initialized?: boolean; program: WebGLProgram; u: Record<string, WebGLUniformLocation | null>; position: number; ground: number; lift: number }

function link(gl: WebGL2RenderingContext, vs: string, fs: string, uniforms: string[]): Program {
  const program = gl.createProgram()!
  for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    gl.attachShader(program, shader)
    gl.deleteShader(shader)
  }
  gl.linkProgram(program)
  return {
    program,
    uniforms, u: {}, position: -1, ground: -1, lift: -1,
  }
}

/**
 * The ground under a mesh's first `count` vertices in its own z units, from `at` in true metres.
 * A vertex with no ground known stands on itself, and casts nothing.
 */
export function groundBeneath(position: ArrayLike<number>, count: number, origin: Point, at: (p: Point) => number | null, exaggeration = 1): Float32Array {
  const ground = new Float32Array(count)
  // Walls and piers stack many vertices on one spot: each spot, to about a metre, is read once.
  const seen = new Map<number, number | null>()
  for (let i = 0; i < count; i++) {
    const p: Point = [position[i * 3] + origin[0], position[i * 3 + 1] + origin[1]]
    const key = Math.round(p[0] * 2 ** 25) * 2 ** 26 + Math.round(p[1] * 2 ** 25)
    let g = seen.get(key)
    if (g === undefined) {
      const metres = at(p)
      seen.set(key, (g = metres === null || Number.isNaN(metres) ? null : (metres * exaggeration) / metresPerUnit(p[1])))
    }
    ground[i] = g ?? position[i * 3 + 2]
  }
  return ground
}

type SharedPrograms = { mask: Program; depth: Program; users: number }
const sharedPrograms = new WeakMap<WebGL2RenderingContext, SharedPrograms>()

export class MeshShadow {
  private shared: SharedPrograms | null = null
  /** Bumped with every mesh set, for the shade layer's caches. */
  version = 0
  private mask: Program | null = null
  private depth: Program | null = null
  private mesh: { position: WebGLBuffer; ground: WebGLBuffer; lift: WebGLBuffer | null; count: number; origin: Point; exaggeration: number; indices?: WebGLBuffer | null } | null = null

  /** Cast the first `count` vertices in `position`, drawn about `origin`, standing on `ground` (see `groundBeneath`). */
  set(gl: WebGL2RenderingContext, position: WebGLBuffer | null, count: number, ground: Float32Array | null, origin: Point, exaggeration: number, indices?: WebGLBuffer | null, lift: WebGLBuffer | null = null) {
    this.clear(gl)
    this.version++
    if (!position || !ground || !count) return
    this.prepare(gl)
    const buffer = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, ground, gl.STATIC_DRAW)
    this.mesh = { indices, position, ground: buffer, lift, count, origin: [origin[0], origin[1]], exaggeration }
  }

  prepare(gl: WebGL2RenderingContext) {
    // Linked here, by the owning layer, rather than inside another layer's pass.
    if (!this.shared) {
      let shared = sharedPrograms.get(gl)
      if (!shared) {
        shared = { mask: link(gl, MASK_VS, MASK_FS, ['u_elevation_scale', 'u_matrix', 'u_shear', 'u_metres', 'u_min']),
          depth: link(gl, DEPTH_VS, DEPTH_FS, ['u_elevation_scale', 'u_lifted', 'u_matrix']), users: 0 }
        sharedPrograms.set(gl, shared)
      }
      shared.users++
      this.shared = shared
      this.mask = shared.mask
      this.depth = shared.depth
    }
  }

  ready(gl: WebGL2RenderingContext) {
    if (!this.shared) return false
    for (const p of [this.shared.mask, this.shared.depth]) {
      if (!programReady(gl, p.program)) return false
      if (!p.initialized) {
        p.u = Object.fromEntries(p.uniforms.map(name => [name, gl.getUniformLocation(p.program, name)]))
        p.position = gl.getAttribLocation(p.program, 'a_position')
        p.ground = gl.getAttribLocation(p.program, 'a_ground')
        p.lift = gl.getAttribLocation(p.program, 'a_lift')
        p.initialized = true
      }
    }
    return true
  }

  clear(gl: WebGL2RenderingContext) {
    if (this.mesh) gl.deleteBuffer(this.mesh.ground)
    this.mesh = null
  }

  /** Into the ground mask: `shear` is mercator units of offset per metre of height. */
  drawShadow(gl: WebGL2RenderingContext, frame: { matrix: ArrayLike<number>; shear: [number, number] }, elevationScale = 1) {
    const mesh = this.mesh
    const p = this.mask
    if (!mesh || !p || !this.ready(gl)) return
    gl.bindVertexArray(null)
    gl.useProgram(p.program)
    gl.uniform1f(p.u.u_elevation_scale, elevationScale)
    gl.uniformMatrix4fv(p.u.u_matrix, false, translate(frame.matrix, [mesh.origin[0], mesh.origin[1], 0]))
    gl.uniform2f(p.u.u_shear, frame.shear[0], frame.shear[1])
    gl.uniform1f(p.u.u_metres, metresPerUnit(mesh.origin[1]) / mesh.exaggeration)
    gl.uniform1f(p.u.u_min, MIN_HEIGHT)
    gl.disable(gl.CULL_FACE)
    this.drawWith(gl, p)
  }

  /** Into the sun's shadow map, with the pass's own state. */
  drawSunDepth(gl: WebGL2RenderingContext, frame: SunFrame, elevationScale = 1) {
    const mesh = this.mesh
    const p = this.depth
    if (!mesh || !p || !this.ready(gl)) return
    gl.bindVertexArray(null)
    gl.useProgram(p.program)
    gl.uniform1f(p.u.u_elevation_scale, elevationScale)
    gl.uniform1i(p.u.u_lifted, mesh.lift ? 1 : 0)
    gl.uniformMatrix4fv(p.u.u_matrix, false, lightAbout(frame.light, mesh.origin))
    this.drawWith(gl, p)
  }

  private drawWith(gl: WebGL2RenderingContext, p: Program) {
    const mesh = this.mesh!
    const attach = (loc: number, buffer: WebGLBuffer, size: number) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0)
      gl.vertexAttribDivisor(loc, 0)
    }
    attach(p.position, mesh.position, 3)
    if (p.ground >= 0) attach(p.ground, mesh.ground, 1)
    if (p.lift >= 0 && mesh.lift) attach(p.lift, mesh.lift, 1)
    else if (p.lift >= 0) gl.vertexAttrib1f(p.lift, 0)
    if (mesh.indices) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indices)
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null)
    } else gl.drawArrays(gl.TRIANGLES, 0, mesh.count)
    gl.disableVertexAttribArray(p.position)
    if (p.ground >= 0) gl.disableVertexAttribArray(p.ground)
    if (p.lift >= 0 && mesh.lift) gl.disableVertexAttribArray(p.lift)
  }

  delete(gl: WebGL2RenderingContext) {
    this.clear(gl)
    if (this.shared && --this.shared.users === 0) {
      gl.deleteProgram(this.shared.mask.program)
      gl.deleteProgram(this.shared.depth.program)
      sharedPrograms.delete(gl)
    }
    this.shared = null
    this.mask = this.depth = null
  }
}
