/**
 * The flat-shaded, sun-lit program decks and tunnels draw with, and the
 * buffers a built mesh is uploaded into.
 */
import type { Mesh } from './decks'
import { linkProgram, programReady } from '@/lib/map/rendering/gl-program'
import { MATERIALS } from './baked/mesh-file'
import { bindOcclusion, bindSun, GROUND_OCCLUSION_GLSL, GROUND_OCCLUSION_UNIFORMS, lightAbout, SUN_SHADOW_GLSL, SUN_SHADOW_UNIFORMS, type GroundOcclusion, type SunFrame } from '@/lib/map/sun-shadow'

// `a_low` is the colour below street zoom. `a_bias` moves a vertex along its own
// sight line, so it keeps its place on screen but wins the depth test against ground that many metres in front.
const VS = `#version 300 es
  uniform mat4 u_matrix;
  uniform float u_elevation_scale;
  uniform bool u_lifted;
  uniform bool u_materials;
  uniform vec3 u_palette[${MATERIALS.length}];
  uniform float u_travelled;
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
  in float a_lift;
  out vec3 v_color;
  out vec4 v_sun;
  out float v_slope;
  uniform mat4 u_occlusionUv;
  uniform float u_grade_bias;
  out vec2 v_occlusion;
  out float v_grade;
  int routeSlot(int slot, int shift) {
    return slot == ${MATERIALS.indexOf('route')} || slot == ${MATERIALS.indexOf('routeCasing')} ? slot + shift : slot;
  }
  void main() {
    vec3 n = normalize(vec3(a_normal.xy, u_lifted ? a_normal.z : a_normal.z / u_elevation_scale));
    float sun = dot(n, u_light) * 0.5 + 0.5;
    float sky = n.z * 0.5 + 0.5;
    float lit = mix(0.62, 1.0, mix(sun, sky, 0.6));
    // A deck's top is the flat road's colour, unshaded, so it meets the road it carries.
    // A route vertex carries its metres along the route in y; behind u_travelled it takes the travelled slot.
    int shift = a_color.y >= 0.0 && a_color.y < u_travelled ? ${MATERIALS.indexOf('travelled') - MATERIALS.indexOf('route')} : 0;
    vec3 high = u_materials ? u_palette[routeSlot(int(a_color.x), shift)] : a_color;
    vec3 low = u_materials ? u_palette[routeSlot(int(a_low.x), shift)] : a_low;
    v_color = mix(low, high, u_hd) * max(lit, n.z);
    // Lifted: a structure stands its true height over the exaggerated ground beneath it.
    vec3 p = vec3(a_position.xy, u_lifted ? a_position.z + (u_elevation_scale - 1.0) * a_lift : a_position.z * u_elevation_scale);
    // A painted line is widened to at least u_min_px across on screen, as the flat roads' lines are.
    if (a_spread.z > 0.0) {
      vec4 c0 = u_matrix * vec4(p, 1.0);
      vec4 c1 = u_matrix * vec4(p + vec3(a_spread.xy, 0.0), 1.0);
      float px = length((c1.xy / c1.w - c0.xy / c0.w) * u_viewport * 0.5);
      p.xy += a_spread.xy * max(0.0, u_min_px * 0.5 / max(px, 1e-6) - a_spread.z);
    }
    v_sun = u_sunLight * vec4(p, 1.0);
    v_occlusion = (u_occlusionUv * vec4(p, 1.0)).xy;
    // 1 where the surface lies on the ground, by the bias a vertex there has, to 0 clear of it.
    v_grade = u_grade_bias > 0.0 ? clamp(a_bias / u_grade_bias, 0.0, 1.0) : 0.0;
    v_slope = sqrt(max(0.0, 1.0 - n.z * n.z)) / max(abs(n.z), 0.2);
    if (a_bias > 0.0) p += normalize(u_eye - p) * a_bias * u_per_metre;
    gl_Position = u_matrix * vec4(p, 1.0);
  }`

// In the sun's shadow a surface takes the tint the ground beside it does, and lying on the ground, its occlusion.
const FS = `#version 300 es
  precision highp float;
  uniform float u_shadowAlpha;
  uniform vec3 u_shadowColor;
  in vec3 v_color;
  in vec4 v_sun;
  in float v_slope;
  in vec2 v_occlusion;
  in float v_grade;
  out vec4 fragColor;
  ${SUN_SHADOW_GLSL}
  ${GROUND_OCCLUSION_GLSL}
  void main() {
    float shadow = u_shadowAlpha * sunShade(v_sun, v_slope);
    float occlusion = v_grade > 0.0 ? v_grade * groundOcclusion(v_occlusion) : 0.0;
    fragColor = vec4(v_color * (1.0 - shadow) * (1.0 - occlusion) + u_shadowColor * shadow, 1.0);
  }`

/** How an attribute's buffer is read: its GL type, and whether integers are normalised to [-1, 1]. */
type Layout = { type: number; normalized: boolean }
export type MeshBuffers = { position: WebGLBuffer; normal: WebGLBuffer; color: WebGLBuffer; low: WebGLBuffer | null; bias: WebGLBuffer | null; spread: WebGLBuffer | null; lift?: WebGLBuffer | null; count: number; indices?: WebGLBuffer | null; vao?: WebGLVertexArrayObject | null; layouts?: Partial<Record<'normal' | 'color' | 'low', Layout>> }

export function linkMeshProgram(gl: WebGL2RenderingContext, deferred = false): WebGLProgram {
  const program = linkProgram(gl, VS, FS)
  if (!deferred) programReady(gl, program, 'mesh')
  return program
}

/** Normals may come as signed bytes (read normalised) and palette slots as unsigned bytes, as compact meshes store them. */
export type MeshUpload = Omit<{ [K in keyof Mesh]: number[] | Float32Array }, 'normal' | 'color' | 'low'> & { normal: number[] | Float32Array | Int8Array; color: number[] | Float32Array | Uint8Array; low?: number[] | Float32Array | Uint8Array; indices?: Uint32Array }

export function uploadMesh(gl: WebGL2RenderingContext, mesh: MeshUpload): MeshBuffers {
  const upload = (data: number[] | Float32Array | Int8Array | Uint8Array) => {
    const buffer = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, ArrayBuffer.isView(data) ? data : new Float32Array(data), gl.STATIC_DRAW)
    return buffer
  }
  const layout = (data: unknown): Layout | undefined => data instanceof Int8Array ? { type: gl.BYTE, normalized: true } : data instanceof Uint8Array ? { type: gl.UNSIGNED_BYTE, normalized: false } : undefined
  const count = mesh.position.length / 3
  gl.bindVertexArray(null)
  const indices = mesh.indices ? gl.createBuffer() : null
  if (indices) {
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices!, gl.STATIC_DRAW)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null)
  }
  return {
    indices,
    position: upload(mesh.position),
    normal: upload(mesh.normal),
    color: upload(mesh.color),
    low: mesh.low?.length === count * 3 ? upload(mesh.low) : null,
    bias: mesh.bias?.length === count ? upload(mesh.bias) : null,
    spread: mesh.spread?.length === count * 3 ? upload(mesh.spread) : null,
    lift: mesh.lift?.length === count ? upload(mesh.lift) : null,
    count: mesh.indices?.length ?? count,
    layouts: { normal: layout(mesh.normal), color: layout(mesh.color), low: mesh.low?.length === count * 3 ? layout(mesh.low) : layout(mesh.color) },
  }
}

export function deleteMesh(gl: WebGL2RenderingContext, buffers: MeshBuffers | null) {
  if (!buffers) return
  for (const b of [buffers.position, buffers.normal, buffers.color, buffers.low, buffers.bias, buffers.spread, buffers.lift, buffers.indices]) if (b) gl.deleteBuffer(b)
  if (buffers.vao) gl.deleteVertexArray(buffers.vao)
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

/** What every mesh drawn in a frame shares besides the light. */
export type MeshFrame = {
  elevationScale?: number; palette?: Float32Array
  /** How far toward street zoom the view is, 1 there. */
  hd?: number; minLinePx?: number; pixelRatio?: number
  /** The buildings' shadows: their sun shadow map, and how dark and what colour a shadow is. */
  sun?: { frame: SunFrame | null; alpha: number; color?: readonly number[] }
  /** The ground's occlusion, and the bias a vertex lying on the ground has: what lies there is darkened as the ground is. */
  occlusion?: { map: GroundOcclusion | null; gradeBias: number }
}

/** What one mesh's draw needs besides its matrix. */
export type MeshView = {
  /** The origin the mesh is drawn about, for its place in the sun's shadow map. */
  origin?: [number, number]
  /** Metres of route already travelled: route vertices measured short of it are drawn travelled. */
  travelled?: number
  /** The eye about the mesh's origin, and mercator units to a metre, for biased vertices. */
  eye?: [number, number, number] | null; perMetre?: number
}

type Locations = { uniforms: Record<'matrix' | 'light' | 'hd' | 'eye' | 'perMetre' | 'viewport' | 'minPx' | 'sunLight' | 'shadowAlpha' | 'shadowColor' | 'occlusionUv' | 'gradeBias' | 'elevationScale' | 'lifted' | 'materials' | 'palette' | 'travelled', WebGLUniformLocation | null>; sun: Record<string, WebGLUniformLocation | null>; occlusion: Record<string, WebGLUniformLocation | null>; attributes: number[]; frame: SunFrame | null; ground: GroundOcclusion | null }
const locations = new WeakMap<WebGLProgram, Locations>()

const BLACK = [0, 0, 0]
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

function locate(gl: WebGL2RenderingContext, program: WebGLProgram): Locations {
  let at = locations.get(program)
  if (at) return at
  const u = (name: string) => gl.getUniformLocation(program, name)
  at = {
    uniforms: { elevationScale: u('u_elevation_scale'), lifted: u('u_lifted'), materials: u('u_materials'), palette: u('u_palette[0]'), travelled: u('u_travelled'), matrix: u('u_matrix'), light: u('u_light'), hd: u('u_hd'), eye: u('u_eye'), perMetre: u('u_per_metre'), viewport: u('u_viewport'), minPx: u('u_min_px'), sunLight: u('u_sunLight'), shadowAlpha: u('u_shadowAlpha'), shadowColor: u('u_shadowColor'), occlusionUv: u('u_occlusionUv'), gradeBias: u('u_grade_bias') },
    sun: Object.fromEntries(SUN_SHADOW_UNIFORMS.map(name => [name, u(name)])),
    occlusion: Object.fromEntries(GROUND_OCCLUSION_UNIFORMS.map(name => [name, u(name)])),
    attributes: ['a_position', 'a_normal', 'a_color', 'a_low', 'a_bias', 'a_spread', 'a_lift'].map(name => gl.getAttribLocation(program, name)),
    frame: null,
    ground: null,
  }
  locations.set(program, at)
  return at
}

/** Take up the program with what every mesh drawn this frame shares: the style's light, the palette and the sun's shadows. */
export function useMeshProgram(gl: WebGL2RenderingContext, program: WebGLProgram, light: number[], frame: MeshFrame = {}) {
  const at = locate(gl, program)
  gl.useProgram(program)
  gl.uniform1f(at.uniforms.elevationScale, frame.elevationScale ?? 1)
  gl.uniform1i(at.uniforms.materials, frame.palette ? 1 : 0)
  if (frame.palette) gl.uniform3fv(at.uniforms.palette, frame.palette)
  const l = Math.hypot(light[0], light[1], light[2]) || 1
  gl.uniform3f(at.uniforms.light, light[0] / l, light[1] / l, light[2] / l)
  gl.uniform1f(at.uniforms.hd, frame.hd ?? 1)
  gl.uniform2f(at.uniforms.viewport, gl.drawingBufferWidth, gl.drawingBufferHeight)
  gl.uniform1f(at.uniforms.minPx, (frame.minLinePx ?? 0) * (frame.pixelRatio ?? 1))
  const sun = frame.sun?.frame ? frame.sun : null
  at.frame = sun?.frame ?? null
  bindSun(gl, at.sun, at.frame)
  gl.uniform1f(at.uniforms.shadowAlpha, sun?.alpha ?? 0)
  gl.uniform3fv(at.uniforms.shadowColor, sun?.color ?? BLACK)
  at.ground = frame.occlusion?.map ?? null
  bindOcclusion(gl, at.occlusion, at.ground)
  gl.uniform1f(at.uniforms.gradeBias, at.ground ? frame.occlusion!.gradeBias : 0)
  // A mesh without a bias, spread or lift of its own reads these: attribute constants belong to the context, not to a vertex array.
  const [, , , , bias, spread, lift] = at.attributes
  if (bias >= 0) gl.vertexAttrib1f(bias, 0)
  if (spread >= 0) gl.vertexAttrib3f(spread, 0, 0, 0)
  if (lift >= 0) gl.vertexAttrib1f(lift, 0)
}

/** A mesh's buffers pointed at the program's attributes, once. */
function vertexArray(gl: WebGL2RenderingContext, at: Locations, buffers: MeshBuffers): WebGLVertexArrayObject | null {
  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)
  const [position, normal, color, low, bias, spread, lift] = at.attributes
  const point = (loc: number, buffer: WebGLBuffer | null | undefined, size: number, layout?: Layout) => {
    if (loc < 0 || !buffer) return
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, size, layout?.type ?? gl.FLOAT, layout?.normalized ?? false, 0, 0)
  }
  point(position, buffers.position, 3)
  point(normal, buffers.normal, 3, buffers.layouts?.normal)
  point(color, buffers.color, 3, buffers.layouts?.color)
  point(low, buffers.low ?? buffers.color, 3, buffers.layouts?.low)
  point(bias, buffers.bias, 1)
  point(spread, buffers.spread, 3)
  point(lift, buffers.lift, 1)
  if (buffers.indices) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indices)
  return vao
}

/**
 * Bind a mesh for drawing with the program `useMeshProgram` took up; returns a
 * draw for a range of vertices and an unbind. A mesh without low colours or
 * biases draws its own colours, unbiased.
 */
export function bindMesh(gl: WebGL2RenderingContext, program: WebGLProgram, buffers: MeshBuffers, matrix: Float32Array, view: MeshView = {}) {
  const at = locate(gl, program)
  gl.uniformMatrix4fv(at.uniforms.matrix, false, matrix)
  gl.uniform1f(at.uniforms.travelled, view.travelled ?? -1)
  const eye = view.eye ?? null
  gl.uniform3f(at.uniforms.eye, eye?.[0] ?? 0, eye?.[1] ?? 0, eye?.[2] ?? 0)
  // No eye, no bias: a zero scale leaves every vertex where it is.
  const biased = eye ? (view.perMetre ?? 0) : 0
  gl.uniform1f(at.uniforms.perMetre, biased)
  gl.uniformMatrix4fv(at.uniforms.sunLight, false, at.frame && view.origin ? lightAbout(at.frame.light, view.origin) : IDENTITY)
  gl.uniformMatrix4fv(at.uniforms.occlusionUv, false, at.ground && view.origin ? lightAbout(at.ground.uv, view.origin) : IDENTITY)
  gl.uniform1i(at.uniforms.lifted, buffers.lift ? 1 : 0)
  if (buffers.vao) gl.bindVertexArray(buffers.vao)
  else buffers.vao = vertexArray(gl, at, buffers)
  return {
    draw: (from = 0, to = buffers.count) => {
      if (to <= from) return
      if (buffers.indices) gl.drawElements(gl.TRIANGLES, to - from, gl.UNSIGNED_INT, from * 4)
      else gl.drawArrays(gl.TRIANGLES, from, to - from)
    },
    /** Draw the biased vertices where they are biased to, or where they are. */
    bias: (on: boolean) => gl.uniform1f(at.uniforms.perMetre, on ? biased : 0),
    unbind: () => gl.bindVertexArray(null),
  }
}
