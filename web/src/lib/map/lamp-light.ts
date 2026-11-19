/**
 * Lamplight at night: one map of the light on the ground, drawn from overhead
 * by MapLibre's shading (`Map.setShading`) from whatever each `ShadowCaster`
 * says its lamps throw, and from the buildings whose windows are lit. The
 * ground and the buildings read it in the engine; the custom layers read it
 * here, at the ground occlusion's texture coordinates.
 */
import type { GroundLights } from 'maplibre-gl'

export type { GroundLights }

export const LIGHTS_UNIT = 7

/** Floats per pool in `LightPools.set`: centre, radius, colour. */
export const POOL_FLOATS = 7

/**
 * `lampLight(uv, height)`: the light reaching a surface `height` metres over a
 * point of the ground, linear rgb to add to the surface in its own colour.
 */
export const LAMP_LIGHT_GLSL = `
  uniform sampler2D u_lightMap;
  uniform vec4 u_lightSpill; // the spill's colour at the light's strength, and that strength: 0 by day
  uniform float u_lightHeight; // metres up the light fades over
  vec3 lampLight(vec2 uv, float height) {
    if (u_lightSpill.a <= 0.0) return vec3(0.0);
    vec2 edge = abs(uv * 2.0 - 1.0);
    float reach = max(edge.x, edge.y);
    if (reach >= 1.0) return vec3(0.0);
    vec4 light = textureLod(u_lightMap, uv, 0.0);
    return (light.rgb * u_lightSpill.a + u_lightSpill.rgb * light.a)
      * (1.0 - smoothstep(0.8, 1.0, reach)) * exp(-max(height, 0.0) / u_lightHeight);
  }
`

export const LAMP_LIGHT_UNIFORMS = ['u_lightMap', 'u_lightSpill', 'u_lightHeight'] as const

const clears = new WeakMap<WebGL2RenderingContext, WebGLTexture>()

function clearTexture(gl: WebGL2RenderingContext): WebGLTexture {
  let t = clears.get(gl)
  if (t) return t
  t = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, t)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
  clears.set(gl, t)
  return t
}

/** Point the receiver's sampler at this frame's lamplight, or at nothing. */
export function bindLights(gl: WebGL2RenderingContext, u: Record<string, WebGLUniformLocation | null>, lights: GroundLights | null, height = 6) {
  const k = lights?.strength ?? 0
  const spill = lights?.spillColor ?? [0, 0, 0]
  gl.uniform4f(u.u_lightSpill, spill[0] * k, spill[1] * k, spill[2] * k, k)
  gl.uniform1f(u.u_lightHeight, height)
  gl.uniform1i(u.u_lightMap, LIGHTS_UNIT)
  gl.activeTexture(gl.TEXTURE0 + LIGHTS_UNIT)
  gl.bindTexture(gl.TEXTURE_2D, lights ? lights.texture : clearTexture(gl))
  gl.activeTexture(gl.TEXTURE0)
}

const POOL_VS = `#version 300 es
  uniform mat4 u_matrix;
  uniform mat3 u_local;
  uniform float u_scale;
  uniform vec2 u_billboard; // clip units per unit of the frame, for a disc that faces the camera; zero for one on the ground
  layout(location = 0) in vec2 a_corner;
  layout(location = 1) in vec4 a_pool;
  layout(location = 2) in vec3 a_color;
  out vec2 v_corner;
  out vec3 v_color;
  void main() {
    vec3 centre = u_local * a_pool.xyz;
    v_corner = a_corner;
    v_color = a_color;
    if (u_billboard.x > 0.0) {
      gl_Position = u_matrix * vec4(centre, 1.0);
      gl_Position.xy += a_corner * a_pool.w * u_scale * u_billboard;
    } else {
      gl_Position = u_matrix * vec4(centre.xy + a_corner * a_pool.w * u_scale, 0.0, 1.0);
    }
  }`

const POOL_FS = `#version 300 es
  precision mediump float;
  in vec2 v_corner;
  in vec3 v_color;
  out vec4 color;
  void main() {
    float fall = 1.0 - clamp(length(v_corner), 0.0, 1.0);
    color = vec4(v_color * fall * fall, 0.0);
  }`

type Shared = { program: WebGLProgram; u: Record<string, WebGLUniformLocation | null>; corners: WebGLBuffer; users: number }
const shared = new WeakMap<WebGL2RenderingContext, Shared>()

const IDENTITY3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1])

/**
 * Clip units a mercator unit spans across the view, whatever its depth: the camera sees one pixel per pixel at
 * its distance to the centre, so a length facing it scales by that distance alone.
 */
export function billboardScale(transform: { worldSize: number; cameraToCenterDistance: number; width: number; height: number }): [number, number] {
  const k = 2 * transform.worldSize * transform.cameraToCenterDistance
  return [k / transform.width, k / transform.height]
}

/** Pools of light on the ground, as soft discs drawn from overhead into the lamplight. */
export class LightPools {
  private shared: Shared | null = null
  private vao: WebGLVertexArrayObject | null = null
  private buffer: WebGLBuffer | null = null
  private count = 0

  /** `pools` is `POOL_FLOATS` per pool: its centre in the frame `draw` is given, its radius, its linear colour. */
  set(gl: WebGL2RenderingContext, pools: Float32Array) {
    this.count = pools.length / POOL_FLOATS
    if (!this.count) return
    const s = this.prepare(gl)
    this.vao ??= gl.createVertexArray()!
    this.buffer ??= gl.createBuffer()!
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, s.corners)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    gl.bufferData(gl.ARRAY_BUFFER, pools, gl.STATIC_DRAW)
    for (const [loc, size, offset] of [[1, 4, 0], [2, 3, 4]]) {
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, POOL_FLOATS * 4, offset * 4)
      gl.vertexAttribDivisor(loc, 1)
    }
    gl.bindVertexArray(null)
  }

  private prepare(gl: WebGL2RenderingContext): Shared {
    if (this.shared) return this.shared
    let s = shared.get(gl)
    if (!s) {
      const program = gl.createProgram()!
      for (const [type, source] of [[gl.VERTEX_SHADER, POOL_VS], [gl.FRAGMENT_SHADER, POOL_FS]] as const) {
        const shader = gl.createShader(type)!
        gl.shaderSource(shader, source)
        gl.compileShader(shader)
        gl.attachShader(program, shader)
        gl.deleteShader(shader)
      }
      gl.linkProgram(program)
      const corners = gl.createBuffer()!
      gl.bindBuffer(gl.ARRAY_BUFFER, corners)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
      const u = Object.fromEntries(['u_matrix', 'u_local', 'u_scale', 'u_billboard'].map(n => [n, gl.getUniformLocation(program, n)]))
      shared.set(gl, (s = { program, u, corners, users: 0 }))
    }
    s.users++
    return (this.shared = s)
  }

  /**
   * Into the lamplight, from overhead. `matrix` takes the pools' frame to clip; `local` turns their centres into
   * it, and `scale` their radii. With `billboard`, as glows facing the camera instead: see `billboardScale`.
   */
  draw(gl: WebGL2RenderingContext, matrix: Float32Array, local: Float32Array = IDENTITY3, scale = 1, billboard: [number, number] = [0, 0]) {
    const s = this.shared
    if (!s || !this.count || !this.vao) return
    gl.useProgram(s.program)
    gl.uniformMatrix4fv(s.u.u_matrix, false, matrix)
    gl.uniformMatrix3fv(s.u.u_local, false, local)
    gl.uniform1f(s.u.u_scale, scale)
    gl.uniform2f(s.u.u_billboard, billboard[0], billboard[1])
    gl.bindVertexArray(this.vao)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count)
    gl.bindVertexArray(null)
  }

  delete(gl: WebGL2RenderingContext) {
    if (this.vao) gl.deleteVertexArray(this.vao)
    if (this.buffer) gl.deleteBuffer(this.buffer)
    this.vao = this.buffer = null
    this.count = 0
    if (this.shared && --this.shared.users === 0) {
      gl.deleteProgram(this.shared.program)
      gl.deleteBuffer(this.shared.corners)
      shared.delete(gl)
    }
    this.shared = null
  }
}

