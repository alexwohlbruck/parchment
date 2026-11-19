/**
 * A built mesh — decks, tunnel walls — as a shadow caster beside the
 * buildings: drawn into the sun's shadow map. See `ShadowCaster` in
 * `building-shade.ts`.
 */
import { programReady } from './mesh-program'
import { lightAbout, type SunFrame } from '@/lib/map/sun-shadow'
import type { Point } from './decks'

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

type Program = { uniforms: string[]; initialized?: boolean; program: WebGLProgram; u: Record<string, WebGLUniformLocation | null>; position: number; lift: number }

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
    uniforms, u: {}, position: -1, lift: -1,
  }
}

type SharedPrograms = { depth: Program; users: number }
const sharedPrograms = new WeakMap<WebGL2RenderingContext, SharedPrograms>()

export class MeshShadow {
  private shared: SharedPrograms | null = null
  /** Bumped with every mesh set, for the shading's caches. */
  version = 0
  private depth: Program | null = null
  private mesh: { position: WebGLBuffer; lift: WebGLBuffer | null; count: number; origin: Point; indices?: WebGLBuffer | null } | null = null

  /** Cast the first `count` vertices in `position`, drawn about `origin`. */
  set(gl: WebGL2RenderingContext, position: WebGLBuffer | null, count: number, origin: Point, indices?: WebGLBuffer | null, lift: WebGLBuffer | null = null) {
    this.mesh = null
    this.version++
    if (!position || !count) return
    this.prepare(gl)
    this.mesh = { indices, position, lift, count, origin: [origin[0], origin[1]] }
  }

  prepare(gl: WebGL2RenderingContext) {
    // Linked here, by the owning layer, rather than inside another layer's pass.
    if (!this.shared) {
      let shared = sharedPrograms.get(gl)
      if (!shared) {
        shared = { depth: link(gl, DEPTH_VS, DEPTH_FS, ['u_elevation_scale', 'u_lifted', 'u_matrix']), users: 0 }
        sharedPrograms.set(gl, shared)
      }
      shared.users++
      this.shared = shared
      this.depth = shared.depth
    }
  }

  ready(gl: WebGL2RenderingContext) {
    const p = this.shared?.depth
    if (!p || !programReady(gl, p.program)) return false
    if (!p.initialized) {
      p.u = Object.fromEntries(p.uniforms.map(name => [name, gl.getUniformLocation(p.program, name)]))
      p.position = gl.getAttribLocation(p.program, 'a_position')
      p.lift = gl.getAttribLocation(p.program, 'a_lift')
      p.initialized = true
    }
    return true
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
    if (p.lift >= 0 && mesh.lift) attach(p.lift, mesh.lift, 1)
    else if (p.lift >= 0) gl.vertexAttrib1f(p.lift, 0)
    if (mesh.indices) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indices)
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null)
    } else gl.drawArrays(gl.TRIANGLES, 0, mesh.count)
    gl.disableVertexAttribArray(p.position)
    if (p.lift >= 0 && mesh.lift) gl.disableVertexAttribArray(p.lift)
  }

  delete(gl: WebGL2RenderingContext) {
    this.mesh = null
    if (this.shared && --this.shared.users === 0) {
      gl.deleteProgram(this.shared.depth.program)
      sharedPrograms.delete(gl)
    }
    this.shared = null
    this.depth = null
  }
}
