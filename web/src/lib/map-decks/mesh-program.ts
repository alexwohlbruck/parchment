/**
 * The flat-shaded, sun-lit program decks and tunnels draw with, and the
 * buffers a built mesh is uploaded into.
 */
import type { Mesh } from './decks'
import { bindSun, multiply, SUN_SHADOW_GLSL, SUN_SHADOW_UNIFORMS, type SunFrame } from '@/lib/map/sun-shadow'

// `a_low` is the colour below street zoom. `a_bias` moves a vertex along its own
// sight line, so it keeps its place on screen but wins the depth test against ground that many metres in front.
const VS = `#version 300 es
  uniform mat4 u_matrix;
  uniform mat4 u_sunLight;
  uniform vec3 u_light;
  uniform float u_hd;
  uniform vec3 u_eye;
  uniform float u_per_metre;
  uniform vec2 u_viewport;
  uniform float u_min_px;
  in vec3 a_position;
  in vec3 a_normal;
  in vec3 a_color;
  in vec3 a_low;
  in float a_bias;
  in vec3 a_spread;
  out vec3 v_color;
  out vec4 v_sun;
  out float v_slope;
  out float v_grade;
  uniform float u_grade_bias;
  void main() {
    vec3 n = normalize(a_normal);
    float sun = dot(n, u_light) * 0.5 + 0.5;
    float sky = n.z * 0.5 + 0.5;
    float lit = mix(0.62, 1.0, mix(sun, sky, 0.6));
    // A deck's top is the flat road's colour, unshaded, so it meets the road it carries.
    v_color = mix(a_low, a_color, u_hd) * max(lit, n.z);
    vec3 p = a_position;
    // A painted line is widened to at least u_min_px across on screen, as the flat roads' lines are.
    if (a_spread.z > 0.0) {
      vec4 c0 = u_matrix * vec4(p, 1.0);
      vec4 c1 = u_matrix * vec4(p + vec3(a_spread.xy, 0.0), 1.0);
      float px = length((c1.xy / c1.w - c0.xy / c0.w) * u_viewport * 0.5);
      p.xy += a_spread.xy * max(0.0, u_min_px * 0.5 / max(px, 1e-6) - a_spread.z);
    }
    v_sun = u_sunLight * vec4(p, 1.0);
    v_slope = sqrt(max(0.0, 1.0 - n.z * n.z)) / max(abs(n.z), 0.2);
    v_grade = u_grade_bias > 0.0 ? clamp(a_bias / u_grade_bias, 0.0, 1.0) : 0.0;
    if (a_bias > 0.0) p += normalize(u_eye - p) * a_bias * u_per_metre;
    gl_Position = u_matrix * vec4(p, 1.0);
  }`

// At grade a deck lies in the buildings' ground shadow, read from the same screen-space mask
// and blurred as the ground's; standing clear of the ground, in their sun shadow.
const FS = `#version 300 es
  precision highp float;
  uniform float u_shadowAlpha;
  uniform sampler2D u_mask;
  uniform float u_maskAlpha;
  uniform float u_maskBlur;
  uniform vec2 u_viewport;
  in vec3 v_color;
  in vec4 v_sun;
  in float v_slope;
  in float v_grade;
  out vec4 fragColor;
  ${SUN_SHADOW_GLSL}
  float groundShade() {
    if (u_maskAlpha <= 0.0) return 0.0;
    vec2 uv = gl_FragCoord.xy / u_viewport;
    float sh = 0.0, sw = 0.0;
    for (int dy = -2; dy <= 2; dy++)
      for (int dx = -2; dx <= 2; dx++) {
        float w = exp(-0.5 * float(dx * dx + dy * dy));
        sh += textureLod(u_mask, uv + vec2(float(dx), float(dy)) * u_maskBlur, 0.0).a * w;
        sw += w;
      }
    return sh / sw * u_maskAlpha;
  }
  void main() {
    float shade = max(groundShade() * v_grade, u_shadowAlpha * sunShade(v_sun, v_slope) * (1.0 - v_grade));
    fragColor = vec4(v_color * (1.0 - shade), 1.0);
  }`

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
export type MeshView = {
  hd?: number; eye?: [number, number, number] | null; perMetre?: number; minLinePx?: number
  /**
   * The buildings' shadows: their sun shadow map, the origin the mesh is drawn about and how dark a shadow is;
   * their screen-space ground shadow mask; and the bias a vertex lying on the ground has.
   */
  sun?: { frame: SunFrame | null; origin: [number, number]; alpha: number; ground: { texture: WebGLTexture; blurStep: number; alpha: number } | null; gradeBias: number }
}

/**
 * Bind the program with its matrix and the style's light, and the buffers to
 * its attributes; returns a draw for a range of vertices and an unbind. A mesh
 * without low colours or biases draws its own colours, unbiased.
 */
type Locations = { uniforms: Record<'matrix' | 'light' | 'hd' | 'eye' | 'perMetre' | 'viewport' | 'minPx' | 'sunLight' | 'shadowAlpha' | 'mask' | 'maskAlpha' | 'maskBlur' | 'gradeBias', WebGLUniformLocation | null>; sun: Record<string, WebGLUniformLocation | null>; attributes: number[] }
const locations = new WeakMap<WebGLProgram, Locations>()
/** The texture unit the ground shadow mask is bound to; the sun's map takes `SUN_SHADOW_UNIT`. */
const MASK_UNIT = 6
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

export function bindMesh(gl: WebGL2RenderingContext, program: WebGLProgram, buffers: MeshBuffers, matrix: Float32Array, light: number[], view: MeshView = {}) {
  let at = locations.get(program)
  if (!at) {
    const u = (name: string) => gl.getUniformLocation(program, name)
    at = {
      uniforms: { matrix: u('u_matrix'), light: u('u_light'), hd: u('u_hd'), eye: u('u_eye'), perMetre: u('u_per_metre'), viewport: u('u_viewport'), minPx: u('u_min_px'), sunLight: u('u_sunLight'), shadowAlpha: u('u_shadowAlpha'), mask: u('u_mask'), maskAlpha: u('u_maskAlpha'), maskBlur: u('u_maskBlur'), gradeBias: u('u_grade_bias') },
      sun: Object.fromEntries(SUN_SHADOW_UNIFORMS.map(name => [name, u(name)])),
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
  const ground = view.sun?.ground ?? null
  gl.uniform1f(at.uniforms.gradeBias, view.sun?.gradeBias ?? 0)
  gl.uniform1f(at.uniforms.maskAlpha, ground?.alpha ?? 0)
  gl.uniform1f(at.uniforms.maskBlur, ground?.blurStep ?? 0)
  gl.uniform1i(at.uniforms.mask, MASK_UNIT)
  gl.activeTexture(gl.TEXTURE0 + MASK_UNIT)
  gl.bindTexture(gl.TEXTURE_2D, ground?.texture ?? null)
  gl.activeTexture(gl.TEXTURE0)
  const sun = view.sun?.frame ? view.sun : null
  bindSun(gl, at.sun, sun?.frame ?? null)
  gl.uniform1f(at.uniforms.shadowAlpha, sun?.alpha ?? 0)
  // Composed in double precision about the mesh's origin, so a mesh drawn near it keeps its float precision.
  gl.uniformMatrix4fv(at.uniforms.sunLight, false, sun ? Float32Array.from(multiply(sun.frame!.light, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, sun.origin[0], sun.origin[1], 0, 1])) : IDENTITY)
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
