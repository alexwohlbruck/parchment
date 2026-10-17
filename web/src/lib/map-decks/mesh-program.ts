/**
 * The flat-shaded, sun-lit program decks and tunnels draw with, and the
 * buffers a built mesh is uploaded into.
 */
import type { Mesh } from './decks'

// `a_low` is the colour below street zoom. `a_bias` moves a vertex along its own
// sight line, so it keeps its place on screen but wins the depth test against ground that many metres in front.
const VS = `
  uniform mat4 u_matrix;
  uniform vec3 u_light;
  uniform float u_hd;
  uniform vec3 u_eye;
  uniform float u_per_metre;
  uniform vec2 u_viewport;
  uniform float u_min_px;
  attribute vec3 a_position;
  attribute vec3 a_spread;
  attribute vec3 a_normal;
  attribute vec3 a_color;
  attribute vec3 a_low;
  attribute float a_bias;
  varying vec3 v_color;
  void main() {
    float sun = dot(normalize(a_normal), u_light) * 0.5 + 0.5;
    float sky = normalize(a_normal).z * 0.5 + 0.5;
    float lit = mix(0.62, 1.0, mix(sun, sky, 0.6));
    // A deck's top is the flat road's colour, unshaded, so it meets the road it carries.
    v_color = mix(a_low, a_color, u_hd) * max(lit, normalize(a_normal).z);
    vec3 p = a_position;
    // A painted line is widened to at least u_min_px across on screen, as the flat roads' lines are.
    if (a_spread.z > 0.0) {
      vec4 c0 = u_matrix * vec4(p, 1.0);
      vec4 c1 = u_matrix * vec4(p + vec3(a_spread.xy, 0.0), 1.0);
      float px = length((c1.xy / c1.w - c0.xy / c0.w) * u_viewport * 0.5);
      p.xy += a_spread.xy * max(0.0, u_min_px * 0.5 / max(px, 1e-6) - a_spread.z);
    }
    if (a_bias > 0.0) p += normalize(u_eye - p) * a_bias * u_per_metre;
    gl_Position = u_matrix * vec4(p, 1.0);
  }`

const FS = `
  precision mediump float;
  varying vec3 v_color;
  void main() { gl_FragColor = vec4(v_color, 1.0); }`

export type MeshBuffers = { position: WebGLBuffer; normal: WebGLBuffer; color: WebGLBuffer; low: WebGLBuffer | null; bias: WebGLBuffer | null; spread: WebGLBuffer | null; count: number }

export function linkMeshProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const program = gl.createProgram()!
  for (const [type, source] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]] as const) {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    gl.attachShader(program, shader)
  }
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) console.error('[mesh] link:', gl.getProgramInfoLog(program))
  return program
}

export function uploadMesh(gl: WebGL2RenderingContext, mesh: Mesh): MeshBuffers {
  const upload = (data: number[]) => {
    const buffer = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW)
    return buffer
  }
  const count = mesh.position.length / 3
  return {
    position: upload(mesh.position),
    normal: upload(mesh.normal),
    color: upload(mesh.color),
    low: mesh.low?.length === count * 3 ? upload(mesh.low) : null,
    bias: mesh.bias?.length === count ? upload(mesh.bias) : null,
    spread: mesh.spread?.length === count * 3 ? upload(mesh.spread) : null,
    count,
  }
}

export function deleteMesh(gl: WebGL2RenderingContext, buffers: MeshBuffers | null) {
  if (buffers) for (const b of [buffers.position, buffers.normal, buffers.color, buffers.low, buffers.bias, buffers.spread]) if (b) gl.deleteBuffer(b)
}

/**
 * The camera's position in the space a matrix projects from: the point its x,
 * y and w rows all send to zero. Null for a matrix with no such point.
 */
export function eyeOf(m: ArrayLike<number>): [number, number, number] | null {
  const row = (i: number) => [m[i], m[4 + i], m[8 + i], m[12 + i]]
  const [a, b, c] = [row(0), row(1), row(3)]
  const det3 = (x: number[], y: number[], z: number[]) =>
    x[0] * (y[1] * z[2] - y[2] * z[1]) - x[1] * (y[0] * z[2] - y[2] * z[0]) + x[2] * (y[0] * z[1] - y[1] * z[0])
  const minor = (skip: number) => {
    const pick = (v: number[]) => v.filter((_, k) => k !== skip)
    return det3(pick(a), pick(b), pick(c))
  }
  const h = [minor(0), -minor(1), minor(2), -minor(3)]
  if (!h[3]) return null
  return [h[0] / h[3], h[1] / h[3], h[2] / h[3]]
}

/** What a draw needs besides the matrix and light: how far toward street zoom it is (1 there) and the eye, for biased vertices. */
export type MeshView = { hd?: number; eye?: [number, number, number] | null; perMetre?: number; minLinePx?: number }

/**
 * Bind the program with its matrix and the style's light, and the buffers to
 * its attributes; returns a draw for a range of vertices and an unbind. A mesh
 * without low colours or biases draws its own colours, unbiased.
 */
type Locations = { uniforms: Record<'matrix' | 'light' | 'hd' | 'eye' | 'perMetre' | 'viewport' | 'minPx', WebGLUniformLocation | null>; attributes: number[] }
const locations = new WeakMap<WebGLProgram, Locations>()

export function bindMesh(gl: WebGL2RenderingContext, program: WebGLProgram, buffers: MeshBuffers, matrix: Float32Array, light: number[], view: MeshView = {}) {
  let at = locations.get(program)
  if (!at) {
    const u = (name: string) => gl.getUniformLocation(program, name)
    at = {
      uniforms: { matrix: u('u_matrix'), light: u('u_light'), hd: u('u_hd'), eye: u('u_eye'), perMetre: u('u_per_metre'), viewport: u('u_viewport'), minPx: u('u_min_px') },
      attributes: ['a_position', 'a_normal', 'a_color', 'a_low', 'a_bias', 'a_spread'].map(name => gl.getAttribLocation(program, name)),
    }
    locations.set(program, at)
  }
  gl.useProgram(program)
  gl.uniformMatrix4fv(at.uniforms.matrix, false, matrix)
  const l = Math.hypot(light[0], light[1], light[2]) || 1
  gl.uniform3f(at.uniforms.light, light[0] / l, light[1] / l, light[2] / l)
  gl.uniform1f(at.uniforms.hd, view.hd ?? 1)
  const eye = view.eye ?? null
  gl.uniform3f(at.uniforms.eye, eye?.[0] ?? 0, eye?.[1] ?? 0, eye?.[2] ?? 0)
  // No eye, no bias: a zero scale leaves every vertex where it is.
  const biased = eye ? (view.perMetre ?? 0) : 0
  gl.uniform1f(at.uniforms.perMetre, biased)
  gl.uniform2f(at.uniforms.viewport, gl.drawingBufferWidth, gl.drawingBufferHeight)
  gl.uniform1f(at.uniforms.minPx, (view.minLinePx ?? 0) * (globalThis.devicePixelRatio || 1))
  gl.bindVertexArray(null)
  const [position, normal, color, low, bias, spread] = at.attributes
  const enabled: number[] = []
  const bind = (loc: number, buffer: WebGLBuffer, size: number) => {
    if (loc < 0) return
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0)
    enabled.push(loc)
  }
  bind(position, buffers.position, 3)
  bind(normal, buffers.normal, 3)
  bind(color, buffers.color, 3)
  bind(low, buffers.low ?? buffers.color, 3)
  if (buffers.bias) bind(bias, buffers.bias, 1)
  else if (bias >= 0) gl.vertexAttrib1f(bias, 0)
  if (buffers.spread) bind(spread, buffers.spread, 3)
  else if (spread >= 0) gl.vertexAttrib3f(spread, 0, 0, 0)
  return {
    draw: (from = 0, to = buffers.count) => {
      if (to > from) gl.drawArrays(gl.TRIANGLES, from, to - from)
    },
    /** Draw the biased vertices where they are biased to, or where they are. */
    bias: (on: boolean) => gl.uniform1f(at!.uniforms.perMetre, on ? biased : 0),
    unbind: () => {
      for (const loc of enabled) gl.disableVertexAttribArray(loc)
    },
  }
}
